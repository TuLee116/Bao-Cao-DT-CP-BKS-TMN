// API của web. Dùng chung cho Railway (server.js) và Vercel (api/index.js).
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const bcrypt = require('bcryptjs');
const { query, tx, migrate, HttpError, hasDb } = require('./db');

const SESSION_DAYS = 30;
const BCRYPT_COST = 11;
const ROLES = ['admin', 'viewer'];

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
// Nén gzip mọi phản hồi (JSON số liệu, file JS/CSS): giảm 70–90% dung lượng truyền, số liệu giữ nguyên.
app.use(compression({ threshold: 1024 }));

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin'
  });
  next();
});

// ---------------------------------------------------------------------
// Tiện ích
// ---------------------------------------------------------------------
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const fail = (status, msg) => { throw new HttpError(status, msg); };

function cookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { return null; }
    }
  }
  return null;
}

const str = (v, field, min, max) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min || s.length > max) fail(400, `${field} cần từ ${min} đến ${max} ký tự.`);
  return s;
};
const username = v => {
  const s = str(v, 'Tên đăng nhập', 3, 64);
  if (!/^[\p{L}\p{N}._@-]+$/u.test(s)) fail(400, 'Tên đăng nhập chỉ gồm chữ, số và các dấu . _ @ -');
  return s;
};
const password = v => {
  if (typeof v !== 'string' || v.length < 8 || v.length > 200) fail(400, 'Mật khẩu cần ít nhất 8 ký tự.');
  return v;
};
const intId = v => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) fail(400, 'Mã không hợp lệ.');
  return n;
};

// ---------------------------------------------------------------------
// Phiên đăng nhập (cookie HttpOnly, token ngẫu nhiên, lưu băm trong DB)
// ---------------------------------------------------------------------
async function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await query(`insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '${SESSION_DAYS} days')`, [sha256(token), userId]);
  res.cookie('sid', token, { httpOnly: true, secure: req.secure, sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 864e5 });
  query('delete from sessions where expires_at < now()').catch(() => {});
}

async function currentUser(req) {
  const t = cookie(req, 'sid');
  if (!t) return null;
  const r = await query(
    `select u.id, u.username, u.full_name, u.role from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now() and u.active`, [sha256(t)]);
  return r.rows[0] || null;
}

// Giới hạn đăng nhập sai: 10 lần / 15 phút cho mỗi IP + tên đăng nhập (trong bộ nhớ của tiến trình).
const attempts = new Map();
function throttle(key) {
  const now = Date.now();
  const a = attempts.get(key) || { n: 0, until: now + 15 * 60e3 };
  if (a.until < now) { a.n = 0; a.until = now + 15 * 60e3; }
  if (a.n >= 10) fail(429, 'Đăng nhập sai quá nhiều lần. Hãy đợi 15 phút rồi thử lại.');
  return { failed() { a.n++; attempts.set(key, a); }, ok() { attempts.delete(key); } };
}
const DUMMY_HASH = bcrypt.hashSync('khong-dung-den', 4);

// ---------------------------------------------------------------------
// Middleware cho /api
// ---------------------------------------------------------------------
const api = express.Router();
// JSON tối đa 2MB; riêng tải mốc dữ liệu (file Excel đã đọc) cho tới 15MB ở route của nó.
const json2mb = express.json({ limit: '2mb' });
api.use((req, res, next) => (req.method === 'POST' && req.path === '/snapshots' ? next() : json2mb(req, res, next)));
// Chống CSRF: mọi yêu cầu thay đổi dữ liệu phải có header X-App (form của trang khác không gửi được).
api.use((req, res, next) => {
  if (req.method !== 'GET' && req.get('x-app') !== '1') return res.status(403).json({ error: 'Yêu cầu không hợp lệ.' });
  next();
});
api.get('/health', (req, res) => res.json({ ok: true, db: hasDb }));
api.use(wrap(async (req, res, next) => { await migrate(); req.user = await currentUser(req); next(); }));

const need = role => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Phiên đăng nhập đã hết. Hãy đăng nhập lại.' });
  if (role === 'admin' && req.user.role !== 'admin') return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này.' });
  next();
};

// ---------------------------------------------------------------------
// Đăng nhập & tài khoản
// ---------------------------------------------------------------------
api.get('/me', wrap(async (req, res) => {
  const needsSetup = !req.user && (await query('select count(*) as n from users')).rows[0].n === 0;
  res.json({ user: req.user, needsSetup });
}));

// Tạo admin đầu tiên. Chỉ chạy được khi chưa có tài khoản nào.
api.post('/setup', wrap(async (req, res) => {
  const u = username(req.body.username);
  const name = str(req.body.full_name || '', 'Họ tên', 0, 100);
  const hash = await bcrypt.hash(password(req.body.password), BCRYPT_COST);
  const id = await tx(async c => {
    await c.query('lock table users in exclusive mode');
    if ((await c.query('select count(*) as n from users')).rows[0].n > 0) fail(409, 'Web đã có tài khoản admin. Hãy đăng nhập.');
    return (await c.query(`insert into users (username, full_name, role, password_hash) values ($1, $2, 'admin', $3) returning id`, [u, name, hash])).rows[0].id;
  });
  await startSession(req, res, id);
  res.json({ ok: true });
}));

api.post('/login', wrap(async (req, res) => {
  const name = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const pw = typeof req.body.password === 'string' ? req.body.password : '';
  const t = throttle(req.ip + '|' + name.toLowerCase());
  const u = (await query('select id, password_hash, active from users where lower(username) = lower($1)', [name])).rows[0];
  const match = await bcrypt.compare(pw, u ? u.password_hash : DUMMY_HASH);
  if (!u || !match) { t.failed(); fail(401, 'Tên đăng nhập hoặc mật khẩu không đúng.'); }
  if (!u.active) fail(403, 'Tài khoản đã bị khóa. Hãy liên hệ admin.');
  t.ok();
  await startSession(req, res, u.id);
  res.json({ ok: true });
}));

api.post('/logout', wrap(async (req, res) => {
  const t = cookie(req, 'sid');
  if (t) await query('delete from sessions where token_hash = $1', [sha256(t)]);
  res.clearCookie('sid', { path: '/' });
  res.json({ ok: true });
}));

api.post('/me/password', need('member'), wrap(async (req, res) => {
  const row = (await query('select password_hash from users where id = $1', [req.user.id])).rows[0];
  if (!(await bcrypt.compare(String(req.body.current || ''), row.password_hash))) fail(400, 'Mật khẩu hiện tại không đúng.');
  const hash = await bcrypt.hash(password(req.body.password), BCRYPT_COST);
  await query('update users set password_hash = $1 where id = $2', [hash, req.user.id]);
  await query('delete from sessions where user_id = $1 and token_hash <> $2', [req.user.id, sha256(cookie(req, 'sid'))]);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------
// DT-CP công trình: mỗi lần tải file Excel lên là một "mốc" (snapshot).
// Mỗi dòng = một dòng Hợp đồng/Phụ lục, gắn công ty, khu vực, công trình, hợp đồng (mã DT-CP), chủ đầu tư, giai đoạn.
// vals: hd (giá trị HĐ), sl (sản lượng), slhs (sản lượng hồ sơ), tv (tiền về), dt (doanh thu thời điểm), k..y (15 khoản chi phí trực tiếp). Đơn vị: đồng.
// ---------------------------------------------------------------------
const VAL_KEYS = ['hd', 'sl', 'slhs', 'tv', 'dt', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y'];
const COST_KEYS = VAL_KEYS.slice(5);
const LINE_TEXT = ['company', 'region', 'region_name', 'project_code', 'project_name', 'project_stage', 'contract_code', 'contract_no', 'contract_title', 'investor', 'stage', 'line_label'];
const CATALOG_KINDS = ['company', 'region', 'investor', 'stage', 'cost'];
const isoDate = v => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) fail(400, 'Ngày báo cáo không hợp lệ (cần dạng YYYY-MM-DD).');
  return v;
};
const shortText = (v, max) => (v == null ? '' : String(v).trim().slice(0, max));

api.get('/meta', need('member'), wrap(async (req, res) => {
  const [snaps, cat, dash] = await Promise.all([
    query(`select id, to_char(report_date, 'YYYY-MM-DD') as report_date, label, file_name, cost_labels, line_count, created_at
           from snapshots order by report_date desc, id desc`),
    query('select kind, code, name, sort from catalog order by kind, sort, code'),
    query(`select value from app_settings where key = 'dashboard_v2'`)
  ]);
  res.json({ snapshots: snaps.rows, catalog: cat.rows, dashboard: (dash.rows[0] || {}).value || null });
}));

api.get('/snapshots/:id/lines', need('member'), wrap(async (req, res) => {
  const r = await query(`select seq, ${LINE_TEXT.join(', ')}, vals from snapshot_lines where snapshot_id = $1 order by seq`, [intId(req.params.id)]);
  res.json(r.rows);
}));

api.post('/snapshots', need('admin'), express.json({ limit: '15mb' }), wrap(async (req, res) => {
  const b = req.body || {};
  const date = isoDate(b.report_date);
  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (!lines.length) fail(400, 'File không có dòng số liệu nào.');
  if (lines.length > 30000) fail(400, 'File quá lớn (tối đa 30.000 dòng).');
  const costLabels = {};
  if (b.cost_labels && typeof b.cost_labels === 'object') for (const k of COST_KEYS) if (b.cost_labels[k]) costLabels[k] = shortText(b.cost_labels[k], 200);
  const cols = Object.fromEntries(LINE_TEXT.map(k => [k, []]));
  const vals = [];
  lines.forEach(l => {
    if (!l || typeof l !== 'object') fail(400, 'Dòng số liệu không hợp lệ.');
    LINE_TEXT.forEach(k => cols[k].push(shortText(l[k], k === 'contract_title' || k === 'project_name' ? 500 : 200)));
    const v = {};
    for (const k of VAL_KEYS) {
      const n = l.vals && l.vals[k];
      if (n == null || n === '') continue;
      const x = Number(n);
      if (!Number.isFinite(x) || Math.abs(x) >= 1e16) fail(400, 'Có ô số liệu không hợp lệ.');
      if (x !== 0) v[k] = Math.round(x * 100) / 100;
    }
    vals.push(JSON.stringify(v));
  });
  const id = await tx(async c => {
    const s = (await c.query(`insert into snapshots (report_date, label, file_name, cost_labels, line_count, created_by)
      values ($1, $2, $3, $4, $5, $6) returning id`, [date, shortText(b.label, 120), shortText(b.file_name, 200), JSON.stringify(costLabels), lines.length, req.user.id])).rows[0].id;
    for (let i = 0; i < lines.length; i += 2000) {
      const end = Math.min(lines.length, i + 2000);
      const params = [s, Array.from({ length: end - i }, (_, j) => i + j + 1)];
      LINE_TEXT.forEach(k => params.push(cols[k].slice(i, end)));
      params.push(vals.slice(i, end));
      const casts = LINE_TEXT.map((k, j) => `$${j + 3}::text[]`).join(', ');
      await c.query(`insert into snapshot_lines (snapshot_id, seq, ${LINE_TEXT.join(', ')}, vals)
        select $1, * from unnest($2::int[], ${casts}, $${LINE_TEXT.length + 3}::jsonb[])`, params);
    }
    // Bổ sung danh mục còn thiếu (tên mặc định = mã), không ghi đè tên admin đã đặt.
    const add = (kind, codes, names) => c.query(`insert into catalog (kind, code, name) select $1, x.code, x.name from unnest($2::text[], $3::text[]) as x(code, name)
      where x.code <> '' on conflict (kind, code) do nothing`, [kind, codes, names]);
    const uniq = (codeKey, nameKey) => { const m = new Map(); cols[codeKey].forEach((code, i) => { if (code && !m.has(code)) m.set(code, nameKey ? cols[nameKey][i] || code : code); }); return [[...m.keys()], [...m.values()]]; };
    const hints = b.company_names && typeof b.company_names === 'object' ? b.company_names : {};
    const comp = uniq('company');
    await add('company', comp[0], comp[0].map(code => shortText(hints[code], 160) || code));
    await add('region', ...uniq('region', 'region_name'));
    await add('investor', ...uniq('investor'));
    const st = uniq('stage'); const ps = uniq('project_stage');
    await add('stage', [...new Set(st[0].concat(ps[0]))], [...new Set(st[0].concat(ps[0]))].map(x => (/^\d+$/.test(x) ? 'Giai đoạn ' + x : x)));
    return s;
  });
  res.json({ id });
}));

api.put('/snapshots/:id', need('admin'), wrap(async (req, res) => {
  const r = await query('update snapshots set report_date = $1, label = $2 where id = $3', [isoDate(req.body.report_date), shortText(req.body.label, 120), intId(req.params.id)]);
  if (!r.rowCount) fail(404, 'Không tìm thấy mốc dữ liệu.');
  res.json({ ok: true });
}));

api.delete('/snapshots/:id', need('admin'), wrap(async (req, res) => {
  await query('delete from snapshots where id = $1', [intId(req.params.id)]);
  res.json({ ok: true });
}));

// Diễn biến một hợp đồng qua các mốc + ghi chú của hợp đồng.
api.get('/contracts/:code/history', need('member'), wrap(async (req, res) => {
  const code = shortText(req.params.code, 200);
  const sum = k => `coalesce(sum((l.vals->>'${k}')::numeric), 0)::float8 as ${k}`;
  const cp = COST_KEYS.map(k => `coalesce((l.vals->>'${k}')::numeric, 0)`).join(' + ');
  const [h, n] = await Promise.all([
    query(`select s.id as snapshot_id, to_char(s.report_date, 'YYYY-MM-DD') as report_date, s.label, max(l.stage) as stage,
        ${VAL_KEYS.map(sum).join(', ')}, coalesce(sum(${cp}), 0)::float8 as cp
      from snapshot_lines l join snapshots s on s.id = l.snapshot_id
      where l.contract_code = $1 group by s.id order by s.report_date, s.id`, [code]),
    query('select id, content, author_id, author_name, created_at from contract_notes where contract_code = $1 order by created_at desc', [code])
  ]);
  res.json({ history: h.rows, notes: n.rows });
}));

// Ma trận DT-CP gọn: mỗi hợp đồng × mỗi mốc một dòng (đã cộng các dòng HĐ/PL), dạng mảng để giảm dung lượng.
// rows: [chỉ số mã trong codes, snapshot_id, giai đoạn, hd, sl, slhs, tv, dt, cp]. Đơn vị: đồng.
const MX_FIELDS = ['hd', 'sl', 'slhs', 'tv', 'dt'];
api.get('/dtcp/matrix', need('member'), wrap(async (req, res) => {
  const cp = COST_KEYS.map(k => `coalesce((vals->>'${k}')::numeric, 0)`).join(' + ');
  const r = await query(`select contract_code, snapshot_id, max(stage) as stage,
      ${MX_FIELDS.map(k => `coalesce(sum((vals->>'${k}')::numeric), 0)::float8 as ${k}`).join(', ')}, coalesce(sum(${cp}), 0)::float8 as cp
    from snapshot_lines group by contract_code, snapshot_id order by contract_code, snapshot_id`);
  const codes = [], idx = new Map();
  const rows = r.rows.map(x => {
    if (!idx.has(x.contract_code)) { idx.set(x.contract_code, codes.length); codes.push(x.contract_code); }
    return [idx.get(x.contract_code), x.snapshot_id, x.stage || ''].concat(MX_FIELDS.map(k => x[k]), x.cp);
  });
  res.set('Cache-Control', 'private, no-cache');
  res.json({ fields: ['code', 'snapshot_id', 'stage'].concat(MX_FIELDS, 'cp'), codes, rows });
}));

api.post('/contract-notes', need('member'), wrap(async (req, res) => {
  const code = str(req.body.contract_code, 'Mã DT-CP', 1, 200);
  const content = str(req.body.content, 'Ghi chú', 1, 4000);
  const r = await query('insert into contract_notes (contract_code, content, author_id, author_name) values ($1, $2, $3, $4) returning id',
    [code, content, req.user.id, req.user.full_name || req.user.username]);
  res.json({ id: r.rows[0].id });
}));

api.delete('/contract-notes/:id', need('member'), wrap(async (req, res) => {
  const id = intId(req.params.id);
  const n = (await query('select author_id from contract_notes where id = $1', [id])).rows[0];
  if (!n) fail(404, 'Ghi chú không còn tồn tại.');
  if (n.author_id !== req.user.id && req.user.role !== 'admin') fail(403, 'Bạn chỉ xóa được ghi chú của mình.');
  await query('delete from contract_notes where id = $1', [id]);
  res.json({ ok: true });
}));

// Danh mục tên hiển thị: công ty, khu vực, chủ đầu tư, giai đoạn, khoản chi phí.
api.put('/catalog', need('admin'), wrap(async (req, res) => {
  const kind = req.body.kind;
  if (!CATALOG_KINDS.includes(kind)) fail(400, 'Loại danh mục không hợp lệ.');
  const code = str(req.body.code, 'Mã', 1, 60);
  const name = str(req.body.name, 'Tên', 1, 160);
  const sort = Number.isInteger(Number(req.body.sort)) ? Number(req.body.sort) : 0;
  await query(`insert into catalog (kind, code, name, sort) values ($1, $2, $3, $4)
    on conflict (kind, code) do update set name = excluded.name, sort = excluded.sort`, [kind, code, name, sort]);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------
// Bố cục dashboard DT-CP (admin tùy biến). Chỉ nhận đúng cấu trúc đã biết.
// ---------------------------------------------------------------------
const DASH_METRICS = ['count', 'hd', 'sl', 'slhs', 'tv', 'dt', 'cp', 'pct'];
const DASH_DIMS = ['company', 'region', 'project', 'investor', 'stage'];
const CARD_TYPES = ['kpis', 'group', 'costs', 'table'];
const TERM_KEYS = DASH_METRICS.concat(DASH_DIMS, ['contract']);
function dashboardConfig(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(400, 'Cấu hình dashboard không hợp lệ.');
  const text = (s, field, max) => str(typeof s === 'string' ? s : '', field, 0, max);
  const pick = (a, allowed, max) => {
    if (a == null) return [];
    if (!Array.isArray(a) || a.length > max || !a.every(x => allowed.includes(x))) fail(400, 'Danh sách dữ liệu của biểu đồ không hợp lệ.');
    return [...new Set(a)];
  };
  const cards = Array.isArray(v.cards) ? v.cards : [];
  if (cards.length > 24) fail(400, 'Tối đa 24 biểu đồ.');
  const terms = {};
  if (v.terms != null) {
    if (typeof v.terms !== 'object' || Array.isArray(v.terms)) fail(400, 'Tên gọi không hợp lệ.');
    for (const k of TERM_KEYS) if (v.terms[k] != null) terms[k] = text(v.terms[k], 'Tên gọi', 60);
  }
  const ids = new Set();
  return {
    title: text(v.title, 'Tiêu đề trang', 80),
    terms,
    cards: cards.map(c => {
      if (!c || typeof c !== 'object') fail(400, 'Biểu đồ không hợp lệ.');
      const id = String(c.id || '');
      if (!/^[A-Za-z0-9_-]{1,24}$/.test(id) || ids.has(id)) fail(400, 'Mã biểu đồ không hợp lệ.');
      ids.add(id);
      if (!CARD_TYPES.includes(c.type)) fail(400, 'Loại biểu đồ không hợp lệ.');
      const top = Number(c.top);
      return {
        id, type: c.type,
        title: text(c.title, 'Tiêu đề biểu đồ', 120),
        note: text(c.note, 'Mô tả biểu đồ', 400),
        dim: DASH_DIMS.includes(c.dim) ? c.dim : 'region',
        metrics: pick(c.metrics, DASH_METRICS, 8),
        top: Number.isInteger(top) && top >= 3 && top <= 50 ? top : 12,
        detail: c.detail === true,
        width: c.width === 'half' ? 'half' : 'full',
        hidden: c.hidden === true
      };
    })
  };
}

api.put('/settings/dashboard', need('admin'), wrap(async (req, res) => {
  if (req.body && req.body.reset === true) {
    await query(`delete from app_settings where key = 'dashboard_v2'`);
    return res.json({ dashboard: null });
  }
  const value = dashboardConfig(req.body);
  if (JSON.stringify(value).length > 60000) fail(400, 'Cấu hình dashboard quá lớn.');
  await query(`insert into app_settings (key, value, updated_by) values ('dashboard_v2', $1, $2)
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`, [JSON.stringify(value), req.user.id]);
  res.json({ dashboard: value });
}));

// ---------------------------------------------------------------------
// Người dùng (admin)
// ---------------------------------------------------------------------
api.get('/users', need('admin'), wrap(async (req, res) => {
  res.json((await query('select id, username, full_name, role, active, created_at from users order by created_at, id')).rows);
}));

api.post('/users', need('admin'), wrap(async (req, res) => {
  const u = username(req.body.username);
  const name = str(req.body.full_name || '', 'Họ tên', 0, 100);
  const role = ROLES.includes(req.body.role) ? req.body.role : 'viewer';
  const hash = await bcrypt.hash(password(req.body.password), BCRYPT_COST);
  const r = await query('insert into users (username, full_name, role, password_hash) values ($1, $2, $3, $4) returning id', [u, name, role, hash]);
  res.json({ id: r.rows[0].id });
}));

api.put('/users/:id', need('admin'), wrap(async (req, res) => {
  const id = intId(req.params.id);
  const b = req.body || {};
  if (id === req.user.id && ((b.role && b.role !== 'admin') || b.active === false)) fail(400, 'Bạn không thể tự hạ quyền hoặc tự khóa tài khoản của mình.');
  const hash = b.password != null ? await bcrypt.hash(password(b.password), BCRYPT_COST) : null;
  await tx(async c => {
    const cur = (await c.query('select id from users where id = $1 for update', [id])).rows[0];
    if (!cur) fail(404, 'Không tìm thấy người dùng.');
    if (b.full_name != null) await c.query('update users set full_name = $1 where id = $2', [str(b.full_name, 'Họ tên', 0, 100), id]);
    if (b.role != null) {
      if (!ROLES.includes(b.role)) fail(400, 'Vai trò không hợp lệ.');
      await c.query('update users set role = $1 where id = $2', [b.role, id]);
    }
    if (b.active != null) await c.query('update users set active = $1 where id = $2', [!!b.active, id]);
    if (hash) await c.query('update users set password_hash = $1 where id = $2', [hash, id]);
    if (hash || b.active === false) await c.query('delete from sessions where user_id = $1', [id]);
    const admins = (await c.query(`select count(*) as n from users where role = 'admin' and active`)).rows[0].n;
    if (admins < 1) fail(400, 'Phải còn ít nhất một admin đang hoạt động.');
  });
  res.json({ ok: true });
}));

api.use((req, res) => res.status(404).json({ error: 'Không có API này.' }));

// Lỗi: đổi lỗi PostgreSQL thường gặp thành thông báo dễ hiểu.
api.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  let status = err.status || 500;
  let msg = err.status ? err.message : 'Lỗi máy chủ. Hãy thử lại sau.';
  if (err.code === '23505') { status = 409; msg = /users/.test(err.constraint || '') ? 'Tên đăng nhập này đã có.' : 'Tên này đã tồn tại.'; }
  else if (err.code === '23503') { status = 409; msg = req.method === 'DELETE' ? 'Mục này đang có số liệu nên không xóa được. Hãy bỏ chọn "Đang dùng" để ẩn thay vì xóa.' : 'Không tìm thấy danh mục này. Hãy tải lại trang.'; }
  else if (err.code === '23514') { status = 400; msg = 'Dữ liệu không hợp lệ.'; }
  else if (err.type === 'entity.parse.failed') { status = 400; msg = 'Dữ liệu gửi lên không đúng định dạng.'; }
  else if (err.type === 'entity.too.large') { status = 413; msg = 'Dữ liệu gửi lên quá lớn.'; }
  if (status >= 500) console.error(err);
  res.status(status).json({ error: msg });
});

app.use('/api', api);

// Trang web tĩnh (Railway / chạy trên máy). Trên Vercel, thư mục public được phục vụ trực tiếp.
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders(res, p) { if (p.endsWith('.html')) res.set('Cache-Control', 'no-cache'); }
}));

module.exports = app;

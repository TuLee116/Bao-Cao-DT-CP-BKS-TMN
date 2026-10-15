// API của web. Dùng chung cho Railway (server.js) và Vercel (api/index.js).
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { query, tx, migrate, HttpError, hasDb } = require('./db');

const SESSION_DAYS = 30;
const BCRYPT_COST = 11;
const ROLES = ['admin', 'viewer'];

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

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
const month = v => {
  if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(v)) fail(400, 'Tháng không hợp lệ (cần dạng YYYY-MM-01).');
  return v;
};
const amount = v => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n >= 1e15) fail(400, 'Số tiền không hợp lệ.');
  return Math.round(n * 100) / 100;
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
api.use(express.json({ limit: '2mb' }));
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
// Số liệu
// ---------------------------------------------------------------------
api.get('/data', need('member'), wrap(async (req, res) => {
  const [ch, ca, rv, ex, no] = await Promise.all([
    query('select id, name, sort_order, active from channels order by sort_order, id'),
    query('select id, name, sort_order, active from expense_categories order by sort_order, id'),
    query('select month, channel_id, amount from revenue_entries order by month, channel_id'),
    query('select month, category_id, amount from expense_entries order by month, category_id'),
    query('select id, month, content, author_id, author_name, created_at from month_notes order by created_at')
  ]);
  res.json({ channels: ch.rows, categories: ca.rows, revenue: rv.rows, expenses: ex.rows, notes: no.rows });
}));

// Danh mục: kênh bán và khoản mục chi phí dùng chung một bộ route.
for (const [route, table] of [['channels', 'channels'], ['categories', 'expense_categories']]) {
  const body = b => ({
    name: str(b.name, 'Tên', 1, 100),
    sort_order: Number.isInteger(Number(b.sort_order)) ? Number(b.sort_order) : 0,
    active: b.active !== false
  });
  api.post(`/${route}`, need('admin'), wrap(async (req, res) => {
    const b = body(req.body);
    const r = await query(`insert into ${table} (name, sort_order, active) values ($1, $2, $3) returning id`, [b.name, b.sort_order, b.active]);
    res.json({ id: r.rows[0].id });
  }));
  api.put(`/${route}/:id`, need('admin'), wrap(async (req, res) => {
    const b = body(req.body);
    const r = await query(`update ${table} set name = $1, sort_order = $2, active = $3 where id = $4`, [b.name, b.sort_order, b.active, intId(req.params.id)]);
    if (!r.rowCount) fail(404, 'Không tìm thấy mục này.');
    res.json({ ok: true });
  }));
  api.delete(`/${route}/:id`, need('admin'), wrap(async (req, res) => {
    await query(`delete from ${table} where id = $1`, [intId(req.params.id)]);
    res.json({ ok: true });
  }));
}

api.put('/months/:month', need('admin'), wrap(async (req, res) => {
  const m = month(req.params.month);
  const revs = Array.isArray(req.body.revenues) ? req.body.revenues : [];
  const exps = Array.isArray(req.body.expenses) ? req.body.expenses : [];
  if (revs.length + exps.length > 500) fail(400, 'Quá nhiều ô số liệu trong một tháng.');
  await tx(async c => {
    for (const r of revs) {
      await c.query(`insert into revenue_entries (month, channel_id, amount, updated_by) values ($1, $2, $3, $4)
        on conflict (month, channel_id) do update set amount = excluded.amount, updated_at = now(), updated_by = excluded.updated_by`,
      [m, intId(r.channel_id), amount(r.amount), req.user.id]);
    }
    for (const r of exps) {
      await c.query(`insert into expense_entries (month, category_id, amount, updated_by) values ($1, $2, $3, $4)
        on conflict (month, category_id) do update set amount = excluded.amount, updated_at = now(), updated_by = excluded.updated_by`,
      [m, intId(r.category_id), amount(r.amount), req.user.id]);
    }
  });
  res.json({ ok: true });
}));

api.delete('/months/:month', need('admin'), wrap(async (req, res) => {
  const m = month(req.params.month);
  await tx(async c => {
    await c.query('delete from revenue_entries where month = $1', [m]);
    await c.query('delete from expense_entries where month = $1', [m]);
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------
// Ghi chú
// ---------------------------------------------------------------------
api.post('/notes', need('member'), wrap(async (req, res) => {
  const m = month(req.body.month);
  const content = str(req.body.content, 'Ghi chú', 1, 4000);
  const r = await query('insert into month_notes (month, content, author_id, author_name) values ($1, $2, $3, $4) returning id',
    [m, content, req.user.id, req.user.full_name || req.user.username]);
  res.json({ id: r.rows[0].id });
}));

api.delete('/notes/:id', need('member'), wrap(async (req, res) => {
  const id = intId(req.params.id);
  const n = (await query('select author_id from month_notes where id = $1', [id])).rows[0];
  if (!n) fail(404, 'Ghi chú không còn tồn tại.');
  if (n.author_id !== req.user.id && req.user.role !== 'admin') fail(403, 'Bạn chỉ xóa được ghi chú của mình.');
  await query('delete from month_notes where id = $1', [id]);
  res.json({ ok: true });
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
  if (status >= 500) console.error(err);
  res.status(status).json({ error: msg });
});

app.use('/api', api);

// Trang web tĩnh (Railway / chạy trên máy). Trên Vercel, thư mục public được phục vụ trực tiếp.
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders(res, p) { if (p.endsWith('.html')) res.set('Cache-Control', 'no-cache'); }
}));

module.exports = app;

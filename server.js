const express = require('express');
const path = require('path');
const crypto = require('crypto');
const store = require('./lib/db');
const auth = require('./lib/auth');
const { TRANG_THAI, ROLES, validateProject, validateUser, validateSettings, validateRevenue, validateTienVe, validateCost, validateTp, validateTpLine, validateTpPay, passwordErrors, passcodeErrors } = require('./lib/validate');
const { buildContracts, summarizeContracts } = require('./lib/subcontract');
const { NHOM_CHI_PHI, summarizeCost, sortCost } = require('./lib/cost');
const { LOAI_DOANH_THU, calcLine, summarize, sortRevenue, tienVeLabel, sortTienVe, summarizeTienVe } = require('./lib/revenue');

const app = express();
const PORT = process.env.PORT || 3000;
const SETUP_TOKEN = (process.env.SETUP_TOKEN || '').trim();

app.set('trust proxy', 1); // Railway đứng sau proxy HTTPS
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  next();
});
app.use(express.json({ limit: '1mb' }));

// Trạng thái kết nối CSDL (web vẫn chạy khi CSDL lỗi để hiển thị nguyên nhân)
const dbState = { ready: false, error: null, attempts: 0 };

// Health check cho Railway: luôn trả 200 khi web đang chạy, kèm tình trạng CSDL
app.get('/health', async (_req, res) => {
  if (dbState.ready) {
    try {
      await store.ping();
    } catch (e) {
      return res.json({ status: 'db_error', db: store.kind, target: store.target, error: e.message });
    }
  }
  res.json({
    status: dbState.ready ? 'ok' : 'db_error',
    db: store.kind,
    target: store.target,
    ...(dbState.ready ? {} : { error: dbState.error || 'Đang kết nối...', attempts: dbState.attempts }),
  });
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Khi CSDL chưa sẵn sàng: trả trang báo lỗi rõ ràng thay vì 502
app.use((req, res, next) => {
  if (dbState.ready) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(503).json({ errors: ['Chưa kết nối được cơ sở dữ liệu: ' + (dbState.error || 'đang kết nối...')] });
  }
  res.status(503).type('html').send(dbErrorPage());
});
app.use(auth.loadUser);

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const view = (name) => path.join(__dirname, 'views', name);
const parseId = (v) => {
  const id = Number(v);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const bad = (res, errors, code = 400) => res.status(code).json({ errors: [].concat(errors) });
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// =====================================================================
// Trang (HTML)
// =====================================================================
app.get('/', wrap(async (req, res) => {
  if ((await store.countUsers()) === 0) return res.redirect('/setup');
  if (!req.user) return res.redirect('/login');
  res.sendFile(view('index.html'));
}));
app.get('/login', wrap(async (req, res) => {
  if ((await store.countUsers()) === 0) return res.redirect('/setup');
  if (req.user) return res.redirect('/');
  res.sendFile(view('login.html'));
}));
app.get('/setup', wrap(async (_req, res) => {
  if ((await store.countUsers()) > 0) return res.redirect('/login');
  res.sendFile(view('setup.html'));
}));

// =====================================================================
// API
// =====================================================================
const api = express.Router();
api.use(auth.csrfGuard);

api.get('/meta', wrap(async (_req, res) => {
  const s = await store.getSettings();
  res.json({
    trang_thai: TRANG_THAI,
    loai_doanh_thu: LOAI_DOANH_THU,
    nhom_chi_phi: NHOM_CHI_PHI,
    roles: ROLES,
    db: store.kind,
    ten_cong_ty: s.ten_cong_ty,
    ten_he_thong: s.ten_he_thong,
    needs_setup: (await store.countUsers()) === 0,
    setup_token_required: Boolean(SETUP_TOKEN),
  });
}));

// ---------- Setup lần đầu ----------
api.post('/setup', wrap(async (req, res) => {
  const body = req.body || {};
  if (SETUP_TOKEN && !safeEq(body.setup_token || '', SETUP_TOKEN)) return bad(res, 'Mã khởi tạo (SETUP_TOKEN) không đúng', 403);
  const s = validateSettings(body);
  const u = validateUser({ ...body, role: 'admin' }, true);
  const errors = [...s.errors, ...u.errors];
  if (errors.length) return bad(res, errors);

  const id = await store.createFirstAdmin(
    { username: u.data.username, full_name: u.data.full_name, password_hash: await auth.hashPassword(u.data.password) },
    s.data);
  if (!id) return bad(res, 'Hệ thống đã được khởi tạo trước đó', 409);
  await auth.startSession(req, res, id);
  await store.touchLogin(id);
  res.status(201).json({ ok: true });
}));

// ---------- Đăng nhập / đăng xuất ----------
api.post('/auth/login', wrap(async (req, res) => {
  const ip = req.ip;
  const wait = auth.loginBlocked(ip);
  if (wait) return bad(res, `Sai quá nhiều lần. Thử lại sau ${wait} phút`, 429);

  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = await store.getUserForLogin(username);
  const ok = await auth.verifyPassword(password, user ? user.password_hash : auth.DUMMY_HASH);
  if (!user || !ok) {
    auth.loginFailed(ip);
    return bad(res, 'Sai tên đăng nhập hoặc mật khẩu', 401);
  }
  if (!user.active) return bad(res, 'Tài khoản đã bị khóa. Liên hệ quản trị viên', 403);
  auth.loginOk(ip);
  await auth.startSession(req, res, user.id);
  await store.touchLogin(user.id);
  res.json({ ok: true });
}));

api.post('/auth/logout', wrap(async (req, res) => {
  await auth.endSession(req, res);
  res.json({ ok: true });
}));

// Từ đây trở xuống: bắt buộc đăng nhập
api.use(auth.requireAuth);

api.get('/auth/me', (req, res) => res.json(req.user));

api.post('/auth/change-password', wrap(async (req, res) => {
  const { current_password, new_password } = req.body || {};
  const hash = await store.getPasswordHash(req.user.id);
  if (!(await auth.verifyPassword(current_password || '', hash))) return bad(res, 'Mật khẩu hiện tại không đúng');
  if (String(new_password) === String(current_password)) return bad(res, 'Mật khẩu mới phải khác mật khẩu hiện tại');
  const errors = passwordErrors(new_password, req.user.username);
  if (errors.length) return bad(res, errors);
  await store.updateUser(req.user.id, { password_hash: await auth.hashPassword(new_password) });
  await store.deleteUserSessions(req.user.id, req.sessionHash); // đăng xuất các thiết bị khác
  res.json({ ok: true });
}));

// ---------- Cài đặt hệ thống ----------
const PASSCODE_KEY = 'xoa_hd_passcode';
api.get('/settings', wrap(async (_req, res) => {
  const s = await store.getSettings();
  res.json({ ten_cong_ty: s.ten_cong_ty, ten_he_thong: s.ten_he_thong, passcode_set: Boolean(s[PASSCODE_KEY]) });
}));

// Đặt / đổi Passcode xóa HĐ/PL (chỉ Quản trị, phải nhập lại mật khẩu đăng nhập)
api.put('/settings/passcode', auth.requireRole('admin'), wrap(async (req, res) => {
  const { current_password, passcode, passcode2 } = req.body || {};
  const hash = await store.getPasswordHash(req.user.id);
  if (!(await auth.verifyPassword(current_password || '', hash))) return bad(res, 'Mật khẩu đăng nhập không đúng');
  if (String(passcode) !== String(passcode2)) return bad(res, 'Passcode nhập lại không khớp');
  const errors = passcodeErrors(passcode);
  if (errors.length) return bad(res, errors);
  await store.saveSettings({ [PASSCODE_KEY]: await auth.hashPassword(String(passcode)) });
  console.log(`[NHẬT KÝ] ${new Date().toISOString()} ${req.user.username} đã đặt/đổi Passcode xóa HĐ/PL`);
  res.json({ ok: true });
}));

// Chống dò passcode: sai 5 lần / 15 phút / tài khoản -> khóa xóa
const passFails = new Map();
const PASS_WINDOW = 15 * 60e3;
function passcodeLocked(uid) {
  const a = passFails.get(uid);
  if (!a || Date.now() - a.first > PASS_WINDOW) return 0;
  return a.count >= 5 ? Math.ceil((a.first + PASS_WINDOW - Date.now()) / 60e3) : 0;
}
// Kiểm tra Passcode xóa (gửi lỗi và trả false nếu không hợp lệ)
async function requirePasscode(req, res) {
  const stored = (await store.getSettings())[PASSCODE_KEY];
  if (!stored) { bad(res, 'Quản trị chưa đặt Passcode xóa HĐ/PL (tab Cài đặt). Chưa thể xóa.', 403); return false; }
  const wait = passcodeLocked(req.user.id);
  if (wait) { bad(res, `Nhập sai Passcode quá nhiều lần. Thử lại sau ${wait} phút`, 429); return false; }
  if (!(await auth.verifyPassword(String(req.body?.passcode ?? ''), stored))) {
    const left = passcodeFailed(req.user.id);
    bad(res, left > 0 ? `Passcode không đúng (còn ${left} lần thử)` : 'Passcode không đúng. Đã khóa chức năng xóa 15 phút', 403);
    return false;
  }
  passFails.delete(req.user.id);
  return true;
}
function passcodeFailed(uid) {
  const a = passFails.get(uid);
  if (!a || Date.now() - a.first > PASS_WINDOW) passFails.set(uid, { first: Date.now(), count: 1 });
  else a.count++;
  return 5 - passFails.get(uid).count;
}
api.put('/settings', auth.requireRole('admin'), wrap(async (req, res) => {
  const { data, errors } = validateSettings(req.body || {});
  if (errors.length) return bad(res, errors);
  await store.saveSettings(data);
  res.json(data);
}));

// ---------- Quản lý tài khoản (chỉ Quản trị) ----------
const users = express.Router();
users.use(auth.requireRole('admin'));

users.get('/', wrap(async (_req, res) => res.json(await store.listUsers())));

users.post('/', wrap(async (req, res) => {
  const { data, errors } = validateUser(req.body || {}, true);
  if (errors.length) return bad(res, errors);
  const id = await store.createUser({ ...data, password_hash: await auth.hashPassword(data.password) });
  res.status(201).json({ id });
}));

users.put('/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return bad(res, 'ID không hợp lệ');
  const target = await store.getUserById(id);
  if (!target) return bad(res, 'Không tìm thấy tài khoản', 404);
  const { data, errors } = validateUser(req.body || {}, false, target.username);
  if (errors.length) return bad(res, errors);

  const isSelf = id === req.user.id;
  if (isSelf && (data.role !== 'admin' || !data.active)) return bad(res, 'Không thể tự hạ quyền hoặc khóa chính mình');
  const losesAdmin = target.role === 'admin' && target.active && (data.role !== 'admin' || !data.active);
  if (losesAdmin && (await store.countActiveAdmins(id)) === 0) return bad(res, 'Hệ thống phải còn ít nhất 1 Quản trị đang hoạt động');

  const fields = { full_name: data.full_name, role: data.role, active: data.active };
  if (data.password) fields.password_hash = await auth.hashPassword(data.password);
  await store.updateUser(id, fields);
  // Đổi mật khẩu / khóa / đổi quyền -> buộc đăng nhập lại
  if (data.password || !data.active || data.role !== target.role) {
    await store.deleteUserSessions(id, isSelf ? req.sessionHash : '');
  }
  res.json({ id });
}));

users.delete('/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return bad(res, 'ID không hợp lệ');
  if (id === req.user.id) return bad(res, 'Không thể xóa tài khoản đang đăng nhập');
  const target = await store.getUserById(id);
  if (!target) return bad(res, 'Không tìm thấy tài khoản', 404);
  if (target.role === 'admin' && target.active && (await store.countActiveAdmins(id)) === 0) {
    return bad(res, 'Hệ thống phải còn ít nhất 1 Quản trị đang hoạt động');
  }
  await store.deleteUser(id);
  res.status(204).end();
}));
api.use('/users', users);

// ---------- Dự án ----------
const canEdit = auth.requireRole('admin', 'editor');

api.get('/du-an', wrap(async (_req, res) => res.json(await store.listProjects())));

api.post('/du-an', canEdit, wrap(async (req, res) => {
  const { data, errors } = validateProject(req.body || {});
  if (errors.length) return bad(res, errors);
  res.status(201).json(await store.createProject(data, req.user.id));
}));

api.put('/du-an/:id', canEdit, wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return bad(res, 'ID không hợp lệ');
  const { data, errors } = validateProject(req.body || {});
  if (errors.length) return bad(res, errors);
  const ok = await store.updateProject(id, data, req.user.id);
  ok ? res.json({ id }) : bad(res, 'Không tìm thấy dự án', 404);
}));

api.delete('/du-an/:id', canEdit, wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return bad(res, 'ID không hợp lệ');
  const ok = await store.deleteProject(id);
  ok ? res.status(204).end() : bad(res, 'Không tìm thấy dự án', 404);
}));

// ---------- Doanh thu theo công trình ----------
api.get('/du-an/:id/doanh-thu', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return bad(res, 'ID không hợp lệ');
  const du_an = await store.getProject(id);
  if (!du_an) return bad(res, 'Không tìm thấy công trình', 404);
  const items = sortRevenue(await store.listRevenue(id)).map(calcLine);
  const tien_ve = sortTienVe(await store.listTienVe(id)).map((r) => ({ ...r, nhan: tienVeLabel(r) }));
  res.json({ du_an, items, tong: summarize(items), tien_ve, tong_tien_ve: summarizeTienVe(tien_ve) });
}));

// ---------- Giá trị tiền về ----------
api.post('/du-an/:id/tien-ve', canEdit, wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return bad(res, 'ID không hợp lệ');
  if (!(await store.getProject(id))) return bad(res, 'Không tìm thấy công trình', 404);
  const { data, errors } = validateTienVe(req.body || {});
  if (errors.length) return bad(res, errors);
  const refErr = await checkHeadRef(data.hd_id, id);
  if (refErr) return bad(res, refErr);
  res.status(201).json(await store.createTienVe(id, data, req.user.id));
}));

api.put('/tien-ve/:id', canEdit, wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return bad(res, 'ID không hợp lệ');
  const cur = await store.getTienVe(id);
  if (!cur) return bad(res, 'Không tìm thấy dòng tiền về', 404);
  const { data, errors } = validateTienVe(req.body || {});
  if (errors.length) return bad(res, errors);
  const refErr = await checkHeadRef(data.hd_id, cur.du_an_id);
  if (refErr) return bad(res, refErr);
  const ok = await store.updateTienVe(id, data, req.user.id);
  ok ? res.json({ id }) : bad(res, 'Không tìm thấy dòng tiền về', 404);
}));

api.delete('/tien-ve/:id', canEdit, wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return bad(res, 'ID không hợp lệ');
  const ok = await store.deleteTienVe(id);
  ok ? res.status(204).end() : bad(res, 'Không tìm thấy dòng tiền về', 404);
}));

api.post('/du-an/:id/doanh-thu', canEdit, wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return bad(res, 'ID không hợp lệ');
  if (!(await store.getProject(id))) return bad(res, 'Không tìm thấy công trình', 404);
  const { data, errors } = validateRevenue(req.body || {});
  if (errors.length) return bad(res, errors);
  const refErr = await checkHdRef(data, id);
  if (refErr) return bad(res, refErr);
  res.status(201).json(await store.createRevenue(id, data, req.user.id));
}));

// Phải là hợp đồng gốc (HĐ) của cùng công trình
async function checkHeadRef(hdId, duAnId) {
  const hd = await store.getRevenue(hdId);
  if (!hd || hd.loai !== 'hd' || hd.du_an_id !== duAnId) return 'Số HĐ không thuộc công trình này, hãy chọn lại';
  return hd.ma_loai === 'HĐ' ? null : 'Chỉ chọn hợp đồng gốc (HĐ), không chọn phụ lục';
}

// Mục 1: không trùng tên "HĐ/PL + Số mã" trong cùng công trình
// Mục 2: dòng HT/QT phải tham chiếu 1 dòng HĐ/PL của cùng công trình
async function checkHdRef(data, duAnId, selfId = 0) {
  if (data.loai === 'hd') {
    const list = await store.listRevenue(duAnId);
    // PL cùng Số mã với một HĐ đã có -> dùng đúng cách viết của HĐ đó (gộp nhóm chính xác)
    if (data.ma_loai !== 'HĐ') {
      const head = list.find((r) => r.loai === 'hd' && r.ma_loai === 'HĐ' && r.id !== selfId &&
        String(r.so_ma).toLowerCase() === data.so_ma.toLowerCase());
      if (head) { data.so_ma = head.so_ma; data.so_hieu = `${data.ma_loai} ${data.so_ma}`; }
    }
    const dup = list.some((r) =>
      r.loai === 'hd' && r.id !== selfId && String(r.so_hieu).toLowerCase() === data.so_hieu.toLowerCase());
    return dup ? `"${data.so_hieu}" đã có trong công trình này` : null;
  }
  // Chỉ gắn với hợp đồng gốc (HĐ), không gắn vào phụ lục để tránh nhiễu số liệu
  return checkHeadRef(data.hd_id, duAnId);
}

api.put('/doanh-thu/:id', canEdit, wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return bad(res, 'ID không hợp lệ');
  const cur = await store.getRevenue(id);
  if (!cur) return bad(res, 'Không tìm thấy dòng doanh thu', 404);
  // Không cho đổi loại dòng (HĐ/PL ↔ HT/QT) khi sửa
  const { data, errors } = validateRevenue({ ...(req.body || {}), loai: cur.loai });
  if (errors.length) return bad(res, errors);
  const refErr = await checkHdRef(data, cur.du_an_id, id);
  if (refErr) return bad(res, refErr);
  if (cur.loai === 'hd' && cur.ma_loai === 'HĐ' && data.ma_loai !== 'HĐ') {
    const { qt, tv } = await store.countRevenueRefs(id);
    if (qt || tv) return bad(res, `Không đổi được loại của "${cur.so_hieu}" vì đang có dòng HT/QT hoặc Tiền về gắn vào HĐ này`);
  }
  const ok = await store.updateRevenue(id, data, req.user.id);
  ok ? res.json({ id }) : bad(res, 'Không tìm thấy dòng doanh thu', 404);
}));

// Phạm vi ảnh hưởng khi xóa 1 dòng HĐ/PL (để hiện cho người dùng xác nhận)
async function contractImpact(cur) {
  const items = (await store.listRevenue(cur.du_an_id)).map(calcLine);
  const self = items.find((r) => r.id === cur.id);
  const out = { so_hieu: cur.so_hieu, sau_vat: self?.sau_vat || 0, pls: [], qt: { n: 0, sau_vat: 0 }, tv: { n: 0, so_tien: 0 } };
  if (cur.loai !== 'hd' || cur.ma_loai !== 'HĐ') return out;
  const so = String(cur.so_ma).toLowerCase();
  out.pls = items.filter((r) => r.loai === 'hd' && r.ma_loai !== 'HĐ' && String(r.so_ma).toLowerCase() === so)
    .map((r) => ({ so_hieu: r.so_hieu, sau_vat: r.sau_vat }));
  const qts = items.filter((r) => r.loai === 'qt' && r.hd_id === cur.id);
  out.qt = { n: qts.length, sau_vat: qts.reduce((s, r) => s + r.sau_vat, 0) };
  const tvs = (await store.listTienVe(cur.du_an_id)).filter((r) => r.hd_id === cur.id);
  out.tv = { n: tvs.length, so_tien: tvs.reduce((s, r) => s + r.so_tien, 0) };
  return out;
}

api.get('/doanh-thu/:id/impact', canEdit, wrap(async (req, res) => {
  const id = parseId(req.params.id);
  const cur = id && (await store.getRevenue(id));
  if (!cur) return bad(res, 'Không tìm thấy dòng doanh thu', 404);
  res.json(await contractImpact(cur));
}));

api.delete('/doanh-thu/:id', canEdit, wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return bad(res, 'ID không hợp lệ');
  const cur = await store.getRevenue(id);
  if (!cur) return bad(res, 'Không tìm thấy dòng doanh thu', 404);
  const cascade = req.body?.cascade === true;
  if (cur.loai === 'hd') {
    const { qt, tv } = await store.countRevenueRefs(id);
    if ((qt || tv) && !cascade) {
      const parts = [qt && `${qt} dòng Hoàn thành/Quyết toán`, tv && `${tv} dòng Tiền về`].filter(Boolean).join(' và ');
      return bad(res, `Không xóa được "${cur.so_hieu}": đang được ${parts} tham chiếu. Chọn "Xóa toàn bộ hợp đồng" để xóa kèm.`, 409);
    }
    // Xóa Số HĐ/PL phải nhập Passcode do Quản trị đặt
    if (!(await requirePasscode(req, res))) return;
    // Xóa toàn bộ hợp đồng: HĐ + PL cùng Số mã + HT/QT + Tiền về
    if (cascade && cur.ma_loai === 'HĐ') {
      const im = await contractImpact(cur);
      await store.deleteContractCascade(cur);
      console.log(`[NHẬT KÝ] ${new Date().toISOString()} ${req.user.username} đã XÓA TOÀN BỘ HỢP ĐỒNG "${cur.so_hieu}" ` +
        `(công trình #${cur.du_an_id}): HĐ ${im.sau_vat}đ; ${im.pls.length} PL [${im.pls.map((p) => p.so_hieu).join(', ')}]; ` +
        `${im.qt.n} dòng HT/QT ${im.qt.sau_vat}đ; ${im.tv.n} dòng tiền về ${im.tv.so_tien}đ`);
      return res.status(204).end();
    }
  }
  const ok = await store.deleteRevenue(id);
  if (ok && cur.loai === 'hd') console.log(`[NHẬT KÝ] ${new Date().toISOString()} ${req.user.username} đã xóa "${cur.so_hieu}" (công trình #${cur.du_an_id}, dòng #${id})`);
  ok ? res.status(204).end() : bad(res, 'Không tìm thấy dòng doanh thu', 404);
}));

// ---------- Chi phí công trình ----------
api.get('/du-an/:id/chi-phi', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return bad(res, 'ID không hợp lệ');
  const du_an = await store.getProject(id);
  if (!du_an) return bad(res, 'Không tìm thấy công trình', 404);
  const items = sortCost(await store.listCost(id)).map(calcLine);
  const thau_phu = buildContracts(await store.listTp(id));
  // Nhóm 1 Thầu phụ = giá trị HT/QT của các HĐTP (+ dòng thầu phụ nhập kiểu cũ nếu có)
  const tpAsCost = thau_phu.map((c) => ({ nhom: 'thau_phu', gia_tri: c.qt_gia_tri, tien_vat: c.qt_tien_vat, sau_vat: c.qt_sau_vat, tam_tinh: c.tam_tinh }));
  res.json({ du_an, items, thau_phu, tong_tp: summarizeContracts(thau_phu), tong: summarizeCost([...items, ...tpAsCost]) });
}));

api.post('/du-an/:id/chi-phi', canEdit, wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return bad(res, 'ID không hợp lệ');
  if (!(await store.getProject(id))) return bad(res, 'Không tìm thấy công trình', 404);
  const { data, errors } = validateCost({ ...(req.body || {}), _new: true });
  if (errors.length) return bad(res, errors);
  res.status(201).json(await store.createCost(id, data, req.user.id));
}));

api.put('/chi-phi/:id', canEdit, wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return bad(res, 'ID không hợp lệ');
  const { data, errors } = validateCost(req.body || {});
  if (errors.length) return bad(res, errors);
  const ok = await store.updateCost(id, data, req.user.id);
  ok ? res.json({ id }) : bad(res, 'Không tìm thấy dòng chi phí', 404);
}));

api.delete('/chi-phi/:id', canEdit, wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return bad(res, 'ID không hợp lệ');
  const ok = await store.deleteCost(id);
  ok ? res.status(204).end() : bad(res, 'Không tìm thấy dòng chi phí', 404);
}));

// ---------- Thầu phụ theo hợp đồng ----------
const LOCK_MSG = 'Hợp đồng thầu phụ đã quyết toán – đã khóa số. Muốn điều chỉnh, xóa dòng Quyết toán (cần Passcode) để mở khóa.';
async function lockedErr(res, tpId) {
  if (await store.tpLocked(tpId)) { bad(res, LOCK_MSG, 423); return true; }
  return false;
}
async function tpOf(req, res) {
  const id = parseId(req.params.id);
  const tp = id && (await store.getTp(id));
  if (!tp) { bad(res, 'Không tìm thấy hợp đồng thầu phụ', 404); return null; }
  return tp;
}

api.post('/du-an/:id/thau-phu', canEdit, wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id || !(await store.getProject(id))) return bad(res, 'Không tìm thấy công trình', 404);
  const t = validateTp(req.body || {});
  const l = validateTpLine({ ...(req.body?.hd || {}), ma_loai: 'HĐ' });
  const errors = [...t.errors, ...l.errors];
  if (errors.length) return bad(res, errors);
  res.status(201).json(await store.createTp(id, t.data, l.data, req.user.id));
}));

api.put('/thau-phu/:id', canEdit, wrap(async (req, res) => {
  const tp = await tpOf(req, res); if (!tp) return;
  const { data, errors } = validateTp(req.body || {});
  if (errors.length) return bad(res, errors);
  await store.updateTp(tp.id, data, req.user.id);
  res.json({ id: tp.id });
}));

api.delete('/thau-phu/:id', canEdit, wrap(async (req, res) => {
  const tp = await tpOf(req, res); if (!tp) return;
  if (!(await requirePasscode(req, res))) return;
  const c = buildContracts(await store.listTp(tp.du_an_id)).find((x) => x.id === tp.id);
  await store.deleteTp(tp.id);
  console.log(`[NHẬT KÝ] ${new Date().toISOString()} ${req.user.username} đã XÓA HĐ THẦU PHỤ "${tp.so_ma}" (công trình #${tp.du_an_id}): ` +
    `${c.lines.length} dòng HĐ/PL, HĐ ${c.hd_sau_vat}đ, HT/QT ${c.qt_sau_vat}đ, ${c.pays.length} dòng thanh toán ${c.da_tt}đ`);
  res.status(204).end();
}));

api.post('/thau-phu/:id/hd-pl', canEdit, wrap(async (req, res) => {
  const tp = await tpOf(req, res); if (!tp) return;
  if (await lockedErr(res, tp.id)) return;
  const { data, errors } = validateTpLine(req.body || {});
  if (errors.length) return bad(res, errors);
  res.status(201).json(await store.createTpLine(tp.id, data, req.user.id));
}));

api.put('/tp-hd-pl/:id', canEdit, wrap(async (req, res) => {
  const id = parseId(req.params.id);
  const cur = id && (await store.getTpLine(id));
  if (!cur) return bad(res, 'Không tìm thấy dòng HĐ/PL', 404);
  if (await lockedErr(res, cur.tp_id)) return;
  const { data, errors } = validateTpLine(req.body || {});
  if (errors.length) return bad(res, errors);
  if ((cur.ma_loai === 'HĐ') !== (data.ma_loai === 'HĐ')) return bad(res, 'Không đổi được dòng HĐ gốc thành PL (và ngược lại)');
  await store.updateTpLine(id, data, req.user.id);
  res.json({ id });
}));

api.delete('/tp-hd-pl/:id', canEdit, wrap(async (req, res) => {
  const id = parseId(req.params.id);
  const cur = id && (await store.getTpLine(id));
  if (!cur) return bad(res, 'Không tìm thấy dòng HĐ/PL', 404);
  if (cur.ma_loai === 'HĐ') return bad(res, 'Dòng HĐ gốc không xóa riêng được. Hãy xóa cả hợp đồng thầu phụ.');
  if (await lockedErr(res, cur.tp_id)) return;
  if (!(await requirePasscode(req, res))) return;
  await store.deleteTpLine(id);
  const tp = await store.getTp(cur.tp_id);
  console.log(`[NHẬT KÝ] ${new Date().toISOString()} ${req.user.username} đã xóa "${cur.ma_loai} ${tp?.so_ma}" (HĐ thầu phụ #${cur.tp_id})`);
  res.status(204).end();
}));

api.post('/thau-phu/:id/thanh-toan', canEdit, wrap(async (req, res) => {
  const tp = await tpOf(req, res); if (!tp) return;
  if (await lockedErr(res, tp.id)) return;
  const { data, errors } = validateTpPay(req.body || {});
  if (errors.length) return bad(res, errors);
  const r = await store.createTpPay(tp.id, data, req.user.id);
  if (data.loai === 'quyet_toan') console.log(`[NHẬT KÝ] ${new Date().toISOString()} ${req.user.username} đã QUYẾT TOÁN & KHÓA SỐ HĐ thầu phụ "${tp.so_ma}" (quyết toán ${data.so_tien}đ)`);
  res.status(201).json(r);
}));

api.put('/tp-thanh-toan/:id', canEdit, wrap(async (req, res) => {
  const id = parseId(req.params.id);
  const cur = id && (await store.getTpPay(id));
  if (!cur) return bad(res, 'Không tìm thấy dòng thanh toán', 404);
  if (await lockedErr(res, cur.tp_id)) return;
  const { data, errors } = validateTpPay(req.body || {});
  if (errors.length) return bad(res, errors);
  await store.updateTpPay(id, data, req.user.id);
  res.json({ id });
}));

api.delete('/tp-thanh-toan/:id', canEdit, wrap(async (req, res) => {
  const id = parseId(req.params.id);
  const cur = id && (await store.getTpPay(id));
  if (!cur) return bad(res, 'Không tìm thấy dòng thanh toán', 404);
  if (cur.loai === 'quyet_toan') {
    // Xóa dòng Quyết toán = mở khóa số -> bắt buộc Passcode
    if (!(await requirePasscode(req, res))) return;
    const tp = await store.getTp(cur.tp_id);
    console.log(`[NHẬT KÝ] ${new Date().toISOString()} ${req.user.username} đã MỞ KHÓA HĐ thầu phụ "${tp?.so_ma}" (xóa quyết toán ${cur.so_tien}đ)`);
  } else if (await lockedErr(res, cur.tp_id)) return;
  await store.deleteTpPay(id);
  res.status(204).end();
}));

app.use('/api', api);
app.use('/api', (_req, res) => bad(res, 'Không tìm thấy API', 404));

// Xử lý lỗi chung
app.use((err, req, res, _next) => {
  if (err.code === '23505') {
    const msg = /thau-phu$|thau-phu\/\d+$/.test(req.path) ? 'Số HĐ thầu phụ này đã có trong công trình'
      : req.path.includes('hd-pl') ? 'Loại HĐ/PL này đã có trong hợp đồng thầu phụ'
      : req.path.includes('thanh-toan') ? 'Trùng dữ liệu: số đợt thanh toán đã có, hoặc đã có dòng Quyết toán'
      : req.path.includes('tien-ve')
      ? 'Trùng dữ liệu: số đợt thanh toán này đã có trong HĐ, hoặc HĐ đã có dòng Quyết toán'
      : /users/.test(err.table || err.detail || '') || req.path.includes('/users') || req.path.includes('/setup')
        ? 'Tên đăng nhập đã tồn tại' : 'Mã dự án đã tồn tại';
    return bad(res, msg, 409);
  }
  if (err.type === 'entity.parse.failed') return bad(res, 'Dữ liệu JSON không hợp lệ');
  console.error(err);
  bad(res, 'Lỗi máy chủ', 500);
});

// =====================================================================
// Chẩn đoán lỗi CSDL
// =====================================================================
function dbHint(msg = '') {
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) return 'Không tìm thấy máy chủ CSDL. Service PostgreSQL chưa có, sai tên trong ${{...}}, hoặc nằm ở project/môi trường khác.';
  if (/ECONNREFUSED/i.test(msg)) return 'Máy chủ CSDL từ chối kết nối. Service PostgreSQL chưa chạy xong (chờ 1–2 phút) hoặc đang lỗi.';
  if (/password authentication|authentication failed/i.test(msg)) return 'Sai mật khẩu CSDL. Hãy dùng tham chiếu ${{Postgres.DATABASE_URL}} thay vì dán tay giá trị cũ.';
  if (/does not exist/i.test(msg)) return 'Tên database trong DATABASE_URL không tồn tại.';
  if (/timeout|ETIMEDOUT/i.test(msg)) return 'Hết thời gian chờ kết nối CSDL. Kiểm tra service PostgreSQL có đang Active.';
  if (/Invalid URL|invalid connection|getaddrinfo .*undefined/i.test(msg)) return 'DATABASE_URL sai định dạng. Phải có dạng postgresql://user:pass@host:5432/db';
  if (/SSL|certificate/i.test(msg)) return 'Lỗi SSL khi kết nối CSDL.';
  return 'Kiểm tra biến DATABASE_URL và service PostgreSQL trên Railway.';
}

function dbErrorPage() {
  const e = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="10"><title>Chưa kết nối CSDL</title><link rel="icon" href="/img/favicon.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap&subset=vietnamese"><link rel="stylesheet" href="/style.css"></head>
<body class="auth-page"><div class="auth-box wide"><div class="auth-brand"><img class="logo-full" src="/img/logo-full.png" alt="TMN">
<h1>Chưa kết nối được cơ sở dữ liệu</h1><p class="muted">Web đang chạy, đang tự thử kết nối lại (lần ${dbState.attempts}). Trang tự tải lại sau 10 giây.</p></div>
<div class="stack"><div><b>Nguyên nhân có thể:</b><br>${e(dbHint(dbState.error))}</div>
<div><b>Lỗi chi tiết:</b><br><code>${e(dbState.error || 'Đang kết nối...')}</code></div>
<div><b>DATABASE_URL đang trỏ tới:</b><br><code>${e(store.target)}</code></div></div></div>
<div class="auth-foot">Produced by the Supervisory Board of Tan Minh Nhan Corporation®</div></body></html>`;
}

// =====================================================================
// Khởi động: mở cổng web NGAY, rồi kết nối CSDL (tự thử lại mãi, không tắt web)
// =====================================================================
console.log(`Khởi động... PORT=${PORT} | CSDL: ${store.kind} | DATABASE_URL: ${store.target}`);
app.listen(PORT, '0.0.0.0', () => console.log(`Server chạy tại cổng ${PORT}`));

(async function connectDb() {
  for (;;) {
    dbState.attempts++;
    try {
      await store.init();
      const n = await store.migrateHdCodes();
      if (n) console.log(`Đã tách Loại/Số mã cho ${n} dòng HĐ/PL cũ`);
      const m = await store.migrateQtToHead();
      if (m) console.log(`Đã chuyển ${m} dòng HT/QT từ phụ lục sang HĐ gốc`);
      const t = await store.migrateTienVeHd();
      if (t) console.log(`Đã gắn HĐ cho ${t} dòng tiền về cũ`);
      dbState.ready = true;
      dbState.error = null;
      console.log(`Đã kết nối CSDL (${store.kind}) sau ${dbState.attempts} lần thử`);
      return;
    } catch (e) {
      dbState.error = e.message || String(e);
      console.error(`Kết nối CSDL thất bại (lần ${dbState.attempts}): ${dbState.error} -> ${dbHint(dbState.error)}`);
      await new Promise((r) => setTimeout(r, Math.min(30000, 3000 * dbState.attempts)));
    }
  }
})();

// Không để lỗi bất ngờ làm sập web
process.on('unhandledRejection', (e) => console.error('Lỗi chưa xử lý:', e));

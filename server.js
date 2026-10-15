const express = require('express');
const path = require('path');
const crypto = require('crypto');
const store = require('./lib/db');
const auth = require('./lib/auth');
const { TRANG_THAI, ROLES, validateProject, validateUser, validateSettings, passwordErrors } = require('./lib/validate');

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

// Health check cho Railway (không cần đăng nhập)
app.get('/health', async (_req, res) => {
  try {
    await store.ping();
    res.json({ status: 'ok', db: store.kind });
  } catch (e) {
    res.status(503).json({ status: 'error', message: e.message });
  }
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));
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
  const errors = passwordErrors(new_password);
  if (errors.length) return bad(res, errors);
  await store.updateUser(req.user.id, { password_hash: await auth.hashPassword(new_password) });
  await store.deleteUserSessions(req.user.id, req.sessionHash); // đăng xuất các thiết bị khác
  res.json({ ok: true });
}));

// ---------- Cài đặt hệ thống ----------
api.get('/settings', wrap(async (_req, res) => res.json(await store.getSettings())));
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
  const { data, errors } = validateUser(req.body || {}, false);
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

app.use('/api', api);
app.use('/api', (_req, res) => bad(res, 'Không tìm thấy API', 404));

// Xử lý lỗi chung
app.use((err, req, res, _next) => {
  if (err.code === '23505') {
    const msg = /users/.test(err.table || err.detail || '') || req.path.includes('/users') || req.path.includes('/setup')
      ? 'Tên đăng nhập đã tồn tại' : 'Mã dự án đã tồn tại';
    return bad(res, msg, 409);
  }
  if (err.type === 'entity.parse.failed') return bad(res, 'Dữ liệu JSON không hợp lệ');
  console.error(err);
  bad(res, 'Lỗi máy chủ', 500);
});

// Thử kết nối CSDL tối đa 10 lần (Postgres có thể khởi động chậm hơn web)
async function start() {
  for (let i = 1; i <= 10; i++) {
    try {
      await store.init();
      app.listen(PORT, '0.0.0.0', () => console.log(`Server chạy tại cổng ${PORT} (CSDL: ${store.kind})`));
      return;
    } catch (e) {
      console.error(`Kết nối CSDL thất bại (lần ${i}/10): ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  console.error('Không kết nối được CSDL. Kiểm tra biến DATABASE_URL và service PostgreSQL.');
  process.exit(1);
}
start();

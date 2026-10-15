const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { store, validate, TRANG_THAI } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));

// Health check cho Railway (không yêu cầu đăng nhập)
app.get('/health', async (_req, res) => {
  try {
    await store.ping();
    res.json({ status: 'ok', db: store.kind });
  } catch (e) {
    res.status(503).json({ status: 'error', message: e.message });
  }
});

// Đăng nhập Basic Auth – chỉ bật khi đặt APP_USER và APP_PASS
const { APP_USER, APP_PASS } = process.env;
const safeEq = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
if (APP_USER && APP_PASS) {
  app.use((req, res, next) => {
    const [type, token] = (req.headers.authorization || '').split(' ');
    if (type === 'Basic' && token) {
      const raw = Buffer.from(token, 'base64').toString();
      const i = raw.indexOf(':');
      if (i > 0 && safeEq(raw.slice(0, i), APP_USER) && safeEq(raw.slice(i + 1), APP_PASS)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="QLDA"').status(401).send('Yêu cầu đăng nhập');
  });
}

app.use(express.static(path.join(__dirname, 'public')));

// Bọc lỗi async
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const parseId = (req) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// ---------- API ----------
app.get('/api/meta', (_req, res) => res.json({ trang_thai: TRANG_THAI, db: store.kind }));

app.get('/api/du-an', wrap(async (_req, res) => res.json(await store.list())));

app.post('/api/du-an', wrap(async (req, res) => {
  const { data, errors } = validate(req.body || {});
  if (errors.length) return res.status(400).json({ errors });
  res.status(201).json(await store.create(data));
}));

app.put('/api/du-an/:id', wrap(async (req, res) => {
  const id = parseId(req);
  if (!id) return res.status(400).json({ errors: ['ID không hợp lệ'] });
  const { data, errors } = validate(req.body || {});
  if (errors.length) return res.status(400).json({ errors });
  const ok = await store.update(id, data);
  ok ? res.json({ id }) : res.status(404).json({ errors: ['Không tìm thấy dự án'] });
}));

app.delete('/api/du-an/:id', wrap(async (req, res) => {
  const id = parseId(req);
  if (!id) return res.status(400).json({ errors: ['ID không hợp lệ'] });
  const ok = await store.remove(id);
  ok ? res.status(204).end() : res.status(404).json({ errors: ['Không tìm thấy dự án'] });
}));

// Xử lý lỗi chung
app.use((err, _req, res, _next) => {
  if (err.code === '23505') return res.status(409).json({ errors: ['Mã dự án đã tồn tại'] });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ errors: ['Dữ liệu JSON không hợp lệ'] });
  console.error(err);
  res.status(500).json({ errors: ['Lỗi máy chủ'] });
});

store.init()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => console.log(`Server chạy tại cổng ${PORT} (CSDL: ${store.kind})`));
  })
  .catch((e) => {
    console.error('Không khởi tạo được CSDL:', e.message);
    process.exit(1);
  });

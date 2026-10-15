// Mã hóa mật khẩu, phiên đăng nhập (cookie), phân quyền, chống dò mật khẩu
const crypto = require('crypto');
const { promisify } = require('util');
const store = require('./db');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'sid';
const SESSION_DAYS = 7;

// ---------- Mật khẩu (scrypt, không cần thư viện ngoài) ----------
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(pw, stored) {
  const [algo, saltHex, keyHex] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = await scrypt(String(pw), Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(keyHex, 'hex');
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// Dùng khi username không tồn tại để thời gian phản hồi như nhau
const DUMMY_HASH = 'scrypt$' + '0'.repeat(32) + '$' + '0'.repeat(128);

// ---------- Phiên đăng nhập ----------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setCookie(req, res, value, maxAgeSec) {
  const parts = [`${COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (req.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400e3);
  await store.createSession(sha256(token), userId, expires);
  setCookie(req, res, token, SESSION_DAYS * 86400);
}

async function endSession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) await store.deleteSession(sha256(token));
  setCookie(req, res, '', 0);
}

// Gắn req.user nếu cookie hợp lệ
async function loadUser(req, _res, next) {
  try {
    const token = readCookie(req, COOKIE);
    if (token) {
      req.sessionHash = sha256(token);
      const user = await store.getSessionUser(req.sessionHash);
      if (user && user.active) req.user = user;
    }
    next();
  } catch (e) {
    next(e);
  }
}

const requireAuth = (req, res, next) =>
  req.user ? next() : res.status(401).json({ errors: ['Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'] });

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ errors: ['Chưa đăng nhập'] });
  if (!roles.includes(req.user.role)) return res.status(403).json({ errors: ['Bạn không có quyền thực hiện thao tác này'] });
  next();
};

// Chặn CSRF: mọi request thay đổi dữ liệu phải có header tùy chỉnh (form của web khác không gửi được)
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'fetch') return res.status(403).json({ errors: ['Yêu cầu không hợp lệ'] });
  next();
}

// ---------- Chống dò mật khẩu: tối đa 10 lần sai / 15 phút / IP ----------
const attempts = new Map();
const WINDOW = 15 * 60e3;
const MAX_FAIL = 10;

function loginBlocked(ip) {
  const a = attempts.get(ip);
  if (!a || Date.now() - a.first > WINDOW) return 0;
  return a.count >= MAX_FAIL ? Math.ceil((a.first + WINDOW - Date.now()) / 60e3) : 0;
}
function loginFailed(ip) {
  const a = attempts.get(ip);
  if (!a || Date.now() - a.first > WINDOW) attempts.set(ip, { first: Date.now(), count: 1 });
  else a.count++;
}
const loginOk = (ip) => attempts.delete(ip);
setInterval(() => {
  const now = Date.now();
  for (const [ip, a] of attempts) if (now - a.first > WINDOW) attempts.delete(ip);
}, WINDOW).unref();

module.exports = {
  hashPassword, verifyPassword, DUMMY_HASH,
  startSession, endSession, loadUser, requireAuth, requireRole, csrfGuard,
  loginBlocked, loginFailed, loginOk,
};

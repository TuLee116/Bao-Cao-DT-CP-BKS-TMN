// Lớp dữ liệu: PostgreSQL khi có DATABASE_URL (Railway),
// ngược lại dùng bộ nhớ tạm để chạy thử (mất dữ liệu khi khởi động lại).
const { Pool } = require('pg');

const PROJECT_FIELDS = ['ma_du_an', 'ten_du_an', 'chu_dau_tu', 'gia_tri_hd', 'da_giai_ngan', 'tien_do', 'trang_thai', 'ngay_bat_dau', 'ngay_ket_thuc'];
const USER_COLS = 'id, username, full_name, role, active, created_at, last_login_at';
const DEFAULT_SETTINGS = { ten_cong_ty: '', ten_he_thong: 'Quản lý dự án' };

const dupError = () => Object.assign(new Error('duplicate'), { code: '23505' });

// =====================================================================
// PostgreSQL
// =====================================================================
function pgStore(url) {
  const pool = new Pool({
    connectionString: url,
    // Kết nối nội bộ Railway (*.railway.internal) không cần SSL; kết nối public thì cần.
    ssl: /railway\.internal|localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
    max: 10,
    connectionTimeoutMillis: 10000,
  });
  // Bắt lỗi kết nối rớt (Postgres khởi động lại...) để không làm sập web
  pool.on('error', (e) => console.error('Lỗi kết nối PostgreSQL (tự kết nối lại khi cần):', e.message));
  const q = (sql, params) => pool.query(sql, params);

  return {
    kind: 'postgres',

    async init() {
      await q(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          full_name TEXT NOT NULL DEFAULT '',
          role TEXT NOT NULL DEFAULT 'viewer',
          active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_login_at TIMESTAMPTZ
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS du_an (
          id SERIAL PRIMARY KEY,
          ma_du_an TEXT UNIQUE NOT NULL,
          ten_du_an TEXT NOT NULL,
          chu_dau_tu TEXT,
          gia_tri_hd NUMERIC(18,0) DEFAULT 0,
          da_giai_ngan NUMERIC(18,0) DEFAULT 0,
          tien_do NUMERIC(5,2) DEFAULT 0,
          trang_thai TEXT DEFAULT 'Chuẩn bị',
          ngay_bat_dau DATE,
          ngay_ket_thuc DATE,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        );
        ALTER TABLE du_an ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
        ALTER TABLE du_an ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
        CREATE TABLE IF NOT EXISTS doanh_thu (
          id SERIAL PRIMARY KEY,
          du_an_id INTEGER NOT NULL REFERENCES du_an(id) ON DELETE CASCADE,
          loai TEXT NOT NULL CHECK (loai IN ('hd','qt')),
          so_hieu TEXT NOT NULL,
          ngay DATE,
          gia_tri NUMERIC(18,0) NOT NULL DEFAULT 0,
          vat SMALLINT NOT NULL DEFAULT 0 CHECK (vat BETWEEN 0 AND 100),
          ghi_chu TEXT NOT NULL DEFAULT '',
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS doanh_thu_du_an_idx ON doanh_thu(du_an_id, loai);
      `);
    },
    async ping() { await q('SELECT 1'); },

    // ---------- Cài đặt ----------
    async getSettings() {
      const { rows } = await q('SELECT key, value FROM settings');
      const s = { ...DEFAULT_SETTINGS };
      for (const r of rows) s[r.key] = r.value;
      return s;
    },
    async saveSettings(obj) {
      for (const [k, v] of Object.entries(obj)) {
        await q('INSERT INTO settings(key, value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value', [k, v]);
      }
    },

    // ---------- Tài khoản ----------
    async countUsers() {
      const { rows } = await q('SELECT count(*)::int AS n FROM users');
      return rows[0].n;
    },
    // Tạo admin đầu tiên – khóa để 2 người setup cùng lúc không tạo trùng
    async createFirstAdmin(u, settings) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('SELECT pg_advisory_xact_lock(918273)');
        const { rows } = await c.query('SELECT count(*)::int AS n FROM users');
        if (rows[0].n > 0) { await c.query('ROLLBACK'); return null; }
        const r = await c.query(
          `INSERT INTO users(username, password_hash, full_name, role) VALUES($1,$2,$3,'admin') RETURNING id`,
          [u.username, u.password_hash, u.full_name]);
        for (const [k, v] of Object.entries(settings)) {
          await c.query('INSERT INTO settings(key, value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value', [k, v]);
        }
        await c.query('COMMIT');
        return r.rows[0].id;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    async listUsers() {
      const { rows } = await q(`SELECT ${USER_COLS} FROM users ORDER BY id`);
      return rows;
    },
    async getUserById(id) {
      const { rows } = await q(`SELECT ${USER_COLS} FROM users WHERE id=$1`, [id]);
      return rows[0] || null;
    },
    async getUserForLogin(username) {
      const { rows } = await q(`SELECT ${USER_COLS}, password_hash FROM users WHERE username=$1`, [username]);
      return rows[0] || null;
    },
    async getPasswordHash(id) {
      const { rows } = await q('SELECT password_hash FROM users WHERE id=$1', [id]);
      return rows[0]?.password_hash || null;
    },
    async createUser(u) {
      const { rows } = await q(
        `INSERT INTO users(username, password_hash, full_name, role, active) VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [u.username, u.password_hash, u.full_name, u.role, u.active]);
      return rows[0].id;
    },
    async updateUser(id, f) {
      const keys = Object.keys(f);
      if (!keys.length) return true;
      const sets = keys.map((k, i) => `${k}=$${i + 1}`).join(',');
      const { rowCount } = await q(`UPDATE users SET ${sets} WHERE id=$${keys.length + 1}`, [...keys.map((k) => f[k]), id]);
      return rowCount > 0;
    },
    async deleteUser(id) {
      const { rowCount } = await q('DELETE FROM users WHERE id=$1', [id]);
      return rowCount > 0;
    },
    async countActiveAdmins(excludeId = 0) {
      const { rows } = await q(`SELECT count(*)::int AS n FROM users WHERE role='admin' AND active AND id<>$1`, [excludeId]);
      return rows[0].n;
    },
    async touchLogin(id) { await q('UPDATE users SET last_login_at=now() WHERE id=$1', [id]); },

    // ---------- Phiên đăng nhập ----------
    async createSession(hash, userId, expires) {
      await q('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES($1,$2,$3)', [hash, userId, expires]);
      await q('DELETE FROM sessions WHERE expires_at < now()');
    },
    async getSessionUser(hash) {
      const { rows } = await q(
        `SELECT u.id, u.username, u.full_name, u.role, u.active
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash=$1 AND s.expires_at > now()`, [hash]);
      return rows[0] || null;
    },
    async deleteSession(hash) { await q('DELETE FROM sessions WHERE token_hash=$1', [hash]); },
    async deleteUserSessions(userId, exceptHash = '') {
      await q('DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2', [userId, exceptHash]);
    },

    // ---------- Dự án ----------
    async listProjects() {
      const { rows } = await q(
        `SELECT d.id, d.ma_du_an, d.ten_du_an, d.chu_dau_tu,
                d.gia_tri_hd::float8 AS gia_tri_hd, d.da_giai_ngan::float8 AS da_giai_ngan,
                d.tien_do::float8 AS tien_do, d.trang_thai,
                to_char(d.ngay_bat_dau,'YYYY-MM-DD') AS ngay_bat_dau,
                to_char(d.ngay_ket_thuc,'YYYY-MM-DD') AS ngay_ket_thuc,
                u.full_name AS nguoi_cap_nhat, d.updated_at
         FROM du_an d LEFT JOIN users u ON u.id = COALESCE(d.updated_by, d.created_by)
         ORDER BY d.id DESC`);
      return rows;
    },
    async createProject(d, userId) {
      const cols = [...PROJECT_FIELDS, 'created_by', 'updated_by'];
      const vals = [...PROJECT_FIELDS.map((f) => d[f]), userId, userId];
      const { rows } = await q(
        `INSERT INTO du_an (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id`, vals);
      return rows[0];
    },
    async updateProject(id, d, userId) {
      const sets = PROJECT_FIELDS.map((f, i) => `${f}=$${i + 1}`).join(',');
      const n = PROJECT_FIELDS.length;
      const { rowCount } = await q(
        `UPDATE du_an SET ${sets}, updated_by=$${n + 1}, updated_at=now() WHERE id=$${n + 2}`,
        [...PROJECT_FIELDS.map((f) => d[f]), userId, id]);
      return rowCount > 0;
    },
    async deleteProject(id) {
      const { rowCount } = await q('DELETE FROM du_an WHERE id=$1', [id]);
      return rowCount > 0;
    },
    async getProject(id) {
      const { rows } = await q('SELECT id, ma_du_an, ten_du_an, chu_dau_tu FROM du_an WHERE id=$1', [id]);
      return rows[0] || null;
    },

    // ---------- Doanh thu ----------
    async listRevenue(duAnId) {
      const { rows } = await q(
        `SELECT r.id, r.du_an_id, r.loai, r.so_hieu, to_char(r.ngay,'YYYY-MM-DD') AS ngay,
                r.gia_tri::text AS gia_tri, r.vat, r.ghi_chu, u.full_name AS nguoi_cap_nhat, r.updated_at
         FROM doanh_thu r LEFT JOIN users u ON u.id = COALESCE(r.updated_by, r.created_by)
         WHERE r.du_an_id=$1 ORDER BY r.loai, r.ngay NULLS LAST, r.id`, [duAnId]);
      return rows.map((r) => ({ ...r, gia_tri: Number(r.gia_tri) }));
    },
    async getRevenue(id) {
      const { rows } = await q('SELECT id, du_an_id FROM doanh_thu WHERE id=$1', [id]);
      return rows[0] || null;
    },
    async createRevenue(duAnId, d, userId) {
      const { rows } = await q(
        `INSERT INTO doanh_thu(du_an_id, loai, so_hieu, ngay, gia_tri, vat, ghi_chu, created_by, updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id`,
        [duAnId, d.loai, d.so_hieu, d.ngay, d.gia_tri, d.vat, d.ghi_chu, userId]);
      return rows[0];
    },
    async updateRevenue(id, d, userId) {
      const { rowCount } = await q(
        `UPDATE doanh_thu SET loai=$1, so_hieu=$2, ngay=$3, gia_tri=$4, vat=$5, ghi_chu=$6, updated_by=$7, updated_at=now()
         WHERE id=$8`, [d.loai, d.so_hieu, d.ngay, d.gia_tri, d.vat, d.ghi_chu, userId, id]);
      return rowCount > 0;
    },
    async deleteRevenue(id) {
      const { rowCount } = await q('DELETE FROM doanh_thu WHERE id=$1', [id]);
      return rowCount > 0;
    },
  };
}

// =====================================================================
// Bộ nhớ tạm (chạy thử trên máy)
// =====================================================================
function memoryStore() {
  const db = { users: [], sessions: new Map(), settings: { ...DEFAULT_SETTINGS }, projects: [], revenue: [], seqU: 0, seqP: 0, seqR: 0 };
  const pub = (u) => u && (({ password_hash, ...rest }) => ({ ...rest }))(u);
  const now = () => new Date().toISOString();
  const userName = (id) => db.users.find((u) => u.id === id)?.full_name || null;

  return {
    kind: 'memory',
    async init() {},
    async ping() {},

    async getSettings() { return { ...db.settings }; },
    async saveSettings(obj) { Object.assign(db.settings, obj); },

    async countUsers() { return db.users.length; },
    async createFirstAdmin(u, settings) {
      if (db.users.length) return null;
      Object.assign(db.settings, settings);
      return this.createUser({ ...u, role: 'admin', active: true });
    },
    async listUsers() { return db.users.map(pub); },
    async getUserById(id) { return pub(db.users.find((u) => u.id === id)) || null; },
    async getUserForLogin(username) {
      const u = db.users.find((x) => x.username === username);
      return u ? { ...u } : null;
    },
    async getPasswordHash(id) { return db.users.find((u) => u.id === id)?.password_hash || null; },
    async createUser(u) {
      if (db.users.some((x) => x.username === u.username)) throw dupError();
      const row = { id: ++db.seqU, username: u.username, password_hash: u.password_hash, full_name: u.full_name, role: u.role, active: u.active, created_at: now(), last_login_at: null };
      db.users.push(row);
      return row.id;
    },
    async updateUser(id, f) {
      const u = db.users.find((x) => x.id === id);
      if (!u) return false;
      Object.assign(u, f);
      return true;
    },
    async deleteUser(id) {
      const n = db.users.length;
      db.users = db.users.filter((u) => u.id !== id);
      for (const [h, s] of db.sessions) if (s.userId === id) db.sessions.delete(h);
      for (const p of [...db.projects, ...db.revenue]) {
        if (p.created_by === id) p.created_by = null;
        if (p.updated_by === id) p.updated_by = null;
      }
      return db.users.length < n;
    },
    async countActiveAdmins(excludeId = 0) {
      return db.users.filter((u) => u.role === 'admin' && u.active && u.id !== excludeId).length;
    },
    async touchLogin(id) { await this.updateUser(id, { last_login_at: now() }); },

    async createSession(hash, userId, expires) {
      db.sessions.set(hash, { userId, expires });
      for (const [h, s] of db.sessions) if (s.expires < new Date()) db.sessions.delete(h);
    },
    async getSessionUser(hash) {
      const s = db.sessions.get(hash);
      if (!s || s.expires < new Date()) return null;
      const u = db.users.find((x) => x.id === s.userId);
      return u ? { id: u.id, username: u.username, full_name: u.full_name, role: u.role, active: u.active } : null;
    },
    async deleteSession(hash) { db.sessions.delete(hash); },
    async deleteUserSessions(userId, exceptHash = '') {
      for (const [h, s] of db.sessions) if (s.userId === userId && h !== exceptHash) db.sessions.delete(h);
    },

    async listProjects() {
      return [...db.projects].sort((a, b) => b.id - a.id)
        .map((p) => ({ ...p, nguoi_cap_nhat: userName(p.updated_by ?? p.created_by) }));
    },
    async createProject(d, userId) {
      if (db.projects.some((p) => p.ma_du_an === d.ma_du_an)) throw dupError();
      const p = { id: ++db.seqP, ...d, created_by: userId, updated_by: userId, updated_at: now() };
      db.projects.push(p);
      return { id: p.id };
    },
    async updateProject(id, d, userId) {
      const p = db.projects.find((x) => x.id === id);
      if (!p) return false;
      if (db.projects.some((x) => x.ma_du_an === d.ma_du_an && x.id !== id)) throw dupError();
      Object.assign(p, d, { updated_by: userId, updated_at: now() });
      return true;
    },
    async deleteProject(id) {
      const n = db.projects.length;
      db.projects = db.projects.filter((p) => p.id !== id);
      db.revenue = db.revenue.filter((r) => r.du_an_id !== id);
      return db.projects.length < n;
    },
    async getProject(id) {
      const p = db.projects.find((x) => x.id === id);
      return p ? { id: p.id, ma_du_an: p.ma_du_an, ten_du_an: p.ten_du_an, chu_dau_tu: p.chu_dau_tu } : null;
    },

    async listRevenue(duAnId) {
      const key = (r) => [r.loai, r.ngay || '9999-99-99', String(r.id).padStart(10, '0')].join('|');
      return db.revenue.filter((r) => r.du_an_id === duAnId)
        .sort((a, b) => (key(a) < key(b) ? -1 : 1))
        .map((r) => ({ ...r, nguoi_cap_nhat: userName(r.updated_by ?? r.created_by) }));
    },
    async getRevenue(id) {
      const r = db.revenue.find((x) => x.id === id);
      return r ? { id: r.id, du_an_id: r.du_an_id } : null;
    },
    async createRevenue(duAnId, d, userId) {
      const r = { id: ++db.seqR, du_an_id: duAnId, ...d, created_by: userId, updated_by: userId, updated_at: now() };
      db.revenue.push(r);
      return { id: r.id };
    },
    async updateRevenue(id, d, userId) {
      const r = db.revenue.find((x) => x.id === id);
      if (!r) return false;
      Object.assign(r, d, { updated_by: userId, updated_at: now() });
      return true;
    },
    async deleteRevenue(id) {
      const n = db.revenue.length;
      db.revenue = db.revenue.filter((r) => r.id !== id);
      return db.revenue.length < n;
    },
  };
}

const DB_URL = (process.env.DATABASE_URL || '').trim();
if (!DB_URL && process.env.RAILWAY_ENVIRONMENT) {
  console.warn('CẢNH BÁO: DATABASE_URL đang rỗng -> dùng bộ nhớ tạm, dữ liệu và tài khoản sẽ mất khi khởi động lại. ' +
    'Hãy thêm service PostgreSQL và đặt DATABASE_URL=${{Postgres.DATABASE_URL}}');
}

function describeUrl(url) {
  if (!url) return 'không có (DATABASE_URL rỗng)';
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.username ? u.username + ':***@' : ''}${u.host}${u.pathname}`;
  } catch {
    return 'sai định dạng (không phải dạng postgresql://...)';
  }
}

const store = DB_URL ? pgStore(DB_URL) : memoryStore();
store.target = describeUrl(DB_URL);
module.exports = store;

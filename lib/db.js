// Lớp dữ liệu: PostgreSQL khi có DATABASE_URL (Railway),
// ngược lại dùng bộ nhớ tạm để chạy thử (mất dữ liệu khi khởi động lại).
const { Pool } = require('pg');

// Danh sách dự án: A→Z theo mã, số so theo giá trị (DA-2 trước DA-10), rồi theo tên
const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });
const sortProjects = (rows) => rows.sort((a, b) =>
  collator.compare(a.ma_du_an, b.ma_du_an) || collator.compare(a.ten_du_an, b.ten_du_an) || a.id - b.id);

const PROJECT_FIELDS = ['ma_du_an', 'ten_du_an', 'chu_dau_tu', 'gia_tri_hd', 'da_giai_ngan', 'tien_do', 'trang_thai', 'ngay_bat_dau', 'ngay_ket_thuc', 'loai_cong_trinh', 'dia_diem'];
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
        ALTER TABLE du_an ADD COLUMN IF NOT EXISTS loai_cong_trinh TEXT NOT NULL DEFAULT '';
        ALTER TABLE du_an ADD COLUMN IF NOT EXISTS dia_diem TEXT NOT NULL DEFAULT '';
        -- Ảnh đại diện công trình (lưu trong CSDL vì ổ đĩa Railway không bền)
        CREATE TABLE IF NOT EXISTS du_an_anh (
          du_an_id INTEGER PRIMARY KEY REFERENCES du_an(id) ON DELETE CASCADE,
          mime TEXT NOT NULL,
          data BYTEA NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
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
        ALTER TABLE doanh_thu ADD COLUMN IF NOT EXISTS hd_id INTEGER REFERENCES doanh_thu(id);
        CREATE INDEX IF NOT EXISTS doanh_thu_hd_idx ON doanh_thu(hd_id);
        ALTER TABLE doanh_thu ADD COLUMN IF NOT EXISTS ma_loai TEXT;
        ALTER TABLE doanh_thu ADD COLUMN IF NOT EXISTS so_ma TEXT;
        CREATE TABLE IF NOT EXISTS tien_ve (
          id SERIAL PRIMARY KEY,
          du_an_id INTEGER NOT NULL REFERENCES du_an(id) ON DELETE CASCADE,
          loai TEXT NOT NULL CHECK (loai IN ('tam_ung','dot','quyet_toan')),
          dot SMALLINT CHECK ((loai = 'dot') = (dot IS NOT NULL)),
          so_tien NUMERIC(18,0) NOT NULL DEFAULT 0 CHECK (so_tien >= 0),
          ngay DATE,
          ghi_chu TEXT NOT NULL DEFAULT '',
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        -- Tiền về gắn theo HĐ: số đợt & Quyết toán là duy nhất trong từng HĐ
        ALTER TABLE tien_ve ADD COLUMN IF NOT EXISTS hd_id INTEGER REFERENCES doanh_thu(id);
        DROP INDEX IF EXISTS tien_ve_dot_uq;
        DROP INDEX IF EXISTS tien_ve_qt_uq;
        CREATE UNIQUE INDEX IF NOT EXISTS tien_ve_dot_hd_uq ON tien_ve(du_an_id, COALESCE(hd_id, 0), dot) WHERE loai = 'dot';
        CREATE UNIQUE INDEX IF NOT EXISTS tien_ve_qt_hd_uq ON tien_ve(du_an_id, COALESCE(hd_id, 0)) WHERE loai = 'quyet_toan';
        CREATE INDEX IF NOT EXISTS tien_ve_hd_idx ON tien_ve(hd_id);
        CREATE TABLE IF NOT EXISTS chi_phi (
          id SERIAL PRIMARY KEY,
          du_an_id INTEGER NOT NULL REFERENCES du_an(id) ON DELETE CASCADE,
          nhom TEXT NOT NULL,
          nhom_con TEXT,
          noi_dung TEXT NOT NULL,
          doi_tac TEXT NOT NULL DEFAULT '',
          so_ct TEXT NOT NULL DEFAULT '',
          ngay DATE,
          gia_tri NUMERIC(18,0) NOT NULL DEFAULT 0,
          vat SMALLINT NOT NULL DEFAULT 0 CHECK (vat BETWEEN 0 AND 100),
          ghi_chu TEXT NOT NULL DEFAULT '',
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS chi_phi_du_an_idx ON chi_phi(du_an_id, nhom);
        -- Thầu phụ theo hợp đồng
        CREATE TABLE IF NOT EXISTS tp_hop_dong (
          id SERIAL PRIMARY KEY,
          du_an_id INTEGER NOT NULL REFERENCES du_an(id) ON DELETE CASCADE,
          so_ma TEXT NOT NULL,
          doi_tac TEXT NOT NULL DEFAULT '',
          ghi_chu TEXT NOT NULL DEFAULT '',
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS tp_hop_dong_uq ON tp_hop_dong(du_an_id, lower(so_ma));
        -- HĐ thầu phụ thuộc HĐ chủ đầu tư nào (xóa HĐ CĐT -> về nhóm "Chưa gắn")
        ALTER TABLE tp_hop_dong ADD COLUMN IF NOT EXISTS hd_cdt_id INTEGER REFERENCES doanh_thu(id) ON DELETE SET NULL;
        CREATE TABLE IF NOT EXISTS tp_hd_pl (
          id SERIAL PRIMARY KEY,
          tp_id INTEGER NOT NULL REFERENCES tp_hop_dong(id) ON DELETE CASCADE,
          ma_loai TEXT NOT NULL,
          ngay DATE,
          gia_tri NUMERIC(18,0) NOT NULL DEFAULT 0,
          vat SMALLINT NOT NULL DEFAULT 0 CHECK (vat BETWEEN 0 AND 100),
          gia_tri_qt NUMERIC(18,0),
          ghi_chu TEXT NOT NULL DEFAULT '',
          updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS tp_hd_pl_uq ON tp_hd_pl(tp_id, ma_loai);
        CREATE TABLE IF NOT EXISTS tp_thanh_toan (
          id SERIAL PRIMARY KEY,
          tp_id INTEGER NOT NULL REFERENCES tp_hop_dong(id) ON DELETE CASCADE,
          loai TEXT NOT NULL CHECK (loai IN ('tam_ung','dot','quyet_toan')),
          dot SMALLINT,
          so_tien NUMERIC(18,0) NOT NULL DEFAULT 0 CHECK (so_tien >= 0),
          ngay DATE,
          ghi_chu TEXT NOT NULL DEFAULT '',
          updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS tp_tt_dot_uq ON tp_thanh_toan(tp_id, dot) WHERE loai = 'dot';
        CREATE UNIQUE INDEX IF NOT EXISTS tp_tt_qt_uq ON tp_thanh_toan(tp_id) WHERE loai = 'quyet_toan';
      `);
    },
    async ping() { await q('SELECT 1'); },

    // Dữ liệu cũ của mục 1 (chỉ có so_hieu): tách thành Loại + Số mã
    async migrateHdCodes() {
      const { splitSoHieu } = require('./revenue');
      const { rows } = await q(`SELECT id, so_hieu FROM doanh_thu WHERE loai='hd' AND (ma_loai IS NULL OR so_ma IS NULL)`);
      for (const r of rows) {
        const s = splitSoHieu(r.so_hieu);
        await q('UPDATE doanh_thu SET ma_loai=$1, so_ma=$2, so_hieu=$3 WHERE id=$4', [s.ma_loai, s.so_ma, `${s.ma_loai} ${s.so_ma}`, r.id]);
      }
      return rows.length;
    },
    // Tiền về cũ chưa có HĐ: công trình chỉ có đúng 1 HĐ gốc thì tự gắn vào HĐ đó
    async migrateTienVeHd() {
      const { rowCount } = await q(
        `UPDATE tien_ve t SET hd_id = h.id
         FROM (SELECT du_an_id, min(id) AS id FROM doanh_thu WHERE loai='hd' AND ma_loai='HĐ'
               GROUP BY du_an_id HAVING count(*) = 1) h
         WHERE t.hd_id IS NULL AND t.du_an_id = h.du_an_id`);
      return rowCount;
    },
    // Dòng HT/QT đang gắn vào phụ lục -> chuyển sang HĐ gốc cùng Số mã (nếu có)
    async migrateQtToHead() {
      const { rowCount } = await q(
        `UPDATE doanh_thu qt SET hd_id = h.id
         FROM doanh_thu p, doanh_thu h
         WHERE qt.loai='qt' AND qt.hd_id=p.id AND p.ma_loai<>'HĐ'
           AND h.du_an_id=p.du_an_id AND h.loai='hd' AND h.ma_loai='HĐ' AND lower(h.so_ma)=lower(p.so_ma)`);
      return rowCount;
    },

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
                to_char(d.ngay_ket_thuc,'YYYY-MM-DD') AS ngay_ket_thuc, d.loai_cong_trinh, d.dia_diem,
                (a.du_an_id IS NOT NULL) AS co_anh, COALESCE(floor(extract(epoch FROM a.updated_at))::bigint, 0) AS anh_v,
                u.full_name AS nguoi_cap_nhat, d.updated_at
         FROM du_an d LEFT JOIN users u ON u.id = COALESCE(d.updated_by, d.created_by)
         LEFT JOIN du_an_anh a ON a.du_an_id = d.id
         ORDER BY d.id`);
      return sortProjects(rows);
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
    async getProjectImage(id) {
      const { rows } = await q('SELECT mime, data, floor(extract(epoch FROM updated_at))::bigint AS v FROM du_an_anh WHERE du_an_id=$1', [id]);
      return rows[0] ? { mime: rows[0].mime, data: rows[0].data, v: Number(rows[0].v) } : null;
    },
    async setProjectImage(id, mime, data) {
      await q(`INSERT INTO du_an_anh(du_an_id, mime, data, updated_at) VALUES($1,$2,$3,now())
               ON CONFLICT(du_an_id) DO UPDATE SET mime=EXCLUDED.mime, data=EXCLUDED.data, updated_at=now()`, [id, mime, data]);
    },
    async deleteProjectImage(id) {
      const { rowCount } = await q('DELETE FROM du_an_anh WHERE du_an_id=$1', [id]);
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
                r.gia_tri::text AS gia_tri, r.vat, r.ghi_chu, r.hd_id, h.so_hieu AS hd_so_hieu, r.ma_loai, r.so_ma,
                u.full_name AS nguoi_cap_nhat, r.updated_at
         FROM doanh_thu r
         LEFT JOIN doanh_thu h ON h.id = r.hd_id
         LEFT JOIN users u ON u.id = COALESCE(r.updated_by, r.created_by)
         WHERE r.du_an_id=$1 ORDER BY r.loai, r.ngay NULLS LAST, r.id`, [duAnId]);
      return rows.map((r) => ({ ...r, gia_tri: Number(r.gia_tri) }));
    },
    async getRevenue(id) {
      const { rows } = await q('SELECT id, du_an_id, loai, so_hieu, ma_loai, so_ma FROM doanh_thu WHERE id=$1', [id]);
      return rows[0] || null;
    },
    async createRevenue(duAnId, d, userId) {
      const { rows } = await q(
        `INSERT INTO doanh_thu(du_an_id, loai, so_hieu, ngay, gia_tri, vat, ghi_chu, hd_id, ma_loai, so_ma, created_by, updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING id`,
        [duAnId, d.loai, d.so_hieu, d.ngay, d.gia_tri, d.vat, d.ghi_chu, d.hd_id, d.ma_loai, d.so_ma, userId]);
      return rows[0];
    },
    async updateRevenue(id, d, userId) {
      const { rowCount } = await q(
        `UPDATE doanh_thu SET loai=$1, so_hieu=$2, ngay=$3, gia_tri=$4, vat=$5, ghi_chu=$6, hd_id=$7, ma_loai=$8, so_ma=$9,
                updated_by=$10, updated_at=now()
         WHERE id=$11`, [d.loai, d.so_hieu, d.ngay, d.gia_tri, d.vat, d.ghi_chu, d.hd_id, d.ma_loai, d.so_ma, userId, id]);
      return rowCount > 0;
    },
    async deleteRevenue(id) {
      const { rowCount } = await q('DELETE FROM doanh_thu WHERE id=$1', [id]);
      return rowCount > 0;
    },
    // Xóa HĐ gốc + PL cùng Số mã + HT/QT và Tiền về gắn vào HĐ (1 giao dịch, lỗi thì không xóa gì)
    async deleteContractCascade(hd) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('DELETE FROM tien_ve WHERE hd_id=$1', [hd.id]);
        await c.query(`DELETE FROM doanh_thu WHERE hd_id=$1 AND loai='qt'`, [hd.id]);
        await c.query(`DELETE FROM doanh_thu WHERE du_an_id=$1 AND loai='hd' AND ma_loai<>'HĐ' AND lower(so_ma)=lower($2)`, [hd.du_an_id, hd.so_ma]);
        await c.query('DELETE FROM doanh_thu WHERE id=$1', [hd.id]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    async countRevenueRefs(hdId) {
      const { rows } = await q(
        `SELECT (SELECT count(*) FROM doanh_thu WHERE hd_id=$1)::int AS qt, (SELECT count(*) FROM tien_ve WHERE hd_id=$1)::int AS tv`, [hdId]);
      return rows[0];
    },

    // ---------- Giá trị tiền về ----------
    async listTienVe(duAnId) {
      const { rows } = await q(
        `SELECT t.id, t.du_an_id, t.loai, t.dot, t.so_tien::text AS so_tien, to_char(t.ngay,'YYYY-MM-DD') AS ngay,
                t.ghi_chu, t.hd_id, h.so_hieu AS hd_so_hieu, u.full_name AS nguoi_cap_nhat
         FROM tien_ve t
         LEFT JOIN doanh_thu h ON h.id = t.hd_id
         LEFT JOIN users u ON u.id = COALESCE(t.updated_by, t.created_by)
         WHERE t.du_an_id=$1`, [duAnId]);
      return rows.map((r) => ({ ...r, so_tien: Number(r.so_tien) }));
    },
    async createTienVe(duAnId, d, userId) {
      const { rows } = await q(
        `INSERT INTO tien_ve(du_an_id, loai, dot, so_tien, ngay, ghi_chu, hd_id, created_by, updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id`,
        [duAnId, d.loai, d.dot, d.so_tien, d.ngay, d.ghi_chu, d.hd_id, userId]);
      return rows[0];
    },
    async updateTienVe(id, d, userId) {
      const { rowCount } = await q(
        `UPDATE tien_ve SET loai=$1, dot=$2, so_tien=$3, ngay=$4, ghi_chu=$5, hd_id=$6, updated_by=$7, updated_at=now() WHERE id=$8`,
        [d.loai, d.dot, d.so_tien, d.ngay, d.ghi_chu, d.hd_id, userId, id]);
      return rowCount > 0;
    },
    async getTienVe(id) {
      const { rows } = await q('SELECT id, du_an_id FROM tien_ve WHERE id=$1', [id]);
      return rows[0] || null;
    },
    async deleteTienVe(id) {
      const { rowCount } = await q('DELETE FROM tien_ve WHERE id=$1', [id]);
      return rowCount > 0;
    },

    // ---------- Chi phí ----------
    async listCost(duAnId) {
      const { rows } = await q(
        `SELECT c.id, c.du_an_id, c.nhom, c.nhom_con, c.noi_dung, c.doi_tac, c.so_ct, to_char(c.ngay,'YYYY-MM-DD') AS ngay,
                c.gia_tri::text AS gia_tri, c.vat, c.ghi_chu, u.full_name AS nguoi_cap_nhat
         FROM chi_phi c LEFT JOIN users u ON u.id = COALESCE(c.updated_by, c.created_by)
         WHERE c.du_an_id=$1`, [duAnId]);
      return rows.map((r) => ({ ...r, gia_tri: Number(r.gia_tri) }));
    },
    async createCost(duAnId, d, userId) {
      const { rows } = await q(
        `INSERT INTO chi_phi(du_an_id, nhom, nhom_con, noi_dung, doi_tac, so_ct, ngay, gia_tri, vat, ghi_chu, created_by, updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING id`,
        [duAnId, d.nhom, d.nhom_con, d.noi_dung, d.doi_tac, d.so_ct, d.ngay, d.gia_tri, d.vat, d.ghi_chu, userId]);
      return rows[0];
    },
    async updateCost(id, d, userId) {
      const { rowCount } = await q(
        `UPDATE chi_phi SET nhom=$1, nhom_con=$2, noi_dung=$3, doi_tac=$4, so_ct=$5, ngay=$6, gia_tri=$7, vat=$8, ghi_chu=$9,
                updated_by=$10, updated_at=now() WHERE id=$11`,
        [d.nhom, d.nhom_con, d.noi_dung, d.doi_tac, d.so_ct, d.ngay, d.gia_tri, d.vat, d.ghi_chu, userId, id]);
      return rowCount > 0;
    },
    async deleteCost(id) {
      const { rowCount } = await q('DELETE FROM chi_phi WHERE id=$1', [id]);
      return rowCount > 0;
    },

    // ---------- Thầu phụ theo hợp đồng ----------
    async listTp(duAnId) {
      const num = (v) => (v === null ? null : Number(v));
      const contracts = (await q(
        `SELECT t.id, t.du_an_id, t.so_ma, t.doi_tac, t.ghi_chu, t.hd_cdt_id, u.full_name AS nguoi_cap_nhat
         FROM tp_hop_dong t LEFT JOIN users u ON u.id = COALESCE(t.updated_by, t.created_by)
         WHERE t.du_an_id=$1 ORDER BY t.id`, [duAnId])).rows;
      const lines = (await q(
        `SELECT l.id, l.tp_id, l.ma_loai, to_char(l.ngay,'YYYY-MM-DD') AS ngay, l.gia_tri::text AS gia_tri, l.vat,
                l.gia_tri_qt::text AS gia_tri_qt, l.ghi_chu
         FROM tp_hd_pl l JOIN tp_hop_dong t ON t.id = l.tp_id WHERE t.du_an_id=$1`, [duAnId])).rows
        .map((r) => ({ ...r, gia_tri: Number(r.gia_tri), gia_tri_qt: num(r.gia_tri_qt) }));
      const pays = (await q(
        `SELECT p.id, p.tp_id, p.loai, p.dot, p.so_tien::text AS so_tien, to_char(p.ngay,'YYYY-MM-DD') AS ngay, p.ghi_chu
         FROM tp_thanh_toan p JOIN tp_hop_dong t ON t.id = p.tp_id WHERE t.du_an_id=$1`, [duAnId])).rows
        .map((r) => ({ ...r, so_tien: Number(r.so_tien) }));
      return { contracts, lines, pays };
    },
    async setTpHdCdt(id, hdId) { await q('UPDATE tp_hop_dong SET hd_cdt_id=$1 WHERE id=$2', [hdId, id]); },
    async getTp(id) {
      const { rows } = await q('SELECT id, du_an_id, so_ma, hd_cdt_id FROM tp_hop_dong WHERE id=$1', [id]);
      return rows[0] || null;
    },
    // Tạo HĐTP kèm dòng HĐ gốc (1 giao dịch)
    async createTp(duAnId, d, hd, userId) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const { rows } = await c.query(
          `INSERT INTO tp_hop_dong(du_an_id, so_ma, doi_tac, ghi_chu, hd_cdt_id, created_by, updated_by) VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING id`,
          [duAnId, d.so_ma, d.doi_tac, d.ghi_chu, d.hd_cdt_id ?? null, userId]);
        await c.query(
          `INSERT INTO tp_hd_pl(tp_id, ma_loai, ngay, gia_tri, vat, gia_tri_qt, ghi_chu, updated_by) VALUES($1,'HĐ',$2,$3,$4,$5,'',$6)`,
          [rows[0].id, hd.ngay, hd.gia_tri, hd.vat, hd.gia_tri_qt, userId]);
        await c.query('COMMIT');
        return rows[0];
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    async updateTp(id, d, userId) {
      const { rowCount } = await q('UPDATE tp_hop_dong SET so_ma=$1, doi_tac=$2, ghi_chu=$3, hd_cdt_id=$4, updated_by=$5, updated_at=now() WHERE id=$6',
        [d.so_ma, d.doi_tac, d.ghi_chu, d.hd_cdt_id ?? null, userId, id]);
      return rowCount > 0;
    },
    async deleteTp(id) {
      const { rowCount } = await q('DELETE FROM tp_hop_dong WHERE id=$1', [id]);
      return rowCount > 0;
    },
    async tpLocked(tpId) {
      const { rows } = await q(`SELECT 1 FROM tp_thanh_toan WHERE tp_id=$1 AND loai='quyet_toan' LIMIT 1`, [tpId]);
      return rows.length > 0;
    },
    async getTpLine(id) {
      const { rows } = await q('SELECT id, tp_id, ma_loai FROM tp_hd_pl WHERE id=$1', [id]);
      return rows[0] || null;
    },
    async createTpLine(tpId, d, userId) {
      const { rows } = await q(
        'INSERT INTO tp_hd_pl(tp_id, ma_loai, ngay, gia_tri, vat, gia_tri_qt, ghi_chu, updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
        [tpId, d.ma_loai, d.ngay, d.gia_tri, d.vat, d.gia_tri_qt, d.ghi_chu, userId]);
      return rows[0];
    },
    async updateTpLine(id, d, userId) {
      const { rowCount } = await q(
        'UPDATE tp_hd_pl SET ma_loai=$1, ngay=$2, gia_tri=$3, vat=$4, gia_tri_qt=$5, ghi_chu=$6, updated_by=$7, updated_at=now() WHERE id=$8',
        [d.ma_loai, d.ngay, d.gia_tri, d.vat, d.gia_tri_qt, d.ghi_chu, userId, id]);
      return rowCount > 0;
    },
    async deleteTpLine(id) {
      const { rowCount } = await q('DELETE FROM tp_hd_pl WHERE id=$1', [id]);
      return rowCount > 0;
    },
    async getTpPay(id) {
      const { rows } = await q('SELECT id, tp_id, loai, so_tien::text AS so_tien FROM tp_thanh_toan WHERE id=$1', [id]);
      return rows[0] || null;
    },
    async createTpPay(tpId, d, userId) {
      const { rows } = await q(
        'INSERT INTO tp_thanh_toan(tp_id, loai, dot, so_tien, ngay, ghi_chu, updated_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [tpId, d.loai, d.dot, d.so_tien, d.ngay, d.ghi_chu, userId]);
      return rows[0];
    },
    async updateTpPay(id, d, userId) {
      const { rowCount } = await q(
        'UPDATE tp_thanh_toan SET loai=$1, dot=$2, so_tien=$3, ngay=$4, ghi_chu=$5, updated_by=$6, updated_at=now() WHERE id=$7',
        [d.loai, d.dot, d.so_tien, d.ngay, d.ghi_chu, userId, id]);
      return rowCount > 0;
    },
    async deleteTpPay(id) {
      const { rowCount } = await q('DELETE FROM tp_thanh_toan WHERE id=$1', [id]);
      return rowCount > 0;
    },
  };
}

// =====================================================================
// Bộ nhớ tạm (chạy thử trên máy)
// =====================================================================
function memoryStore() {
  const db = { users: [], sessions: new Map(), settings: { ...DEFAULT_SETTINGS }, projects: [], images: new Map(), revenue: [], tienVe: [], cost: [], tp: [], tpLines: [], tpPays: [], seqU: 0, seqP: 0, seqR: 0, seqT: 0, seqC: 0, seqTp: 0 };
  const pub = (u) => u && (({ password_hash, ...rest }) => ({ ...rest }))(u);
  const now = () => new Date().toISOString();
  const userName = (id) => db.users.find((u) => u.id === id)?.full_name || null;

  return {
    kind: 'memory',
    async init() {},
    async ping() {},
    async migrateHdCodes() { return 0; },
    async migrateQtToHead() { return 0; },
    async migrateTienVeHd() { return 0; },

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
      for (const p of [...db.projects, ...db.revenue, ...db.tienVe, ...db.cost]) {
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
      return sortProjects([...db.projects])
        .map((p) => ({ loai_cong_trinh: '', dia_diem: '', ...p, co_anh: db.images.has(p.id), anh_v: db.images.get(p.id)?.v || 0, nguoi_cap_nhat: userName(p.updated_by ?? p.created_by) }));
    },
    async getProjectImage(id) { return db.images.get(id) || null; },
    async setProjectImage(id, mime, data) { db.images.set(id, { mime, data, v: Math.floor(Date.now() / 1000) }); },
    async deleteProjectImage(id) { return db.images.delete(id);
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
      db.images.delete(id);
      db.revenue = db.revenue.filter((r) => r.du_an_id !== id);
      db.tienVe = db.tienVe.filter((r) => r.du_an_id !== id);
      db.cost = db.cost.filter((r) => r.du_an_id !== id);
      const tpIds = new Set(db.tp.filter((t) => t.du_an_id === id).map((t) => t.id));
      db.tp = db.tp.filter((t) => !tpIds.has(t.id));
      db.tpLines = db.tpLines.filter((l) => !tpIds.has(l.tp_id));
      db.tpPays = db.tpPays.filter((p) => !tpIds.has(p.tp_id));
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
        .map((r) => ({
          ...r,
          hd_id: r.hd_id ?? null,
          hd_so_hieu: db.revenue.find((h) => h.id === r.hd_id)?.so_hieu ?? null,
          nguoi_cap_nhat: userName(r.updated_by ?? r.created_by),
        }));
    },
    async getRevenue(id) {
      const r = db.revenue.find((x) => x.id === id);
      return r ? { id: r.id, du_an_id: r.du_an_id, loai: r.loai, so_hieu: r.so_hieu, ma_loai: r.ma_loai, so_ma: r.so_ma } : null;
    },
    async deleteContractCascade(hd) {
      const so = String(hd.so_ma).toLowerCase();
      db.tp.forEach((t) => { if (t.hd_cdt_id === hd.id) t.hd_cdt_id = null; });
      db.tienVe = db.tienVe.filter((r) => r.hd_id !== hd.id);
      db.revenue = db.revenue.filter((r) => !(r.loai === 'qt' && r.hd_id === hd.id) && r.id !== hd.id &&
        !(r.du_an_id === hd.du_an_id && r.loai === 'hd' && r.ma_loai !== 'HĐ' && String(r.so_ma).toLowerCase() === so));
    },
    async countRevenueRefs(hdId) {
      return { qt: db.revenue.filter((r) => r.hd_id === hdId).length, tv: db.tienVe.filter((r) => r.hd_id === hdId).length };
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
      db.tp.forEach((t) => { if (t.hd_cdt_id === id) t.hd_cdt_id = null; });
      const n = db.revenue.length;
      db.revenue = db.revenue.filter((r) => r.id !== id);
      return db.revenue.length < n;
    },

    async listTienVe(duAnId) {
      return db.tienVe.filter((r) => r.du_an_id === duAnId)
        .map((r) => ({
          ...r,
          hd_id: r.hd_id ?? null,
          hd_so_hieu: db.revenue.find((h) => h.id === r.hd_id)?.so_hieu ?? null,
          nguoi_cap_nhat: userName(r.updated_by ?? r.created_by),
        }));
    },
    async getTienVe(id) {
      const r = db.tienVe.find((x) => x.id === id);
      return r ? { id: r.id, du_an_id: r.du_an_id } : null;
    },
    _tvConflict(duAnId, d, exceptId = 0) {
      return db.tienVe.some((r) => r.du_an_id === duAnId && r.id !== exceptId && r.loai === d.loai && (r.hd_id ?? 0) === (d.hd_id ?? 0) &&
        ((d.loai === 'dot' && r.dot === d.dot) || d.loai === 'quyet_toan'));
    },
    async createTienVe(duAnId, d, userId) {
      if (this._tvConflict(duAnId, d)) throw dupError();
      const r = { id: ++db.seqT, du_an_id: duAnId, ...d, created_by: userId, updated_by: userId };
      db.tienVe.push(r);
      return { id: r.id };
    },
    async updateTienVe(id, d, userId) {
      const r = db.tienVe.find((x) => x.id === id);
      if (!r) return false;
      if (this._tvConflict(r.du_an_id, d, id)) throw dupError();
      Object.assign(r, d, { updated_by: userId });
      return true;
    },
    async deleteTienVe(id) {
      const n = db.tienVe.length;
      db.tienVe = db.tienVe.filter((r) => r.id !== id);
      return db.tienVe.length < n;
    },

    async listCost(duAnId) {
      return db.cost.filter((r) => r.du_an_id === duAnId).map((r) => ({ ...r, nguoi_cap_nhat: userName(r.updated_by ?? r.created_by) }));
    },
    async createCost(duAnId, d, userId) {
      const r = { id: ++db.seqC, du_an_id: duAnId, ...d, created_by: userId, updated_by: userId };
      db.cost.push(r);
      return { id: r.id };
    },
    async updateCost(id, d, userId) {
      const r = db.cost.find((x) => x.id === id);
      if (!r) return false;
      Object.assign(r, d, { updated_by: userId });
      return true;
    },
    async deleteCost(id) {
      const n = db.cost.length;
      db.cost = db.cost.filter((r) => r.id !== id);
      return db.cost.length < n;
    },

    async listTp(duAnId) {
      const contracts = db.tp.filter((t) => t.du_an_id === duAnId)
        .map((t) => ({ ...t, nguoi_cap_nhat: userName(t.updated_by ?? t.created_by) }));
      const ids = new Set(contracts.map((t) => t.id));
      return { contracts, lines: db.tpLines.filter((l) => ids.has(l.tp_id)).map((l) => ({ ...l })), pays: db.tpPays.filter((p) => ids.has(p.tp_id)).map((p) => ({ ...p })) };
    },
    async getTp(id) {
      const t = db.tp.find((x) => x.id === id);
      return t ? { id: t.id, du_an_id: t.du_an_id, so_ma: t.so_ma, hd_cdt_id: t.hd_cdt_id ?? null } : null;
    },
    _tpDup(duAnId, soMa, exceptId = 0) {
      return db.tp.some((t) => t.du_an_id === duAnId && t.id !== exceptId && t.so_ma.toLowerCase() === soMa.toLowerCase());
    },
    async createTp(duAnId, d, hd, userId) {
      if (this._tpDup(duAnId, d.so_ma)) throw dupError();
      const t = { id: ++db.seqTp, du_an_id: duAnId, hd_cdt_id: null, ...d, created_by: userId, updated_by: userId };
      db.tp.push(t);
      db.tpLines.push({ id: ++db.seqTp, tp_id: t.id, ma_loai: 'HĐ', ngay: hd.ngay, gia_tri: hd.gia_tri, vat: hd.vat, gia_tri_qt: hd.gia_tri_qt, ghi_chu: '' });
      return { id: t.id };
    },
    async setTpHdCdt(id, hdId) { const t = db.tp.find((x) => x.id === id); if (t) t.hd_cdt_id = hdId; },
    async updateTp(id, d, userId) {
      const t = db.tp.find((x) => x.id === id);
      if (!t) return false;
      if (this._tpDup(t.du_an_id, d.so_ma, id)) throw dupError();
      Object.assign(t, d, { updated_by: userId });
      return true;
    },
    async deleteTp(id) {
      const n = db.tp.length;
      db.tp = db.tp.filter((t) => t.id !== id);
      db.tpLines = db.tpLines.filter((l) => l.tp_id !== id);
      db.tpPays = db.tpPays.filter((p) => p.tp_id !== id);
      return db.tp.length < n;
    },
    async tpLocked(tpId) { return db.tpPays.some((p) => p.tp_id === tpId && p.loai === 'quyet_toan'); },
    async getTpLine(id) {
      const l = db.tpLines.find((x) => x.id === id);
      return l ? { id: l.id, tp_id: l.tp_id, ma_loai: l.ma_loai } : null;
    },
    async createTpLine(tpId, d) {
      if (db.tpLines.some((l) => l.tp_id === tpId && l.ma_loai === d.ma_loai)) throw dupError();
      const l = { id: ++db.seqTp, tp_id: tpId, ...d };
      db.tpLines.push(l);
      return { id: l.id };
    },
    async updateTpLine(id, d) {
      const l = db.tpLines.find((x) => x.id === id);
      if (!l) return false;
      if (db.tpLines.some((x) => x.tp_id === l.tp_id && x.id !== id && x.ma_loai === d.ma_loai)) throw dupError();
      Object.assign(l, d);
      return true;
    },
    async deleteTpLine(id) {
      const n = db.tpLines.length;
      db.tpLines = db.tpLines.filter((l) => l.id !== id);
      return db.tpLines.length < n;
    },
    async getTpPay(id) {
      const p = db.tpPays.find((x) => x.id === id);
      return p ? { id: p.id, tp_id: p.tp_id, loai: p.loai, so_tien: p.so_tien } : null;
    },
    _payDup(tpId, d, exceptId = 0) {
      return db.tpPays.some((p) => p.tp_id === tpId && p.id !== exceptId && p.loai === d.loai && (d.loai === 'quyet_toan' || (d.loai === 'dot' && p.dot === d.dot)));
    },
    async createTpPay(tpId, d) {
      if (this._payDup(tpId, d)) throw dupError();
      const p = { id: ++db.seqTp, tp_id: tpId, ...d };
      db.tpPays.push(p);
      return { id: p.id };
    },
    async updateTpPay(id, d) {
      const p = db.tpPays.find((x) => x.id === id);
      if (!p) return false;
      if (this._payDup(p.tp_id, d, id)) throw dupError();
      Object.assign(p, d);
      return true;
    },
    async deleteTpPay(id) {
      const n = db.tpPays.length;
      db.tpPays = db.tpPays.filter((p) => p.id !== id);
      return db.tpPays.length < n;
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

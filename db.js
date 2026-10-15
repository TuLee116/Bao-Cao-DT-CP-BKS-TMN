// Lớp dữ liệu: dùng PostgreSQL khi có DATABASE_URL (Railway),
// ngược lại dùng bộ nhớ tạm để chạy thử trên máy (mất dữ liệu khi tắt).
const { Pool } = require('pg');

const FIELDS = ['ma_du_an', 'ten_du_an', 'chu_dau_tu', 'gia_tri_hd', 'da_giai_ngan', 'tien_do', 'trang_thai', 'ngay_bat_dau', 'ngay_ket_thuc'];
const TRANG_THAI = ['Chuẩn bị', 'Đang thi công', 'Tạm dừng', 'Hoàn thành'];

function validate(input) {
  const errors = [];
  const d = {};
  d.ma_du_an = String(input.ma_du_an || '').trim();
  d.ten_du_an = String(input.ten_du_an || '').trim();
  d.chu_dau_tu = String(input.chu_dau_tu || '').trim();
  d.gia_tri_hd = Number(input.gia_tri_hd || 0);
  d.da_giai_ngan = Number(input.da_giai_ngan || 0);
  d.tien_do = Number(input.tien_do || 0);
  d.trang_thai = TRANG_THAI.includes(input.trang_thai) ? input.trang_thai : 'Chuẩn bị';
  d.ngay_bat_dau = input.ngay_bat_dau || null;
  d.ngay_ket_thuc = input.ngay_ket_thuc || null;

  if (!d.ma_du_an) errors.push('Thiếu mã dự án');
  if (!d.ten_du_an) errors.push('Thiếu tên dự án');
  if (!Number.isFinite(d.gia_tri_hd) || d.gia_tri_hd < 0) errors.push('Giá trị HĐ không hợp lệ');
  if (!Number.isFinite(d.da_giai_ngan) || d.da_giai_ngan < 0) errors.push('Giá trị giải ngân không hợp lệ');
  if (d.da_giai_ngan > d.gia_tri_hd) errors.push('Giải ngân vượt giá trị HĐ');
  if (!Number.isFinite(d.tien_do) || d.tien_do < 0 || d.tien_do > 100) errors.push('Tiến độ phải từ 0 đến 100%');
  if (d.ngay_bat_dau && d.ngay_ket_thuc && d.ngay_ket_thuc < d.ngay_bat_dau) errors.push('Ngày kết thúc trước ngày bắt đầu');
  return { data: d, errors };
}

// ---------- PostgreSQL ----------
function pgStore(url) {
  const pool = new Pool({
    connectionString: url,
    // Kết nối nội bộ Railway (*.railway.internal) không cần SSL; kết nối public thì cần.
    ssl: /railway\.internal|localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
  });

  return {
    kind: 'postgres',
    async init() {
      await pool.query(`
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
        )`);
    },
    async list() {
      const { rows } = await pool.query(
        `SELECT id, ma_du_an, ten_du_an, chu_dau_tu,
                gia_tri_hd::float8 AS gia_tri_hd, da_giai_ngan::float8 AS da_giai_ngan,
                tien_do::float8 AS tien_do, trang_thai,
                to_char(ngay_bat_dau,'YYYY-MM-DD') AS ngay_bat_dau,
                to_char(ngay_ket_thuc,'YYYY-MM-DD') AS ngay_ket_thuc
         FROM du_an ORDER BY id DESC`);
      return rows;
    },
    async create(d) {
      const vals = FIELDS.map((f) => d[f]);
      const { rows } = await pool.query(
        `INSERT INTO du_an (${FIELDS.join(',')}) VALUES (${FIELDS.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id`, vals);
      return rows[0];
    },
    async update(id, d) {
      const sets = FIELDS.map((f, i) => `${f}=$${i + 1}`).join(',');
      const { rowCount } = await pool.query(
        `UPDATE du_an SET ${sets}, updated_at=now() WHERE id=$${FIELDS.length + 1}`, [...FIELDS.map((f) => d[f]), id]);
      return rowCount > 0;
    },
    async remove(id) {
      const { rowCount } = await pool.query('DELETE FROM du_an WHERE id=$1', [id]);
      return rowCount > 0;
    },
    async ping() { await pool.query('SELECT 1'); },
  };
}

// ---------- Bộ nhớ tạm (chạy thử local) ----------
function memoryStore() {
  let rows = [];
  let seq = 0;
  const dup = (d, id) => rows.some((r) => r.ma_du_an === d.ma_du_an && r.id !== id);
  const dupErr = () => Object.assign(new Error('duplicate'), { code: '23505' });
  return {
    kind: 'memory',
    async init() {},
    async list() { return [...rows].sort((a, b) => b.id - a.id); },
    async create(d) {
      if (dup(d)) throw dupErr();
      const r = { id: ++seq, ...d };
      rows.push(r);
      return { id: r.id };
    },
    async update(id, d) {
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) return false;
      if (dup(d, id)) throw dupErr();
      rows[i] = { id, ...d };
      return true;
    },
    async remove(id) {
      const n = rows.length;
      rows = rows.filter((r) => r.id !== id);
      return rows.length < n;
    },
    async ping() {},
  };
}

const DB_URL = (process.env.DATABASE_URL || '').trim();
if (!DB_URL && process.env.RAILWAY_ENVIRONMENT) {
  console.warn('CẢNH BÁO: DATABASE_URL đang rỗng -> dùng bộ nhớ tạm, dữ liệu sẽ mất khi khởi động lại. ' +
    'Hãy thêm service PostgreSQL và đặt DATABASE_URL=${{Postgres.DATABASE_URL}}');
}
const store = DB_URL ? pgStore(DB_URL) : memoryStore();

module.exports = { store, validate, TRANG_THAI };

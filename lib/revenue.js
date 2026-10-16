// Công thức Doanh thu (máy chủ). Giao diện public/app.js dùng cùng công thức.
//   Tiền VAT  = làm tròn(Giá trị trước VAT × VAT% / 100)   – tính bằng số nguyên chính xác (BigInt)
//   Sau VAT   = Giá trị trước VAT + Tiền VAT
//   VAT = 0%  → chưa có VAT: Sau VAT = Giá trị trước VAT, đánh dấu "tạm tính"

const LOAI_DOANH_THU = {
  hd: 'Hợp đồng/Phụ lục',
  qt: 'Hoàn thành/Quyết toán',
};

// Loại dòng ở mục 1: 'HĐ' hoặc 'PL01', 'PL02'... (nhận cả 'hd', 'pl1', 'PL 3')
function normMaLoai(s) {
  const t = String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (t === 'HĐ' || t === 'HD') return 'HĐ';
  const m = t.match(/^PL0*(\d{1,3})$/);
  return m && Number(m[1]) >= 1 ? 'PL' + String(Number(m[1])).padStart(2, '0') : null;
}
// Tách tên cũ "HĐ ABC-123" / "PL01 ABC-123" -> { ma_loai, so_ma }
function splitSoHieu(soHieu) {
  const m = String(soHieu ?? '').trim().match(/^(H[ĐD]|PL\s*\d{1,3})[\s.:_-]+(.+)$/i);
  const loai = m && normMaLoai(m[1]);
  return loai ? { ma_loai: loai, so_ma: m[2].trim() } : { ma_loai: 'HĐ', so_ma: String(soHieu ?? '').trim() };
}
const maLoaiOrder = (l) => (l === 'HĐ' ? 0 : Number(String(l || '').slice(2)) || 9999);

// Mục 1: HĐ trước, rồi PL01, PL02...; mục 2: theo ngày
function sortRevenue(items) {
  return [...items].sort((a, b) =>
    (a.loai === b.loai ? 0 : a.loai === 'hd' ? -1 : 1) ||
    (a.loai === 'hd' ? maLoaiOrder(a.ma_loai) - maLoaiOrder(b.ma_loai) : 0) ||
    String(a.ngay || '9999').localeCompare(String(b.ngay || '9999')) ||
    a.id - b.id);
}

function tienVat(giaTri, vat) {
  if (!vat) return 0;
  const g = BigInt(giaTri) * BigInt(vat);
  const half = g < 0n ? -50n : 50n; // làm tròn nửa xa số 0
  return Number((g + half) / 100n);
}

function calcLine(r) {
  const gia_tri = Number(r.gia_tri) || 0;
  const vat = Number(r.vat) || 0;
  const tien_vat = tienVat(gia_tri, vat);
  return { ...r, gia_tri, vat, tien_vat, sau_vat: gia_tri + tien_vat, tam_tinh: vat === 0 };
}

function summarize(items) {
  const out = {};
  for (const loai of Object.keys(LOAI_DOANH_THU)) {
    const rows = items.filter((r) => r.loai === loai);
    out[loai] = {
      so_dong: rows.length,
      gia_tri: rows.reduce((s, r) => s + r.gia_tri, 0),
      tien_vat: rows.reduce((s, r) => s + r.tien_vat, 0),
      sau_vat: rows.reduce((s, r) => s + r.sau_vat, 0),
      tam_tinh: rows.some((r) => r.tam_tinh),
    };
  }
  return out;
}

// ---------- Giá trị tiền về ----------
// Thứ tự: Tạm ứng → TT Đợt 1, 2, ... → Quyết toán
const LOAI_TIEN_VE = { tam_ung: 'Tạm ứng', dot: 'TT Đợt', quyet_toan: 'Quyết toán' };
const TV_ORDER = { tam_ung: 0, dot: 1, quyet_toan: 2 };

const tienVeLabel = (r) => (r.loai === 'dot' ? `TT Đợt ${r.dot}` : LOAI_TIEN_VE[r.loai]);

function sortTienVe(rows) {
  return [...rows].sort((a, b) =>
    TV_ORDER[a.loai] - TV_ORDER[b.loai] ||
    (a.loai === 'dot' ? a.dot - b.dot : 0) ||
    String(a.ngay || '9999').localeCompare(String(b.ngay || '9999')) ||
    a.id - b.id);
}

function summarizeTienVe(rows) {
  const by = (l) => rows.filter((r) => r.loai === l).reduce((s, r) => s + r.so_tien, 0);
  return {
    so_dong: rows.length,
    tong: rows.reduce((s, r) => s + r.so_tien, 0),
    tam_ung: by('tam_ung'),
    thanh_toan: by('dot'),
    quyet_toan: by('quyet_toan'),
    chua_chon_hd: rows.filter((r) => !r.hd_id).length,
  };
}

module.exports = { normMaLoai, splitSoHieu, sortRevenue, LOAI_DOANH_THU, LOAI_TIEN_VE, calcLine, summarize, tienVat, tienVeLabel, sortTienVe, summarizeTienVe };

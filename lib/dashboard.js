// Tổng hợp Dashboard theo dự án (dùng đúng số liệu của tab Doanh thu và Chi phí)
//   Doanh thu  = theo từng HĐ: có Giá trị HT/QT -> lấy tổng HT/QT; chưa có -> lấy giá trị HĐ + các PL
//   Chi phí    = tổng tab Chi phí (trực tiếp + gián tiếp + tài chính; thầu phụ theo giá trị HT/QT của HĐTP)
//   Lợi nhuận  = Doanh thu − Chi phí
//   Còn lại    = Doanh thu (sau VAT) − Tiền về (còn phải thu)
// Mỗi giá trị có 2 cơ sở: gt = trước VAT, sv = sau VAT. Biểu đồ đường: cộng theo tháng (YYYY-MM) theo ngày chứng từ.
const { summarizeCost } = require('./cost');

const monthOf = (ngay) => (ngay ? String(ngay).slice(0, 7) : null);

function addMonth(thang, chuaNgay, key, ngay, gt, sv) {
  const m = monthOf(ngay);
  if (!m) { chuaNgay[key]++; return; }
  const t = (thang[m] ||= { dt_gt: 0, dt_sv: 0, cp_gt: 0, cp_sv: 0 });
  t[key + '_gt'] += gt;
  t[key + '_sv'] += sv;
}

// rev: các dòng doanh thu đã calcLine; tienVe: các dòng tiền về; cost: dòng chi phí đã calcLine; tp: buildContracts(...)
function summarizeProject({ rev, tienVe, cost, tp }) {
  const thang = {};
  const chuaNgay = { dt: 0, cp: 0 };
  const dt = { gt: 0, sv: 0 };

  // ---- Doanh thu theo nhóm HĐ (HĐ + PL cùng số mã) ----
  const hdRows = rev.filter((r) => r.loai === 'hd');
  const qtRows = rev.filter((r) => r.loai === 'qt');
  const masters = hdRows.filter((r) => r.ma_loai === 'HĐ');
  const keyOf = (r) => String(r.so_ma || r.so_hieu || '').toLowerCase();
  const groups = new Map();
  for (const r of hdRows) {
    const k = keyOf(r);
    if (!groups.has(k)) groups.set(k, { master: null, rows: [] });
    const g = groups.get(k);
    g.rows.push(r);
    if (r.ma_loai === 'HĐ') g.master = r;
  }
  const usedQt = new Set();
  const take = (r) => { dt.gt += r.gia_tri; dt.sv += r.sau_vat; addMonth(thang, chuaNgay, 'dt', r.ngay, r.gia_tri, r.sau_vat); };
  for (const g of groups.values()) {
    const qts = g.master ? qtRows.filter((q) => q.hd_id === g.master.id) : [];
    qts.forEach((q) => usedQt.add(q.id));
    (qts.length ? qts : g.rows).forEach(take);
  }
  qtRows.filter((q) => !usedQt.has(q.id)).forEach(take); // HT/QT không khớp HĐ (dữ liệu cũ) vẫn được tính

  // ---- Chi phí: dòng chi phí + thầu phụ theo HT/QT ----
  const tpAsCost = tp.map((c) => ({ nhom: 'thau_phu', gia_tri: c.qt_gia_tri, tien_vat: c.qt_tien_vat, sau_vat: c.qt_sau_vat, tam_tinh: c.tam_tinh }));
  const tong = summarizeCost([...cost, ...tpAsCost]);
  for (const r of cost) addMonth(thang, chuaNgay, 'cp', r.ngay, r.gia_tri, r.sau_vat);
  for (const c of tp) {
    if (c.khoa) {
      // Đã quyết toán: toàn bộ giá trị chốt ghi vào ngày thanh toán quyết toán
      const qt = c.pays.filter((p) => p.loai === 'quyet_toan').map((p) => p.ngay).filter(Boolean).sort().pop();
      addMonth(thang, chuaNgay, 'cp', qt, c.qt_gia_tri, c.qt_sau_vat);
    } else {
      for (const l of c.lines) addMonth(thang, chuaNgay, 'cp', l.ngay, l.qt_gia_tri, l.qt_sau_vat);
    }
  }

  const tv = tienVe.reduce((s, r) => s + r.so_tien, 0);
  return {
    so_hd: masters.length,
    doanh_thu: dt,
    chi_phi: { gt: tong.gia_tri, sv: tong.sau_vat },
    tien_ve: tv,
    con_lai: dt.sv - tv,
    thang,
    chua_ngay: chuaNgay,
  };
}

module.exports = { summarizeProject };

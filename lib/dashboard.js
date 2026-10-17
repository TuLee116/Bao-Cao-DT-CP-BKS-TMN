// Tổng hợp Dashboard theo dự án – 2 lớp số liệu (dùng đúng số liệu tab Doanh thu và Chi phí)
//
//  DỰ KIẾN (hiệu quả hợp đồng):
//    Doanh thu = từng HĐ khách hàng: đã quyết toán -> tổng HT/QT; chưa -> giá trị HĐ + các PL
//    Thầu phụ  = giá trị HT/QT của HĐTP (chưa quyết toán = giá trị HĐ/PL; đã quyết toán = giá trị chốt)
//  THỰC HIỆN (đến thời điểm hiện tại):
//    Doanh thu = tổng giá trị đã nghiệm thu (các dòng HT/QT)
//    Thầu phụ  = đã quyết toán -> giá trị chốt; chưa -> tổng thanh toán đợt (không tính tạm ứng)
//  Chi phí khác (vật tư, nhân công, gián tiếp, tài chính...) = các khoản đã ghi nhận, giống nhau ở 2 lớp;
//  không gồm Trả nợ gốc vay (dòng tiền trả nợ, không phải chi phí).
//  Lợi nhuận = Doanh thu − Chi phí;  Còn lại = Doanh thu (sau VAT) − Tiền về.
//  Mỗi giá trị có gt = trước VAT, sv = sau VAT. Biểu đồ: cộng theo tháng (YYYY-MM) theo ngày chứng từ.
const { summarizeCost, isNgoaiCp } = require('./cost');

const monthOf = (ngay) => (ngay ? String(ngay).slice(0, 7) : null);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

function layer() {
  return { doanh_thu: { gt: 0, sv: 0 }, chi_phi: { gt: 0, sv: 0 }, thang: {}, ngay: {}, chua_ngay: { dt: 0, cp: 0 } };
}
function put(L, key, ngay, gt, sv) {
  const tot = key === 'dt' ? L.doanh_thu : L.chi_phi;
  tot.gt += gt; tot.sv += sv;
  const m = monthOf(ngay);
  if (!m) { L.chua_ngay[key]++; return; }
  const t = (L.thang[m] ||= { dt_gt: 0, dt_sv: 0, cp_gt: 0, cp_sv: 0 });
  t[key + '_gt'] += gt;
  t[key + '_sv'] += sv;
  const d = (L.ngay[String(ngay).slice(0, 10)] ||= { dt_gt: 0, dt_sv: 0, cp_gt: 0, cp_sv: 0 }); // theo ngày (biểu đồ phóng to)
  d[key + '_gt'] += gt;
  d[key + '_sv'] += sv;
}
// Tách tiền thanh toán (sau VAT) về trước VAT theo tỷ lệ VAT của HĐTP (số nguyên chính xác)
function truocVat(svAmt, hdTienVat, hdSauVat) {
  if (!hdSauVat || !hdTienVat) return svAmt;
  const v = (BigInt(svAmt) * BigInt(hdTienVat) * 2n + BigInt(hdSauVat)) / (2n * BigInt(hdSauVat));
  return svAmt - Number(v);
}

// rev: dòng doanh thu đã calcLine; tienVe: dòng tiền về; cost: dòng chi phí đã costLine; tp: buildContracts(...)
function summarizeProject({ rev, tienVe, cost, tp }) {
  const dk = layer();
  const th = layer();

  // ---------- Doanh thu theo nhóm HĐ (HĐ + PL cùng số mã) ----------
  const hdRows = rev.filter((r) => r.loai === 'hd');
  const qtRows = rev.filter((r) => r.loai === 'qt');
  const masters = hdRows.filter((r) => r.ma_loai === 'HĐ');
  const groups = new Map();
  for (const r of hdRows) {
    const k = String(r.so_ma || r.so_hieu || '').toLowerCase();
    if (!groups.has(k)) groups.set(k, { master: null, rows: [] });
    const g = groups.get(k);
    g.rows.push(r);
    if (r.ma_loai === 'HĐ') g.master = r;
  }
  const usedQt = new Set();
  let soDaQt = 0;
  for (const g of groups.values()) {
    const qts = g.master ? qtRows.filter((q) => q.hd_id === g.master.id) : [];
    qts.forEach((q) => usedQt.add(q.id));
    const daQt = Boolean(g.master) && (
      tienVe.some((t) => t.hd_id === g.master.id && t.loai === 'quyet_toan') ||
      qts.some((q) => norm(q.so_hieu).includes('quyet toan')));
    if (daQt) soDaQt++;
    (daQt && qts.length ? qts : g.rows).forEach((r) => put(dk, 'dt', r.ngay, r.gia_tri, r.sau_vat));
    qts.forEach((r) => put(th, 'dt', r.ngay, r.gia_tri, r.sau_vat));
  }
  // HT/QT không khớp HĐ nào (dữ liệu cũ) vẫn được tính ở cả 2 lớp
  qtRows.filter((q) => !usedQt.has(q.id)).forEach((r) => { put(dk, 'dt', r.ngay, r.gia_tri, r.sau_vat); put(th, 'dt', r.ngay, r.gia_tri, r.sau_vat); });

  // ---------- Chi phí khác (giống nhau 2 lớp) ----------
  for (const r of cost) {
    if (isNgoaiCp(r)) continue;
    put(dk, 'cp', r.ngay, r.gia_tri, r.sau_vat);
    put(th, 'cp', r.ngay, r.gia_tri, r.sau_vat);
  }
  // ---------- Thầu phụ ----------
  for (const c of tp) {
    if (c.khoa) {
      // Đã quyết toán: giá trị chốt (= tổng thanh toán) phân bổ theo ngày từng lần thanh toán thực tế (cả 2 lớp);
      // phần trước VAT chia theo tỷ lệ, phần dư làm tròn dồn vào lần cuối để tổng khớp đúng giá trị chốt
      const pays = c.pays.filter((p) => p.so_tien);
      let gLeft = c.qt_gia_tri, sLeft = c.qt_sau_vat;
      pays.forEach((p, i) => {
        const last = i === pays.length - 1;
        const sv = last ? sLeft : p.so_tien;
        const gt = last ? gLeft : (c.qt_sau_vat ? Math.round((c.qt_gia_tri * p.so_tien) / c.qt_sau_vat) : p.so_tien);
        sLeft -= sv; gLeft -= gt;
        put(dk, 'cp', p.ngay, gt, sv);
        put(th, 'cp', p.ngay, gt, sv);
      });
      if (!pays.length) { put(dk, 'cp', null, c.qt_gia_tri, c.qt_sau_vat); put(th, 'cp', null, c.qt_gia_tri, c.qt_sau_vat); }
      continue;
    }
    for (const l of c.lines) put(dk, 'cp', l.ngay, l.qt_gia_tri, l.qt_sau_vat);
    const hdTienVat = c.lines.reduce((s, l) => s + l.tien_vat, 0);
    for (const p of c.pays) {
      if (p.loai === 'tam_ung') continue; // tạm ứng chưa phải khối lượng thực hiện
      put(th, 'cp', p.ngay, truocVat(p.so_tien, hdTienVat, c.hd_sau_vat), p.so_tien);
    }
  }

  // Tổng chi phí Dự kiến phải khớp tab Chi phí (kiểm tra chéo)
  const tpAsCost = tp.map((c) => ({ nhom: 'thau_phu', gia_tri: c.qt_gia_tri, tien_vat: c.qt_tien_vat, sau_vat: c.qt_sau_vat, tam_tinh: c.tam_tinh }));
  const tong = summarizeCost([...cost, ...tpAsCost]);

  const tv = tienVe.reduce((s, r) => s + r.so_tien, 0);
  dk.con_lai = dk.doanh_thu.sv - tv;
  th.con_lai = th.doanh_thu.sv - tv;
  return {
    so_hd: masters.length,
    so_hd_qt: soDaQt,
    so_tp: tp.length,
    so_tp_qt: tp.filter((c) => c.khoa).length,
    tien_ve: tv,
    tra_goc: { gt: tong.ngoai_cp.gia_tri, sv: tong.ngoai_cp.sau_vat }, // trả nợ gốc vay (không tính chi phí)
    du_kien: dk,
    thuc_hien: th,
  };
}

module.exports = { summarizeProject };

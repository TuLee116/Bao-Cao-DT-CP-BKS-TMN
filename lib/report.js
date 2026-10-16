// Báo cáo tổng quan: gom toàn bộ số liệu đã liên kết (Doanh thu – HĐ CĐT – Thầu phụ – Chi phí – Tiền về)
// Dùng lại đúng công thức Dashboard (lib/dashboard.js) để số liệu khớp mọi nơi.
const { summarizeProject } = require('./dashboard');
const { summarizeCost, NHOM_CHI_PHI, KHOI_CHI_PHI, findNhom, isNgoaiCp } = require('./cost');

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
const monthOf = (ngay) => (ngay ? String(ngay).slice(0, 7) : null);

// p: dự án; rev (calcLine), tienVe, cost (costLine), tp (buildContracts)
function projectReport(p, { rev, tienVe, cost, tp }) {
  const s = summarizeProject({ rev, tienVe, cost, tp });
  const hdRows = rev.filter((r) => r.loai === 'hd');
  const qtRows = rev.filter((r) => r.loai === 'qt');
  const masters = hdRows.filter((r) => r.ma_loai === 'HĐ');
  const sameHd = (m) => (r) => String(r.so_ma).toLowerCase() === String(m.so_ma).toLowerCase();
  const sum = (arr, f) => arr.reduce((a, x) => a + (typeof f === 'function' ? f(x) : x[f]), 0);

  // ---- Từng HĐ chủ đầu tư ----
  const tpOf = (id) => tp.filter((c) => (c.hd_cdt_id || 0) === id);
  const tpSum = (list) => ({
    n: list.length, n_qt: list.filter((c) => c.khoa || c.da_qt).length,
    hd_sv: sum(list, 'hd_sau_vat'), qt_gt: sum(list, 'qt_gia_tri'), qt_sv: sum(list, 'qt_sau_vat'),
    da_tt: sum(list, 'da_tt'), con_lai: sum(list, 'con_lai'),
  });
  const hds = masters.map((m) => {
    const lines = hdRows.filter(sameHd(m));
    const qts = qtRows.filter((q) => q.hd_id === m.id);
    const tvs = tienVe.filter((t) => t.hd_id === m.id);
    const daQt = tvs.some((t) => t.loai === 'quyet_toan') || qts.some((q) => norm(q.so_hieu).includes('quyet toan'));
    const hd = { gt: sum(lines, 'gia_tri'), sv: sum(lines, 'sau_vat') };
    const nt = { gt: sum(qts, 'gia_tri'), sv: sum(qts, 'sau_vat') };
    const dk = daQt && qts.length ? nt : hd;
    const tv = sum(tvs, 'so_tien');
    const t = tpSum(tpOf(m.id));
    return {
      id: m.id, so_hieu: m.so_hieu, so_ma: m.so_ma, ngay: m.ngay, vat: m.vat, tam_tinh: lines.some((l) => l.tam_tinh),
      so_pl: lines.length - 1, hd, so_dot: qts.length, nt, da_qt: daQt, dk,
      pct_ht: hd.sv ? nt.sv / hd.sv : 0,
      tien_ve: tv, phai_thu: nt.sv - tv, con_lai_hd: dk.sv - tv,
      tp: t, lai_gop_dk: dk.gt - t.qt_gt,
    };
  });
  const tpChuaGan = tpSum(tpOf(0));

  // ---- Chi phí theo khối / nhóm (Dự kiến = tab Chi phí) ----
  const tpAsCost = tp.map((c) => ({ nhom: 'thau_phu', gia_tri: c.qt_gia_tri, tien_vat: c.qt_tien_vat, sau_vat: c.qt_sau_vat, tam_tinh: c.tam_tinh }));
  const tong = summarizeCost([...cost, ...tpAsCost]);
  const khoi = KHOI_CHI_PHI.map((k) => ({ code: k.code, ten: k.ten, gt: tong.theo_khoi[k.code].gia_tri, sv: tong.theo_khoi[k.code].sau_vat }));
  const nhom = NHOM_CHI_PHI.map((n) => ({ code: n.code, khoi: n.khoi, ten: n.ten, gt: tong.theo_nhom[n.code].gia_tri, sv: tong.theo_nhom[n.code].sau_vat, so_dong: tong.theo_nhom[n.code].so_dong }));

  // ---- Dòng tiền thực tế theo tháng (sau VAT): Thu = tiền về; Chi = chi phí + thanh toán thầu phụ (gồm tạm ứng) + trả nợ gốc ----
  const dong_tien = {};
  const flow = { thu_chua_ngay: 0, chi_chua_ngay: 0 };
  const add = (ngay, k, v) => {
    const m = monthOf(ngay);
    if (!m) { flow[k + '_chua_ngay'] += v; return; }
    (dong_tien[m] ||= { thu: 0, chi: 0 })[k] += v;
  };
  tienVe.forEach((t) => add(t.ngay, 'thu', t.so_tien));
  cost.forEach((r) => add(r.ngay, 'chi', r.sau_vat));
  tp.forEach((c) => c.pays.forEach((x) => add(x.ngay, 'chi', x.so_tien)));

  // ---- Cảnh báo nghiệp vụ ----
  const warn = [];
  const W = (muc, noi_dung) => warn.push({ muc, noi_dung });
  const lnDk = s.du_kien.doanh_thu.gt - s.du_kien.chi_phi.gt;
  if (lnDk < 0) W('cao', `Dự án lỗ dự kiến ${fmt(lnDk)} đ (trước VAT)`);
  for (const h of hds) {
    if (h.tam_tinh) W('tb', `${h.so_hieu}: VAT 0% (tạm tính)`);
    if (h.tien_ve > h.dk.sv) W('cao', `${h.so_hieu}: tiền về ${fmt(h.tien_ve)} vượt giá trị HĐ ${fmt(h.dk.sv)}`);
    if (h.nt.sv > h.hd.sv * 1.1 && !h.da_qt) W('tb', `${h.so_hieu}: nghiệm thu vượt 110% giá trị HĐ + PL`);
    if (h.lai_gop_dk < 0) W('cao', `${h.so_hieu}: thầu phụ (${fmt(h.tp.qt_gt)}) vượt doanh thu dự kiến (${fmt(h.dk.gt)})`);
  }
  for (const c of tp) if (c.da_tt > c.qt_sau_vat) W('cao', `HĐTP ${c.so_ma}: thanh toán ${fmt(c.da_tt)} vượt HT/QT ${fmt(c.qt_sau_vat)}`);
  if (tpChuaGan.n) W('tb', `${tpChuaGan.n} HĐ thầu phụ chưa gắn HĐ chủ đầu tư`);
  const legacy = cost.filter((r) => findNhom(r.nhom)?.sub.length && !findNhom(r.nhom).sub.some((x) => x.code === r.nhom_con)).length;
  if (legacy) W('tb', `${legacy} dòng chi phí chưa phân loại hạng mục`);
  if (s.thuc_hien.chua_ngay.dt + s.thuc_hien.chua_ngay.cp) W('thap', `${s.thuc_hien.chua_ngay.dt + s.thuc_hien.chua_ngay.cp} dòng thiếu ngày (không lên biểu đồ theo tháng)`);

  // ---- Dòng chi tiết để xuất Excel ----
  const tpName = (id) => masters.find((m) => m.id === id)?.so_hieu || 'Chưa gắn HĐ CĐT';
  const chi_tiet = {
    doanh_thu: rev.map((r) => ({ loai: r.loai === 'hd' ? 'HĐ/PL' : 'HT/QT', so_hieu: r.so_hieu, thuoc_hd: r.loai === 'qt' ? (masters.find((m) => m.id === r.hd_id)?.so_hieu || '') : r.so_hieu,
      ngay: r.ngay, gia_tri: r.gia_tri, vat: r.vat, tien_vat: r.tien_vat, sau_vat: r.sau_vat, ghi_chu: r.ghi_chu || '' })),
    tien_ve: tienVe.map((t) => ({ hd: masters.find((m) => m.id === t.hd_id)?.so_hieu || '', loai: t.loai === 'dot' ? `TT Đợt ${t.dot}` : t.loai === 'tam_ung' ? 'Tạm ứng' : 'Quyết toán',
      ngay: t.ngay, so_tien: t.so_tien, ghi_chu: t.ghi_chu || '' })),
    thau_phu: tp.map((c) => ({ hd_cdt: tpName(c.hd_cdt_id || 0), so_ma: c.so_ma, doi_tac: c.doi_tac, so_pl: c.so_pl, hd_sv: c.hd_sau_vat, qt_gt: c.qt_gia_tri, qt_sv: c.qt_sau_vat,
      da_tt: c.da_tt, con_lai: c.con_lai, trang_thai: c.khoa ? 'Đã quyết toán (khóa)' : c.da_qt ? 'Đã QT' : 'Chưa QT', ghi_chu: c.ghi_chu || '' })),
    chi_phi: cost.map((r) => {
      const n = findNhom(r.nhom);
      return { khoi: KHOI_CHI_PHI.find((k) => k.code === n?.khoi)?.ten || '', nhom: n?.ten || r.nhom, hang_muc: n?.sub.find((x) => x.code === r.nhom_con)?.ten || '',
        noi_dung: r.noi_dung, doi_tac: r.doi_tac, so_ct: r.so_ct, ngay: r.ngay, gia_tri: r.gia_tri, vat: r.vat, tien_vat: r.tien_vat, sau_vat: r.sau_vat,
        tinh_cp: isNgoaiCp(r) ? 'Không (trả nợ gốc)' : 'Có', ghi_chu: r.ghi_chu || '' };
    }),
  };

  return {
    id: p.id, ma_du_an: p.ma_du_an, ten_du_an: p.ten_du_an, chu_dau_tu: p.chu_dau_tu, trang_thai: p.trang_thai, tien_do: Number(p.tien_do) || 0,
    ngay_bat_dau: p.ngay_bat_dau, ngay_ket_thuc: p.ngay_ket_thuc,
    loai_cong_trinh: p.loai_cong_trinh || '', dia_diem: p.dia_diem || '', co_anh: Boolean(p.co_anh), anh_v: Number(p.anh_v) || 0,
    so_hd: s.so_hd, so_hd_qt: s.so_hd_qt, so_tp: s.so_tp, so_tp_qt: s.so_tp_qt,
    du_kien: { doanh_thu: s.du_kien.doanh_thu, chi_phi: s.du_kien.chi_phi, con_lai: s.du_kien.con_lai, thang: s.du_kien.thang },
    thuc_hien: { doanh_thu: s.thuc_hien.doanh_thu, chi_phi: s.thuc_hien.chi_phi, con_lai: s.thuc_hien.con_lai, thang: s.thuc_hien.thang, chua_ngay: s.thuc_hien.chua_ngay },
    tien_ve: s.tien_ve, tra_goc: s.tra_goc,
    tp: { ...tpSum(tp), chua_gan: tpChuaGan },
    khoi, nhom, hds, dong_tien, flow, canh_bao: warn, chi_tiet,
  };
}

function fmt(n) { return new Intl.NumberFormat('vi-VN').format(n); }

module.exports = { projectReport };

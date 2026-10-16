// Danh mục Chi phí công trình (nhóm -> hạng mục con) và tổng hợp
const { calcLine } = require('./revenue');

// Khối chi phí: B1 trực tiếp, B2 gián tiếp, B3 tài chính
const KHOI_CHI_PHI = [
  { code: 'B1', ten: 'CHI PHÍ TRỰC TIẾP', danh_so: 'so' },
  { code: 'B2', ten: 'CHI PHÍ GIÁN TIẾP', danh_so: 'la_ma' },
  { code: 'B3', ten: 'CHI PHÍ TÀI CHÍNH', danh_so: 'so' },
];

const NHOM_CHI_PHI = [
  // ---- B1. Chi phí trực tiếp ----
  { code: 'thau_phu', ten: 'Thầu phụ', sub: [] },
  { code: 'vat_tu', ten: 'Vật tư', sub: [
    { code: 'chinh', ten: 'Vật tư chính' },
    { code: 'phu', ten: 'Vật tư phụ' },
  ] },
  { code: 'nhan_cong', ten: 'Nhân công', sub: [
    { code: 'giao_khoan', ten: 'Giao khoán' },
    { code: 'cong_nhat', ten: 'Công nhật' },
    { code: 'van_chuyen', ten: 'Vận chuyển' },
    { code: 've_sinh', ten: 'Vệ sinh/Sắp xếp thiết bị' },
    { code: 'bao_che', ten: 'Bao che/Biện pháp' },
    { code: 'thi_nghiem', ten: 'Thí nghiệm' },
  ] },
  { code: 'may_moc', ten: 'Máy móc thiết bị', sub: [] },
  { code: 'to_chuc', ten: 'Tổ chức thi công/VP', sub: [] },
  { code: 'khac', ten: 'Chi phí khác', sub: [] },
  // ---- B2. Chi phí gián tiếp ----
  { code: 'gt_tien_ich', khoi: 'B2', ten: 'Chi phí tiện ích, chi phí phục vụ thi công', sub: [
    { code: 've_may_bay', ten: 'Chi phí Vé máy bay' },
    { code: 'tien_ich', ten: 'Chi phí Tiện ích' },
    { code: 'cong_trinh', ten: 'Chi phí Công trình' },
  ] },
  { code: 'gt_luong', khoi: 'B2', ten: 'Chi phí lương, thưởng', sub: [
    { code: 'luong', ten: 'Lương + CTX + phụ cấp ĐT' },
    { code: 'thuong_le', ten: 'Thưởng tết âm lịch, Thưởng Lễ 30/4, 2/9' },
    { code: 'thuong_dot', ten: 'Thưởng Đợt, Quyết toán CT; Thưởng 6 tháng VP' },
  ] },
  { code: 'gt_ngoai_giao', khoi: 'B2', ten: 'Chi phí ngoại giao', sub: [
    { code: 'bgd1', ten: 'Chi phí BGĐ 1' },
    { code: 'bgd2', ten: 'Chi phí BGĐ 2' },
    { code: 'bgd0', ten: 'Chi phí BGĐ 0' },
  ] },
  // ---- B3. Chi phí tài chính ----
  { code: 'tc_chi_phi', khoi: 'B3', ten: 'Chi phí tài chính', sub: [] },
  { code: 'tc_tra_no', khoi: 'B3', ten: 'Trả nợ vay ngân hàng', sub: [], bat_buoc_doi_tac: 'Tên ngân hàng' },
  { code: 'tc_phat', khoi: 'B3', ten: 'Đóng tiền phạt CĐT', sub: [] },
].map((n) => ({ khoi: 'B1', ...n }));

const findNhom = (code) => NHOM_CHI_PHI.find((n) => n.code === code);

// Tổng theo nhóm và hạng mục con (đủ 6 nhóm, kể cả nhóm chưa có dòng)
function summarizeCost(items) {
  const add = (a, r) => { a.so_dong++; a.gia_tri += r.gia_tri; a.tien_vat += r.tien_vat; a.sau_vat += r.sau_vat; if (r.tam_tinh) a.tam_tinh = true; };
  const zero = () => ({ so_dong: 0, gia_tri: 0, tien_vat: 0, sau_vat: 0, tam_tinh: false });
  const tong = zero();
  const theo_nhom = {};
  for (const n of NHOM_CHI_PHI) {
    theo_nhom[n.code] = { ...zero(), sub: Object.fromEntries(n.sub.map((s) => [s.code, zero()])) };
  }
  const theo_khoi = Object.fromEntries(KHOI_CHI_PHI.map((k) => [k.code, zero()]));
  for (const r of items) {
    const g = theo_nhom[r.nhom];
    if (!g) continue;
    add(tong, r);
    add(g, r);
    add(theo_khoi[findNhom(r.nhom).khoi], r);
    if (r.nhom_con && g.sub[r.nhom_con]) add(g.sub[r.nhom_con], r);
  }
  return { ...tong, theo_nhom, theo_khoi };
}

const sortCost = (items) => [...items].sort((a, b) =>
  NHOM_CHI_PHI.findIndex((n) => n.code === a.nhom) - NHOM_CHI_PHI.findIndex((n) => n.code === b.nhom) ||
  String(a.nhom_con || '').localeCompare(String(b.nhom_con || '')) ||
  String(a.ngay || '9999').localeCompare(String(b.ngay || '9999')) || a.id - b.id);

module.exports = { KHOI_CHI_PHI, NHOM_CHI_PHI, findNhom, summarizeCost, sortCost, calcLine };

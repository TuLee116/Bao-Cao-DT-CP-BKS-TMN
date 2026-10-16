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
    { code: 'chinh', ten: 'Vật tư chính', goi_y: 'Thép, bê tông, xi măng, cát đá, gạch...' },
    { code: 'phu', ten: 'Vật tư phụ', goi_y: 'Que hàn, đinh, dây buộc, vật tư tiêu hao...' },
  ] },
  { code: 'nhan_cong', ten: 'Nhân công', sub: [
    { code: 'giao_khoan', ten: 'Giao khoán', goi_y: 'Tổ đội / hạng mục giao khoán, đợt thanh toán...' },
    { code: 'cong_nhat', ten: 'Công nhật', goi_y: 'Công nhật tháng / tuần, số công...' },
    { code: 'van_chuyen', ten: 'Vận chuyển', goi_y: 'Vận chuyển vật tư, thiết bị, phế thải...' },
    { code: 've_sinh', ten: 'Vệ sinh/Sắp xếp thiết bị', goi_y: 'Vệ sinh công trường, sắp xếp, di dời thiết bị...' },
    { code: 'bao_che', ten: 'Bao che/Biện pháp', goi_y: 'Bao che, lưới an toàn, biện pháp thi công...' },
    { code: 'thi_nghiem', ten: 'Thí nghiệm', goi_y: 'Thí nghiệm vật liệu, nén mẫu, kiểm định...' },
  ] },
  { code: 'may_moc', ten: 'Máy móc thiết bị', sub: [], goi_y: 'Thuê cẩu, máy đào, giàn giáo, nhiên liệu máy...' },
  { code: 'to_chuc', ten: 'Tổ chức thi công/VP', sub: [], goi_y: 'Ban chỉ huy, lán trại, văn phòng công trường...' },
  { code: 'khac', ten: 'Chi phí khác', sub: [], goi_y: 'Diễn giải khoản chi phí' },
  // ---- B2. Chi phí gián tiếp ----
  { code: 'gt_tien_ich', khoi: 'B2', ten: 'Chi phí tiện ích, chi phí phục vụ thi công', sub: [
    { code: 've_may_bay', ten: 'Chi phí Vé máy bay', goi_y: 'Chặng bay, người đi, ngày bay...' },
    { code: 'tien_ich', ten: 'Chi phí Tiện ích', goi_y: 'Điện, nước, internet, điện thoại...' },
    { code: 'cong_trinh', ten: 'Chi phí Công trình', goi_y: 'Chi phí phục vụ công trình: lưu trú, đi lại, sinh hoạt...' },
  ] },
  { code: 'gt_luong', khoi: 'B2', ten: 'Chi phí lương, thưởng', sub: [
    { code: 'luong', ten: 'Lương + CTX + phụ cấp ĐT', goi_y: 'Lương, CTX, phụ cấp ĐT tháng...' },
    { code: 'thuong_le', ten: 'Thưởng tết âm lịch, Thưởng Lễ 30/4, 2/9', goi_y: 'Thưởng tết âm lịch / Lễ 30/4 / 2/9 năm...' },
    { code: 'thuong_dot', ten: 'Thưởng Đợt, Quyết toán CT; Thưởng 6 tháng VP', goi_y: 'Thưởng đợt, quyết toán công trình, thưởng 6 tháng VP...' },
  ] },
  { code: 'gt_ngoai_giao', khoi: 'B2', ten: 'Chi phí ngoại giao', sub: [
    { code: 'bgd1', ten: 'Chi phí BGĐ 1', goi_y: 'Nội dung chi ngoại giao' },
    { code: 'bgd2', ten: 'Chi phí BGĐ 2', goi_y: 'Nội dung chi ngoại giao' },
    { code: 'bgd0', ten: 'Chi phí BGĐ 0', goi_y: 'Nội dung chi ngoại giao' },
  ] },
  // ---- B3. Chi phí tài chính ----
  { code: 'tc_chi_phi', khoi: 'B3', ten: 'Chi phí tài chính', sub: [], goi_y: 'Phí ngân hàng, phí bảo lãnh, phí mở L/C...' },
  // Trả nợ gốc vay: dòng tiền trả nợ, KHÔNG phải chi phí -> không tính vào tổng chi phí / lợi nhuận
  { code: 'tc_tra_no', khoi: 'B3', ten: 'Trả nợ vay ngân hàng', bat_buoc_doi_tac: 'Tên ngân hàng', khong_vat: true, sub: [
    { code: 'goc', ten: 'Trả nợ gốc (không tính vào chi phí)', goi_y: 'Trả nợ gốc kỳ..., khế ước số...', khong_tinh_cp: true },
    { code: 'lai', ten: 'Trả lãi vay', goi_y: 'Lãi vay kỳ..., khế ước số...' },
  ] },
  { code: 'tc_phat', khoi: 'B3', ten: 'Đóng tiền phạt CĐT', sub: [], goi_y: 'Phạt chậm tiến độ, vi phạm hợp đồng...' },
].map((n) => ({ khoi: 'B1', ...n }));

const findNhom = (code) => NHOM_CHI_PHI.find((n) => n.code === code);
// Dòng không phải chi phí (vd: trả nợ gốc vay) – chỉ theo dõi dòng tiền
// Một dòng chi phí: như Doanh thu; nhóm không chịu VAT (trả nợ gốc/lãi vay) thì VAT 0% không phải "tạm tính"
const costLine = (r) => {
  const l = calcLine(r);
  return findNhom(r.nhom)?.khong_vat ? { ...l, tam_tinh: false, khong_vat: true } : l;
};
const isNgoaiCp = (r) => Boolean(findNhom(r.nhom)?.sub.find((s) => s.code === r.nhom_con)?.khong_tinh_cp);

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
  const ngoai_cp = zero(); // trả nợ gốc vay: không cộng vào nhóm / khối / tổng chi phí
  for (const r of items) {
    const g = theo_nhom[r.nhom];
    if (!g) continue;
    if (isNgoaiCp(r)) { add(ngoai_cp, r); add(g.sub[r.nhom_con], r); continue; }
    add(tong, r);
    add(g, r);
    add(theo_khoi[findNhom(r.nhom).khoi], r);
    if (r.nhom_con && g.sub[r.nhom_con]) add(g.sub[r.nhom_con], r);
  }
  return { ...tong, theo_nhom, theo_khoi, ngoai_cp };
}

const sortCost = (items) => [...items].sort((a, b) =>
  NHOM_CHI_PHI.findIndex((n) => n.code === a.nhom) - NHOM_CHI_PHI.findIndex((n) => n.code === b.nhom) ||
  String(a.nhom_con || '').localeCompare(String(b.nhom_con || '')) ||
  String(a.ngay || '9999').localeCompare(String(b.ngay || '9999')) || a.id - b.id);

module.exports = { KHOI_CHI_PHI, NHOM_CHI_PHI, findNhom, isNgoaiCp, costLine, summarizeCost, sortCost, calcLine };

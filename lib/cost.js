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
  { code: 'vat_tu', ten: 'Thiết bị & vật tư', sub: [
    { code: 'tam_pin', ten: 'Tấm pin (PV module)', goi_y: 'Hãng, công suất tấm (Wp), số tấm...' },
    { code: 'inverter', ten: 'Inverter (biến tần)', goi_y: 'Hãng, công suất (kW), hòa lưới / hybrid...' },
    { code: 'luu_tru', ten: 'Pin lưu trữ (ESS)', goi_y: 'Hãng, dung lượng (kWh)...' },
    { code: 'khung', ten: 'Khung giá đỡ, ray, kẹp', goi_y: 'Ray nhôm, kẹp biên/giữa, chân L, bulong...' },
    { code: 'chinh', ten: 'Cáp, tủ điện, thiết bị bảo vệ', goi_y: 'Cáp DC/AC, MC4, tủ AC/DC, CB, SPD, tiếp địa...' },
    { code: 'phu', ten: 'Vật tư phụ, tiêu hao', goi_y: 'Ống luồn, ốc vít, keo, băng keo, dây rút...' },
  ] },
  { code: 'nhan_cong', ten: 'Nhân công lắp đặt', sub: [
    { code: 'giao_khoan', ten: 'Khoán lắp đặt', goi_y: 'Đội lắp đặt, số kWp, đơn giá khoán/kWp...' },
    { code: 'cong_nhat', ten: 'Công nhật', goi_y: 'Số công, đơn giá công...' },
    { code: 'van_chuyen', ten: 'Vận chuyển', goi_y: 'Vận chuyển tấm pin, thiết bị lên công trình...' },
    { code: 've_sinh', ten: 'Vệ sinh tấm pin, dọn dẹp', goi_y: 'Vệ sinh pin, thu dọn mặt bằng sau lắp đặt...' },
    { code: 'bao_che', ten: 'An toàn lao động / biện pháp', goi_y: 'Dây an toàn, giàn giáo, thang, che chắn mái...' },
    { code: 'thi_nghiem', ten: 'Đo kiểm, chạy thử', goi_y: 'Đo cách điện, điện trở tiếp địa, chạy thử hệ thống...' },
  ] },
  { code: 'may_moc', ten: 'Máy móc, dụng cụ', sub: [], goi_y: 'Thuê cẩu/xe nâng đưa pin lên mái, máy khoan, dụng cụ...' },
  { code: 'to_chuc', ten: 'Khảo sát, thiết kế, hồ sơ', sub: [], goi_y: 'Khảo sát mái, thiết kế bản vẽ, mô phỏng sản lượng...' },
  { code: 'thu_tuc', ten: 'Thủ tục đấu nối & giấy phép', sub: [], goi_y: 'Đăng ký với điện lực, công tơ 2 chiều, thỏa thuận đấu nối, PCCC...' },
  { code: 'khac', ten: 'Chi phí khác', sub: [], goi_y: 'Diễn giải khoản chi phí' },
  // ---- B2. Chi phí gián tiếp ----
  { code: 'gt_tien_ich', khoi: 'B2', ten: 'Chi phí vận hành, phục vụ thi công', sub: [
    { code: 've_may_bay', ten: 'Đi lại, xăng xe', goi_y: 'Xăng xe, gửi xe, vé đi công trình xa...' },
    { code: 'tien_ich', ten: 'Mặt bằng, tiện ích', goi_y: 'Thuê kho/cửa hàng, điện, nước, internet, điện thoại...' },
    { code: 'cong_trinh', ten: 'Phục vụ công trình', goi_y: 'Lưu trú, ăn uống khi thi công xa...' },
  ] },
  { code: 'gt_luong', khoi: 'B2', ten: 'Chi phí lương, thưởng', sub: [
    { code: 'luong', ten: 'Lương + phụ cấp', goi_y: 'Lương, phụ cấp xăng xe, điện thoại tháng...' },
    { code: 'thuong_le', ten: 'Thưởng tết âm lịch, Thưởng Lễ 30/4, 2/9', goi_y: 'Thưởng tết âm lịch / Lễ 30/4 / 2/9 năm...' },
    { code: 'thuong_dot', ten: 'Thưởng công trình, doanh số', goi_y: 'Thưởng hoàn thành công trình, thưởng doanh số bán hàng...' },
  ] },
  { code: 'gt_ngoai_giao', khoi: 'B2', ten: 'Chi phí bán hàng & tiếp khách', sub: [
    { code: 'bgd1', ten: 'Tiếp khách', goi_y: 'Nội dung tiếp khách' },
    { code: 'bgd2', ten: 'Hoa hồng giới thiệu', goi_y: 'Người giới thiệu, công trình...' },
    { code: 'bgd0', ten: 'Marketing, quảng cáo', goi_y: 'Quảng cáo Facebook/Google, in ấn, biển bảng...' },
  ] },
  // ---- B3. Chi phí tài chính ----
  { code: 'tc_chi_phi', khoi: 'B3', ten: 'Chi phí tài chính', sub: [], goi_y: 'Phí ngân hàng, phí bảo lãnh, phí trả góp...' },
  // Trả nợ gốc vay: dòng tiền trả nợ, KHÔNG phải chi phí -> không tính vào tổng chi phí / lợi nhuận
  { code: 'tc_tra_no', khoi: 'B3', ten: 'Trả nợ vay ngân hàng', bat_buoc_doi_tac: 'Tên ngân hàng', khong_vat: true, sub: [
    { code: 'goc', ten: 'Trả nợ gốc (không tính vào chi phí)', goi_y: 'Trả nợ gốc kỳ..., khế ước số...', khong_tinh_cp: true },
    { code: 'lai', ten: 'Trả lãi vay', goi_y: 'Lãi vay kỳ..., khế ước số...' },
  ] },
  { code: 'tc_phat', khoi: 'B3', ten: 'Phạt / bồi thường khách hàng', sub: [], goi_y: 'Phạt chậm tiến độ, bồi thường hư hỏng mái, bảo hành...' },
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

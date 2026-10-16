// Danh mục Chi phí công trình (nhóm -> hạng mục con) và tổng hợp
const { calcLine } = require('./revenue');

const NHOM_CHI_PHI = [
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
];

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
  for (const r of items) {
    const g = theo_nhom[r.nhom];
    if (!g) continue;
    add(tong, r);
    add(g, r);
    if (r.nhom_con && g.sub[r.nhom_con]) add(g.sub[r.nhom_con], r);
  }
  return { ...tong, theo_nhom };
}

const sortCost = (items) => [...items].sort((a, b) =>
  NHOM_CHI_PHI.findIndex((n) => n.code === a.nhom) - NHOM_CHI_PHI.findIndex((n) => n.code === b.nhom) ||
  String(a.nhom_con || '').localeCompare(String(b.nhom_con || '')) ||
  String(a.ngay || '9999').localeCompare(String(b.ngay || '9999')) || a.id - b.id);

module.exports = { NHOM_CHI_PHI, findNhom, summarizeCost, sortCost, calcLine };

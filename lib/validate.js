// Kiểm tra dữ liệu đầu vào (dùng chung cho mọi API)

const { normMaLoai } = require('./revenue');
const { findNhom } = require('./cost');

const TRANG_THAI = ['Chuẩn bị', 'Đang thi công', 'Tạm dừng', 'Hoàn thành'];
const ROLES = {
  admin: 'Quản trị',
  editor: 'Nhập liệu',
  viewer: 'Chỉ xem',
};

const str = (v, max = 255) => String(v ?? '').trim().slice(0, max);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateProject(input) {
  const errors = [];
  const d = {
    ma_du_an: str(input.ma_du_an, 50),
    ten_du_an: str(input.ten_du_an),
    chu_dau_tu: str(input.chu_dau_tu),
    gia_tri_hd: Number(input.gia_tri_hd || 0),
    da_giai_ngan: Number(input.da_giai_ngan || 0),
    tien_do: Number(input.tien_do || 0),
    trang_thai: TRANG_THAI.includes(input.trang_thai) ? input.trang_thai : 'Chuẩn bị',
    ngay_bat_dau: input.ngay_bat_dau || null,
    ngay_ket_thuc: input.ngay_ket_thuc || null,
  };
  if (!d.ma_du_an) errors.push('Thiếu mã dự án');
  if (!d.ten_du_an) errors.push('Thiếu tên dự án');
  if (!Number.isFinite(d.gia_tri_hd) || d.gia_tri_hd < 0) errors.push('Giá trị HĐ không hợp lệ');
  if (!Number.isFinite(d.da_giai_ngan) || d.da_giai_ngan < 0) errors.push('Giá trị giải ngân không hợp lệ');
  if (d.da_giai_ngan > d.gia_tri_hd) errors.push('Giải ngân vượt giá trị HĐ');
  if (!Number.isFinite(d.tien_do) || d.tien_do < 0 || d.tien_do > 100) errors.push('Tiến độ phải từ 0 đến 100%');
  for (const k of ['ngay_bat_dau', 'ngay_ket_thuc']) {
    if (d[k] && !DATE_RE.test(d[k])) errors.push('Ngày không hợp lệ');
  }
  if (d.ngay_bat_dau && d.ngay_ket_thuc && d.ngay_ket_thuc < d.ngay_bat_dau) errors.push('Ngày kết thúc trước ngày bắt đầu');
  return { data: d, errors };
}

// Quy tắc mật khẩu mạnh (giao diện public/common.js dùng cùng quy tắc)
const PASSWORD_RULES = [
  { test: (p) => p.length >= 8, msg: 'Tối thiểu 8 ký tự' },
  { test: (p) => /[A-Z]/.test(p), msg: 'Có ít nhất 1 chữ viết hoa (A–Z)' },
  { test: (p) => /[a-z]/.test(p), msg: 'Có ít nhất 1 chữ viết thường (a–z)' },
  { test: (p) => /\d/.test(p), msg: 'Có ít nhất 1 chữ số (0–9)' },
  { test: (p) => /[^A-Za-z0-9\s]/.test(p), msg: 'Có ít nhất 1 ký tự đặc biệt (vd: ! @ # $ % & *)' },
  { test: (p) => !/\s/.test(p), msg: 'Không chứa khoảng trắng' },
];

function passwordErrors(pw, username = '') {
  pw = String(pw ?? '');
  if (pw.length > 128) return ['Mật khẩu tối đa 128 ký tự'];
  const errors = PASSWORD_RULES.filter((r) => !r.test(pw)).map((r) => 'Mật khẩu: ' + r.msg.toLowerCase());
  const u = String(username || '').toLowerCase();
  if (u.length >= 3 && pw.toLowerCase().includes(u)) errors.push('Mật khẩu không được chứa tên đăng nhập');
  return errors;
}

// isNew = true: tạo mới (bắt buộc username + mật khẩu); username dùng khi sửa để kiểm tra mật khẩu
function validateUser(input, isNew, username = '') {
  const errors = [];
  const d = {
    full_name: str(input.full_name, 100),
    role: input.role,
    active: input.active === undefined ? true : Boolean(input.active),
  };
  if (!d.full_name) errors.push('Thiếu họ tên');
  if (!ROLES[d.role]) errors.push('Quyền không hợp lệ');
  if (isNew) {
    d.username = str(input.username, 50).toLowerCase();
    if (!/^[a-z0-9._-]{3,50}$/.test(d.username)) errors.push('Tên đăng nhập 3–50 ký tự, chỉ gồm chữ không dấu, số, dấu . _ -');
  }
  if (isNew || input.password) {
    d.password = String(input.password ?? '');
    errors.push(...passwordErrors(d.password, d.username || username));
  }
  return { data: d, errors };
}

const MAX_MONEY = 1e15; // 1 triệu tỷ đồng

// Ngày dạng YYYY-MM-DD và có thật (chặn 31/02...)
function validIsoDate(s) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return y >= 1900 && y <= 2200 && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Một dòng Doanh thu (Hợp đồng/Phụ lục hoặc Hoàn thành/Quyết toán)
function validateRevenue(input) {
  const errors = [];
  const rawGt = String(input.gia_tri ?? '').replace(/[.,\s]/g, '');
  const rawVat = String(input.vat ?? '').trim();
  const d = {
    loai: input.loai,
    so_hieu: str(input.so_hieu, 150),
    ngay: input.ngay || null,
    gia_tri: Number(rawGt),
    vat: rawVat === '' ? 0 : Number(rawVat),
    ghi_chu: str(input.ghi_chu, 500),
    hd_id: input.loai === 'qt' ? Number(input.hd_id) : null,
    ma_loai: null,
    so_ma: null,
  };
  if (!['hd', 'qt'].includes(d.loai)) errors.push('Loại doanh thu không hợp lệ');
  if (d.loai === 'hd') {
    // Mục 1: Loại (HĐ/PLxx) + Số mã HĐ -> tên hiển thị "HĐ ABC-123"
    d.ma_loai = normMaLoai(input.ma_loai);
    d.so_ma = str(input.so_ma, 120);
    if (!d.ma_loai) errors.push('Chọn loại HĐ / PL01 / PL02...');
    if (!d.so_ma) errors.push('Thiếu Số mã HĐ');
    d.so_hieu = d.ma_loai && d.so_ma ? `${d.ma_loai} ${d.so_ma}` : '';
  }
  if (d.loai === 'qt' && !(Number.isInteger(d.hd_id) && d.hd_id > 0)) errors.push('Chọn Số HĐ từ danh sách gợi ý');
  if (d.loai === 'qt' && !d.so_hieu) errors.push('Thiếu Đợt / Hồ sơ HT/QT');
  if (rawGt === '' || !Number.isInteger(d.gia_tri)) errors.push('Giá trị phải là số nguyên (đồng)');
  else if (Math.abs(d.gia_tri) > MAX_MONEY) errors.push('Giá trị vượt giới hạn cho phép');
  if (!Number.isInteger(d.vat) || d.vat < 0 || d.vat > 100) errors.push('VAT phải là số nguyên từ 0 đến 100 (%)');
  if (d.ngay && !validIsoDate(d.ngay)) errors.push('Ngày không hợp lệ (dd/mm/yyyy)');
  return { data: d, errors };
}

// Một dòng Giá trị tiền về (Tạm ứng / TT Đợt n / Quyết toán)
function validateTienVe(input) {
  const errors = [];
  const raw = String(input.so_tien ?? '').replace(/[.,\s]/g, '');
  const d = {
    loai: input.loai,
    dot: input.loai === 'dot' ? Number(input.dot) : null,
    so_tien: Number(raw),
    ngay: input.ngay || null,
    ghi_chu: str(input.ghi_chu, 500),
    hd_id: Number(input.hd_id),
  };
  if (!['tam_ung', 'dot', 'quyet_toan'].includes(d.loai)) errors.push('Loại tiền về không hợp lệ');
  if (!(Number.isInteger(d.hd_id) && d.hd_id > 0)) errors.push('Chọn Số HĐ cho dòng tiền về');
  if (d.loai === 'dot' && (!Number.isInteger(d.dot) || d.dot < 1 || d.dot > 999)) errors.push('Số đợt phải là số nguyên từ 1 đến 999');
  if (raw === '' || !Number.isInteger(d.so_tien)) errors.push('Giá trị tiền về phải là số nguyên (đồng)');
  else if (d.so_tien < 0) errors.push('Giá trị tiền về không được âm');
  else if (d.so_tien > MAX_MONEY) errors.push('Giá trị vượt giới hạn cho phép');
  if (d.ngay && !validIsoDate(d.ngay)) errors.push('Ngày không hợp lệ (dd/mm/yyyy)');
  return { data: d, errors };
}

// Một dòng Chi phí
function validateCost(input) {
  const errors = [];
  const rawGt = String(input.gia_tri ?? '').replace(/[.,\s]/g, '');
  const rawVat = String(input.vat ?? '').trim();
  const nhom = findNhom(input.nhom);
  const d = {
    nhom: input.nhom,
    nhom_con: input.nhom_con || null,
    noi_dung: str(input.noi_dung, 300),
    doi_tac: str(input.doi_tac, 200),
    so_ct: str(input.so_ct, 100),
    ngay: input.ngay || null,
    gia_tri: Number(rawGt),
    vat: rawVat === '' ? 0 : Number(rawVat),
    ghi_chu: str(input.ghi_chu, 500),
  };
  if (!nhom) errors.push('Chọn nhóm chi phí');
  else if (nhom.code === 'thau_phu' && input._new) errors.push('Thầu phụ nhập theo hợp đồng (bảng 1. Thầu phụ)');
  else if (nhom.sub.length) {
    if (!nhom.sub.some((s) => s.code === d.nhom_con)) errors.push(`Chọn hạng mục của nhóm ${nhom.ten}`);
  } else d.nhom_con = null;
  if (!d.noi_dung) errors.push('Thiếu nội dung chi phí');
  if (nhom?.bat_buoc_doi_tac && !d.doi_tac) errors.push(`Nhập ${nhom.bat_buoc_doi_tac.toLowerCase()}`);
  if (rawGt === '' || !Number.isInteger(d.gia_tri)) errors.push('Giá trị phải là số nguyên (đồng)');
  else if (Math.abs(d.gia_tri) > MAX_MONEY) errors.push('Giá trị vượt giới hạn cho phép');
  if (!Number.isInteger(d.vat) || d.vat < 0 || d.vat > 100) errors.push('VAT phải là số nguyên từ 0 đến 100 (%)');
  if (d.ngay && !validIsoDate(d.ngay)) errors.push('Ngày không hợp lệ (dd/mm/yyyy)');
  return { data: d, errors };
}

// ---------- Thầu phụ ----------
function moneyField(v, label, errors, { allowEmpty = false, allowNeg = true } = {}) {
  const raw = String(v ?? '').replace(/[.,\s]/g, '');
  if (raw === '' && allowEmpty) return null;
  const n = Number(raw);
  if (raw === '' || !Number.isInteger(n)) errors.push(`${label} phải là số nguyên (đồng)`);
  else if (!allowNeg && n < 0) errors.push(`${label} không được âm`);
  else if (Math.abs(n) > MAX_MONEY) errors.push(`${label} vượt giới hạn cho phép`);
  return n;
}
function vatField(v, errors) {
  const raw = String(v ?? '').trim();
  const n = raw === '' ? 0 : Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 100) errors.push('VAT phải là số nguyên từ 0 đến 100 (%)');
  return n;
}
function dateField(v, errors) {
  if (v && !validIsoDate(v)) errors.push('Ngày không hợp lệ (dd/mm/yyyy)');
  return v || null;
}
// Thông tin chung HĐTP
function validateTp(input) {
  const errors = [];
  const d = { so_ma: str(input.so_ma, 120), doi_tac: str(input.doi_tac, 200), ghi_chu: str(input.ghi_chu, 500) };
  if (!d.so_ma) errors.push('Thiếu Số HĐ thầu phụ');
  return { data: d, errors };
}
// 1 dòng HĐ/PL của HĐTP
function validateTpLine(input) {
  const errors = [];
  const d = {
    ma_loai: normMaLoai(input.ma_loai),
    ngay: dateField(input.ngay, errors),
    gia_tri: moneyField(input.gia_tri, 'Giá trị HĐ/PL', errors),
    vat: vatField(input.vat, errors),
    gia_tri_qt: moneyField(input.gia_tri_qt, 'Giá trị HT/QT', errors, { allowEmpty: true }),
    ghi_chu: str(input.ghi_chu, 500),
  };
  if (!d.ma_loai) errors.push('Loại phải là HĐ hoặc PL01, PL02...');
  return { data: d, errors };
}
// 1 dòng thanh toán cho thầu phụ
function validateTpPay(input) {
  const errors = [];
  const d = {
    loai: input.loai,
    dot: input.loai === 'dot' ? Number(input.dot) : null,
    so_tien: moneyField(input.so_tien, 'Giá trị thanh toán', errors, { allowNeg: false }),
    ngay: dateField(input.ngay, errors),
    ghi_chu: str(input.ghi_chu, 500),
  };
  if (!['tam_ung', 'dot', 'quyet_toan'].includes(d.loai)) errors.push('Loại thanh toán không hợp lệ');
  if (d.loai === 'dot' && (!Number.isInteger(d.dot) || d.dot < 1 || d.dot > 999)) errors.push('Số đợt phải là số nguyên từ 1 đến 999');
  return { data: d, errors };
}

// Passcode xóa HĐ/PL: đúng 8 chữ số, không quá dễ đoán
function passcodeErrors(p) {
  p = String(p ?? '');
  if (!/^\d{8}$/.test(p)) return ['Passcode phải gồm đúng 8 chữ số'];
  if (/^(\d)\1{7}$/.test(p)) return ['Passcode quá dễ đoán (8 số giống nhau)'];
  const asc = '01234567890123456789', desc = '98765432109876543210';
  if (asc.includes(p) || desc.includes(p)) return ['Passcode quá dễ đoán (dãy số liên tiếp)'];
  return [];
}

function validateSettings(input) {
  const d = {
    ten_cong_ty: str(input.ten_cong_ty, 150),
    ten_he_thong: str(input.ten_he_thong, 100) || 'Quản lý dự án',
  };
  return { data: d, errors: d.ten_cong_ty ? [] : ['Thiếu tên công ty'] };
}

// Thông tin hệ thống & liên hệ hỗ trợ (tab Liên hệ) – Quản trị sửa
const VERSION_RE = /^V\d{2,3}\.(0[1-9]|[12]\d|3[01])\.(0[1-9]|1[0-2])\.\d{2}$/;
function validateContact(input) {
  const errors = [];
  const d = {
    ten: str(input.ten, 150),
    so_huu: str(input.so_huu, 150),
    phat_trien: str(input.phat_trien, 150),
    sdt: str(input.sdt, 50),
    mail: str(input.mail, 150),
    phien_ban: str(input.phien_ban, 20).toUpperCase(),
  };
  if (!d.ten) errors.push('Thiếu Tên hệ thống/Website');
  if (!d.so_huu) errors.push('Thiếu Đơn vị sở hữu');
  if (d.sdt && !/^[0-9+().\s-]{6,50}$/.test(d.sdt)) errors.push('SĐT chỉ gồm chữ số, dấu cách, + . - ( )');
  if (d.mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.mail)) errors.push('Mail không hợp lệ');
  if (d.phien_ban && !VERSION_RE.test(d.phien_ban)) errors.push('Phiên bản phải dạng V01.16.10.26 (để trống = tự động)');
  return { data: d, errors };
}

module.exports = { TRANG_THAI, ROLES, validateProject, validateUser, validateSettings, validateContact, validateRevenue, validateTienVe, validateCost, validateTp, validateTpLine, validateTpPay, passwordErrors, passcodeErrors };

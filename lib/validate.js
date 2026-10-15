// Kiểm tra dữ liệu đầu vào (dùng chung cho mọi API)

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

function passwordErrors(pw) {
  pw = String(pw ?? '');
  const errors = [];
  if (pw.length < 8) errors.push('Mật khẩu tối thiểu 8 ký tự');
  if (pw.length > 128) errors.push('Mật khẩu tối đa 128 ký tự');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) errors.push('Mật khẩu phải có cả chữ và số');
  return errors;
}

// isNew = true: tạo mới (bắt buộc username + mật khẩu)
function validateUser(input, isNew) {
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
    errors.push(...passwordErrors(d.password));
  }
  return { data: d, errors };
}

function validateSettings(input) {
  const d = {
    ten_cong_ty: str(input.ten_cong_ty, 150),
    ten_he_thong: str(input.ten_he_thong, 100) || 'Quản lý dự án',
  };
  return { data: d, errors: d.ten_cong_ty ? [] : ['Thiếu tên công ty'] };
}

module.exports = { TRANG_THAI, ROLES, validateProject, validateUser, validateSettings, passwordErrors };

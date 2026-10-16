// Hàm dùng chung cho mọi trang
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', ...(opts.headers || {}) },
    credentials: 'same-origin',
  });
  if (res.status === 401 && !url.startsWith('/api/auth/login') && location.pathname === '/') {
    location.href = '/login';
    throw new Error('Phiên đăng nhập hết hạn');
  }
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body.errors || ['Lỗi ' + res.status]).join('\n'));
  return body;
}

function showMsg(el, text, type = 'ok') {
  el.textContent = text;
  el.className = 'msg ' + (text ? type : '');
}

const formData = (form) => Object.fromEntries(new FormData(form));

function dbWarning(meta) {
  if (meta.db !== 'memory') return;
  const div = document.createElement('div');
  div.className = 'warn-bar';
  div.textContent = 'Cảnh báo: chưa kết nối PostgreSQL (DATABASE_URL rỗng). Dữ liệu và tài khoản chỉ lưu tạm, sẽ mất khi máy chủ khởi động lại.';
  document.body.prepend(div);
}

// ---------- Kiểm tra độ mạnh mật khẩu (cùng quy tắc với máy chủ lib/validate.js) ----------
const PW_RULES = [
  [(p) => p.length >= 8, 'Tối thiểu 8 ký tự'],
  [(p) => /[A-Z]/.test(p), 'Chữ viết hoa (A–Z)'],
  [(p) => /[a-z]/.test(p), 'Chữ viết thường (a–z)'],
  [(p) => /\d/.test(p), 'Chữ số (0–9)'],
  [(p) => /[^A-Za-z0-9\s]/.test(p), 'Ký tự đặc biệt (!@#$%...)'],
  [(p) => !/\s/.test(p), 'Không có khoảng trắng'],
];

// Gắn danh sách điều kiện dưới ô mật khẩu; trả về hàm kiểm tra hợp lệ
function attachPwChecklist(input) {
  if (!input) return () => true;
  const box = document.createElement('ul');
  box.className = 'pw-rules';
  input.insertAdjacentElement('afterend', box);
  const render = () => {
    const p = input.value;
    box.hidden = !p && !input.required && document.activeElement !== input;
    box.innerHTML = PW_RULES.map(([t, label]) => `<li class="${t(p) ? 'ok' : ''}">${label}</li>`).join('');
    const ok = PW_RULES.every(([t]) => t(p));
    input.setCustomValidity(p && !ok ? 'Mật khẩu chưa đủ mạnh, xem các điều kiện bên dưới' : '');
    return ok;
  };
  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('blur', render);
  input.form?.addEventListener('reset', () => setTimeout(render));
  render();
  return () => !input.value || render();
}

// ---------- Ô nhập tiền: hiển thị 1.234.567, cho phép số âm (phụ lục giảm) ----------
const moneyFmt = new Intl.NumberFormat('vi-VN');
const parseMoney = (s) => {
  const t = String(s ?? '').trim();
  const neg = t.startsWith('-');
  const digits = t.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digits ? (neg ? '-' : '') + digits : (neg ? '-' : '');
};
function formatMoneyInput(input) {
  const raw = parseMoney(input.value);
  const fromEnd = input.value.length - (input.selectionStart ?? input.value.length);
  input.value = raw === '' || raw === '-' ? raw : moneyFmt.format(Number(raw));
  const pos = Math.max(0, input.value.length - fromEnd);
  try { input.setSelectionRange(pos, pos); } catch {}
}
function attachMoneyInput(input) {
  input.setAttribute('inputmode', 'numeric');
  input.setAttribute('autocomplete', 'off');
  input.addEventListener('input', () => formatMoneyInput(input));
}

// ---------- Ô ngày dd/mm/yyyy (không phụ thuộc ngôn ngữ trình duyệt) ----------
// Trả về: '' nếu trống, 'YYYY-MM-DD' nếu hợp lệ, null nếu sai
function dmyToIso(s) {
  s = String(s ?? '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (y < 1900 || y > 2200 || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
const isoToDmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

function attachDateInput(input) {
  input.setAttribute('placeholder', 'dd/mm/yyyy');
  input.setAttribute('maxlength', '10');
  input.setAttribute('inputmode', 'numeric');
  input.setAttribute('autocomplete', 'off');
  input.addEventListener('input', (e) => {
    if (e.inputType && e.inputType.startsWith('delete')) return;
    const digits = input.value.replace(/\D/g, '').slice(0, 8);
    let v = digits.slice(0, 2);
    if (digits.length > 2) v += '/' + digits.slice(2, 4);
    if (digits.length > 4) v += '/' + digits.slice(4);
    if (digits.length === 2 || digits.length === 4) v += '/';
    input.value = v;
  });
  input.addEventListener('blur', () => {
    input.classList.toggle('invalid', dmyToIso(input.value) === null);
  });
}

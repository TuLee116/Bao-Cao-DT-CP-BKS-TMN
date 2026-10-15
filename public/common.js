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

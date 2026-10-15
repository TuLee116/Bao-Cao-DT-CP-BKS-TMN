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

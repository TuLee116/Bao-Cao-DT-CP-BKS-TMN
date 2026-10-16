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

// ---------- Ô tìm kiếm có gợi ý (chọn từ danh sách) ----------
// getOptions() -> [{ id, label, sub }]; ô ẩn hiddenInput lưu id đã chọn
const normVn = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim();

function attachAutocomplete(input, hiddenInput, getOptions) {
  const wrap = document.createElement('div');
  wrap.className = 'ac';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  const list = document.createElement('ul');
  list.className = 'ac-list';
  list.hidden = true;
  wrap.appendChild(list);
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  let items = [];
  let active = -1;

  const choose = (opt) => {
    input.value = opt ? opt.label : '';
    hiddenInput.value = opt ? opt.id : '';
    input.classList.toggle('ac-ok', Boolean(opt));
    input.classList.remove('invalid');
    list.hidden = true;
  };
  const render = () => {
    const q = normVn(input.value);
    const all = getOptions();
    items = all.filter((o) => !q || normVn(o.label + ' ' + (o.sub || '')).includes(q)).slice(0, 50);
    active = items.length ? 0 : -1;
    list.innerHTML = items.length
      ? items.map((o, i) => `<li data-i="${i}" class="${i === active ? 'active' : ''}"><b>${esc(o.label)}</b>${o.sub ? `<span>${esc(o.sub)}</span>` : ''}</li>`).join('')
      : `<li class="ac-empty">${all.length ? 'Không tìm thấy' : 'Chưa có HĐ nào ở mục 1'}</li>`;
    list.hidden = false;
  };
  const highlight = () => $$('li[data-i]', list).forEach((li) => li.classList.toggle('active', Number(li.dataset.i) === active));

  input.addEventListener('focus', render);
  input.addEventListener('input', () => { hiddenInput.value = ''; input.classList.remove('ac-ok'); render(); });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); highlight(); }
    else if (e.key === 'Enter') { if (active >= 0) { e.preventDefault(); choose(items[active]); } }
    else if (e.key === 'Escape') { list.hidden = true; }
  });
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) { e.preventDefault(); choose(items[Number(li.dataset.i)]); }
  });
  input.addEventListener('blur', () => {
    list.hidden = true;
    if (hiddenInput.value) return;
    // Gõ đúng nguyên văn một số HĐ/PL thì tự chọn
    const exact = getOptions().filter((o) => normVn(o.label) === normVn(input.value));
    if (exact.length === 1) choose(exact[0]);
    else if (input.value.trim()) input.classList.add('invalid');
  });
  return { set: (id) => choose(getOptions().find((o) => o.id === Number(id)) || null), clear: () => choose(null) };
}

// ---------- Danh sách chọn nhanh (nhấp đúp hoặc phím ↓), vẫn cho gõ tự do ----------
// getOptions() -> [{ value, label, sub }]; onPick(option) khi chọn
function attachQuickPicker(input, getOptions, onPick, emptyText = 'Chưa có dữ liệu') {
  const wrap = document.createElement('div');
  wrap.className = 'ac';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  const list = document.createElement('ul');
  list.className = 'ac-list';
  list.hidden = true;
  wrap.appendChild(list);
  let items = [];
  let active = 0;
  const open = () => {
    items = getOptions();
    active = 0;
    list.innerHTML = items.length
      ? items.map((o, i) => `<li data-i="${i}" class="${i === 0 ? 'active' : ''}"><b>${esc(o.label)}</b>${o.sub ? `<span>${esc(o.sub)}</span>` : ''}</li>`).join('')
      : `<li class="ac-empty">${esc(emptyText)}</li>`;
    list.hidden = false;
  };
  const close = () => { list.hidden = true; };
  const pick = (o) => { close(); if (o) onPick(o); };
  const highlight = () => $$('li[data-i]', list).forEach((li) => li.classList.toggle('active', Number(li.dataset.i) === active));
  input.addEventListener('dblclick', (e) => { e.preventDefault(); open(); });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) { if (e.key === 'ArrowDown') { e.preventDefault(); open(); } return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); highlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(items[active]); }
    else if (e.key === 'Escape') close();
  });
  input.addEventListener('input', close);
  input.addEventListener('blur', close);
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) { e.preventDefault(); pick(items[Number(li.dataset.i)]); }
  });
  return { open, close };
}

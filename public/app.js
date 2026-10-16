const fmt = new Intl.NumberFormat('vi-VN');
const slug = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, '-');
const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);
const dmy = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const dt = (d) => (d ? new Date(d).toLocaleString('vi-VN') : '—');

let META = {};
let ME = {};
let projects = [];
let users = [];

// =====================================================================
// Khởi động
// =====================================================================
(async () => {
  try {
    [META, ME] = await Promise.all([api('/api/meta'), api('/api/auth/me')]);
  } catch (err) {
    return alert('Không tải được dữ liệu: ' + err.message);
  }
  dbWarning(META);
  applyBranding(META);
  $('#me-name').textContent = ME.full_name || ME.username;
  $('#me-role').textContent = META.roles[ME.role];

  // Ẩn chức năng không thuộc quyền
  $$('[data-role]').forEach((el) => {
    if (!el.dataset.role.split(' ').includes(ME.role)) el.remove();
  });

  const stSel = $('#p-form [name=trang_thai]');
  if (stSel) stSel.innerHTML = META.trang_thai.map((t) => `<option>${esc(t)}</option>`).join('');
  const roleSel = $('#u-form [name=role]');
  if (roleSel) roleSel.innerHTML = Object.entries(META.roles).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');

  let start = 'projects';
  try { start = localStorage.getItem('tab') || start; } catch {}
  showTab($(`#tabs [data-tab="${start}"]`) ? start : 'projects');
})();

function applyBranding(s) {
  $('#sys-name').textContent = s.ten_he_thong;
  $('#company').textContent = s.ten_cong_ty;
  document.title = s.ten_he_thong;
}

// =====================================================================
// Tab
// =====================================================================
const loaders = { projects: loadProjects, revenue: loadRevenueTab, users: loadUsers, settings: loadSettings, profile: async () => {} };

function showTab(name) {
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('main > .tab-panel').forEach((p) => (p.hidden = p.id !== 'tab-' + name));
  try { localStorage.setItem('tab', name); } catch {}
  Promise.resolve(loaders[name]()).catch((err) => alert(err.message));
}
$('#tabs').addEventListener('click', (e) => e.target.dataset.tab && showTab(e.target.dataset.tab));

$('#btn-logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = '/login';
});

// =====================================================================
// DỰ ÁN
// =====================================================================
const pForm = $('#p-form');
const canEdit = () => ['admin', 'editor'].includes(ME.role);

async function loadProjects() {
  projects = await api('/api/du-an');
  renderProjects();
}

function renderProjects() {
  const q = slug($('#p-search').value.trim());
  const rows = q ? projects.filter((r) => slug(`${r.ma_du_an} ${r.ten_du_an} ${r.chu_dau_tu}`).includes(q)) : projects;

  const hd = rows.reduce((s, r) => s + r.gia_tri_hd, 0);
  const gn = rows.reduce((s, r) => s + r.da_giai_ngan, 0);
  $('#k-count').textContent = rows.length;
  $('#k-hd').textContent = fmt.format(hd);
  $('#k-gn').textContent = fmt.format(gn);
  $('#k-tl').textContent = pct(gn, hd).toFixed(1) + '%';

  const cols = 11;
  $('#p-tbody').innerHTML = rows.length
    ? rows.map((r) => `
      <tr>
        <td>${esc(r.ma_du_an)}</td>
        <td>${esc(r.ten_du_an)}</td>
        <td>${esc(r.chu_dau_tu)}</td>
        <td class="num">${fmt.format(r.gia_tri_hd)}</td>
        <td class="num">${fmt.format(r.da_giai_ngan)}</td>
        <td class="num">${pct(r.da_giai_ngan, r.gia_tri_hd).toFixed(1)}%</td>
        <td><span class="bar"><i style="width:${Math.min(100, Number(r.tien_do) || 0)}%"></i></span>${r.tien_do}%</td>
        <td><span class="st st-${slug(r.trang_thai)}">${esc(r.trang_thai)}</span></td>
        <td>${dmy(r.ngay_bat_dau)}${r.ngay_ket_thuc ? ' → ' + dmy(r.ngay_ket_thuc) : ''}</td>
        <td class="muted">${esc(r.nguoi_cap_nhat || '')}</td>
        <td class="row-actions">
          <button data-rev="${r.id}" title="Xem / nhập doanh thu">Doanh thu</button>
          ${canEdit() ? `<button data-edit="${r.id}">Sửa</button>
          <button class="danger" data-del="${r.id}">Xóa</button>` : ''}
        </td>
      </tr>`).join('')
    : `<tr><td colspan="${cols}" class="empty">Chưa có dữ liệu</td></tr>`;
}

function resetProjectForm() {
  pForm.reset();
  pForm.elements.id.value = '';
  $('#p-form-title').textContent = 'Thêm dự án';
}

pForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = formData(pForm);
  const id = body.id;
  delete body.id;
  try {
    await api(id ? `/api/du-an/${id}` : '/api/du-an', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
    showMsg($('#p-msg'), id ? 'Đã cập nhật dự án' : 'Đã thêm dự án');
    resetProjectForm();
    await loadProjects();
  } catch (err) {
    showMsg($('#p-msg'), err.message, 'err');
  }
});
$('#p-cancel')?.addEventListener('click', () => { resetProjectForm(); showMsg($('#p-msg'), ''); });
$('#p-search').addEventListener('input', renderProjects);

$('#p-tbody').addEventListener('click', async (e) => {
  const { edit, del, rev } = e.target.dataset;
  if (rev) {
    revProjectId = Number(rev);
    return showTab('revenue');
  }
  if (edit) {
    const r = projects.find((x) => x.id === Number(edit));
    if (!r) return;
    for (const [k, v] of Object.entries(r)) if (pForm.elements[k]) pForm.elements[k].value = v ?? '';
    $('#p-form-title').textContent = 'Sửa dự án ' + r.ma_du_an;
    pForm.scrollIntoView({ behavior: 'smooth' });
  }
  if (del && confirm('Xóa dự án này?')) {
    try {
      await api(`/api/du-an/${del}`, { method: 'DELETE' });
      await loadProjects();
    } catch (err) {
      alert(err.message);
    }
  }
});

// Xuất CSV (UTF-8 có BOM để Excel đọc đúng tiếng Việt)
$('#p-csv').addEventListener('click', () => {
  const cols = ['ma_du_an', 'ten_du_an', 'chu_dau_tu', 'gia_tri_hd', 'da_giai_ngan', 'tien_do', 'trang_thai', 'ngay_bat_dau', 'ngay_ket_thuc'];
  const head = ['Mã DA', 'Tên dự án', 'Chủ đầu tư', 'Giá trị HĐ', 'Đã giải ngân', 'Tiến độ %', 'Trạng thái', 'Ngày bắt đầu', 'Ngày kết thúc'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [head.map(q).join(','), ...projects.map((r) => cols.map((c) => q(r[c])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `du-an_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// =====================================================================
// DOANH THU theo công trình
// =====================================================================
// Công thức giống máy chủ (lib/revenue.js): Tiền VAT = làm tròn(Giá trị × VAT% / 100); VAT 0% = tạm tính
const REV_LABEL = {
  hd: { title: '1. Hợp đồng / Phụ lục', short: 'HĐ/PL', so: 'Số HĐ / Phụ lục *', soPh: 'VD: HĐ 01/2026/TMN, PL01' },
  qt: { title: '2. Giá trị Hoàn thành / Quyết toán', short: 'HT/QT', so: 'Đợt / Hồ sơ HT/QT *', soPh: 'VD: Nghiệm thu đợt 1, Quyết toán' },
};
let revProjectId = null;
let revData = null;
try { revProjectId = Number(localStorage.getItem('revProject')) || null; } catch {}

const calcVat = (giaTri, vat) => {
  if (!vat || !giaTri) return 0;
  const g = BigInt(giaTri) * BigInt(vat);
  return Number((g + (g < 0n ? -50n : 50n)) / 100n);
};
const money = (n) => fmt.format(n);
const vatBadge = (vat) => (vat ? `${vat}%` : '<span class="st st-tam-tinh">Tạm tính</span>');

// Dựng 2 khối (HĐ/PL và HT/QT) từ một mẫu chung
function buildRevenueSections() {
  const wrap = $('#r-sections');
  if (wrap.dataset.built) return;
  wrap.dataset.built = '1';
  wrap.innerHTML = Object.entries(REV_LABEL).map(([loai, L]) => `
    <div class="card rev-card" data-loai="${loai}">
      <h2>${L.title}</h2>
      ${canEdit() ? `
      <form class="grid-form rev-form" data-loai="${loai}" novalidate>
        <input type="hidden" name="id">
        <label>${L.so}<input name="so_hieu" required maxlength="150" placeholder="${L.soPh}"></label>
        <label>Ngày<input name="ngay" type="date"></label>
        <label>Giá trị ${L.short} (trước VAT) *<input name="gia_tri" class="money" required placeholder="0"></label>
        <label>VAT (%)<input name="vat" type="number" min="0" max="100" step="1" placeholder="0 = chưa có VAT"></label>
        <label>Giá trị ${L.short} (sau VAT)<output class="calc" name="sau_vat">0</output><span class="calc-note"></span></label>
        <label class="span-2">Ghi chú<input name="ghi_chu" maxlength="500"></label>
        <div class="actions">
          <button type="submit" class="primary">Thêm dòng</button>
          <button type="button" class="rev-cancel">Hủy</button>
        </div>
        <div class="msg" role="alert"></div>
      </form>` : ''}
      <div class="table-wrap">
        <table class="rev-table">
          <thead><tr>
            <th class="num">#</th><th>${L.short === 'HĐ/PL' ? 'Số HĐ / Phụ lục' : 'Đợt / Hồ sơ'}</th><th>Ngày</th>
            <th class="num">Trước VAT</th><th class="num">VAT</th><th class="num">Tiền VAT</th>
            <th class="num">Sau VAT</th><th>Ghi chú</th><th>Người cập nhật</th>${canEdit() ? '<th></th>' : ''}
          </tr></thead>
          <tbody></tbody>
          <tfoot></tfoot>
        </table>
      </div>
    </div>`).join('');

  $$('.rev-form', wrap).forEach((f) => {
    attachMoneyInput(f.elements.gia_tri);
    const update = () => updateRevPreview(f);
    f.elements.gia_tri.addEventListener('input', update);
    f.elements.vat.addEventListener('input', update);
    f.addEventListener('submit', (e) => { e.preventDefault(); saveRevenue(f); });
    $('.rev-cancel', f).addEventListener('click', () => resetRevForm(f));
  });
  wrap.addEventListener('click', onRevTableClick);
}

// Tính trực tiếp Giá trị sau VAT khi đang nhập
function updateRevPreview(f) {
  const raw = parseMoney(f.elements.gia_tri.value);
  const gt = raw && raw !== '-' ? Number(raw) : 0;
  const vatStr = f.elements.vat.value.trim();
  const vat = vatStr === '' ? 0 : Number(vatStr);
  const out = f.elements.sau_vat;
  const note = $('.calc-note', f);
  if (!Number.isInteger(vat) || vat < 0 || vat > 100) {
    out.value = '—';
    note.textContent = 'VAT phải là số nguyên 0–100';
    note.className = 'calc-note err';
    return;
  }
  const tv = calcVat(gt, vat);
  out.value = money(gt + tv);
  note.textContent = vat ? `Tiền VAT: ${money(tv)}` : 'Tạm tính (chưa có VAT)';
  note.className = 'calc-note' + (vat ? '' : ' warn');
}

function resetRevForm(f) {
  f.reset();
  f.elements.id.value = '';
  $('button[type=submit]', f).textContent = 'Thêm dòng';
  showMsg($('.msg', f), '');
  updateRevPreview(f);
}

async function loadRevenueTab() {
  buildRevenueSections();
  projects = await api('/api/du-an');
  const sel = $('#r-project');
  $('#r-empty').hidden = projects.length > 0;
  $('#r-body').hidden = true;
  sel.hidden = !projects.length;
  if (!projects.length) return;
  if (!projects.some((p) => p.id === revProjectId)) revProjectId = projects[0].id;
  sel.innerHTML = projects.map((p) => `<option value="${p.id}">${esc(p.ma_du_an)} – ${esc(p.ten_du_an)}</option>`).join('');
  sel.value = revProjectId;
  await loadRevenue();
}

$('#r-project').addEventListener('change', (e) => {
  revProjectId = Number(e.target.value);
  $$('.rev-form').forEach(resetRevForm);
  loadRevenue().catch((err) => alert(err.message));
});

async function loadRevenue() {
  try { localStorage.setItem('revProject', revProjectId); } catch {}
  revData = await api(`/api/du-an/${revProjectId}/doanh-thu`);
  const p = revData.du_an;
  $('#r-project-info').innerHTML = `Mã: <b>${esc(p.ma_du_an)}</b> · Chủ đầu tư: <b>${esc(p.chu_dau_tu || '—')}</b>`;
  $('#r-body').hidden = false;
  renderRevenue();
}

function renderRevenue() {
  const { items, tong } = revData;
  const hd = tong.hd, qt = tong.qt;
  $('#r-k-hd').textContent = money(hd.sau_vat);
  $('#r-k-hd-sub').innerHTML = `${hd.so_dong} dòng${hd.tam_tinh ? ' · <span class="warn-text">có dòng tạm tính</span>' : ''}`;
  $('#r-k-qt').textContent = money(qt.sau_vat);
  $('#r-k-qt-sub').innerHTML = `${qt.so_dong} dòng${qt.tam_tinh ? ' · <span class="warn-text">có dòng tạm tính</span>' : ''}`;
  $('#r-k-tl').textContent = hd.sau_vat ? (qt.sau_vat / hd.sau_vat * 100).toFixed(1) + '%' : '—';
  $('#r-k-cl').textContent = money(hd.sau_vat - qt.sau_vat);

  const cols = canEdit() ? 10 : 9;
  for (const loai of Object.keys(REV_LABEL)) {
    const card = $(`.rev-card[data-loai="${loai}"]`);
    const rows = items.filter((r) => r.loai === loai);
    $('tbody', card).innerHTML = rows.length ? rows.map((r, i) => `
      <tr>
        <td class="num muted">${i + 1}</td>
        <td><b>${esc(r.so_hieu)}</b></td>
        <td>${dmy(r.ngay)}</td>
        <td class="num">${money(r.gia_tri)}</td>
        <td class="num">${vatBadge(r.vat)}</td>
        <td class="num">${money(r.tien_vat)}</td>
        <td class="num strong">${money(r.sau_vat)}</td>
        <td class="wrap">${esc(r.ghi_chu)}</td>
        <td class="muted">${esc(r.nguoi_cap_nhat || '')}</td>
        ${canEdit() ? `<td class="row-actions"><button data-redit="${r.id}">Sửa</button><button class="danger" data-rdel="${r.id}">Xóa</button></td>` : ''}
      </tr>`).join('') : `<tr><td colspan="${cols}" class="empty">Chưa có dữ liệu</td></tr>`;
    const t = tong[loai];
    $('tfoot', card).innerHTML = `
      <tr>
        <td></td><td colspan="2">TỔNG ${REV_LABEL[loai].short}${t.tam_tinh ? ' <span class="st st-tam-tinh">Có tạm tính</span>' : ''}</td>
        <td class="num">${money(t.gia_tri)}</td><td></td>
        <td class="num">${money(t.tien_vat)}</td>
        <td class="num">${money(t.sau_vat)}</td>
        <td colspan="${canEdit() ? 3 : 2}"></td>
      </tr>`;
  }
}

async function saveRevenue(f) {
  const msgEl = $('.msg', f);
  const id = f.elements.id.value;
  const body = {
    loai: f.dataset.loai,
    so_hieu: f.elements.so_hieu.value,
    ngay: f.elements.ngay.value,
    gia_tri: parseMoney(f.elements.gia_tri.value),
    vat: f.elements.vat.value,
    ghi_chu: f.elements.ghi_chu.value,
  };
  try {
    await api(id ? `/api/doanh-thu/${id}` : `/api/du-an/${revProjectId}/doanh-thu`,
      { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
    resetRevForm(f);
    showMsg(msgEl, id ? 'Đã cập nhật' : 'Đã thêm dòng');
    await loadRevenue();
  } catch (err) {
    showMsg(msgEl, err.message, 'err');
  }
}

async function onRevTableClick(e) {
  const { redit, rdel } = e.target.dataset;
  if (redit) {
    const r = revData.items.find((x) => x.id === Number(redit));
    const f = $(`.rev-form[data-loai="${r.loai}"]`);
    f.elements.id.value = r.id;
    f.elements.so_hieu.value = r.so_hieu;
    f.elements.ngay.value = r.ngay || '';
    f.elements.gia_tri.value = money(r.gia_tri);
    f.elements.vat.value = r.vat;
    f.elements.ghi_chu.value = r.ghi_chu || '';
    $('button[type=submit]', f).textContent = 'Lưu thay đổi';
    showMsg($('.msg', f), 'Đang sửa: ' + r.so_hieu);
    updateRevPreview(f);
    f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  if (rdel) {
    const r = revData.items.find((x) => x.id === Number(rdel));
    if (!r || !confirm(`Xóa dòng "${r.so_hieu}"?`)) return;
    try {
      await api(`/api/doanh-thu/${rdel}`, { method: 'DELETE' });
      await loadRevenue();
    } catch (err) {
      alert(err.message);
    }
  }
}

// =====================================================================
// TÀI KHOẢN (Quản trị)
// =====================================================================
const uForm = $('#u-form');
attachPwChecklist(uForm?.elements.password);

async function loadUsers() {
  users = await api('/api/users');
  $('#u-tbody').innerHTML = users.map((u) => `
    <tr>
      <td>${esc(u.username)}${u.id === ME.id ? ' <span class="badge light">Bạn</span>' : ''}</td>
      <td>${esc(u.full_name)}</td>
      <td><span class="st role-${u.role}">${esc(META.roles[u.role] || u.role)}</span></td>
      <td>${u.active ? '<span class="st st-hoan-thanh">Hoạt động</span>' : '<span class="st st-tam-dung">Đã khóa</span>'}</td>
      <td class="muted">${dt(u.last_login_at)}</td>
      <td class="row-actions">
        <button data-uedit="${u.id}">Sửa</button>
        ${u.id === ME.id ? '' : `<button class="danger" data-udel="${u.id}">Xóa</button>`}
      </td>
    </tr>`).join('');
}

function resetUserForm() {
  uForm.reset();
  uForm.elements.id.value = '';
  uForm.elements.username.disabled = false;
  uForm.elements.password.required = true;
  uForm.elements.password.dispatchEvent(new Event('input'));
  $('#u-pass-label').textContent = 'Mật khẩu *';
  $('#u-form-title').textContent = 'Thêm tài khoản';
}

uForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = uForm.elements.id.value;
  const body = {
    username: uForm.elements.username.value,
    full_name: uForm.elements.full_name.value,
    role: uForm.elements.role.value,
    active: uForm.elements.active.checked,
  };
  if (uForm.elements.password.value) body.password = uForm.elements.password.value;
  try {
    await api(id ? `/api/users/${id}` : '/api/users', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
    showMsg($('#u-msg'), id ? 'Đã cập nhật tài khoản' : 'Đã tạo tài khoản');
    resetUserForm();
    await loadUsers();
  } catch (err) {
    showMsg($('#u-msg'), err.message, 'err');
  }
});
$('#u-cancel')?.addEventListener('click', () => { resetUserForm(); showMsg($('#u-msg'), ''); });

$('#u-tbody')?.addEventListener('click', async (e) => {
  const { uedit, udel } = e.target.dataset;
  if (uedit) {
    const u = users.find((x) => x.id === Number(uedit));
    if (!u) return;
    uForm.elements.id.value = u.id;
    uForm.elements.username.value = u.username;
    uForm.elements.username.disabled = true;
    uForm.elements.full_name.value = u.full_name;
    uForm.elements.role.value = u.role;
    uForm.elements.active.checked = u.active;
    uForm.elements.password.value = '';
    uForm.elements.password.required = false;
    uForm.elements.password.dispatchEvent(new Event('input'));
    $('#u-pass-label').textContent = 'Mật khẩu mới (để trống nếu không đổi)';
    $('#u-form-title').textContent = 'Sửa tài khoản ' + u.username;
    uForm.scrollIntoView({ behavior: 'smooth' });
  }
  if (udel) {
    const u = users.find((x) => x.id === Number(udel));
    if (!u || !confirm(`Xóa tài khoản "${u.username}"?`)) return;
    try {
      await api(`/api/users/${udel}`, { method: 'DELETE' });
      await loadUsers();
    } catch (err) {
      alert(err.message);
    }
  }
});

// =====================================================================
// CÀI ĐẶT (Quản trị)
// =====================================================================
const sForm = $('#s-form');

async function loadSettings() {
  const s = await api('/api/settings');
  sForm.elements.ten_cong_ty.value = s.ten_cong_ty || '';
  sForm.elements.ten_he_thong.value = s.ten_he_thong || '';
  $('#sys-info').innerHTML = `
    Cơ sở dữ liệu: <b>${META.db === 'postgres' ? 'PostgreSQL' : 'Bộ nhớ tạm (chưa kết nối CSDL)'}</b><br>
    Mã khởi tạo (SETUP_TOKEN): ${META.setup_token_required ? 'đã đặt' : 'không đặt'}`;
}

sForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const s = await api('/api/settings', { method: 'PUT', body: JSON.stringify(formData(sForm)) });
    applyBranding(s);
    showMsg($('#s-msg'), 'Đã lưu cài đặt');
  } catch (err) {
    showMsg($('#s-msg'), err.message, 'err');
  }
});

// =====================================================================
// CÁ NHÂN – đổi mật khẩu
// =====================================================================
attachPwChecklist($('#pw-form [name=new_password]'));

$('#pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const d = formData(e.target);
  if (d.new_password !== d.new_password2) return showMsg($('#pw-msg'), 'Mật khẩu nhập lại không khớp', 'err');
  try {
    await api('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password: d.current_password, new_password: d.new_password }),
    });
    e.target.reset();
    showMsg($('#pw-msg'), 'Đã đổi mật khẩu');
  } catch (err) {
    showMsg($('#pw-msg'), err.message, 'err');
  }
});

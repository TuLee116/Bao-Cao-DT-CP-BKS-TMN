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
        ${loai === 'hd' ? `
        <label>Loại *<select name="ma_loai"></select></label>
        <label>Số mã HĐ *<input name="so_ma" maxlength="120" placeholder="VD: ABC-123, 01/2026/HĐXD-TMN"><span class="calc-note so-preview"></span></label>` : `
        <label>${L.so}<input name="so_hieu" required maxlength="150" placeholder="${L.soPh}"></label>`}
        ${loai === 'qt' ? `<label>Số HĐ *<input name="hd_ref" placeholder="Gõ để tìm Số HĐ ở mục 1"><input type="hidden" name="hd_id"></label>` : ''}
        <label>Ngày<input name="ngay" class="date-dmy"></label>
        <label>Giá trị ${L.short} (trước VAT) *<input name="gia_tri" class="money" required placeholder="0"></label>
        <label>VAT (%)<input name="vat" type="number" min="0" max="100" step="1" placeholder="0 = chưa có VAT"></label>
        <label>Giá trị ${L.short} (sau VAT)<output class="calc" name="sau_vat">0</output><span class="calc-note vat-note"></span></label>
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
            <th class="num">#</th><th>${loai === 'hd' ? 'Số HĐ / Phụ lục' : 'Đợt / Hồ sơ'}</th>${loai === 'qt' ? '<th>Số HĐ</th>' : ''}<th>Ngày</th>
            <th class="num">Trước VAT</th><th class="num">VAT</th><th class="num">Tiền VAT</th>
            <th class="num">Sau VAT</th><th>Ghi chú</th><th>Người cập nhật</th>${canEdit() ? '<th></th>' : ''}
          </tr></thead>
          <tbody></tbody>
          <tfoot></tfoot>
        </table>
      </div>
    </div>`).join('');

  wrap.insertAdjacentHTML('beforeend', tienVeCardHtml());
  $$('.rev-form', wrap).forEach((f) => {
    attachMoneyInput(f.elements.gia_tri);
    attachDateInput(f.elements.ngay);
    if (f.elements.hd_ref) f._hdAc = attachAutocomplete(f.elements.hd_ref, f.elements.hd_id, hdOptions);
    if (f.elements.ma_loai) {
      f.elements.ma_loai.addEventListener('change', () => { autoFillSoMa(f); updateSoPreview(f); });
      f.elements.so_ma.addEventListener('input', () => updateSoPreview(f));
    }
    const update = () => updateRevPreview(f);
    f.elements.gia_tri.addEventListener('input', update);
    f.elements.vat.addEventListener('input', update);
    f.addEventListener('submit', (e) => { e.preventDefault(); saveRevenue(f); });
    $('.rev-cancel', f).addEventListener('click', () => resetRevForm(f));
  });
  wrap.addEventListener('click', onRevTableClick);
  bindTienVe();
}

// Tính trực tiếp Giá trị sau VAT khi đang nhập
function updateRevPreview(f) {
  const raw = parseMoney(f.elements.gia_tri.value);
  const gt = raw && raw !== '-' ? Number(raw) : 0;
  const vatStr = f.elements.vat.value.trim();
  const vat = vatStr === '' ? 0 : Number(vatStr);
  const out = f.elements.sau_vat;
  const note = $('.vat-note', f);
  if (!Number.isInteger(vat) || vat < 0 || vat > 100) {
    out.value = '—';
    note.textContent = 'VAT phải là số nguyên 0–100';
    note.className = 'calc-note vat-note err';
    return;
  }
  const tv = calcVat(gt, vat);
  out.value = money(gt + tv);
  note.textContent = vat ? `Tiền VAT: ${money(tv)}` : 'Tạm tính (chưa có VAT)';
  note.className = 'calc-note vat-note' + (vat ? '' : ' warn');
}

// Danh sách gợi ý Số HĐ/PL = các dòng ở mục 1 của công trình đang chọn
// Chỉ gợi ý hợp đồng gốc (HĐ); giá trị hiển thị = HĐ tổng (HĐ + các PL cùng Số mã)
function hdOptions() {
  const rows = (revData?.items || []).filter((r) => r.loai === 'hd');
  return hdGroups(rows).filter((g) => g.head).map((g) => {
    const tong = [g.head, ...g.pls].reduce((s, r) => s + r.sau_vat, 0);
    return {
      id: g.head.id,
      label: g.head.so_hieu,
      sub: `HĐ tổng ${money(tong)} đ sau VAT${g.pls.length ? ` (gồm ${g.pls.length} PL)` : ''}${g.head.ngay ? ' · ' + dmy(g.head.ngay) : ''}`,
    };
  });
}

// Ô chọn Loại: HĐ, PL01, PL02... (luôn dư vài PL so với số đang có)
function hdRows() { return (revData?.items || []).filter((r) => r.loai === 'hd'); }
function fillMaLoaiOptions(f, keep) {
  const maxPl = Math.max(0, ...hdRows().map((r) => (r.ma_loai || '').startsWith('PL') ? Number(r.ma_loai.slice(2)) : 0),
    keep && keep.startsWith('PL') ? Number(keep.slice(2)) : 0);
  const n = Math.max(10, maxPl + 5);
  const used = new Set(hdRows().map((r) => r.ma_loai));
  const opts = ['HĐ', ...Array.from({ length: n }, (_, i) => 'PL' + String(i + 1).padStart(2, '0'))];
  f.elements.ma_loai.innerHTML = opts.map((o) => `<option value="${o}">${o}${used.has(o) && o !== keep ? ' (đã có)' : ''}</option>`).join('');
}
// Mặc định: chưa có HĐ -> HĐ; đã có -> PL kế tiếp
function nextMaLoai() {
  const rows = hdRows();
  if (!rows.some((r) => r.ma_loai === 'HĐ')) return 'HĐ';
  const maxPl = Math.max(0, ...rows.map((r) => (r.ma_loai || '').startsWith('PL') ? Number(r.ma_loai.slice(2)) : 0));
  return 'PL' + String(maxPl + 1).padStart(2, '0');
}
// Chọn PL mà chưa nhập Số mã -> lấy Số mã của HĐ chính
function autoFillSoMa(f) {
  if (f.elements.so_ma.value.trim() || !f.elements.ma_loai.value.startsWith('PL')) return;
  const hd = hdRows().find((r) => r.ma_loai === 'HĐ');
  if (hd) f.elements.so_ma.value = hd.so_ma;
}
function updateSoPreview(f) {
  const so = f.elements.so_ma.value.trim();
  $('.so-preview', f).textContent = so ? `Hiển thị: ${f.elements.ma_loai.value} ${so}` : '';
}

function resetRevForm(f) {
  f.reset();
  f.elements.id.value = '';
  if (f._hdAc) f._hdAc.clear();
  if (f.elements.ma_loai) {
    fillMaLoaiOptions(f);
    f.elements.ma_loai.value = nextMaLoai();
    autoFillSoMa(f);
    updateSoPreview(f);
  }
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
  loadRevenue().catch((err) => alert(err.message));
});

let tvProject = null;
async function loadRevenue() {
  try { localStorage.setItem('revProject', revProjectId); } catch {}
  if (tvProject !== revProjectId) {
    // Đổi công trình: bỏ dữ liệu đang nhập dở của công trình trước
    tvProject = revProjectId;
    tvDrafts = null;
    tvEdits = {};
    $$('.rev-form').forEach(resetRevForm);
  }
  revData = await api(`/api/du-an/${revProjectId}/doanh-thu`);
  const p = revData.du_an;
  $('#r-project-info').innerHTML = `Mã: <b>${esc(p.ma_du_an)}</b> · Chủ đầu tư: <b>${esc(p.chu_dau_tu || '—')}</b>`;
  $('#r-body').hidden = false;
  renderRevenue();
  // Cập nhật ô chọn Loại theo dữ liệu mới, không xóa nội dung đang nhập
  const fHd = $('.rev-form[data-loai="hd"]');
  if (fHd && !fHd.elements.id.value) {
    const typing = fHd.elements.so_ma.value.trim();
    const cur = fHd.elements.ma_loai.value;
    fillMaLoaiOptions(fHd);
    fHd.elements.ma_loai.value = typing && cur ? cur : nextMaLoai();
    autoFillSoMa(fHd);
    updateSoPreview(fHd);
  }
}

function renderRevenue() {
  const { items, tong } = revData;
  const hd = tong.hd, qt = tong.qt;
  $('#r-k-hd').textContent = money(hd.sau_vat);
  $('#r-k-hd-sub').innerHTML = `${hd.so_dong} dòng${hd.tam_tinh ? ' · <span class="warn-text">có dòng tạm tính</span>' : ''}`;
  $('#r-k-qt').textContent = money(qt.sau_vat);
  $('#r-k-qt-sub').innerHTML = `${qt.so_dong} dòng${qt.tam_tinh ? ' · <span class="warn-text">có dòng tạm tính</span>' : ''}`;
  const tv = revData.tong_tien_ve;
  $('#r-k-tv').textContent = money(tv.tong);
  $('#r-k-tv-sub').textContent = `Tạm ứng ${money(tv.tam_ung)} · Thanh toán ${money(tv.thanh_toan)} · Quyết toán ${money(tv.quyet_toan)}`;

  for (const loai of Object.keys(REV_LABEL)) {
    const cols = (canEdit() ? 10 : 9) + (loai === 'qt' ? 1 : 0);
    const card = $(`.rev-card[data-loai="${loai}"]`);
    const rows = items.filter((r) => r.loai === loai);
    if (loai === 'hd') {
      $('tbody', card).innerHTML = rows.length ? hdGroupsHtml(rows) : `<tr><td colspan="${cols}" class="empty">Chưa có dữ liệu</td></tr>`;
    } else $('tbody', card).innerHTML = rows.length ? rows.map((r, i) => `
      <tr>
        <td class="num muted">${i + 1}</td>
        <td><b>${esc(r.so_hieu)}</b></td>
        ${loai === 'qt' ? `<td>${r.hd_so_hieu ? `<span class="st hd-tag">${esc(r.hd_so_hieu)}</span>` : '<span class="muted">—</span>'}</td>` : ''}
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
        <td></td><td colspan="${loai === 'qt' ? 3 : 2}">TỔNG ${REV_LABEL[loai].short}${t.tam_tinh ? ' <span class="st st-tam-tinh">Có tạm tính</span>' : ''}</td>
        <td class="num">${money(t.gia_tri)}</td><td></td>
        <td class="num">${money(t.tien_vat)}</td>
        <td class="num">${money(t.sau_vat)}</td>
        <td colspan="${canEdit() ? 3 : 2}"></td>
      </tr>`;
  }
  renderTienVe();
}

// ---------- Mục 1: nhóm PL theo Số mã HĐ (HĐ là dòng cha, PL là tập con) ----------
const hdCollapsed = new Set();
const hdKey = (r) => normVn(r.so_ma || r.so_hieu);

function hdGroups(rows) {
  const map = new Map();
  for (const r of rows) {           // rows đã sắp: HĐ trước, PL01, PL02...
    const k = hdKey(r);
    if (!map.has(k)) map.set(k, { key: k, so_ma: r.so_ma || r.so_hieu, head: null, pls: [] });
    const g = map.get(k);
    if (r.ma_loai === 'HĐ' && !g.head) g.head = r; else g.pls.push(r);
  }
  // Nhóm có HĐ đứng trước (theo ngày HĐ), nhóm chỉ có PL (chưa có HĐ) xếp sau
  return [...map.values()].sort((a, b) =>
    (a.head ? 0 : 1) - (b.head ? 0 : 1) ||
    String(a.head?.ngay || '9999').localeCompare(String(b.head?.ngay || '9999')) ||
    (a.head?.id || a.pls[0].id) - (b.head?.id || b.pls[0].id));
}

function hdRowHtml(r, stt, { child = false, head = false, toggle = '' } = {}) {
  return `
    <tr class="${child ? 'hd-child' : 'hd-head'}" ${child ? `data-grp-child="${esc(hdKey(r))}"` : ''}>
      <td class="num muted">${stt}</td>
      <td class="${child ? 'indent' : ''}">${toggle}${child ? '<span class="tree">└</span>' : ''}<span class="kind-tag ${r.ma_loai === 'HĐ' ? 'kind-hd' : ''}">${esc(r.ma_loai || '')}</span> <b>${esc(r.so_ma || r.so_hieu)}</b></td>
      <td>${dmy(r.ngay)}</td>
      <td class="num">${money(r.gia_tri)}</td>
      <td class="num">${vatBadge(r.vat)}</td>
      <td class="num">${money(r.tien_vat)}</td>
      <td class="num strong">${money(r.sau_vat)}</td>
      <td class="wrap">${esc(r.ghi_chu)}</td>
      <td class="muted">${esc(r.nguoi_cap_nhat || '')}</td>
      ${canEdit() ? `<td class="row-actions"><button data-redit="${r.id}">Sửa</button><button class="danger" data-rdel="${r.id}">Xóa</button></td>` : ''}
    </tr>`;
}

function hdGroupsHtml(rows) {
  return hdGroups(rows).map((g, gi) => {
    const n = gi + 1;
    const members = [g.head, ...g.pls].filter(Boolean);
    const closed = hdCollapsed.has(g.key);
    const toggle = g.pls.length
      ? `<button class="grp-toggle" data-grp="${esc(g.key)}" title="${closed ? 'Mở' : 'Thu gọn'} phụ lục">${closed ? '▸' : '▾'}</button>`
      : '<span class="grp-toggle-sp"></span>';
    let html = '';
    if (g.head) html += hdRowHtml(g.head, n, { toggle });
    else html += `<tr class="hd-head hd-orphan"><td class="num muted">${n}</td><td colspan="${canEdit() ? 9 : 8}">${toggle}<b>${esc(g.so_ma)}</b> <span class="st st-tam-tinh">Chưa có HĐ gốc</span></td></tr>`;
    if (!closed) g.pls.forEach((r, i) => { html += hdRowHtml(r, `${n}.${i + 1}`, { child: true }); });
    if (g.pls.length) {
      const sum = (f) => members.reduce((s, r) => s + r[f], 0);
      const tt = members.some((r) => r.tam_tinh);
      html += `
        <tr class="hd-sub">
          <td></td>
          <td colspan="2">Cộng ${esc(g.so_ma)} <span class="muted small">(${g.head ? 'HĐ + ' : ''}${g.pls.length} PL)</span>${tt ? ' <span class="st st-tam-tinh">Có tạm tính</span>' : ''}</td>
          <td class="num">${money(sum('gia_tri'))}</td><td></td>
          <td class="num">${money(sum('tien_vat'))}</td>
          <td class="num">${money(sum('sau_vat'))}</td>
          <td colspan="${canEdit() ? 3 : 2}"></td>
        </tr>`;
    }
    return html;
  }).join('');
}

async function saveRevenue(f) {
  const msgEl = $('.msg', f);
  const id = f.elements.id.value;
  const ngay = dmyToIso(f.elements.ngay.value);
  if (ngay === null) return showMsg(msgEl, 'Ngày không hợp lệ, nhập theo dạng dd/mm/yyyy', 'err');
  const body = {
    loai: f.dataset.loai,
    ...(f.elements.ma_loai
      ? { ma_loai: f.elements.ma_loai.value, so_ma: f.elements.so_ma.value }
      : { so_hieu: f.elements.so_hieu.value }),
    ngay,
    gia_tri: parseMoney(f.elements.gia_tri.value),
    vat: f.elements.vat.value,
    ghi_chu: f.elements.ghi_chu.value,
  };
  if (f.elements.hd_id) {
    if (!f.elements.hd_id.value) return showMsg(msgEl, 'Chọn Số HĐ từ danh sách gợi ý (nhập HĐ ở mục 1 trước nếu chưa có)', 'err');
    body.hd_id = f.elements.hd_id.value;
  }
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
  const { redit, rdel, grp } = e.target.dataset;
  if (grp !== undefined) {
    hdCollapsed.has(grp) ? hdCollapsed.delete(grp) : hdCollapsed.add(grp);
    return renderRevenue();
  }
  if (redit) {
    const r = revData.items.find((x) => x.id === Number(redit));
    const f = $(`.rev-form[data-loai="${r.loai}"]`);
    f.elements.id.value = r.id;
    if (f.elements.ma_loai) {
      fillMaLoaiOptions(f, r.ma_loai);
      f.elements.ma_loai.value = r.ma_loai;
      f.elements.so_ma.value = r.so_ma || '';
      updateSoPreview(f);
    } else {
      f.elements.so_hieu.value = r.so_hieu;
    }
    f.elements.ngay.value = isoToDmy(r.ngay);
    f.elements.gia_tri.value = money(r.gia_tri);
    f.elements.vat.value = r.vat;
    f.elements.ghi_chu.value = r.ghi_chu || '';
    if (f._hdAc) f._hdAc.set(r.hd_id);
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

// ---------------------------------------------------------------------
// 3. GIÁ TRỊ TIỀN VỀ – theo từng HĐ, bảng sửa trực tiếp, chèn dòng
// ---------------------------------------------------------------------
const TV_ORDER = { tam_ung: 0, dot: 1, quyet_toan: 2 };
const tvLabel = (r) => (r.loai === 'dot' ? 'TT Đợt' : r.loai === 'tam_ung' ? 'Tạm ứng' : 'Quyết toán');
let tvDrafts = null;   // dòng chưa lưu: [{key, loai, dot, hd_id}]
let tvEdits = {};      // nội dung đang sửa chưa lưu: key -> {so_tien, ngay, ghi_chu, dot, hd_id}
let tvSeq = 0;

function tienVeCardHtml() {
  return `
    <div class="card" id="tv-card">
      <div class="toolbar tv-head">
        <h2>3. Giá trị tiền về</h2>
        <div class="tv-total">Tổng: <b id="tv-total">0</b></div>
      </div>
      <div class="table-wrap">
        <table class="tv-table">
          <thead><tr>
            <th class="num">#</th><th>Số HĐ</th><th>Nội dung</th><th class="num">Giá trị tiền về</th><th>Ngày (dd/mm/yyyy)</th>
            <th>Ghi chú</th><th>Người cập nhật</th>${canEdit() ? '<th></th>' : ''}
          </tr></thead>
          <tbody id="tv-body"></tbody>
          <tfoot id="tv-foot"></tfoot>
        </table>
      </div>
      ${canEdit() ? `
      <div class="tv-tools">
        <label class="tv-hd-pick">Chèn vào HĐ <select id="tv-hd-pick"></select></label>
        <button type="button" data-tvadd="tam_ung">+ Tạm ứng</button>
        <button type="button" data-tvadd="dot">+ Chèn đợt thanh toán</button>
        <button type="button" data-tvadd="quyet_toan" id="tv-add-qt">+ Quyết toán</button>
        <span class="spacer"></span>
        <button type="button" class="primary" id="tv-save-all" hidden>Lưu tất cả (<span id="tv-dirty">0</span>)</button>
      </div>
      <div class="msg" id="tv-msg" role="alert"></div>` : ''}
    </div>`;
}

// Danh sách hợp đồng gốc (HĐ) theo thứ tự ở mục 1
function tvHeads() {
  return hdGroups((revData?.items || []).filter((r) => r.loai === 'hd')).filter((g) => g.head).map((g) => g.head);
}
const tvPickHd = () => Number($('#tv-hd-pick')?.value) || tvHeads()[0]?.id || null;

// Giá trị đang hiển thị của 1 dòng (ưu tiên nội dung đang sửa)
function tvVal(r) {
  const e = tvEdits[r.key] || {};
  return {
    so_tien: e.so_tien ?? (r.id ? money(r.so_tien) : ''),
    ngay: e.ngay ?? isoToDmy(r.ngay),
    ghi_chu: e.ghi_chu ?? (r.ghi_chu || ''),
    dot: e.dot ?? (r.dot ?? ''),
    hd_id: e.hd_id ?? (r.hd_id ?? ''),
  };
}
const tvDirty = (r) => !r.id || Boolean(tvEdits[r.key]);

// Dòng hiển thị = dòng đã lưu + dòng nháp; nhóm theo HĐ (thứ tự mục 1), trong nhóm: Tạm ứng → Đợt → Quyết toán
function tvRows() {
  const heads = tvHeads();
  const saved = revData.tien_ve.map((r) => ({ ...r, key: 'id' + r.id }));
  if (tvDrafts === null && (saved.length || !canEdit() || heads.length)) {
    // Công trình chưa có dữ liệu: gợi ý sẵn mẫu Tạm ứng / TT Đợt 1 / Quyết toán cho HĐ đầu tiên
    const hd_id = heads[0]?.id;
    tvDrafts = saved.length || !canEdit() ? [] : [
      { key: 'd' + ++tvSeq, loai: 'tam_ung', hd_id },
      { key: 'd' + ++tvSeq, loai: 'dot', dot: 1, hd_id },
      { key: 'd' + ++tvSeq, loai: 'quyet_toan', hd_id },
    ];
  }
  const order = new Map(heads.map((h, i) => [h.id, i]));
  const gOrd = (r) => (r.hd_id && order.has(r.hd_id) ? order.get(r.hd_id) : 1e6);
  return [...saved, ...(tvDrafts || [])].sort((a, b) =>
    gOrd(a) - gOrd(b) ||
    TV_ORDER[a.loai] - TV_ORDER[b.loai] || (a.loai === 'dot' ? (a.dot || 0) - (b.dot || 0) : 0) ||
    String(a.ngay || '9999').localeCompare(String(b.ngay || '9999')) || (a.id || 1e9) - (b.id || 1e9));
}

function renderTienVe() {
  const heads = tvHeads();
  const rows = tvRows();
  const edit = canEdit();
  const cols = edit ? 8 : 7;
  const hdName = (id) => heads.find((h) => h.id === Number(id))?.so_hieu;
  $('#tv-total').textContent = money(revData.tong_tien_ve.tong);

  const hdSelect = (cur) => `<select class="tv-in tv-hd" data-f="hd_id">
      ${cur && hdName(cur) ? '' : '<option value="">— Chọn HĐ —</option>'}
      ${heads.map((h) => `<option value="${h.id}" ${Number(cur) === h.id ? 'selected' : ''}>${esc(h.so_hieu)}</option>`).join('')}
    </select>`;

  const rowHtml = (r, i) => {
    const v = tvVal(r);
    const label = r.loai === 'dot'
      ? (edit ? `TT Đợt <input class="tv-dot" data-f="dot" type="number" min="1" max="999" step="1" value="${esc(v.dot)}">` : `TT Đợt ${esc(r.dot)}`)
      : tvLabel(r);
    if (!edit) {
      return `<tr><td class="num muted">${i}</td>
        <td>${r.hd_so_hieu ? `<span class="st hd-tag">${esc(r.hd_so_hieu)}</span>` : '<span class="st st-tam-tinh">Chưa chọn HĐ</span>'}</td>
        <td><b>${label}</b></td><td class="num strong">${money(r.so_tien)}</td>
        <td>${isoToDmy(r.ngay)}</td><td class="wrap">${esc(r.ghi_chu)}</td><td class="muted">${esc(r.nguoi_cap_nhat || '')}</td></tr>`;
    }
    const cls = !r.id ? 'tv-draft' : tvEdits[r.key] ? 'tv-dirty' : '';
    return `<tr class="${cls}" data-key="${r.key}">
      <td class="num muted">${i}</td>
      <td>${hdSelect(v.hd_id)}</td>
      <td><b>${label}</b>${!r.id ? ' <span class="st st-tam-tinh">Chưa lưu</span>' : ''}</td>
      <td class="num"><input class="tv-in money num" data-f="so_tien" value="${esc(v.so_tien)}" placeholder="Nhập giá trị"></td>
      <td><input class="tv-in date-dmy" data-f="ngay" value="${esc(v.ngay)}"></td>
      <td><input class="tv-in" data-f="ghi_chu" maxlength="500" value="${esc(v.ghi_chu)}"></td>
      <td class="muted">${esc(r.nguoi_cap_nhat || '')}</td>
      <td class="row-actions">
        <button class="primary sm" data-tvsave="${r.key}" ${tvDirty(r) ? '' : 'hidden'}>Lưu</button>
        <button class="danger sm" data-tvdel="${r.key}">${r.id ? 'Xóa' : 'Bỏ'}</button>
      </td>
    </tr>`;
  };

  // Nhóm theo HĐ (theo HĐ đã lưu của dòng) + dòng cộng tiền về từng HĐ
  const groups = [];
  for (const r of rows) {
    const k = r.hd_id && hdName(r.hd_id) ? r.hd_id : 0;
    let g = groups[groups.length - 1];
    if (!g || g.k !== k) groups.push(g = { k, rows: [] });
    g.rows.push(r);
  }
  let i = 0;
  $('#tv-body').innerHTML = rows.length ? groups.map((g) => {
    const sum = g.rows.filter((r) => r.id).reduce((s, r) => s + r.so_tien, 0);
    const name = g.k ? hdName(g.k) : 'Chưa chọn HĐ';
    return g.rows.map((r) => rowHtml(r, ++i)).join('') + `
      <tr class="tv-sub ${g.k ? '' : 'tv-sub-warn'}"><td></td>
        <td colspan="2">Cộng tiền về ${esc(name)}</td>
        <td class="num">${money(sum)}</td><td colspan="${cols - 4}"></td></tr>`;
  }).join('') : `<tr><td colspan="${cols}" class="empty">${heads.length ? 'Chưa có dữ liệu' : 'Chưa có HĐ ở mục 1 – hãy nhập HĐ trước'}</td></tr>`;

  const t = revData.tong_tien_ve;
  $('#tv-foot').innerHTML = `<tr><td></td><td colspan="2">TỔNG TIỀN VỀ</td><td class="num">${money(t.tong)}</td><td colspan="${cols - 4}"></td></tr>`;

  if (edit) {
    $$('#tv-body input.money').forEach(attachMoneyInput);
    $$('#tv-body input.date-dmy').forEach(attachDateInput);
    // Ô chọn HĐ cho các nút chèn dòng
    const pick = $('#tv-hd-pick');
    const keep = Number(pick.value);
    pick.innerHTML = heads.map((h) => `<option value="${h.id}">${esc(h.so_hieu)}</option>`).join('');
    if (heads.some((h) => h.id === keep)) pick.value = keep;
    const none = !heads.length;
    pick.disabled = none;
    $$('#tv-card [data-tvadd]').forEach((b) => (b.disabled = none));
    updateTvButtons();
    updateTvSaveAll();
  }
}

// Mỗi HĐ chỉ 1 dòng Quyết toán
function updateTvButtons() {
  const hd = tvPickHd();
  const hasQt = tvRows().some((r) => r.loai === 'quyet_toan' && Number(tvVal(r).hd_id) === hd);
  const btn = $('#tv-add-qt');
  btn.disabled = !hd || hasQt;
  btn.title = hasQt ? 'HĐ này đã có dòng Quyết toán' : '';
}

function updateTvSaveAll() {
  const n = tvRows().filter((r) => tvDirty(r) && (r.id || tvEdits[r.key])).length;
  $('#tv-dirty').textContent = n;
  $('#tv-save-all').hidden = n === 0;
}

function tvFind(key) { return tvRows().find((r) => r.key === key); }

// Lưu 1 dòng; trả về true nếu thành công
async function tvSave(key, { silent = false } = {}) {
  const r = tvFind(key);
  if (!r) return false;
  const v = tvVal(r);
  const msg = $('#tv-msg');
  const label = r.loai === 'dot' ? `TT Đợt ${v.dot}` : tvLabel(r);
  const ngay = dmyToIso(v.ngay);
  const so = parseMoney(v.so_tien);
  if (!v.hd_id) { showMsg(msg, `${label}: chưa chọn Số HĐ`, 'err'); return false; }
  if (!so || so === '-') { showMsg(msg, `${label}: chưa nhập giá trị`, 'err'); return false; }
  if (ngay === null) { showMsg(msg, `${label}: ngày không hợp lệ, nhập dd/mm/yyyy`, 'err'); return false; }
  const body = { loai: r.loai, dot: r.loai === 'dot' ? v.dot : null, so_tien: so, ngay, ghi_chu: v.ghi_chu, hd_id: v.hd_id };
  try {
    await api(r.id ? `/api/tien-ve/${r.id}` : `/api/du-an/${revProjectId}/tien-ve`,
      { method: r.id ? 'PUT' : 'POST', body: JSON.stringify(body) });
    delete tvEdits[key];
    if (!r.id) tvDrafts = tvDrafts.filter((d) => d.key !== key);
    if (!silent) showMsg(msg, `Đã lưu: ${label}`);
    return true;
  } catch (err) {
    showMsg(msg, `${label}: ${err.message}`, 'err');
    return false;
  }
}

async function tvReload() {
  revData = await api(`/api/du-an/${revProjectId}/doanh-thu`);
  renderRevenue();
}

function bindTienVe() {
  const card = $('#tv-card');
  if (!canEdit()) return;
  $('#tv-hd-pick').addEventListener('change', updateTvButtons);
  // Ghi nhận nội dung đang sửa
  card.addEventListener('input', (e) => {
    const tr = e.target.closest('tr[data-key]');
    if (!tr || !e.target.dataset.f) return;
    const key = tr.dataset.key;
    tvEdits[key] = { ...tvVal(tvFind(key)), ...(tvEdits[key] || {}), [e.target.dataset.f]: e.target.value };
    if (!tr.classList.contains('tv-draft')) tr.classList.add('tv-dirty');
    $(`[data-tvsave="${key}"]`, tr).hidden = false;
    updateTvSaveAll();
    if (e.target.dataset.f === 'hd_id') updateTvButtons();
  });
  // Enter = lưu dòng
  card.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-key]');
    if (e.key === 'Enter' && tr) { e.preventDefault(); $(`[data-tvsave="${tr.dataset.key}"]`, tr).click(); }
  });
  card.addEventListener('click', async (e) => {
    const { tvsave, tvdel, tvadd } = e.target.dataset;
    if (tvsave) {
      e.target.disabled = true;
      if (await tvSave(tvsave)) await tvReload();
      else e.target.disabled = false;
    }
    if (tvdel) {
      const r = tvFind(tvdel);
      if (!r) return;
      if (!r.id) {
        tvDrafts = tvDrafts.filter((d) => d.key !== tvdel);
        delete tvEdits[tvdel];
        return renderTienVe();
      }
      const label = r.loai === 'dot' ? `TT Đợt ${r.dot}` : tvLabel(r);
      if (!confirm(`Xóa dòng "${label}" của ${r.hd_so_hieu || 'chưa chọn HĐ'} (${money(r.so_tien)})?`)) return;
      try {
        await api(`/api/tien-ve/${r.id}`, { method: 'DELETE' });
        delete tvEdits[tvdel];
        showMsg($('#tv-msg'), `Đã xóa: ${label}`);
        await tvReload();
      } catch (err) { showMsg($('#tv-msg'), err.message, 'err'); }
    }
    if (tvadd) {
      const hd_id = tvPickHd();
      if (!hd_id) return;
      const rows = tvRows().filter((r) => Number(tvVal(r).hd_id) === hd_id);
      const d = { key: 'd' + ++tvSeq, loai: tvadd, hd_id };
      if (tvadd === 'dot') d.dot = Math.max(0, ...rows.filter((r) => r.loai === 'dot').map((r) => Number(tvVal(r).dot) || 0)) + 1;
      tvDrafts = tvDrafts || [];
      tvDrafts.push(d);
      renderTienVe();
      $(`tr[data-key="${d.key}"] input[data-f="so_tien"]`)?.focus();
    }
  });
  $('#tv-save-all').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const keys = tvRows().filter((r) => tvDirty(r) && (r.id || tvEdits[r.key])).map((r) => r.key);
    let okN = 0;
    for (const k of keys) if (await tvSave(k, { silent: true })) okN++;
    await tvReload();
    if (okN === keys.length) showMsg($('#tv-msg'), `Đã lưu ${okN} dòng`);
    e.target.disabled = false;
  });
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

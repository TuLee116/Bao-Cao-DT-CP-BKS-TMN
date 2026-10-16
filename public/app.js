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
const loaders = { projects: loadProjects, revenue: loadRevenueTab, cost: loadCostTab, users: loadUsers, settings: loadSettings, profile: async () => {} };

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
        <label>Số mã HĐ *<input name="so_ma" maxlength="120" placeholder="Số mới: gõ · Số đã có: nhấp đúp" title="Số HĐ mới: gõ trực tiếp. Số HĐ đã có: nhấp đúp (hoặc phím ↓) để chọn, hệ thống tự chọn PL kế tiếp"><span class="calc-note so-preview"></span></label>` : `
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
      attachQuickPicker(f.elements.so_ma, soMaOptions, (o) => pickExistingSoMa(f, o.value), 'Chưa có số HĐ nào – hãy gõ số mới');
      f.elements.ma_loai.addEventListener('change', () => { f._manualLoai = true; fillMaLoaiOptions(f); updateSoPreview(f); });
      f.elements.so_ma.addEventListener('input', () => syncMaLoai(f));
    }
    const update = () => updateRevPreview(f);
    f.elements.gia_tri.addEventListener('input', update);
    f.elements.vat.addEventListener('input', update);
    f.addEventListener('submit', (e) => { e.preventDefault(); saveRevenue(f); });
    $('.rev-cancel', f).addEventListener('click', () => resetRevForm(f));
  });
  wrap.addEventListener('click', onRevTableClick);
  // Nhấp đúp vào Số mã trong bảng mục 1 -> điền sẵn form với PL kế tiếp
  wrap.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.so-ma-pick');
    const f = $('.rev-form[data-loai="hd"]');
    if (!el || !f) return;
    window.getSelection?.().removeAllRanges();
    resetRevForm(f);
    pickExistingSoMa(f, el.dataset.soma);
    showMsg($('.msg', f), `Thêm ${f.elements.ma_loai.value} cho ${el.dataset.soma} – nhập giá trị rồi bấm Thêm dòng`);
    f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
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

// Ô chọn Loại: HĐ, PL01, PL02...; "(đã có)" tính theo Số mã đang nhập
function hdRows() { return (revData?.items || []).filter((r) => r.loai === 'hd'); }
function fillMaLoaiOptions(f, keep) {
  const cur = keep ?? f.elements.ma_loai.value;
  const so = normVn(f.elements.so_ma.value);
  const same = so ? hdRows().filter((r) => normVn(r.so_ma) === so && r.id !== Number(f.elements.id.value)) : [];
  const plNum = (l) => (String(l || '').startsWith('PL') ? Number(l.slice(2)) : 0);
  const n = Math.max(10, Math.max(0, ...same.map((r) => plNum(r.ma_loai)), plNum(cur)) + 5);
  const used = new Set(same.map((r) => r.ma_loai));
  const opts = ['HĐ', ...Array.from({ length: n }, (_, i) => 'PL' + String(i + 1).padStart(2, '0'))];
  f.elements.ma_loai.innerHTML = opts.map((o) => `<option value="${o}">${o}${used.has(o) ? ' (đã có)' : ''}</option>`).join('');
  if (cur) f.elements.ma_loai.value = cur;
}
// Loại tự theo Số mã: số mới -> HĐ; số đã có -> PL kế tiếp (trừ khi người dùng đã tự chọn Loại)
function syncMaLoai(f) {
  if (f.elements.id.value) return updateSoPreview(f);
  const so = f.elements.so_ma.value.trim();
  const auto = so ? nextPlFor(so) : 'HĐ';
  fillMaLoaiOptions(f, f._manualLoai ? f.elements.ma_loai.value : auto);
  updateSoPreview(f);
}
// Danh sách Số mã HĐ đã có (để nhấp đúp chọn lại, tránh gõ sai)
function soMaOptions() {
  return hdGroups(hdRows()).map((g) => {
    const tong = [g.head, ...g.pls].filter(Boolean).reduce((s, r) => s + r.sau_vat, 0);
    const pls = g.pls.map((r) => r.ma_loai).join(', ');
    return {
      value: g.so_ma,
      label: g.so_ma,
      sub: `${g.head ? 'Có HĐ' : 'Chưa có HĐ gốc'}${pls ? ' · ' + pls : ''} · Tổng ${money(tong)} đ sau VAT · Tiếp theo: ${nextPlFor(g.so_ma)}`,
    };
  });
}
// PL kế tiếp của một Số mã: chưa có HĐ gốc -> HĐ; có rồi -> PL lớn nhất + 1
function nextPlFor(soMa) {
  const rows = hdRows().filter((r) => normVn(r.so_ma) === normVn(soMa));
  if (!rows.some((r) => r.ma_loai === 'HĐ')) return 'HĐ';
  const maxPl = Math.max(0, ...rows.map((r) => (r.ma_loai || '').startsWith('PL') ? Number(r.ma_loai.slice(2)) : 0));
  return 'PL' + String(maxPl + 1).padStart(2, '0');
}
function pickExistingSoMa(f, soMa) {
  f._manualLoai = false;
  f.elements.so_ma.value = soMa;
  syncMaLoai(f);
  f.elements.gia_tri.focus({ preventScroll: true });
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
    f._manualLoai = false;
    syncMaLoai(f);
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
  if (fHd && !fHd.elements.id.value) syncMaLoai(fHd);
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
      <td class="${child ? 'indent' : ''}">${toggle}${child ? '<span class="tree">└</span>' : ''}<span class="kind-tag ${r.ma_loai === 'HĐ' ? 'kind-hd' : ''}">${esc(r.ma_loai || '')}</span> ${canEdit() ? `<b class="so-ma-pick" data-soma="${esc(r.so_ma || '')}" title="Nhấp đúp để thêm phụ lục cho ${esc(r.so_ma || '')}">${esc(r.so_ma || r.so_hieu)}</b>` : `<b>${esc(r.so_ma || r.so_hieu)}</b>`}</td>
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
    else html += `<tr class="hd-head hd-orphan"><td class="num muted">${n}</td><td colspan="${canEdit() ? 9 : 8}">${toggle}${canEdit() ? `<b class="so-ma-pick" data-soma="${esc(g.so_ma)}" title="Nhấp đúp để thêm dòng cho ${esc(g.so_ma)}">${esc(g.so_ma)}</b>` : `<b>${esc(g.so_ma)}</b>`} <span class="st st-tam-tinh">Chưa có HĐ gốc</span></td></tr>`;
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
      f._manualLoai = true;
      f.elements.so_ma.value = r.so_ma || '';
      fillMaLoaiOptions(f, r.ma_loai);
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
    if (!r) return;
    let body;
    if (r.loai === 'hd') {
      // Xóa Số HĐ/PL: bắt buộc Passcode; HĐ có dữ liệu kèm theo -> liệt kê và xóa toàn bộ
      let im;
      try { im = await api(`/api/doanh-thu/${r.id}/impact`); } catch (err) { return alert(err.message); }
      const cascade = r.ma_loai === 'HĐ' && (im.pls.length || im.qt.n || im.tv.n);
      const lines = [`${r.so_hieu}: ${money(im.sau_vat)} đ sau VAT`];
      if (cascade) {
        if (im.pls.length) lines.push(`${im.pls.length} phụ lục: ${im.pls.map((p) => `${p.so_hieu} (${money(p.sau_vat)} đ)`).join(', ')}`);
        if (im.qt.n) lines.push(`${im.qt.n} dòng Hoàn thành/Quyết toán: ${money(im.qt.sau_vat)} đ`);
        if (im.tv.n) lines.push(`${im.tv.n} dòng Tiền về: ${money(im.tv.so_tien)} đ`);
      }
      const pc = await askPasscode(
        cascade ? `Xóa toàn bộ hợp đồng "${r.so_hieu}"?` : `Xóa "${r.so_hieu}"?`,
        (cascade ? 'Sẽ xóa tất cả dữ liệu sau:\n• ' : '') + lines.join('\n• ') + '\nThao tác này không hoàn tác được.');
      if (pc === null) return;
      body = JSON.stringify({ passcode: pc, cascade: Boolean(cascade) });
    } else if (!confirm(`Xóa dòng "${r.so_hieu}"?`)) return;
    try {
      await api(`/api/doanh-thu/${rdel}`, { method: 'DELETE', body });
      tvDrafts = null;
      tvEdits = {};
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
const tvOpen = new Set();  // nhóm HĐ đang mở (mặc định thu gọn)

function tienVeCardHtml() {
  return `
    <div class="card" id="tv-card">
      <div class="toolbar tv-head">
        <h2>3. Giá trị tiền về</h2>
        <button type="button" class="sm" id="tv-toggle-all">Mở tất cả</button>
        <div class="tv-total">Tổng: <b id="tv-total">0</b></div>
      </div>
      <div class="table-wrap">
        <table class="tv-table">
          <thead><tr>
            <th class="num">#</th><th>Nội dung</th><th class="num">Giá trị tiền về</th><th>Ngày (dd/mm/yyyy)</th>
            <th>Ghi chú</th><th>Người cập nhật</th>${canEdit() ? '<th></th>' : ''}
          </tr></thead>
          <tbody id="tv-body"></tbody>
          <tfoot id="tv-foot"></tfoot>
        </table>
      </div>
      ${canEdit() ? `
      <div class="tv-tools">
        <label class="tv-hd-pick">Thêm cho HĐ <select id="tv-hd-pick"></select></label>
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
  const cols = edit ? 7 : 6;
  const hdName = (id) => heads.find((h) => h.id === Number(id))?.so_hieu;
  $('#tv-total').textContent = money(revData.tong_tien_ve.tong);

  // Gom nhóm theo HĐ (dòng chưa chọn HĐ / HĐ không còn -> nhóm "Chưa chọn HĐ")
  const groups = [];
  for (const r of rows) {
    const k = r.hd_id && hdName(r.hd_id) ? Number(r.hd_id) : 0;
    let g = groups[groups.length - 1];
    if (!g || g.k !== k) groups.push(g = { k, rows: [] });
    g.rows.push(r);
  }

  const childHtml = (r, stt, orphan) => {
    const v = tvVal(r);
    const label = r.loai === 'dot'
      ? (edit ? `TT Đợt <input class="tv-dot" data-f="dot" type="number" min="1" max="999" step="1" value="${esc(v.dot)}">` : `TT Đợt ${esc(r.dot)}`)
      : tvLabel(r);
    const hdSel = orphan && edit ? `<select class="tv-in tv-hd" data-f="hd_id">
        <option value="">— Chọn HĐ —</option>
        ${heads.map((h) => `<option value="${h.id}" ${Number(v.hd_id) === h.id ? 'selected' : ''}>${esc(h.so_hieu)}</option>`).join('')}
      </select>` : '';
    if (!edit) {
      return `<tr class="tv-child"><td class="num muted">${stt}</td>
        <td class="indent"><span class="tree">└</span><b>${label}</b></td><td class="num">${money(r.so_tien)}</td>
        <td>${isoToDmy(r.ngay)}</td><td class="wrap">${esc(r.ghi_chu)}</td><td class="muted">${esc(r.nguoi_cap_nhat || '')}</td></tr>`;
    }
    const cls = !r.id ? 'tv-draft' : tvEdits[r.key] ? 'tv-dirty' : '';
    return `<tr class="tv-child ${cls}" data-key="${r.key}">
      <td class="num muted">${stt}</td>
      <td class="indent"><span class="tree">└</span>${hdSel}<b>${label}</b>${!r.id ? ' <span class="st st-tam-tinh">Chưa lưu</span>' : ''}</td>
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

  $('#tv-body').innerHTML = groups.length ? groups.map((g, gi) => {
    const n = gi + 1;
    const saved = g.rows.filter((r) => r.id);
    const sum = (f) => saved.filter(f).reduce((s, r) => s + r.so_tien, 0);
    const orphan = g.k === 0;
    // Nhóm đang nhập dở hoặc "Chưa chọn HĐ" luôn mở
    const busy = g.rows.some((r) => !r.id || tvEdits[r.key]);
    const open = orphan || busy || tvOpen.has(g.k);
    const hasQt = g.rows.some((r) => r.loai === 'quyet_toan');
    const parts = [['Tạm ứng', (r) => r.loai === 'tam_ung'], ['Thanh toán', (r) => r.loai === 'dot'], ['Quyết toán', (r) => r.loai === 'quyet_toan']]
      .filter(([, f]) => saved.some(f)).map(([t, f]) => `${t} ${money(sum(f))}`).join(' · ');
    const head = `<tr class="tv-head-row ${orphan ? 'tv-sub-warn' : ''}">
      <td class="num">${n}</td>
      <td>${orphan ? '' : `<button class="grp-toggle" data-tvgrp="${g.k}" title="${open ? 'Thu gọn' : 'Mở chi tiết'}">${open ? '▾' : '▸'}</button>`}
        ${orphan ? '<span class="st st-tam-tinh">Chưa chọn HĐ</span>' : `<span class="kind-tag kind-hd">HĐ</span> <b>${esc(hdName(g.k).replace(/^HĐ\s+/, ''))}</b>`}
        <span class="muted small">(${g.rows.length} dòng)</span></td>
      <td class="num tv-head-sum">${money(sum(() => true))}</td>
      <td colspan="2" class="muted small">${parts}</td>
      <td colspan="${cols - 5}" class="row-actions">${edit && !orphan ? `
        <button class="sm" data-tvadd="tam_ung" data-hd="${g.k}" title="Thêm Tạm ứng">+ TƯ</button>
        <button class="sm" data-tvadd="dot" data-hd="${g.k}" title="Chèn đợt thanh toán">+ Đợt</button>
        <button class="sm" data-tvadd="quyet_toan" data-hd="${g.k}" ${hasQt ? 'disabled title="HĐ đã có Quyết toán"' : 'title="Thêm Quyết toán"'}>+ QT</button>` : ''}</td>
    </tr>`;
    return head + (open ? g.rows.map((r, i) => childHtml(r, `${n}.${i + 1}`, orphan)).join('') : '');
  }).join('') : `<tr><td colspan="${cols}" class="empty">${heads.length ? 'Chưa có dữ liệu' : 'Chưa có HĐ ở mục 1 – hãy nhập HĐ trước'}</td></tr>`;

  const t = revData.tong_tien_ve;
  $('#tv-foot').innerHTML = `<tr><td></td><td>TỔNG TIỀN VỀ</td><td class="num">${money(t.tong)}</td><td colspan="${cols - 3}"></td></tr>`;
  const anyClosed = groups.some((g) => g.k && !tvOpen.has(g.k));
  $('#tv-toggle-all').textContent = anyClosed ? 'Mở tất cả' : 'Thu gọn tất cả';
  $('#tv-toggle-all').hidden = !groups.some((g) => g.k);

  if (edit) {
    $$('#tv-body input.money').forEach(attachMoneyInput);
    $$('#tv-body input.date-dmy').forEach(attachDateInput);
    // Ô chọn HĐ để thêm dòng (dùng khi HĐ chưa có dòng tiền về nào)
    const pick = $('#tv-hd-pick');
    const keep = Number(pick.value);
    pick.innerHTML = heads.map((h) => `<option value="${h.id}">${esc(h.so_hieu)}</option>`).join('');
    if (heads.some((h) => h.id === keep)) pick.value = keep;
    const none = !heads.length;
    pick.disabled = none;
    $$('.tv-tools [data-tvadd]').forEach((b) => (b.disabled = none));
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
    tvOpen.add(Number(v.hd_id));
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
    const { tvsave, tvdel, tvadd, tvgrp } = e.target.dataset;
    if (tvgrp !== undefined) {
      const k = Number(tvgrp);
      tvOpen.has(k) ? tvOpen.delete(k) : tvOpen.add(k);
      return renderTienVe();
    }
    if (e.target.id === 'tv-toggle-all') {
      const ks = [...new Set(tvRows().map((r) => Number(r.hd_id)).filter(Boolean))];
      const close = ks.every((k) => tvOpen.has(k));
      ks.forEach((k) => (close ? tvOpen.delete(k) : tvOpen.add(k)));
      return renderTienVe();
    }
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
      const hd_id = Number(e.target.dataset.hd) || tvPickHd();
      if (!hd_id) return;
      tvOpen.add(hd_id);
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
// CHI PHÍ theo công trình (dùng chung công trình đang chọn với tab Doanh thu)
// =====================================================================
let costData = null;
const costOpen = new Set();          // nhóm / hạng mục đang mở: 'thau_phu', 'vat_tu', 'vat_tu:chinh'...
const cForm = $('#c-form');
const NHOM = () => META.nhom_chi_phi || [];

async function loadCostTab() {
  projects = await api('/api/du-an');
  const sel = $('#c-project');
  $('#c-empty').hidden = projects.length > 0;
  $('#c-body').hidden = true;
  sel.hidden = !projects.length;
  if (!projects.length) return;
  if (!projects.some((p) => p.id === revProjectId)) revProjectId = projects[0].id;
  sel.innerHTML = projects.map((p) => `<option value="${p.id}">${esc(p.ma_du_an)} – ${esc(p.ten_du_an)}</option>`).join('');
  sel.value = revProjectId;
  if (cForm && !cForm.dataset.ready) initCostForm();
  await loadCost();
}

$('#c-project').addEventListener('change', (e) => {
  revProjectId = Number(e.target.value);
  if (cForm) resetCostForm();
  loadCost().catch((err) => alert(err.message));
});

async function loadCost() {
  try { localStorage.setItem('revProject', revProjectId); } catch {}
  costData = await api(`/api/du-an/${revProjectId}/chi-phi`);
  const p = costData.du_an;
  $('#c-project-info').innerHTML = `Mã: <b>${esc(p.ma_du_an)}</b> · Chủ đầu tư: <b>${esc(p.chu_dau_tu || '—')}</b>`;
  $('#c-body').hidden = false;
  renderCost();
}

// ---------- Form nhập ----------
// Nhóm Thầu phụ (thêm mới) -> form tạo hợp đồng thầu phụ; các nhóm khác -> dòng chi phí
const costTpMode = () => cForm.elements.nhom.value === 'thau_phu' && !cForm.elements.id.value;
function setCostMode() {
  const tp = costTpMode();
  $$('.c-tp', cForm).forEach((el) => (el.hidden = !tp));
  $$('.c-gen', cForm).forEach((el) => (el.hidden = tp));
  if (tp) $('#c-sub-wrap').hidden = true;
  $('#c-dt-label').textContent = tp ? 'Nhà thầu phụ' : 'Đối tác / Nhà cung cấp';
  $('#c-ngay-label').textContent = tp ? 'Ngày ký HĐ' : 'Ngày';
  $('#c-gt-label').textContent = tp ? 'Giá trị HĐ (trước VAT) *' : 'Giá trị (trước VAT) *';
  $('button[type=submit]', cForm).textContent = cForm.elements.id.value ? 'Lưu thay đổi' : tp ? 'Tạo HĐ thầu phụ' : 'Thêm dòng';
}

function fillSubOptions(nhomCode, keep) {
  const n = NHOM().find((x) => x.code === nhomCode);
  const has = Boolean(n?.sub.length);
  $('#c-sub-wrap').hidden = !has;
  cForm.elements.nhom_con.innerHTML = has ? n.sub.map((s) => `<option value="${s.code}">${esc(s.ten)}</option>`).join('') : '';
  if (has && keep && n.sub.some((s) => s.code === keep)) cForm.elements.nhom_con.value = keep;
  setCostMode();
}

function updateCostPreview() {
  const raw = parseMoney(cForm.elements.gia_tri.value);
  const gt = raw && raw !== '-' ? Number(raw) : 0;
  const vs = cForm.elements.vat.value.trim();
  const vat = vs === '' ? 0 : Number(vs);
  const note = $('.vat-note', cForm);
  if (!Number.isInteger(vat) || vat < 0 || vat > 100) {
    cForm.elements.sau_vat.value = '—';
    note.textContent = 'VAT phải là số nguyên 0–100';
    note.className = 'calc-note vat-note err';
    return;
  }
  const tv = calcVat(gt, vat);
  cForm.elements.sau_vat.value = money(gt + tv);
  note.textContent = vat ? `Tiền VAT: ${money(tv)}` : 'Tạm tính (chưa có VAT)';
  note.className = 'calc-note vat-note' + (vat ? '' : ' warn');
}

function initCostForm() {
  cForm.dataset.ready = '1';
  cForm.elements.nhom.innerHTML = NHOM().map((n, i) => `<option value="${n.code}">${i + 1}. ${esc(n.ten)}</option>`).join('');
  fillSubOptions(cForm.elements.nhom.value);
  cForm.elements.nhom.addEventListener('change', () => fillSubOptions(cForm.elements.nhom.value));
  attachMoneyInput(cForm.elements.gia_tri);
  attachDateInput(cForm.elements.ngay);
  cForm.elements.gia_tri.addEventListener('input', updateCostPreview);
  cForm.elements.vat.addEventListener('input', updateCostPreview);
  cForm.addEventListener('submit', (e) => { e.preventDefault(); saveCost(); });
  attachQuickPicker(cForm.elements.so_tp,
    () => (costData?.thau_phu || []).map((c) => ({ value: c.id, label: c.so_ma, sub: `${c.doi_tac || '—'} · HĐ ${money(c.hd_sau_vat)} đ · Còn lại ${money(c.con_lai)} đ` })),
    (o) => openTp(o.value), 'Chưa có HĐ thầu phụ nào – hãy gõ số mới');
  $('#c-cancel').addEventListener('click', () => { resetCostForm(); showMsg($('#c-msg'), ''); });
  updateCostPreview();
}

function resetCostForm(nhom, sub) {
  const keepNhom = nhom || cForm.elements.nhom.value;
  const keepSub = sub || cForm.elements.nhom_con.value;
  cForm.reset();
  cForm.elements.id.value = '';
  cForm.elements.nhom.value = keepNhom;
  fillSubOptions(keepNhom, keepSub);
  $('#c-form-title').textContent = 'Thêm chi phí';
  setCostMode();
  updateCostPreview();
}

async function saveCost() {
  const msg = $('#c-msg');
  const id = cForm.elements.id.value;
  const ngay = dmyToIso(cForm.elements.ngay.value);
  if (ngay === null) return showMsg(msg, 'Ngày không hợp lệ, nhập theo dạng dd/mm/yyyy', 'err');
  const e = cForm.elements;
  if (costTpMode()) {
    // Tạo hợp đồng thầu phụ kèm dòng HĐ gốc
    try {
      const so = e.so_tp.value.trim();
      await api(`/api/du-an/${revProjectId}/thau-phu`, { method: 'POST', body: JSON.stringify({
        so_ma: so, doi_tac: e.doi_tac.value, ghi_chu: e.ghi_chu.value,
        hd: { ngay, gia_tri: parseMoney(e.gia_tri.value), vat: e.vat.value },
      }) });
      costOpen.add('thau_phu');
      resetCostForm('thau_phu');
      showMsg(msg, `Đã tạo HĐ thầu phụ ${so}. Nhấp đúp vào số HĐ ở bảng "1. Thầu phụ" để nhập PL, HT/QT, thanh toán.`);
      await loadCost();
    } catch (err) {
      showMsg(msg, err.message, 'err');
    }
    return;
  }
  const body = {
    nhom: e.nhom.value, nhom_con: e.nhom_con.value, noi_dung: e.noi_dung.value, doi_tac: e.doi_tac.value,
    so_ct: e.so_ct.value, ngay, gia_tri: parseMoney(e.gia_tri.value), vat: e.vat.value, ghi_chu: e.ghi_chu.value,
  };
  try {
    await api(id ? `/api/chi-phi/${id}` : `/api/du-an/${revProjectId}/chi-phi`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
    costOpen.add(body.nhom);
    if (body.nhom_con) costOpen.add(`${body.nhom}:${body.nhom_con}`);
    resetCostForm(body.nhom, body.nhom_con);
    showMsg(msg, id ? 'Đã cập nhật' : 'Đã thêm dòng');
    await loadCost();
  } catch (err) {
    showMsg(msg, err.message, 'err');
  }
}

// ---------- Bảng cây: Nhóm -> Hạng mục -> Chi tiết ----------
function renderCost() {
  const { items, tong } = costData;
  const edit = canEdit();
  const pct = (v) => (tong.sau_vat ? ((v / tong.sau_vat) * 100).toFixed(1) + '%' : '—');
  $('#c-k-sau').textContent = money(tong.sau_vat);
  $('#c-k-truoc').textContent = money(tong.gia_tri);
  $('#c-k-vat').textContent = money(tong.tien_vat);
  $('#c-k-sub').innerHTML = `${tong.so_dong} dòng${tong.tam_tinh ? ' · <span class="warn-text">có dòng tạm tính</span>' : ''}`;
  $('#c-total').textContent = money(tong.sau_vat);

  const sumCells = (t, cls = '') => `
      <td class="num ${cls}">${money(t.gia_tri)}</td><td></td>
      <td class="num ${cls}">${money(t.tien_vat)}</td>
      <td class="num ${cls}">${money(t.sau_vat)}</td>
      <td class="num">${pct(t.sau_vat)}</td>`;
  const toggle = (key, n) => (n ? `<button class="grp-toggle" data-cgrp="${key}">${costOpen.has(key) ? '▾' : '▸'}</button>` : '<span class="grp-toggle-sp"></span>');
  const addBtn = (nhom, sub) => (edit ? `<button class="sm" data-cadd="${nhom}" data-csub="${sub || ''}" title="Thêm chi phí vào mục này">+</button>` : '');
  const detail = (r, stt, indent) => `
    <tr class="c-row" title="${esc(r.nguoi_cap_nhat ? 'Cập nhật bởi ' + r.nguoi_cap_nhat : '')}">
      <td class="num muted">${stt}</td>
      <td class="indent-${indent}"><span class="tree">└</span>${esc(r.noi_dung)}</td>
      <td class="c-dt">${esc(r.doi_tac)}${r.so_ct ? `<div class="muted small">${esc(r.so_ct)}</div>` : ''}</td><td>${dmy(r.ngay)}</td>
      <td class="num">${money(r.gia_tri)}</td><td class="num">${vatBadge(r.vat)}</td>
      <td class="num">${money(r.tien_vat)}</td><td class="num strong">${money(r.sau_vat)}</td>
      <td class="num muted">${pct(r.sau_vat)}</td>
      <td class="c-note">${esc(r.ghi_chu)}</td>
      <td class="row-actions">${edit ? `<button class="sm" data-cedit="${r.id}">Sửa</button><button class="danger sm" data-cdel="${r.id}">Xóa</button>` : ''}</td>
    </tr>`;

  let html = '';
  NHOM().forEach((n, i) => {
    const g = tong.theo_nhom[n.code];
    const rows = items.filter((r) => r.nhom === n.code);
    const tps = n.code === 'thau_phu' ? costData.thau_phu : [];
    const open = costOpen.has(n.code);
    html += `<tr class="c-g1"><td class="num">${i + 1}</td>
      <td colspan="3">${toggle(n.code, rows.length || n.sub.length || tps.length)}<b>${esc(n.ten)}</b> <span class="muted small">(${tps.length ? tps.length + ' HĐ' + (rows.length ? ' + ' + rows.length + ' dòng' : '') : g.so_dong + ' dòng'})</span>${g.tam_tinh ? ' <span class="st st-tam-tinh">Có tạm tính</span>' : ''}</td>
      ${sumCells(g, 'strong')}<td></td><td class="row-actions">${addBtn(n.code, n.sub[0]?.code)}</td></tr>`;
    if (!open) return;
    tps.forEach((c, k) => {
      html += `<tr class="c-row">
        <td class="num muted">${i + 1}.${k + 1}</td>
        <td class="indent-1"><span class="tree">└</span><b class="tp-open" data-tp="${c.id}" title="Nhấp đúp để mở chi tiết">${esc(c.so_ma)}</b>${c.so_pl ? ` <span class="muted small">(+${c.so_pl} PL)</span>` : ''}</td>
        <td class="c-dt">${esc(c.doi_tac)}</td><td></td>
        <td class="num">${money(c.qt_gia_tri)}</td><td class="num muted small">HT/QT</td>
        <td class="num">${money(c.qt_tien_vat)}</td><td class="num strong">${money(c.qt_sau_vat)}</td>
        <td class="num muted">${pct(c.qt_sau_vat)}</td><td class="c-note">${esc(c.ghi_chu)}</td>
        <td class="row-actions"><button class="sm" data-tpopen="${c.id}">Chi tiết</button></td>
      </tr>`;
    });
    if (!n.sub.length) {
      rows.forEach((r, k) => { html += detail(r, `${i + 1}.${tps.length + k + 1}`, 1); });
      return;
    }
    n.sub.forEach((s, j) => {
      const key = `${n.code}:${s.code}`;
      const sr = rows.filter((r) => r.nhom_con === s.code);
      const st = g.sub[s.code];
      html += `<tr class="c-g2"><td class="num muted">${i + 1}.${j + 1}</td>
        <td colspan="3" class="indent-1">${toggle(key, sr.length)}${esc(s.ten)} <span class="muted small">(${st.so_dong} dòng)</span></td>
        ${sumCells(st)}<td></td><td class="row-actions">${addBtn(n.code, s.code)}</td></tr>`;
      if (costOpen.has(key)) sr.forEach((r, k) => { html += detail(r, `${i + 1}.${j + 1}.${k + 1}`, 2); });
    });
  });
  $('#c-tbody').innerHTML = html;
  renderTpCard();
  if (tpDlgId) renderTpDlg();
  $('#c-tfoot').innerHTML = `<tr><td></td><td colspan="3">TỔNG CHI PHÍ${tong.tam_tinh ? ' <span class="st st-tam-tinh">Có tạm tính</span>' : ''}</td>${sumCells(tong)}<td colspan="2"></td></tr>`;
  const keys = NHOM().flatMap((n) => [n.code, ...n.sub.map((s) => `${n.code}:${s.code}`)]);
  $('#c-toggle-all').textContent = keys.every((k) => costOpen.has(k)) ? 'Thu gọn tất cả' : 'Mở tất cả';
}

$('#tab-cost').addEventListener('dblclick', (e) => {
  const el = e.target.closest('.tp-open');
  if (el) { window.getSelection?.().removeAllRanges(); openTp(Number(el.dataset.tp)); }
});

$('#tab-cost').addEventListener('click', async (e) => {
  const { cgrp, cadd, csub, cedit, cdel, tpopen, tpdel } = e.target.dataset;
  if (tpopen) return openTp(Number(tpopen));
  if (tpdel) return deleteTp(Number(tpdel));
  if (cgrp) { costOpen.has(cgrp) ? costOpen.delete(cgrp) : costOpen.add(cgrp); return renderCost(); }
  if (e.target.id === 'c-toggle-all') {
    const keys = NHOM().flatMap((n) => [n.code, ...n.sub.map((s) => `${n.code}:${s.code}`)]);
    const close = keys.every((k) => costOpen.has(k));
    keys.forEach((k) => (close ? costOpen.delete(k) : costOpen.add(k)));
    return renderCost();
  }
  if (cadd) {
    costOpen.add(cadd);
    resetCostForm(cadd, csub);
    showMsg($('#c-msg'), `Thêm vào: ${NHOM().find((n) => n.code === cadd).ten}${csub ? ' › ' + NHOM().find((n) => n.code === cadd).sub.find((s) => s.code === csub).ten : ''}`);
    cForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    cForm.elements.noi_dung.focus({ preventScroll: true });
  }
  if (cedit) {
    const r = costData.items.find((x) => x.id === Number(cedit));
    if (!r) return;
    const el = cForm.elements;
    el.id.value = r.id;
    el.nhom.value = r.nhom;
    fillSubOptions(r.nhom, r.nhom_con);
    el.noi_dung.value = r.noi_dung; el.doi_tac.value = r.doi_tac || ''; el.so_ct.value = r.so_ct || '';
    el.ngay.value = isoToDmy(r.ngay); el.gia_tri.value = money(r.gia_tri); el.vat.value = r.vat; el.ghi_chu.value = r.ghi_chu || '';
    $('#c-form-title').textContent = 'Sửa chi phí';
    setCostMode();
    showMsg($('#c-msg'), 'Đang sửa: ' + r.noi_dung);
    updateCostPreview();
    cForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  if (cdel) {
    const r = costData.items.find((x) => x.id === Number(cdel));
    if (!r || !confirm(`Xóa chi phí "${r.noi_dung}" (${money(r.sau_vat)} đ)?`)) return;
    try {
      await api(`/api/chi-phi/${r.id}`, { method: 'DELETE' });
      await loadCost();
    } catch (err) { alert(err.message); }
  }
});

// ---------------------------------------------------------------------
// 1. THẦU PHỤ theo hợp đồng
// ---------------------------------------------------------------------
function renderTpCard() {
  const list = costData.thau_phu;
  const T = costData.tong_tp;
  const edit = canEdit();
  $('#tp-total').textContent = money(T.con_lai);
  $('#tp-tbody').innerHTML = list.length ? list.map((c, i) => `
    <tr>
      <td class="num muted">${i + 1}</td>
      <td><b class="tp-open so-ma-pick" data-tp="${c.id}" title="Nhấp đúp để mở bảng nhập chi tiết">${esc(c.so_ma)}</b>
        ${c.so_pl ? `<span class="muted small">(+${c.so_pl} PL)</span>` : ''}
        ${c.da_qt ? '<span class="st st-hoan-thanh">Đã QT</span>' : '<span class="st">Chưa QT</span>'}</td>
      <td class="c-dt">${esc(c.doi_tac)}</td>
      <td class="num">${money(c.hd_sau_vat)}</td>
      <td class="num">${money(c.qt_sau_vat)}</td>
      <td class="num">${money(c.da_tt)}</td>
      <td class="num strong ${c.con_lai < 0 ? 'neg' : ''}">${money(c.con_lai)}</td>
      <td class="c-note">${esc(c.ghi_chu)}</td>
      <td class="row-actions"><button class="sm" data-tpopen="${c.id}">Chi tiết</button>${edit ? `<button class="danger sm" data-tpdel="${c.id}">Xóa</button>` : ''}</td>
    </tr>`).join('') : `<tr><td colspan="9" class="empty">Chưa có hợp đồng thầu phụ. ${edit ? 'Chọn nhóm "1. Thầu phụ" ở form trên để tạo.' : ''}</td></tr>`;
  $('#tp-tfoot').innerHTML = `<tr><td></td><td colspan="2">TỔNG THẦU PHỤ (${T.so_hd} HĐ)</td>
    <td class="num">${money(T.hd_sau_vat)}</td><td class="num">${money(T.qt_sau_vat)}</td><td class="num">${money(T.da_tt)}</td>
    <td class="num ${T.con_lai < 0 ? 'neg' : ''}">${money(T.con_lai)}</td><td colspan="2"></td></tr>`;
}

async function deleteTp(id) {
  const c = costData.thau_phu.find((x) => x.id === id);
  if (!c) return;
  const pc = await askPasscode(`Xóa hợp đồng thầu phụ "${c.so_ma}"?`,
    `Sẽ xóa tất cả dữ liệu sau:\n• ${c.lines.length} dòng HĐ/PL – giá trị HĐ ${money(c.hd_sau_vat)} đ, HT/QT ${money(c.qt_sau_vat)} đ\n• ${c.pays.length} dòng thanh toán – ${money(c.da_tt)} đ\nThao tác này không hoàn tác được.`);
  if (pc === null) return;
  try {
    await api(`/api/thau-phu/${id}`, { method: 'DELETE', body: JSON.stringify({ passcode: pc }) });
    if (tpDlgId === id) closeTp();
    await loadCost();
  } catch (err) { alert(err.message); }
}

// ---------- Bảng nhập chi tiết 1 HĐ thầu phụ (hộp thoại) ----------
let tpDlgId = null;
let tpDrafts = { lines: [], pays: [] };
let tpSeq = 0;
const TT_LABEL = { tam_ung: 'Tạm ứng', dot: 'TT Đợt', quyet_toan: 'Quyết toán' };

function openTp(id) {
  if (!costData.thau_phu.some((c) => c.id === id)) return;
  tpDlgId = id;
  tpDrafts = { lines: [], pays: [] };
  let dlg = $('#tp-dlg');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'tp-dlg';
    dlg.className = 'tp-dlg';
    document.body.appendChild(dlg);
    dlg.addEventListener('click', onTpDlgClick);
    dlg.addEventListener('input', onTpDlgInput);
    dlg.addEventListener('keydown', (e) => {
      const tr = e.target.closest('tr[data-k]');
      if (e.key === 'Enter' && tr) { e.preventDefault(); $('[data-save]', tr)?.click(); }
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeTp(); });
  }
  renderTpDlg();
  if (!dlg.open) dlg.showModal();
}
function closeTp() {
  tpDlgId = null;
  const dlg = $('#tp-dlg');
  if (dlg?.open) dlg.close();
}

// Tính sau VAT ngay trên trình duyệt (cùng công thức máy chủ)
const tpCalc = (gt, vat) => { const g = Number(parseMoney(gt)) || 0; const v = Number(vat) || 0; return g + calcVat(g, v); };

function renderTpDlg() {
  const c = costData.thau_phu.find((x) => x.id === tpDlgId);
  const dlg = $('#tp-dlg');
  if (!c) return closeTp();
  const edit = canEdit();
  const inp = (name, val, attrs = '') => `<input data-f="${name}" value="${esc(val ?? '')}" ${attrs} ${edit ? '' : 'disabled'}>`;
  const nextPl = 'PL' + String(Math.max(0, ...c.lines.map((l) => (l.ma_loai === 'HĐ' ? 0 : Number(l.ma_loai.slice(2)))), ...tpDrafts.lines.map((d) => Number(d.ma_loai.slice(2)))) + 1).padStart(2, '0');

  const lineRow = (l, draft) => {
    const qtStr = l.gia_tri_qt === null || l.gia_tri_qt === undefined ? '' : money(l.gia_tri_qt);
    const gtStr = draft ? '' : money(l.gia_tri);
    const hdSau = draft ? 0 : l.sau_vat;
    const qtSau = draft ? 0 : l.qt_sau_vat;
    return `<tr data-k="${draft ? 'dl' + l.key : 'l' + l.id}" class="${draft ? 'tv-draft' : l.ma_loai === 'HĐ' ? 'tp-hd-row' : 'tp-pl-row'}">
      <td>${l.ma_loai === 'HĐ' ? '' : '<span class="tree">└</span>'}<span class="kind-tag ${l.ma_loai === 'HĐ' ? 'kind-hd' : ''}">${l.ma_loai}</span> <b>${esc(c.so_ma)}</b>${draft ? ' <span class="st st-tam-tinh">Chưa lưu</span>' : ''}</td>
      <td>${inp('ngay', draft ? '' : isoToDmy(l.ngay), 'class="date-dmy"')}</td>
      <td>${inp('gia_tri', gtStr, 'class="money num" placeholder="0"')}</td>
      <td>${inp('vat', draft ? '' : l.vat || '', 'type="number" min="0" max="100" step="1" class="vat-in" placeholder="0"')}</td>
      <td class="num strong" data-calc="hd">${money(hdSau)}</td>
      <td>${inp('gia_tri_qt', qtStr, 'class="money num" placeholder="= giá trị HĐ/PL"')}</td>
      <td class="num strong" data-calc="qt">${money(qtSau)}${!draft && !l.da_qt ? '<div class="muted small">chưa QT</div>' : ''}</td>
      <td>${inp('ghi_chu', draft ? '' : l.ghi_chu, 'maxlength="500"')}</td>
      <td class="row-actions">${edit ? `<button class="primary sm" data-save ${draft ? '' : 'hidden'}>Lưu</button>${
        l.ma_loai === 'HĐ' ? '' : `<button class="danger sm" data-del>${draft ? 'Bỏ' : 'Xóa'}</button>`}` : ''}</td>
    </tr>`;
  };
  const payLabel = (p, draft) => (p.loai === 'dot'
    ? `TT Đợt ${edit ? `<input data-f="dot" type="number" min="1" max="999" class="tv-dot" value="${esc(p.dot ?? '')}">` : esc(p.dot)}`
    : TT_LABEL[p.loai]) + (draft ? ' <span class="st st-tam-tinh">Chưa lưu</span>' : '');
  const payRow = (p, draft) => `<tr data-k="${draft ? 'dp' + p.key : 'p' + p.id}" class="${draft ? 'tv-draft' : ''}">
      <td><b>${payLabel(p, draft)}</b></td>
      <td>${inp('ngay', draft ? '' : isoToDmy(p.ngay), 'class="date-dmy"')}</td>
      <td>${inp('so_tien', draft ? '' : money(p.so_tien), 'class="money num" placeholder="Nhập giá trị"')}</td>
      <td>${inp('ghi_chu', draft ? '' : p.ghi_chu, 'maxlength="500"')}</td>
      <td class="row-actions">${edit ? `<button class="primary sm" data-save ${draft ? '' : 'hidden'}>Lưu</button><button class="danger sm" data-del>${draft ? 'Bỏ' : 'Xóa'}</button>` : ''}</td>
    </tr>`;
  const hasQt = c.pays.some((p) => p.loai === 'quyet_toan') || tpDrafts.pays.some((p) => p.loai === 'quyet_toan');

  dlg.innerHTML = `
    <div class="tp-dlg-head">
      <div>
        <div class="muted small">Hợp đồng thầu phụ · ${esc(costData.du_an.ma_du_an)}</div>
        <h3>${esc(c.so_ma)} ${c.da_qt ? '<span class="st st-hoan-thanh">Đã QT</span>' : '<span class="st">Chưa QT</span>'}</h3>
      </div>
      <button class="ghost-dark" data-close title="Đóng (Esc)">✕</button>
    </div>
    ${edit ? `<div class="grid-form tp-info" data-k="info">
      <label>Số HĐ thầu phụ *<input data-f="so_ma" value="${esc(c.so_ma)}" maxlength="120"></label>
      <label>Nhà thầu phụ<input data-f="doi_tac" value="${esc(c.doi_tac)}" maxlength="200"></label>
      <label class="span-2">Ghi chú<input data-f="ghi_chu" value="${esc(c.ghi_chu)}" maxlength="500"></label>
      <div class="actions"><button class="primary sm" data-save hidden>Lưu thông tin</button></div>
    </div>` : `<p class="muted">Nhà thầu phụ: <b>${esc(c.doi_tac || '—')}</b>${c.ghi_chu ? ' · ' + esc(c.ghi_chu) : ''}</p>`}
    <div class="kpis tp-kpis">
      <div class="kpi"><div class="label">Tổng giá trị HĐ</div><div class="value">${money(c.hd_sau_vat)}</div><div class="sub">HĐ + ${c.so_pl} PL, sau VAT</div></div>
      <div class="kpi"><div class="label">Tổng giá trị HT/QT</div><div class="value">${money(c.qt_sau_vat)}</div><div class="sub">${c.da_qt ? 'Đã quyết toán' : 'Chưa QT = theo giá trị HĐ/PL'}</div></div>
      <div class="kpi"><div class="label">Giá trị thanh toán</div><div class="value">${money(c.da_tt)}</div><div class="sub">${c.pays.length} lần</div></div>
      <div class="kpi"><div class="label">Giá trị còn lại</div><div class="value ${c.con_lai < 0 ? 'neg' : ''}">${money(c.con_lai)}</div><div class="sub">= HT/QT − Thanh toán</div></div>
    </div>

    <h4>Giá trị HĐ / PL</h4>
    <div class="table-wrap"><table class="tp-dtl">
      <thead><tr><th>Số HĐ/PL</th><th>Ngày</th><th class="num">Giá trị HĐ/PL<br><span class="muted small">trước VAT</span></th><th>VAT %</th><th class="num">HĐ/PL<br><span class="muted small">sau VAT</span></th>
        <th class="num">Giá trị HT/QT<br><span class="muted small">trước VAT</span></th><th class="num">HT/QT<br><span class="muted small">sau VAT</span></th><th>Ghi chú</th><th></th></tr></thead>
      <tbody>${c.lines.map((l) => lineRow(l, false)).join('')}${tpDrafts.lines.map((d) => lineRow(d, true)).join('')}</tbody>
      <tfoot><tr><td colspan="4">TỔNG</td><td class="num">${money(c.hd_sau_vat)}</td><td></td><td class="num">${money(c.qt_sau_vat)}</td><td colspan="2"></td></tr></tfoot>
    </table></div>
    ${edit ? `<div class="tv-tools"><button class="sm" data-addpl="${nextPl}">+ Thêm ${nextPl}</button>
      <span class="muted small">Ô HT/QT để trống = chưa quyết toán (lấy bằng giá trị HĐ/PL)</span></div>` : ''}

    <h4>Giá trị thanh toán</h4>
    <div class="table-wrap"><table class="tp-dtl">
      <thead><tr><th>Nội dung</th><th>Ngày</th><th class="num">Số tiền</th><th>Ghi chú</th><th></th></tr></thead>
      <tbody>${c.pays.map((p) => payRow(p, false)).join('')}${tpDrafts.pays.map((p) => payRow(p, true)).join('')}
        ${!c.pays.length && !tpDrafts.pays.length ? '<tr><td colspan="5" class="empty">Chưa có thanh toán</td></tr>' : ''}</tbody>
      <tfoot><tr><td colspan="2">TỔNG THANH TOÁN</td><td class="num">${money(c.da_tt)}</td><td colspan="2"></td></tr></tfoot>
    </table></div>
    ${edit ? `<div class="tv-tools">
      <button class="sm" data-addpay="tam_ung">+ Tạm ứng</button>
      <button class="sm" data-addpay="dot">+ Đợt thanh toán</button>
      <button class="sm" data-addpay="quyet_toan" ${hasQt ? 'disabled title="Đã có Quyết toán"' : ''}>+ Quyết toán</button>
      <span class="spacer"></span>
      <button class="danger sm" data-deltp>Xóa hợp đồng thầu phụ</button>
    </div>` : ''}
    <div class="msg" id="tp-msg" role="alert"></div>`;
  if (edit) {
    $$('input.money', dlg).forEach(attachMoneyInput);
    $$('input.date-dmy', dlg).forEach(attachDateInput);
  }
}

function onTpDlgInput(e) {
  const tr = e.target.closest('[data-k]');
  if (!tr) return;
  const btn = $('[data-save]', tr);
  if (btn) btn.hidden = false;
  if (tr.dataset.k.startsWith('l') || tr.dataset.k.startsWith('dl')) {
    // cập nhật sau VAT ngay khi gõ
    const v = (f) => $(`[data-f="${f}"]`, tr)?.value ?? '';
    $('[data-calc="hd"]', tr).textContent = money(tpCalc(v('gia_tri'), v('vat')));
    $('[data-calc="qt"]', tr).textContent = money(tpCalc(v('gia_tri_qt') || v('gia_tri'), v('vat')));
  }
}

async function onTpDlgClick(e) {
  const t = e.target;
  const c = costData.thau_phu.find((x) => x.id === tpDlgId);
  if (!c) return;
  const msg = () => $('#tp-msg');
  if (t.dataset.close !== undefined) return closeTp();
  if (t.dataset.deltp !== undefined) return deleteTp(c.id);
  if (t.dataset.addpl) { tpDrafts.lines.push({ key: ++tpSeq, ma_loai: t.dataset.addpl }); return renderTpDlg(); }
  if (t.dataset.addpay) {
    const loai = t.dataset.addpay;
    const d = { key: ++tpSeq, loai };
    if (loai === 'dot') d.dot = Math.max(0, ...c.pays.filter((p) => p.loai === 'dot').map((p) => p.dot), ...tpDrafts.pays.filter((p) => p.loai === 'dot').map((p) => p.dot)) + 1;
    tpDrafts.pays.push(d);
    return renderTpDlg();
  }
  const tr = t.closest('[data-k]');
  if (!tr) return;
  const k = tr.dataset.k;
  const v = (f) => $(`[data-f="${f}"]`, tr)?.value ?? '';
  const call = async (url, method, body) => {
    try {
      await api(url, { method, body: body ? JSON.stringify(body) : undefined });
      return true;
    } catch (err) { showMsg(msg(), err.message, 'err'); return false; }
  };
  const after = async (text) => { await loadCost(); showMsg(msg(), text); };

  if (t.dataset.save !== undefined) {
    if (k === 'info') {
      if (await call(`/api/thau-phu/${c.id}`, 'PUT', { so_ma: v('so_ma'), doi_tac: v('doi_tac'), ghi_chu: v('ghi_chu') })) await after('Đã lưu thông tin hợp đồng');
      return;
    }
    const ngay = dmyToIso(v('ngay'));
    if (ngay === null) return showMsg(msg(), 'Ngày không hợp lệ, nhập dd/mm/yyyy', 'err');
    if (k.startsWith('l') || k.startsWith('dl')) {
      const draft = k.startsWith('dl');
      const cur = draft ? tpDrafts.lines.find((d) => 'dl' + d.key === k) : c.lines.find((l) => 'l' + l.id === k);
      const body = { ma_loai: cur.ma_loai, ngay, gia_tri: parseMoney(v('gia_tri')), vat: v('vat'), gia_tri_qt: parseMoney(v('gia_tri_qt')), ghi_chu: v('ghi_chu') };
      if (await call(draft ? `/api/thau-phu/${c.id}/hd-pl` : `/api/tp-hd-pl/${cur.id}`, draft ? 'POST' : 'PUT', body)) {
        if (draft) tpDrafts.lines = tpDrafts.lines.filter((d) => d !== cur);
        await after(`Đã lưu ${cur.ma_loai}`);
      }
    } else {
      const draft = k.startsWith('dp');
      const cur = draft ? tpDrafts.pays.find((d) => 'dp' + d.key === k) : c.pays.find((p) => 'p' + p.id === k);
      const body = { loai: cur.loai, dot: cur.loai === 'dot' ? v('dot') : null, ngay, so_tien: parseMoney(v('so_tien')), ghi_chu: v('ghi_chu') };
      if (await call(draft ? `/api/thau-phu/${c.id}/thanh-toan` : `/api/tp-thanh-toan/${cur.id}`, draft ? 'POST' : 'PUT', body)) {
        if (draft) tpDrafts.pays = tpDrafts.pays.filter((d) => d !== cur);
        await after(`Đã lưu ${TT_LABEL[cur.loai]}${cur.loai === 'dot' ? ' ' + body.dot : ''}`);
      }
    }
    return;
  }
  if (t.dataset.del !== undefined) {
    if (k.startsWith('dl')) { tpDrafts.lines = tpDrafts.lines.filter((d) => 'dl' + d.key !== k); return renderTpDlg(); }
    if (k.startsWith('dp')) { tpDrafts.pays = tpDrafts.pays.filter((d) => 'dp' + d.key !== k); return renderTpDlg(); }
    if (k.startsWith('l')) {
      const l = c.lines.find((x) => 'l' + x.id === k);
      const pc = await askPasscode(`Xóa "${l.so_hieu}"?`, `Giá trị sau VAT: ${money(l.sau_vat)} đ. Thao tác này không hoàn tác được.`);
      if (pc === null) return;
      if (await call(`/api/tp-hd-pl/${l.id}`, 'DELETE', { passcode: pc })) await after(`Đã xóa ${l.ma_loai}`);
    } else {
      const p = c.pays.find((x) => 'p' + x.id === k);
      if (!confirm(`Xóa dòng ${TT_LABEL[p.loai]}${p.dot ? ' ' + p.dot : ''} (${money(p.so_tien)} đ)?`)) return;
      if (await call(`/api/tp-thanh-toan/${p.id}`, 'DELETE')) await after('Đã xóa dòng thanh toán');
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
  $('#pc-status').innerHTML = s.passcode_set
    ? '<span class="st st-hoan-thanh">Đã đặt</span> Nhân viên Nhập liệu / Quản trị phải nhập passcode khi xóa Số HĐ/PL.'
    : '<span class="st st-tam-dung">Chưa đặt</span> Hiện chưa ai xóa được Số HĐ/PL cho đến khi đặt passcode.';
  $('#pc-submit').textContent = s.passcode_set ? 'Đổi passcode' : 'Đặt passcode';
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

$('#pc-form')?.querySelectorAll('input[inputmode=numeric]').forEach((i) =>
  i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, '').slice(0, 8); }));
$('#pc-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const d = formData(e.target);
  if (!/^\d{8}$/.test(d.passcode)) return showMsg($('#pc-msg'), 'Passcode phải gồm đúng 8 chữ số', 'err');
  if (d.passcode !== d.passcode2) return showMsg($('#pc-msg'), 'Passcode nhập lại không khớp', 'err');
  try {
    await api('/api/settings/passcode', { method: 'PUT', body: JSON.stringify(d) });
    e.target.reset();
    showMsg($('#pc-msg'), 'Đã lưu Passcode xóa HĐ/PL');
    await loadSettings();
  } catch (err) {
    showMsg($('#pc-msg'), err.message, 'err');
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

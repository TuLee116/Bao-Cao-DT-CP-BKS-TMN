const $ = (s) => document.querySelector(s);
const form = $('#form');
const fmt = new Intl.NumberFormat('vi-VN');
let data = [];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, '-');
const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);
const dmy = (d) => (d ? d.split('-').reverse().join('/') : '');

async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body.errors || ['Lỗi ' + res.status]).join('; '));
  return body;
}

function msg(text, type = 'ok') {
  const el = $('#msg');
  el.textContent = text;
  el.className = 'msg ' + type;
}

function render() {
  const q = slug($('#search').value.trim());
  const rows = q ? data.filter((r) => slug(`${r.ma_du_an} ${r.ten_du_an} ${r.chu_dau_tu}`).includes(q)) : data;

  const hd = rows.reduce((s, r) => s + r.gia_tri_hd, 0);
  const gn = rows.reduce((s, r) => s + r.da_giai_ngan, 0);
  $('#k-count').textContent = rows.length;
  $('#k-hd').textContent = fmt.format(hd);
  $('#k-gn').textContent = fmt.format(gn);
  $('#k-tl').textContent = pct(gn, hd).toFixed(1) + '%';

  $('#tbody').innerHTML = rows.length
    ? rows.map((r) => `
      <tr>
        <td>${esc(r.ma_du_an)}</td>
        <td>${esc(r.ten_du_an)}</td>
        <td>${esc(r.chu_dau_tu)}</td>
        <td class="num">${fmt.format(r.gia_tri_hd)}</td>
        <td class="num">${fmt.format(r.da_giai_ngan)}</td>
        <td class="num">${pct(r.da_giai_ngan, r.gia_tri_hd).toFixed(1)}%</td>
        <td><span class="bar"><i style="width:${Math.min(100, r.tien_do)}%"></i></span>${r.tien_do}%</td>
        <td><span class="st st-${slug(r.trang_thai)}">${esc(r.trang_thai)}</span></td>
        <td>${dmy(r.ngay_bat_dau)}${r.ngay_ket_thuc ? ' → ' + dmy(r.ngay_ket_thuc) : ''}</td>
        <td>
          <button data-edit="${r.id}">Sửa</button>
          <button class="danger" data-del="${r.id}">Xóa</button>
        </td>
      </tr>`).join('')
    : '<tr><td colspan="10" class="empty">Chưa có dữ liệu</td></tr>';
}

async function load() {
  data = await api('/api/du-an');
  render();
}

function resetForm() {
  form.reset();
  form.elements.id.value = '';
  $('#form-title').textContent = 'Thêm dự án';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(form));
  const id = body.id;
  delete body.id;
  try {
    await api(id ? `/api/du-an/${id}` : '/api/du-an', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
    msg(id ? 'Đã cập nhật dự án' : 'Đã thêm dự án');
    resetForm();
    await load();
  } catch (err) {
    msg(err.message, 'err');
  }
});

$('#btn-cancel').addEventListener('click', () => { resetForm(); msg(''); });
$('#search').addEventListener('input', render);

$('#tbody').addEventListener('click', async (e) => {
  const editId = e.target.dataset.edit;
  const delId = e.target.dataset.del;
  if (editId) {
    const r = data.find((x) => x.id === Number(editId));
    if (!r) return;
    for (const [k, v] of Object.entries(r)) if (form.elements[k]) form.elements[k].value = v ?? '';
    $('#form-title').textContent = 'Sửa dự án ' + r.ma_du_an;
    form.scrollIntoView({ behavior: 'smooth' });
  }
  if (delId && confirm('Xóa dự án này?')) {
    try {
      await api(`/api/du-an/${delId}`, { method: 'DELETE' });
      msg('Đã xóa dự án');
      await load();
    } catch (err) {
      msg(err.message, 'err');
    }
  }
});

// Xuất CSV (UTF-8 có BOM để Excel đọc đúng tiếng Việt)
$('#btn-csv').addEventListener('click', () => {
  const cols = ['ma_du_an', 'ten_du_an', 'chu_dau_tu', 'gia_tri_hd', 'da_giai_ngan', 'tien_do', 'trang_thai', 'ngay_bat_dau', 'ngay_ket_thuc'];
  const head = ['Mã DA', 'Tên dự án', 'Chủ đầu tư', 'Giá trị HĐ', 'Đã giải ngân', 'Tiến độ %', 'Trạng thái', 'Ngày bắt đầu', 'Ngày kết thúc'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [head.map(q).join(','), ...data.map((r) => cols.map((c) => q(r[c])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `du-an_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

(async () => {
  try {
    const meta = await api('/api/meta');
    form.elements.trang_thai.innerHTML = meta.trang_thai.map((t) => `<option>${esc(t)}</option>`).join('');
    $('#db-badge').textContent = meta.db === 'postgres' ? 'PostgreSQL' : 'Chế độ thử (bộ nhớ tạm)';
    await load();
  } catch (err) {
    msg('Không tải được dữ liệu: ' + err.message, 'err');
  }
})();

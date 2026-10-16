// =====================================================================
// BÁO CÁO TỔNG QUAN – tổng quát + chi tiết, In/PDF, Excel, PowerPoint
// Số liệu: /api/bao-cao (cùng công thức Dashboard). Dùng chung tiện ích của app.js / common.js.
// =====================================================================
let BC = null;                                  // dữ liệu báo cáo
const BST = { project: '', vat: 'gt', ky: 'nam', tu: '', den: '' }; // phạm vi, cơ sở VAT, kỳ báo cáo
try { Object.assign(BST, JSON.parse(localStorage.getItem('bao_cao') || '{}')); } catch {}
const bSave = () => { try { localStorage.setItem('bao_cao', JSON.stringify(BST)); } catch {} };

const BCOL = { dt: '#2a78d6', cp: '#eb6834', dk: '#1baf7a', th: '#2a78d6', thu: '#2a78d6', chi: '#eb6834' };
const bf = new Intl.NumberFormat('vi-VN');
const bn = (n) => bf.format(Math.round(n || 0));
const bm = (n) => `<span class="${n < 0 ? 'neg' : ''}">${bn(n)}</span>`;
const bpct = (a, b) => (b ? ((a / b) * 100).toFixed(1).replace('.', ',') + '%' : '—');
const bTy = (n) => (n / 1e9).toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); // tỷ đồng
const MUC = { cao: 'Cao', tb: 'Trung bình', thap: 'Thấp' };

async function loadReport() {
  $('#b-report').innerHTML = '<div class="card muted">Đang tổng hợp số liệu...</div>';
  BC = await api('/api/bao-cao');
  renderReport();
}

function bScope() {
  const id = Number(BST.project);
  const list = id ? BC.du_an.filter((d) => d.id === id) : BC.du_an;
  return { list, one: id ? list[0] : null };
}

// Tổng hợp nhiều dự án
function bTotals(list) {
  const S = (f) => list.reduce((s, d) => s + f(d), 0);
  const L = (k) => ({
    dt: { gt: S((d) => d[k].doanh_thu.gt), sv: S((d) => d[k].doanh_thu.sv) },
    cp: { gt: S((d) => d[k].chi_phi.gt), sv: S((d) => d[k].chi_phi.sv) },
    con_lai: S((d) => d[k].con_lai),
  });
  return {
    so_da: list.length, so_hd: S((d) => d.so_hd), so_hd_qt: S((d) => d.so_hd_qt), so_tp: S((d) => d.so_tp), so_tp_qt: S((d) => d.so_tp_qt),
    dk: L('du_kien'), th: L('thuc_hien'), tien_ve: S((d) => d.tien_ve), tra_goc: S((d) => d.tra_goc.sv),
    tp_con_lai: S((d) => d.tp.con_lai), tp_da_tt: S((d) => d.tp.da_tt),
    canh_bao: S((d) => d.canh_bao.length),
  };
}

// Gộp số liệu theo tháng: lũy kế DT/CP thực hiện + dòng tiền thu/chi
function bMonths(list, v) {
  const m = {};
  for (const d of list) {
    for (const [k, t] of Object.entries(d.thuc_hien.thang)) { const o = (m[k] ||= { dt: 0, cp: 0, thu: 0, chi: 0 }); o.dt += t['dt_' + v]; o.cp += t['cp_' + v]; }
    for (const [k, t] of Object.entries(d.dong_tien)) { const o = (m[k] ||= { dt: 0, cp: 0, thu: 0, chi: 0 }); o.thu += t.thu; o.chi += t.chi; }
  }
  const keys = Object.keys(m).sort();
  if (!keys.length) return [];
  const out = [];
  let [y, mo] = keys[0].split('-').map(Number);
  const [ye, me] = keys[keys.length - 1].split('-').map(Number);
  let cDt = 0, cCp = 0;
  while (y < ye || (y === ye && mo <= me)) {
    const k = `${y}-${String(mo).padStart(2, '0')}`;
    const o = m[k] || { dt: 0, cp: 0, thu: 0, chi: 0 };
    cDt += o.dt; cCp += o.cp;
    out.push({ k, label: `${String(mo).padStart(2, '0')}/${String(y).slice(2)}`, ...o, luy_dt: cDt, luy_cp: cCp });
    if (++mo > 12) { mo = 1; y++; }
  }
  return out;
}

function bCostGroups(list, v) {
  const map = new Map();
  for (const d of list) for (const n of d.nhom) {
    const o = map.get(n.code) || { ten: n.ten, khoi: n.khoi, val: 0 };
    o.val += n[v];
    map.set(n.code, o);
  }
  return [...map.values()].filter((x) => x.val).sort((a, b) => b.val - a.val);
}

// ---------------------------------------------------------------------
// KỲ BÁO CÁO (theo tháng) – số liệu lớp Thực hiện theo ngày phát sinh
// ---------------------------------------------------------------------
const ymAdd = (ym, n) => { let [y, m] = ym.split('-').map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; };
const ymDiff = (a, b) => { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); };
const ymTxt = (ym) => { const [y, m] = ym.split('-'); return `${m}/${y}`; };
const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const ROMAN_Q = ['I', 'II', 'III', 'IV'];
function bNowYm() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date()).slice(0, 7); }
function bAllMonths(list) {
  const ks = new Set();
  for (const d of list) { Object.keys(d.thuc_hien.thang).forEach((k) => ks.add(k)); Object.keys(d.dong_tien).forEach((k) => ks.add(k)); }
  return [...ks].sort();
}
function bPeriod(list) {
  const now = bNowYm();
  const [y, m] = now.split('-').map(Number);
  const q = Math.floor((m - 1) / 3);
  let from, to, label;
  switch (BST.ky) {
    case 'thang': from = to = now; label = `Tháng ${ymTxt(now)}`; break;
    case 'quy': from = `${y}-${String(q * 3 + 1).padStart(2, '0')}`; to = ymAdd(from, 2); label = `Quý ${ROMAN_Q[q]}/${y}`; break;
    case '6t': to = now; from = ymAdd(now, -5); label = '6 tháng gần nhất'; break;
    case 'luyke': { const all = bAllMonths(list); from = all[0] && all[0] < now ? all[0] : now; to = all.length && all[all.length - 1] > now ? all[all.length - 1] : now; label = 'Lũy kế từ đầu'; break; }
    case 'tuychon': from = BST.tu || ymAdd(now, -2); to = BST.den || now; if (from > to) [from, to] = [to, from]; label = 'Tùy chọn'; break;
    default: from = `${y}-01`; to = `${y}-12`; label = `Năm ${y}`;
  }
  const n = ymDiff(from, to) + 1;
  const prev = BST.ky === 'luyke' ? null : { from: ymAdd(from, -n), to: ymAdd(from, -1) };
  const [fy, fm] = from.split('-'), [ty, tm] = to.split('-');
  return { from, to, n, prev, label, range: `01/${fm}/${fy} – ${lastDay(to)}/${tm}/${ty}` };
}
// Tổng trong khoảng tháng [a, b]
function bSumRange(list, v, a, b) {
  const o = { dt: 0, cp: 0, thu: 0, chi: 0 };
  const inR = (k) => k >= a && k <= b;
  for (const d of list) {
    for (const [k, t] of Object.entries(d.thuc_hien.thang)) if (inR(k)) { o.dt += t['dt_' + v]; o.cp += t['cp_' + v]; }
    for (const [k, t] of Object.entries(d.dong_tien)) if (inR(k)) { o.thu += t.thu; o.chi += t.chi; }
  }
  o.ln = o.dt - o.cp;
  o.dong_tien = o.thu - o.chi;
  return o;
}
function bBalance(list, b) { // số dư dòng tiền lũy kế đến hết tháng b
  let s = 0;
  for (const d of list) for (const [k, t] of Object.entries(d.dong_tien)) if (k <= b) s += t.thu - t.chi;
  return s;
}
// Chuỗi theo tháng (gộp theo quý nếu kỳ > 12 tháng)
function bSeries(list, v, P) {
  const byQ = P.n > 12;
  const out = [];
  for (let k = P.from; k <= P.to; k = ymAdd(k, byQ ? 3 : 1)) {
    let a = k, b = byQ ? ymAdd(k, 2) : k;
    if (b > P.to) b = P.to;
    const [yy, mm] = k.split('-').map(Number);
    const o = bSumRange(list, v, a, b);
    out.push({ label: byQ ? `Q${Math.floor((mm - 1) / 3) + 1}/${String(yy).slice(2)}` : `T${mm}/${String(yy).slice(2)}`, ...o });
    if (byQ && b === P.to) break;
  }
  return out;
}

// So với kỳ trước: good = tăng là tốt
function bDelta(cur, prev, good = true) {
  if (prev === null || prev === undefined) return '';
  if (!prev) return `<span class="f-delta">— <small>kỳ trước = 0</small></span>`;
  const p = (cur - prev) / Math.abs(prev);
  const up = p >= 0;
  const ok = up === good;
  return `<span class="f-delta ${ok ? 'ok' : 'bad'}">${up ? '▲' : '▼'} ${Math.abs(p * 100).toFixed(1).replace('.', ',')}% <small>so với kỳ trước</small></span>`;
}
const PROJ_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'];

function bFinHtml(list, v) {
  const P = bPeriod(list);
  const cur = bSumRange(list, v, P.from, P.to);
  const prv = P.prev ? bSumRange(list, v, P.prev.from, P.prev.to) : null;
  const bal = bBalance(list, P.to);
  const year = P.to.slice(0, 4);
  const ytd = bSumRange(list, v, `${year}-01`, P.to);
  const tg = (BC.muc_tieu || {})[year] || {};
  const card = (k, title, val, sub, delta) => `<div class="f-card f-${k}">
      <div class="f-body"><div class="f-title">${title}</div><div class="f-val ${val < 0 ? 'neg' : ''}">${bTy(val)} <small>tỷ</small></div>
        <div class="f-full">${bn(val)} đ</div>${delta}${sub ? `<div class="f-sub">${sub}</div>` : ''}</div></div>`;
  const bar = (label, act, target, color, fmtFn) => {
    if (target === null || target === undefined) return `<div class="f-tg"><span class="f-tg-dot" style="background:${color}"></span><span class="f-tg-l">${label}</span><span class="muted small">Chưa đặt</span></div>`;
    const pc = target > 0 ? act / target : 0;
    const pTxt = target > 0 ? (pc < 0 ? '<0%' : `${(pc * 100).toFixed(0)}%`) : '—';
    return `<div class="f-tg"><span class="f-tg-dot" style="background:${color}"></span><span class="f-tg-l">${label}</span><span class="f-tg-v ${act < 0 ? 'neg' : ''}">${fmtFn(act)} / ${fmtFn(target)}</span>
      <div class="f-tg-bar"><i style="width:${Math.max(0, Math.min(100, pc * 100))}%;background:${color}"></i></div><span class="f-tg-p ${pc < 0 ? 'neg' : ''}">${pTxt}</span></div>`;
  };
  const tyS = (x) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
  const tsAct = ytd.dt ? ytd.ln / ytd.dt : 0;
  const tyFmt = (n) => `${bTy(n)} tỷ`;
  const anyTarget = ['dt', 'cp', 'ln', 'ty_suat'].some((k) => tg[k] !== null && tg[k] !== undefined);
  const lnPct = cur.dt ? cur.ln / cur.dt : 0;
  const prjRows = list.map((d) => { const o = bSumRange([d], v, P.from, P.to); return { d, ...o }; });
  const tot = prjRows.reduce((a, x) => ({ dt: a.dt + x.dt, cp: a.cp + x.cp, ln: a.ln + x.ln }), { dt: 0, cp: 0, ln: 0 });
  const undated = list.reduce((s, d) => s + d.thuc_hien.chua_ngay.dt + d.thuc_hien.chua_ngay.cp, 0);
  return `
  <section class="card b-sec f-sec">
    <div class="f-head">
      <h2>Tổng quan tài chính · ${esc(P.label)}</h2>
      <div class="f-range">📅 ${P.range}${P.prev ? ` <span class="muted">· so với ${ymTxt(P.prev.from)}${P.prev.n !== 1 && P.prev.from !== P.prev.to ? ' – ' + ymTxt(P.prev.to) : ''}</span>` : ''}</div>
    </div>
    <div class="f-grid">
      ${card('dt', 'Tổng doanh thu', cur.dt, `Nghiệm thu trong kỳ (${v === 'gt' ? 'trước VAT' : 'sau VAT'})`, bDelta(cur.dt, prv?.dt, true))}
      ${card('cp', 'Tổng chi phí', cur.cp, `${bpct(cur.cp, cur.dt)} doanh thu`, bDelta(cur.cp, prv?.cp, false))}
      ${card('ln', 'Lợi nhuận', cur.ln, `Tỷ suất LN: <b>${tyS(lnPct)}</b>`, bDelta(cur.ln, prv?.ln, true))}
      ${card('dong', 'Dòng tiền thực tế', cur.dong_tien, `Thu ${bTy(cur.thu)} · Chi ${bTy(cur.chi)} tỷ<br>Số dư cuối kỳ: <b class="${bal < 0 ? 'neg' : ''}">${bTy(bal)} tỷ</b>`, bDelta(cur.dong_tien, prv?.dong_tien, true))}
      <div class="f-target">
        <div class="f-target-h"><b>Mục tiêu năm ${year}</b>${BC.la_quan_tri ? `<button type="button" class="sm no-print" id="f-set-target">${anyTarget ? 'Sửa' : 'Đặt mục tiêu'}</button>` : ''}</div>
        ${bar('Doanh thu', ytd.dt, tg.dt, BCOL.dt, tyFmt)}
        ${bar('Chi phí', ytd.cp, tg.cp, BCOL.cp, tyFmt)}
        ${bar('Lợi nhuận', ytd.ln, tg.ln, BCOL.dk, tyFmt)}
        ${bar('Tỷ suất LN', tsAct * 100, tg.ty_suat, '#6250d6', (x) => `${Number(x).toFixed(1).replace('.', ',')}%`)}
        <div class="muted small">Thực hiện lũy kế 01/${year} – ${ymTxt(P.to)}</div>
      </div>
    </div>
    <div class="f-row2">
      <div class="f-box"><h3>Doanh thu – Chi phí – Lợi nhuận <span class="muted">(tỷ đồng)</span></h3><div id="f-ch-col" class="chart"></div></div>
      <div class="f-box"><h3>Cơ cấu doanh thu theo công trình</h3><div id="f-ch-donut" class="chart"></div></div>
      <div class="f-box"><h3>Hiệu quả từng công trình <span class="muted">(tỷ đồng)</span></h3>
        <div class="table-wrap"><table class="b-table f-eff">
          <thead><tr><th>Công trình</th><th class="num">Doanh thu</th><th class="num">Chi phí</th><th class="num">Lợi nhuận</th><th class="num">Tỷ suất</th></tr></thead>
          <tbody>${prjRows.map((x, i) => `<tr><td title="${esc(x.d.ten_du_an)}"><span class="f-dot" style="background:${PROJ_COLORS[i % PROJ_COLORS.length]}"></span><b>${esc(x.d.ma_du_an)}</b></td>
            <td class="num">${bTy(x.dt)}</td><td class="num">${bTy(x.cp)}</td><td class="num strong ${x.ln < 0 ? 'neg' : 'pos'}">${bTy(x.ln)}</td><td class="num">${x.dt ? tyS(x.ln / x.dt) : '—'}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Tổng cộng</td><td class="num">${bTy(tot.dt)}</td><td class="num">${bTy(tot.cp)}</td><td class="num ${tot.ln < 0 ? 'neg' : ''}">${bTy(tot.ln)}</td><td class="num">${tot.dt ? tyS(tot.ln / tot.dt) : '—'}</td></tr></tfoot>
        </table></div></div>
    </div>
    <p class="muted small f-note">Số liệu theo ngày phát sinh (lớp Thực hiện): doanh thu theo ngày nghiệm thu, chi phí theo ngày chứng từ / thanh toán thầu phụ, dòng tiền = tiền về − tiền chi (sau VAT).${undated ? ` <b class="warn-text">${undated} dòng thiếu ngày không được tính vào kỳ nào</b> (xem mục Cảnh báo; nhập ngày để số theo kỳ đầy đủ).` : ''}</p>
  </section>`;
}

// Số liệu Tổng quan tài chính theo kỳ (dùng chung cho xuất Excel / PowerPoint)
function bFinData(list, v) {
  const P = bPeriod(list);
  const cur = bSumRange(list, v, P.from, P.to);
  const prv = P.prev ? bSumRange(list, v, P.prev.from, P.prev.to) : null;
  const year = P.to.slice(0, 4);
  const ytd = bSumRange(list, v, `${year}-01`, P.to);
  const tg = (BC.muc_tieu || {})[year] || {};
  const rows = list.map((d, i) => ({ d, color: PROJ_COLORS[i % PROJ_COLORS.length], ...bSumRange([d], v, P.from, P.to) }));
  return { P, cur, prv, year, ytd, tg, bal: bBalance(list, P.to), series: bSeries(list, v, P), rows };
}

function bFinDraw(list, v) {
  const P = bPeriod(list);
  const pts = bSeries(list, v, P);
  bColChart($('#f-ch-col'), pts, [{ key: 'dt', name: 'Doanh thu', color: BCOL.dt }, { key: 'cp', name: 'Chi phí', color: BCOL.cp }, { key: 'ln', name: 'Lợi nhuận', color: BCOL.dk }],
    { valueLabels: pts.length <= 6, tipExtra: (p) => `<tr class="sum"><td>Tỷ suất LN</td><td>${bpct(p.ln, p.dt)}</td></tr>`, height: 240 });
  const items = list.map((d, i) => ({ label: d.ma_du_an, sub: d.ten_du_an, val: bSumRange([d], v, P.from, P.to).dt, color: PROJ_COLORS[i % PROJ_COLORS.length] }));
  bDonut($('#f-ch-donut'), items);
}

// Biểu đồ tròn (vành khuyên) – màu theo thứ tự công trình
function bDonut(el, all) {
  const pos = all.filter((x) => x.val > 0).sort((a, b) => b.val - a.val);
  if (!pos.length) return bEmpty(el, 'Chưa có doanh thu trong kỳ');
  let items = pos;
  if (pos.length > 7) { const rest = pos.slice(6); items = [...pos.slice(0, 6), { label: 'Khác', sub: `${rest.length} công trình`, val: rest.reduce((s, x) => s + x.val, 0), color: '#b5b3ab' }]; }
  const total = items.reduce((s, x) => s + x.val, 0);
  const S = 200, R = 92, r0 = 56, c = S / 2;
  el.innerHTML = '<div class="pie-wrap f-donut"></div>';
  const wrap = el.firstChild;
  const svg = svgEl('svg', { viewBox: `0 0 ${S} ${S}`, width: S, height: S, role: 'img', 'aria-label': 'Cơ cấu doanh thu theo công trình' }, wrap);
  let a = 0;
  const pt = (ang, rr) => [c + rr * Math.sin(ang), c - rr * Math.cos(ang)];
  for (const x of items) {
    let a1 = a + (x.val / total) * Math.PI * 2;
    if (a1 - a >= Math.PI * 2 - 1e-9) a1 = a + Math.PI * 2 - 1e-4;
    const big = a1 - a > Math.PI ? 1 : 0;
    const [x0, y0] = pt(a, R), [x1, y1] = pt(a1, R), [x2, y2] = pt(a1, r0), [x3, y3] = pt(a, r0);
    const path = svgEl('path', { d: `M${x0},${y0}A${R},${R} 0 ${big} 1 ${x1},${y1}L${x2},${y2}A${r0},${r0} 0 ${big} 0 ${x3},${y3}Z`, fill: x.color, stroke: '#fff', 'stroke-width': items.length > 1 ? 2 : 0 }, svg);
    path.addEventListener('mousemove', (e) => showTip(`<b>${esc(x.label)}</b> ${esc(x.sub || '')}<br>${bn(x.val)} đ · <b>${bpct(x.val, total)}</b>`, e.clientX, e.clientY));
    path.addEventListener('mouseleave', hideTip);
    const mid = (a + a1) / 2;
    if (x.val / total >= 0.06) { const [lx, ly] = pt(mid, (R + r0) / 2); svgEl('text', { x: lx, y: ly + 4, 'text-anchor': 'middle', class: 'f-donut-pct' }, svg).textContent = Math.round((x.val / total) * 100) + '%'; }
    a = a1;
  }
  svgEl('text', { x: c, y: c - 2, 'text-anchor': 'middle', class: 'pie-c1' }, svg).textContent = bTy(total).replace(/,00$/, '');
  svgEl('text', { x: c, y: c + 16, 'text-anchor': 'middle', class: 'pie-c2' }, svg).textContent = 'tỷ đồng';
  const ul = document.createElement('ul');
  ul.className = 'pie-legend';
  ul.innerHTML = items.map((x) => `<li><i style="background:${x.color}"></i><span class="nm" title="${esc(x.sub || '')}">${esc(x.label)}<br><small class="muted">${bTy(x.val)} tỷ</small></span><b>${bpct(x.val, total)}</b></li>`).join('');
  wrap.appendChild(ul);
}

// Hộp thoại đặt mục tiêu năm (Quản trị)
function bTargetDialog() {
  const year = bPeriod(BC.du_an).to.slice(0, 4);
  const t = (BC.muc_tieu || {})[year] || {};
  const dlg = document.createElement('dialog');
  dlg.className = 'pass-dlg f-dlg';
  const mv = (x) => (x === null || x === undefined ? '' : bf.format(x));
  dlg.innerHTML = `<form method="dialog" class="stack">
    <h3>Mục tiêu năm</h3>
    <label>Năm<input name="nam" type="number" min="2000" max="2100" value="${year}" required></label>
    <label>Doanh thu (đồng)<input name="dt" class="money" value="${mv(t.dt)}" placeholder="Để trống = chưa đặt"></label>
    <label>Chi phí (đồng)<input name="cp" class="money" value="${mv(t.cp)}" placeholder="Để trống = chưa đặt"></label>
    <label>Lợi nhuận (đồng)<input name="ln" class="money" value="${mv(t.ln)}" placeholder="Để trống = chưa đặt"></label>
    <label>Tỷ suất lợi nhuận (%)<input name="ty_suat" inputmode="decimal" value="${t.ty_suat ?? ''}" placeholder="vd 24"></label>
    <p class="muted small">So sánh với số thực hiện lũy kế trong năm, cơ sở ${BST.vat === 'gt' ? 'trước VAT' : 'sau VAT'} như đang chọn. Để trống tất cả = xóa mục tiêu năm.</p>
    <div class="msg" role="alert"></div>
    <div class="actions"><button type="submit" class="primary" value="ok">Lưu</button><button type="button" data-x>Hủy</button></div>
  </form>`;
  document.body.appendChild(dlg);
  const f = $('form', dlg);
  $$('input.money', f).forEach(attachMoneyInput);
  f.elements.nam.addEventListener('change', () => {
    const t2 = (BC.muc_tieu || {})[f.elements.nam.value] || {};
    f.elements.dt.value = mv(t2.dt); f.elements.cp.value = mv(t2.cp); f.elements.ln.value = mv(t2.ln); f.elements.ty_suat.value = t2.ty_suat ?? '';
  });
  $('[data-x]', f).addEventListener('click', () => { dlg.close(); dlg.remove(); });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      BC.muc_tieu = await api('/api/muc-tieu', { method: 'PUT', body: JSON.stringify({
        nam: f.elements.nam.value, dt: parseMoney(f.elements.dt.value), cp: parseMoney(f.elements.cp.value), ln: parseMoney(f.elements.ln.value), ty_suat: f.elements.ty_suat.value }) });
      dlg.close(); dlg.remove();
      renderReport();
    } catch (err) { showMsg($('.msg', f), err.message, 'err'); }
  });
  dlg.showModal();
}

// ---------------------------------------------------------------------
// Biểu đồ SVG dùng chung (tooltip: showTip/hideTip của app.js)
// ---------------------------------------------------------------------
function bAxis(min, max) { return niceTicks(Math.min(0, min), Math.max(0, max)); }
function bLegend(svg, items, x0) {
  let x = x0;
  items.forEach(([t, c]) => {
    svgEl('rect', { x, y: 4, width: 12, height: 12, rx: 3, fill: c }, svg);
    svgEl('text', { x: x + 18, y: 14, class: 'ax-lbl strong' }, svg).textContent = t;
    x += 30 + t.length * 6.6;
  });
}
function bEmpty(el, text) { el.innerHTML = `<div class="chart-empty">${text}</div>`; }

// Đường lũy kế
function bLineChart(el, pts, series) {
  if (!pts.length) return bEmpty(el, 'Chưa có số liệu có ngày');
  el.innerHTML = '';
  const W = Math.max(320, el.clientWidth || 600), H = 260, pad = { l: 62, r: 70, t: 28, b: 30 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const ticks = bAxis(Math.min(...pts.flatMap((p) => series.map((s) => p[s.key]))), Math.max(...pts.flatMap((p) => series.map((s) => p[s.key]))));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const X = (i) => pad.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
  const Y = (v) => pad.t + ih - ((v - y0) / (y1 - y0)) * ih;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': series.map((s) => s.name).join(', ') }, el);
  bLegend(svg, series.map((s) => [s.name, s.color]), pad.l);
  for (const t of ticks) {
    svgEl('line', { x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t), class: t === 0 ? 'ax-base' : 'ax-grid' }, svg);
    svgEl('text', { x: pad.l - 8, y: Y(t) + 4, 'text-anchor': 'end', class: 'ax-lbl' }, svg).textContent = shortMoney(t);
  }
  const every = Math.ceil(pts.length / Math.max(1, Math.floor(iw / 56)));
  pts.forEach((p, i) => {
    const last = pts.length - 1;
    if (i !== last && (i % every || X(last) - X(i) < 50)) return;
    svgEl('text', { x: X(i), y: H - 10, 'text-anchor': 'middle', class: 'ax-lbl' }, svg).textContent = p.label;
  });
  const endY = [];
  for (const s of series) {
    svgEl('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p[s.key]).toFixed(1)}`).join(''), fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);
    let y = Y(pts[pts.length - 1][s.key]);
    for (const e of endY) if (Math.abs(e - y) < 13) y = e + (y >= e ? 13 : -13);
    endY.push(y);
    svgEl('text', { x: X(pts.length - 1) + 8, y: y + 4, class: 'ax-lbl strong' }, svg).textContent = shortMoney(pts[pts.length - 1][s.key]);
  }
  const cross = svgEl('line', { y1: pad.t, y2: pad.t + ih, class: 'ax-cross', visibility: 'hidden' }, svg);
  const hit = svgEl('rect', { x: pad.l - 8, y: pad.t, width: iw + 16, height: ih, fill: 'transparent' }, svg);
  hit.addEventListener('mousemove', (e) => {
    const r = svg.getBoundingClientRect();
    const sx = (e.clientX - r.left) * (W / r.width);
    const i = pts.length === 1 ? 0 : Math.max(0, Math.min(pts.length - 1, Math.round(((sx - pad.l) / iw) * (pts.length - 1))));
    cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
    showTip(`<b>Tháng ${pts[i].label}</b><table>${series.map((s) => `<tr><td><i style="background:${s.color}"></i>${s.name}</td><td>${bn(pts[i][s.key])}</td></tr>`).join('')}</table>`, e.clientX, e.clientY);
  });
  hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });
}

// Cột đứng nhóm theo tháng (dòng tiền)
function bColChart(el, pts, series, opt = {}) {
  if (!pts.length) return bEmpty(el, 'Chưa có số liệu có ngày');
  if (pts.every((p) => series.every((s) => !p[s.key]))) return bEmpty(el, 'Không có số liệu trong kỳ');
  el.innerHTML = '';
  const W = Math.max(320, el.clientWidth || 600), H = opt.height || 260, pad = { l: 62, r: 16, t: 28, b: 30 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const vals = pts.flatMap((p) => series.map((s) => p[s.key]));
  const ticks = bAxis(Math.min(...vals), Math.max(...vals));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const Y = (v) => pad.t + ih - ((v - y0) / (y1 - y0)) * ih;
  const slot = iw / pts.length, bw = Math.max(2, Math.min(18, (slot - 4) / series.length - 2));
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': series.map((s) => s.name).join(', ') }, el);
  bLegend(svg, series.map((s) => [s.name, s.color]), pad.l);
  for (const t of ticks) {
    svgEl('line', { x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t), class: t === 0 ? 'ax-base' : 'ax-grid' }, svg);
    svgEl('text', { x: pad.l - 8, y: Y(t) + 4, 'text-anchor': 'end', class: 'ax-lbl' }, svg).textContent = shortMoney(t);
  }
  const every = Math.ceil(pts.length / Math.max(1, Math.floor(iw / 56)));
  pts.forEach((p, i) => {
    const cx = pad.l + slot * i + slot / 2;
    series.forEach((s, j) => {
      const v = p[s.key], x = cx - (series.length * (bw + 2)) / 2 + j * (bw + 2);
      const ya = Y(Math.max(0, v)), yb = Y(Math.min(0, v));
      svgEl('rect', { x, y: ya, width: bw, height: Math.max(v ? 1 : 0, yb - ya), rx: Math.min(3, bw / 2), fill: s.color }, svg);
      if (opt.valueLabels && v) svgEl('text', { x: x + bw / 2, y: v >= 0 ? ya - 4 : yb + 11, 'text-anchor': 'middle', class: 'ax-lbl strong' }, svg).textContent = bTy(v).replace(/,0+$/, '').replace(/(,\d)0$/, '$1');
    });
    if (!(i % every)) svgEl('text', { x: cx, y: H - 10, 'text-anchor': 'middle', class: 'ax-lbl' }, svg).textContent = p.label;
    const hit = svgEl('rect', { x: pad.l + slot * i, y: pad.t, width: slot, height: ih, fill: 'transparent' }, svg);
    hit.addEventListener('mousemove', (e) => showTip(`<b>${p.label}</b><table>${series.map((s) => `<tr><td><i style="background:${s.color}"></i>${s.name}</td><td class="${p[s.key] < 0 ? 'neg' : ''}">${bn(p[s.key])}</td></tr>`).join('')}
      ${opt.tipExtra ? opt.tipExtra(p) : ''}</table>`, e.clientX, e.clientY));
    hit.addEventListener('mouseleave', hideTip);
  });
}

// Thanh ngang (1 hoặc nhiều chuỗi), hỗ trợ số âm
function bBarH(el, items, series, { pctOf } = {}) {
  if (!items.length) return bEmpty(el, 'Chưa có số liệu');
  el.innerHTML = '';
  const rowH = series.length > 1 ? 30 : 24;
  const W = Math.max(320, el.clientWidth || 600), labelW = Math.min(230, W * 0.36), pad = { t: series.length > 1 ? 26 : 6, r: 84 };
  const H = pad.t + items.length * rowH + 22;
  const vals = items.flatMap((it) => it.values);
  const ticks = bAxis(Math.min(...vals), Math.max(...vals));
  const x0 = ticks[0], x1 = ticks[ticks.length - 1], iw = W - labelW - pad.r;
  const X = (v) => labelW + ((v - x0) / (x1 - x0)) * iw;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img' }, el);
  if (series.length > 1) bLegend(svg, series.map((s) => [s.name, s.color]), labelW);
  for (const t of ticks) {
    svgEl('line', { x1: X(t), x2: X(t), y1: pad.t, y2: H - 20, class: t === 0 ? 'ax-base' : 'ax-grid' }, svg);
    svgEl('text', { x: X(t), y: H - 6, 'text-anchor': 'middle', class: 'ax-lbl' }, svg).textContent = shortMoney(t);
  }
  const bh = series.length > 1 ? 10 : 14;
  items.forEach((it, i) => {
    const y = pad.t + i * rowH;
    const lab = svgEl('text', { x: labelW - 8, y: y + rowH / 2 + 4, 'text-anchor': 'end', class: 'ax-lbl strong' }, svg);
    const maxCh = Math.max(8, Math.floor((labelW - 16) / 7.2));
    lab.textContent = it.label.length > maxCh ? it.label.slice(0, maxCh - 1) + '…' : it.label;
    it.values.forEach((v, j) => {
      const by = y + (rowH - series.length * (bh + 2)) / 2 + j * (bh + 2);
      const xa = X(Math.min(0, v)), xb = X(Math.max(0, v));
      svgEl('rect', { x: xa, y: by, width: Math.max(v ? 1 : 0, xb - xa), height: bh, rx: 3, fill: series[j].color }, svg);
      if (series.length === 1) svgEl('text', { x: xb + 6, y: by + bh - 2, class: 'ax-lbl' }, svg).textContent = shortMoney(v) + (pctOf ? ` · ${bpct(v, pctOf)}` : '');
    });
    const hit = svgEl('rect', { x: 0, y, width: W, height: rowH, fill: 'transparent' }, svg);
    hit.addEventListener('mousemove', (e) => showTip(`<b>${esc(it.label)}</b><table>${series.map((s, j) => `<tr><td><i style="background:${s.color}"></i>${s.name}</td><td class="${it.values[j] < 0 ? 'neg' : ''}">${bn(it.values[j])}</td>${pctOf ? `<td>${bpct(it.values[j], pctOf)}</td>` : ''}</tr>`).join('')}</table>`, e.clientX, e.clientY));
    hit.addEventListener('mouseleave', hideTip);
  });
}

// ---------------------------------------------------------------------
// Dựng báo cáo
// ---------------------------------------------------------------------
function renderReport() {
  const sel = $('#b-project');
  if (!BC.du_an.some((d) => d.id === Number(BST.project))) BST.project = '';
  sel.innerHTML = `<option value="">Tất cả dự án (${BC.du_an.length})</option>` + BC.du_an.map((d) => `<option value="${d.id}">${esc(d.ma_du_an)} – ${esc(d.ten_du_an)}</option>`).join('');
  sel.value = BST.project;
  $$('#b-vat button').forEach((b) => b.classList.toggle('on', b.dataset.v === BST.vat));
  $('#b-ky').value = BST.ky;
  $('#b-ky-custom').hidden = BST.ky !== 'tuychon';
  { const P0 = bPeriod(BC.du_an); $('#b-tu').value = P0.from; $('#b-den').value = P0.to; }

  const { list, one } = bScope();
  const v = BST.vat, vt = v === 'gt' ? 'trước VAT' : 'sau VAT';
  const T = bTotals(list);
  const lnDk = T.dk.dt[v] - T.dk.cp[v], lnTh = T.th.dt[v] - T.th.cp[v];
  const lap = new Date(BC.lap_luc);
  const scope = one ? `${one.ma_du_an} – ${one.ten_du_an}` : `Tất cả dự án (${list.length})`;

  const kpi = (label, val, sub, cls = '') => `<div class="b-kpi ${cls}"><div class="label">${label}</div><div class="value">${bm(val)}</div><div class="sub">${sub}</div></div>`;
  const projRows = (f) => list.map(f).join('');

  $('#b-report').innerHTML = `
  <div class="card b-head">
    <div class="b-brand"><img src="/img/logo-icon.png" alt=""><div>
      <div class="b-company">${esc(BC.ten_cong_ty || '')}</div>
      <h1>BÁO CÁO TỔNG QUAN TÀI CHÍNH DỰ ÁN</h1>
      <div class="b-tag">Theo dõi nhanh hiệu quả kinh doanh và tình hình tài chính</div>
      <div class="b-meta">Phạm vi: <b>${esc(scope)}</b> · Đơn vị: VNĐ (${vt} trừ khi ghi khác) · Lập lúc ${lap.toLocaleString('vi-VN')} · Người lập: ${esc(BC.nguoi_lap)} · ${esc(BC.phien_ban)}</div>
    </div></div>
  </div>

  ${bFinHtml(list, v)}

  ${bPcSection(list, v)}

  <section class="card b-sec">
    <h2>I. Tổng quan theo hợp đồng</h2>
    <p class="b-count">${T.so_da} dự án · ${T.so_hd} HĐ chủ đầu tư (${T.so_hd_qt} đã quyết toán) · ${T.so_tp} HĐ thầu phụ (${T.so_tp_qt} đã quyết toán)</p>
    <div class="b-kpi-grid">
      <div class="b-rowlab">Dự kiến<small>theo hợp đồng</small></div>
      ${kpi('Doanh thu', T.dk.dt[v], `HĐ + PL; đã QT theo quyết toán`)}
      ${kpi('Chi phí', T.dk.cp[v], `${bpct(T.dk.cp[v], T.dk.dt[v])} doanh thu`)}
      ${kpi('Lợi nhuận', lnDk, `Tỷ suất ${bpct(lnDk, T.dk.dt[v])}`, lnDk < 0 ? 'bad' : 'good')}
      <div class="b-rowlab">Thực hiện<small>đến hiện tại</small></div>
      ${kpi('Doanh thu', T.th.dt[v], `Đã nghiệm thu · đạt ${bpct(T.th.dt[v], T.dk.dt[v])} dự kiến`)}
      ${kpi('Chi phí', T.th.cp[v], `${bpct(T.th.cp[v], T.th.dt[v])} doanh thu`)}
      ${kpi('Lợi nhuận', lnTh, `Tỷ suất ${bpct(lnTh, T.th.dt[v])}`, lnTh < 0 ? 'bad' : 'good')}
      <div class="b-rowlab">Dòng tiền & công nợ<small>sau VAT</small></div>
      ${kpi('Tiền về', T.tien_ve, `${bpct(T.tien_ve, T.dk.dt.sv)} giá trị HĐ`)}
      ${kpi('Còn phải thu', T.th.con_lai, T.th.con_lai < 0 ? 'Âm: CĐT ứng trước vượt nghiệm thu' : 'Theo khối lượng nghiệm thu')}
      ${kpi('Còn phải trả thầu phụ', T.tp_con_lai, `Đã trả ${bn(T.tp_da_tt)} · trả nợ gốc vay ${bn(T.tra_goc)}`)}
    </div>
  </section>

  <section class="card b-sec">
    <h2>II. Biểu đồ</h2>
    <div class="b-charts">
      <div><h3>Doanh thu – Chi phí thực hiện (lũy kế)</h3><div id="b-ch-line" class="chart"></div></div>
      <div><h3>Dòng tiền thực tế theo tháng (sau VAT)</h3><div id="b-ch-flow" class="chart"></div></div>
      <div><h3>Cơ cấu chi phí dự kiến theo nhóm</h3><div id="b-ch-cost" class="chart"></div></div>
      <div><h3>${one ? 'Lãi gộp dự kiến theo HĐ chủ đầu tư' : 'Lợi nhuận theo dự án'}</h3><div id="b-ch-ln" class="chart"></div></div>
    </div>
  </section>

  ${one ? '' : `<section class="card b-sec">
    <h2>III. Tổng hợp theo dự án</h2>
    <h3>1. Hiệu quả (${vt})</h3>
    <div class="table-wrap"><table class="b-table">
      <thead><tr><th rowspan="2">Dự án</th><th rowspan="2">Trạng thái</th><th rowspan="2" class="num">Tiến độ</th>
        <th colspan="4" class="grp">Dự kiến</th><th colspan="4" class="grp">Thực hiện</th></tr>
        <tr><th class="num">Doanh thu</th><th class="num">Chi phí</th><th class="num">Lợi nhuận</th><th class="num">%</th>
        <th class="num">Doanh thu</th><th class="num">Chi phí</th><th class="num">Lợi nhuận</th><th class="num">%</th></tr></thead>
      <tbody>${projRows((d) => {
        const a = d.du_kien.doanh_thu[v] - d.du_kien.chi_phi[v], b = d.thuc_hien.doanh_thu[v] - d.thuc_hien.chi_phi[v];
        return `<tr><td><b>${esc(d.ma_du_an)}</b> ${esc(d.ten_du_an)}</td><td>${esc(d.trang_thai)}</td><td class="num">${d.tien_do}%</td>
          <td class="num">${bn(d.du_kien.doanh_thu[v])}</td><td class="num">${bn(d.du_kien.chi_phi[v])}</td><td class="num strong">${bm(a)}</td><td class="num">${bpct(a, d.du_kien.doanh_thu[v])}</td>
          <td class="num">${bn(d.thuc_hien.doanh_thu[v])}</td><td class="num">${bn(d.thuc_hien.chi_phi[v])}</td><td class="num strong">${bm(b)}</td><td class="num">${bpct(b, d.thuc_hien.doanh_thu[v])}</td></tr>`;
      })}</tbody>
      <tfoot><tr><td colspan="3">TỔNG CỘNG</td><td class="num">${bn(T.dk.dt[v])}</td><td class="num">${bn(T.dk.cp[v])}</td><td class="num">${bm(lnDk)}</td><td class="num">${bpct(lnDk, T.dk.dt[v])}</td>
        <td class="num">${bn(T.th.dt[v])}</td><td class="num">${bn(T.th.cp[v])}</td><td class="num">${bm(lnTh)}</td><td class="num">${bpct(lnTh, T.th.dt[v])}</td></tr></tfoot>
    </table></div>
    <h3>2. Dòng tiền & công nợ (sau VAT)</h3>
    <div class="table-wrap"><table class="b-table">
      <thead><tr><th>Dự án</th><th class="num">HĐ CĐT (đã QT)</th><th class="num">Giá trị HĐ dự kiến</th><th class="num">Tiền về</th><th class="num">% thu</th><th class="num">Còn phải thu</th>
        <th class="num">HĐ thầu phụ (đã QT)</th><th class="num">Đã trả thầu phụ</th><th class="num">Còn phải trả TP</th><th class="num">Trả nợ gốc vay</th><th class="num">Cảnh báo</th></tr></thead>
      <tbody>${projRows((d) => `<tr><td><b>${esc(d.ma_du_an)}</b> ${esc(d.ten_du_an)}</td><td class="num">${d.so_hd} (${d.so_hd_qt})</td>
        <td class="num">${bn(d.du_kien.doanh_thu.sv)}</td><td class="num">${bn(d.tien_ve)}</td><td class="num">${bpct(d.tien_ve, d.du_kien.doanh_thu.sv)}</td><td class="num">${bm(d.thuc_hien.con_lai)}</td>
        <td class="num">${d.so_tp} (${d.so_tp_qt})</td><td class="num">${bn(d.tp.da_tt)}</td><td class="num">${bm(d.tp.con_lai)}</td><td class="num">${bn(d.tra_goc.sv)}</td>
        <td class="num">${d.canh_bao.length ? `<span class="st st-tam-tinh">${d.canh_bao.length}</span>` : '0'}</td></tr>`)}</tbody>
      <tfoot><tr><td>TỔNG CỘNG</td><td class="num">${T.so_hd} (${T.so_hd_qt})</td><td class="num">${bn(T.dk.dt.sv)}</td><td class="num">${bn(T.tien_ve)}</td><td class="num">${bpct(T.tien_ve, T.dk.dt.sv)}</td>
        <td class="num">${bm(T.th.con_lai)}</td><td class="num">${T.so_tp} (${T.so_tp_qt})</td><td class="num">${bn(T.tp_da_tt)}</td><td class="num">${bm(T.tp_con_lai)}</td><td class="num">${bn(T.tra_goc)}</td><td class="num">${T.canh_bao}</td></tr></tfoot>
    </table></div>
  </section>`}

  <section class="card b-sec">
    <h2>${one ? 'III' : 'IV'}. Chi tiết theo dự án</h2>
    <div class="no-print b-tools"><button type="button" class="sm" id="b-open-all">Mở tất cả</button><button type="button" class="sm" id="b-close-all">Thu gọn tất cả</button></div>
    ${list.map((d) => bProjectDetail(d, v, Boolean(one))).join('')}
  </section>

  <section class="card b-sec">
    <h2>${one ? 'IV' : 'V'}. Cảnh báo & lưu ý</h2>
    ${bWarnTable(list)}
  </section>
  <div class="b-foot">Nguồn: ${esc(BC.ten_he_thong || 'PROJECT PROFIT')} · ${esc(BC.phien_ban)} · Số liệu lấy tự động từ các tab Doanh thu, Chi phí, Thầu phụ, Tiền về tại thời điểm lập báo cáo.</div>`;

  bDrawCharts(list, v, one);
}

function bProjectDetail(d, v, open) {
  const lnDk = d.du_kien.doanh_thu[v] - d.du_kien.chi_phi[v], lnTh = d.thuc_hien.doanh_thu[v] - d.thuc_hien.chi_phi[v];
  const h = d.hds;
  const S = (f) => h.reduce((s, x) => s + f(x), 0);
  const cg = d.tp.chua_gan;
  const tp = (x) => (v === 'gt' ? x.qt_gt : x.qt_sv);
  const nhom = d.nhom.filter((n) => n[v]);
  const tongCp = d.du_kien.chi_phi[v];
  return `<details class="b-proj" ${open ? 'open' : ''}>
    <summary><span class="b-proj-title"><b>${esc(d.ma_du_an)}</b> – ${esc(d.ten_du_an)}</span>
      <span class="b-proj-sum">LN dự kiến ${bm(lnDk)} (${bpct(lnDk, d.du_kien.doanh_thu[v])}) · LN thực hiện ${bm(lnTh)} (${bpct(lnTh, d.thuc_hien.doanh_thu[v])})</span></summary>
    <div class="b-proj-body">
      <p class="b-proj-info">Chủ đầu tư: <b>${esc(d.chu_dau_tu || '—')}</b> · Trạng thái: <b>${esc(d.trang_thai)}</b> · Tiến độ: <b>${d.tien_do}%</b>
        ${d.ngay_bat_dau ? ` · Thời gian: ${dmy(d.ngay_bat_dau)}${d.ngay_ket_thuc ? ' → ' + dmy(d.ngay_ket_thuc) : ''}` : ''}
        <span class="no-print"> · <a href="#" data-bgo="revenue" data-id="${d.id}">Mở Doanh thu</a> · <a href="#" data-bgo="cost" data-id="${d.id}">Mở Chi phí</a></span></p>
      <div class="b-mini">
        <div><span>DT dự kiến</span><b>${bn(d.du_kien.doanh_thu[v])}</b></div><div><span>CP dự kiến</span><b>${bn(d.du_kien.chi_phi[v])}</b></div>
        <div><span>DT thực hiện</span><b>${bn(d.thuc_hien.doanh_thu[v])}</b></div><div><span>CP thực hiện</span><b>${bn(d.thuc_hien.chi_phi[v])}</b></div>
        <div><span>Tiền về</span><b>${bn(d.tien_ve)}</b></div><div><span>Còn phải thu</span><b>${bm(d.thuc_hien.con_lai)}</b></div>
        <div><span>Còn phải trả TP</span><b>${bm(d.tp.con_lai)}</b></div><div><span>Trả nợ gốc vay</span><b>${bn(d.tra_goc.sv)}</b></div>
      </div>
      <h4>Hợp đồng chủ đầu tư & thầu phụ</h4>
      <div class="table-wrap"><table class="b-table">
        <thead><tr><th rowspan="2">HĐ chủ đầu tư</th><th colspan="3" class="grp">Doanh thu</th><th colspan="2" class="grp">Thu tiền (sau VAT)</th><th colspan="4" class="grp">Thầu phụ</th><th rowspan="2" class="num">Lãi gộp dự kiến</th></tr>
        <tr><th class="num">Giá trị HĐ + PL</th><th class="num">Nghiệm thu</th><th class="num">% HT</th><th class="num">Tiền về</th><th class="num">Còn phải thu</th>
          <th class="num">Số HĐTP</th><th class="num">Giá trị HT/QT</th><th class="num">Đã trả (sau VAT)</th><th class="num">Còn phải trả</th></tr></thead>
        <tbody>${h.length ? h.map((x) => `<tr><td><b>${esc(x.so_ma)}</b>${x.so_pl ? ` <span class="muted small">+${x.so_pl} PL</span>` : ''} ${x.da_qt ? '<span class="st st-hoan-thanh">Đã QT</span>' : ''}${x.tam_tinh ? ' <span class="st st-tam-tinh">Tạm tính</span>' : ''}</td>
          <td class="num">${bn(x.hd[v])}</td><td class="num">${bn(x.nt[v])}</td><td class="num">${(x.pct_ht * 100).toFixed(1).replace('.', ',')}%</td>
          <td class="num">${bn(x.tien_ve)}</td><td class="num">${bm(x.phai_thu)}</td>
          <td class="num">${x.tp.n}${x.tp.n ? ` (${x.tp.n_qt} QT)` : ''}</td><td class="num">${bn(tp(x.tp))}</td><td class="num">${bn(x.tp.da_tt)}</td><td class="num">${bm(x.tp.con_lai)}</td>
          <td class="num strong">${bm(x.dk[v] - tp(x.tp))}</td></tr>`).join('') : '<tr><td colspan="11" class="empty">Chưa có HĐ chủ đầu tư</td></tr>'}
          ${cg.n ? `<tr class="tv-sub-warn"><td>Thầu phụ chưa gắn HĐ CĐT</td><td colspan="5"></td><td class="num">${cg.n}</td><td class="num">${bn(tp(cg))}</td><td class="num">${bn(cg.da_tt)}</td><td class="num">${bm(cg.con_lai)}</td><td class="num">${bm(-tp(cg))}</td></tr>` : ''}</tbody>
        <tfoot><tr><td>TỔNG</td><td class="num">${bn(S((x) => x.hd[v]))}</td><td class="num">${bn(S((x) => x.nt[v]))}</td><td class="num">${bpct(S((x) => x.nt.sv), S((x) => x.hd.sv))}</td>
          <td class="num">${bn(d.tien_ve)}</td><td class="num">${bm(S((x) => x.phai_thu))}</td><td class="num">${d.tp.n}</td><td class="num">${bn(tp(d.tp))}</td><td class="num">${bn(d.tp.da_tt)}</td><td class="num">${bm(d.tp.con_lai)}</td>
          <td class="num">${bm(S((x) => x.dk[v]) - tp(d.tp))}</td></tr></tfoot>
      </table></div>
      <p class="muted small">Lãi gộp dự kiến = Doanh thu dự kiến của HĐ − Giá trị HT/QT thầu phụ thuộc HĐ (chưa trừ vật tư, nhân công, gián tiếp, tài chính).</p>
      <h4>Cơ cấu chi phí dự kiến (${v === 'gt' ? 'trước VAT' : 'sau VAT'})</h4>
      <div class="table-wrap"><table class="b-table b-cost">
        <thead><tr><th>Khối / Nhóm chi phí</th><th class="num">Giá trị</th><th class="num">Tỷ trọng</th><th class="num">% doanh thu dự kiến</th></tr></thead>
        <tbody>${d.khoi.map((k) => `<tr class="b-khoi"><td>${esc(k.ten)}</td><td class="num">${bn(k[v])}</td><td class="num">${bpct(k[v], tongCp)}</td><td class="num">${bpct(k[v], d.du_kien.doanh_thu[v])}</td></tr>` +
          nhom.filter((n) => n.khoi === k.code).map((n) => `<tr><td class="indent-1">${esc(n.ten)}</td><td class="num">${bn(n[v])}</td><td class="num">${bpct(n[v], tongCp)}</td><td class="num">${bpct(n[v], d.du_kien.doanh_thu[v])}</td></tr>`).join('')).join('')}</tbody>
        <tfoot><tr><td>TỔNG CHI PHÍ</td><td class="num">${bn(tongCp)}</td><td class="num">100%</td><td class="num">${bpct(tongCp, d.du_kien.doanh_thu[v])}</td></tr></tfoot>
      </table></div>
      ${d.canh_bao.length ? `<h4>Cảnh báo</h4><ul class="b-warn">${d.canh_bao.map((w) => `<li class="m-${w.muc}"><b>${MUC[w.muc]}</b> ${esc(w.noi_dung)}</li>`).join('')}</ul>` : ''}
    </div>
  </details>`;
}

function bWarnTable(list) {
  const rank = { cao: 0, tb: 1, thap: 2 };
  const rows = list.flatMap((d) => d.canh_bao.map((w) => ({ ...w, da: d.ma_du_an }))).sort((a, b) => rank[a.muc] - rank[b.muc] || a.da.localeCompare(b.da));
  if (!rows.length) return '<p class="muted">Không có cảnh báo.</p>';
  return `<div class="table-wrap"><table class="b-table"><thead><tr><th>#</th><th>Mức</th><th>Dự án</th><th>Nội dung</th></tr></thead>
    <tbody>${rows.map((w, i) => `<tr><td class="num">${i + 1}</td><td><span class="b-muc m-${w.muc}">${MUC[w.muc]}</span></td><td>${esc(w.da)}</td><td class="wrap">${esc(w.noi_dung)}</td></tr>`).join('')}</tbody></table></div>`;
}

function bDrawCharts(list, v, one) {
  if ($('#f-ch-col')) bFinDraw(list, v);
  $$('#b-report .pc-card').forEach(bPcDraw);
  if (pcScrollTo) { const el = $(`#pc-${pcScrollTo}`); pcScrollTo = null; if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }
  const pts = bMonths(list, v);
  bLineChart($('#b-ch-line'), pts, [{ key: 'luy_dt', name: 'Doanh thu', color: BCOL.dt }, { key: 'luy_cp', name: 'Chi phí', color: BCOL.cp }]);
  bColChart($('#b-ch-flow'), pts, [{ key: 'thu', name: 'Thu (tiền về)', color: BCOL.thu }, { key: 'chi', name: 'Chi', color: BCOL.chi }],
    { tipExtra: (p) => `<tr class="sum"><td>Chênh lệch</td><td class="${p.thu - p.chi < 0 ? 'neg' : ''}">${bn(p.thu - p.chi)}</td></tr>` });
  const cg = bCostGroups(list, v);
  const tong = cg.reduce((s, x) => s + x.val, 0);
  bBarH($('#b-ch-cost'), cg.slice(0, 10).map((x) => ({ label: x.ten, values: [x.val] })), [{ name: 'Chi phí', color: BCOL.cp }], { pctOf: tong });
  if (one) {
    const tp = (x) => (v === 'gt' ? x.qt_gt : x.qt_sv);
    bBarH($('#b-ch-ln'), one.hds.map((x) => ({ label: x.so_ma, values: [x.dk[v] - tp(x.tp)] })), [{ name: 'Lãi gộp dự kiến', color: BCOL.dk }]);
  } else {
    bBarH($('#b-ch-ln'), list.map((d) => ({ label: `${d.ma_du_an} ${d.ten_du_an}`, values: [d.du_kien.doanh_thu[v] - d.du_kien.chi_phi[v], d.thuc_hien.doanh_thu[v] - d.thuc_hien.chi_phi[v]] })),
      [{ name: 'Dự kiến', color: BCOL.dk }, { name: 'Thực hiện', color: BCOL.th }]);
  }
}


// =====================================================================
// THẺ BÁO CÁO TỪNG CÔNG TRÌNH (ảnh, 7 tab: Tổng quan · Doanh thu · Chi phí · Lợi nhuận · Dòng tiền · Công nợ · Hạng mục)
// =====================================================================
const PC_TABS = [['tong', 'Tổng quan'], ['dt', 'Doanh thu'], ['cp', 'Chi phí'], ['ln', 'Lợi nhuận'], ['dong', 'Dòng tiền'], ['cn', 'Công nợ'], ['hm', 'Hạng mục']];
const pcTab = {};            // id dự án -> tab đang mở
const NHOM_NGAN = { thau_phu: 'Thầu phụ', vat_tu: 'Vật tư', nhan_cong: 'Nhân công', may_moc: 'Máy móc', to_chuc: 'Tổ chức TC', khac: 'Khác',
  gt_tien_ich: 'Tiện ích/phục vụ', gt_luong: 'Lương, thưởng', gt_ngoai_giao: 'Ngoại giao', tc_chi_phi: 'CP tài chính', tc_tra_no: 'Lãi vay', tc_phat: 'Phạt CĐT' };
let pcScrollTo = null;       // mở báo cáo từ tab Dự án -> cuộn tới thẻ
const BUILDING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V5l8-3v19M13 8h6v13M8 7h2M8 11h2M8 15h2M16 12h1M16 16h1"/></svg>';
const canEditPc = () => ['admin', 'editor'].includes(ME.role);

function openProjectReport(id) {
  BST.project = String(id);
  bSave();
  pcScrollTo = id;
  showTab('report');
}

function bDeltaS(cur, prev, good = true) {
  if (prev === null || prev === undefined || !prev) return '';
  const p = (cur - prev) / Math.abs(prev);
  return `<span class="f-delta ${(p >= 0) === good ? 'ok' : 'bad'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p * 100).toFixed(0)}%</span>`;
}

function bPcSection(list, v) {
  const P = bPeriod(list);
  return `<section class="card b-sec pc-sec">
    <div class="f-head"><h2>Báo cáo theo công trình</h2><div class="f-range">Kỳ: ${esc(P.label)} · ${P.range}</div></div>
    <div class="pc-grid ${list.length === 1 ? 'one' : ''}">${list.map((d) => bPcCard(d, BC.du_an.indexOf(d))).join('')}</div>
  </section>`;
}

function bPcCard(d, idx) {
  const color = PROJ_COLORS[idx % PROJ_COLORS.length];
  const tab = pcTab[d.id] || 'tong';
  const sub = [d.loai_cong_trinh, d.dia_diem].filter(Boolean).join(' – ') || d.chu_dau_tu || '';
  const img = d.co_anh
    ? `<img src="/api/du-an/${d.id}/anh?v=${d.anh_v}" alt="Ảnh ${esc(d.ten_du_an)}" loading="lazy">`
    : `<span class="pc-noimg">${BUILDING}${canEditPc() ? '<small>Thêm ảnh</small>' : ''}</span>`;
  return `<article class="pc-card" id="pc-${d.id}" data-pc="${d.id}" style="--pc:${color}">
    <header class="pc-head">
      <span class="pc-no">${idx + 1}</span>
      <div class="pc-img ${canEditPc() ? 'editable' : ''}" ${canEditPc() ? `data-pcimg="${d.id}" title="Bấm để ${d.co_anh ? 'đổi' : 'thêm'} ảnh công trình"` : ''}>${img}
        ${canEditPc() && d.co_anh ? `<button type="button" class="pc-img-del no-print" data-pcimgdel="${d.id}" title="Xóa ảnh">×</button>` : ''}</div>
      <div class="pc-title">
        <h3>${esc(d.ma_du_an)} – ${esc(d.ten_du_an)}</h3>
        <div class="pc-sub">${esc(sub)}</div>
        <div class="pc-meta"><span class="pc-st">${esc(d.trang_thai)}</span><span class="pc-prog">Tiến độ: <b>${d.tien_do}%</b><i><b style="width:${Math.min(100, d.tien_do)}%"></b></i></span></div>
      </div>
    </header>
    <nav class="pc-tabs no-print">${PC_TABS.map(([k, t]) => `<button type="button" data-pt="${k}" class="${k === tab ? 'on' : ''}">${t}</button>`).join('')}</nav>
    <div class="pc-body">${bPcBody(d, tab)}</div>
    <button type="button" class="pc-more no-print" data-pdetail="${d.id}">Xem chi tiết công trình ${esc(d.ma_du_an)} →</button>
  </article>`;
}

function bPcBody(d, tab) {
  const v = BST.vat;
  const P = bPeriod(bScope().list);
  const cur = bSumRange([d], v, P.from, P.to);
  const prv = P.prev ? bSumRange([d], v, P.prev.from, P.prev.to) : null;
  const K = d.du_kien, H = d.thuc_hien;
  const mini = (label, val, extra = '', cls = '') => `<div class="pc-k ${cls}"><span>${label}</span><b class="${val < 0 ? 'neg' : ''}">${typeof val === 'number' ? bTy(val) : val}</b>${extra}</div>`;
  const row = (l, val, cls = '') => `<li><span>${l}</span><b class="${cls} ${val < 0 ? 'neg' : ''}">${typeof val === 'number' ? bTy(val) + ' tỷ' : val}</b></li>`;
  const tpv = (x) => (v === 'gt' ? x.qt_gt : x.qt_sv);
  const kyNote = `<div class="pc-note">Kỳ ${esc(P.label)} · đơn vị tỷ đồng (${v === 'gt' ? 'trước VAT' : 'sau VAT'})</div>`;
  switch (tab) {
    case 'dt': return `<div class="pc-kpis">${mini('DT dự kiến', K.doanh_thu[v])}${mini('DT thực hiện', H.doanh_thu[v], '<small>lũy kế</small>')}${mini('DT trong kỳ', cur.dt, bDeltaS(cur.dt, prv?.dt))}${mini('% hoàn thành', bpct(H.doanh_thu.sv, K.doanh_thu.sv))}</div>
      <table class="pc-tbl"><thead><tr><th>HĐ chủ đầu tư</th><th class="num">HĐ + PL</th><th class="num">Nghiệm thu</th><th>% HT</th></tr></thead>
      <tbody>${d.hds.map((x) => `<tr><td>${esc(x.so_ma)}${x.da_qt ? ' <span class="st st-hoan-thanh">QT</span>' : ''}</td><td class="num">${bTy(x.hd[v])}</td><td class="num">${bTy(x.nt[v])}</td>
        <td><span class="pc-bar"><i style="width:${Math.min(100, x.pct_ht * 100)}%"></i></span>${(x.pct_ht * 100).toFixed(0)}%</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Chưa có HĐ</td></tr>'}</tbody></table>
      <div class="pc-note">Đơn vị tỷ đồng</div>`;
    case 'cp': {
      const tong = K.chi_phi[v];
      return `<div class="pc-kpis">${mini('CP dự kiến', tong)}${mini('CP thực hiện', H.chi_phi[v], '<small>lũy kế</small>')}${mini('CP trong kỳ', cur.cp, bDeltaS(cur.cp, prv?.cp, false))}${mini('% doanh thu DK', bpct(tong, K.doanh_thu[v]))}</div>
        <ul class="pc-list">${d.khoi.map((k) => `<li><span>${esc(k.ten)}</span><span class="pc-bar wide"><i style="width:${tong ? Math.max(0, (k[v] / tong) * 100) : 0}%"></i></span><b>${bTy(k[v])} · ${bpct(k[v], tong)}</b></li>`).join('')}</ul>
        <div class="pc-note">Chi phí dự kiến theo khối · trả nợ gốc vay ${bTy(d.tra_goc.sv)} tỷ không tính</div>`;
    }
    case 'ln': {
      const a = K.doanh_thu[v] - K.chi_phi[v], b = H.doanh_thu[v] - H.chi_phi[v];
      const items = d.hds.map((x) => ({ l: x.so_ma, val: x.dk[v] - tpv(x.tp) }));
      const mx = Math.max(1, ...items.map((x) => Math.abs(x.val)));
      return `<div class="pc-kpis">${mini('LN dự kiến', a, `<small>${bpct(a, K.doanh_thu[v])}</small>`)}${mini('LN thực hiện', b, `<small>lũy kế · ${bpct(b, H.doanh_thu[v])}</small>`)}${mini('LN trong kỳ', cur.ln, bDeltaS(cur.ln, prv?.ln))}${mini('Tỷ suất kỳ', bpct(cur.ln, cur.dt))}</div>
        <div class="pc-sub-h">Lãi gộp dự kiến theo HĐ (DT − thầu phụ)</div>
        <ul class="pc-list">${items.map((x) => `<li><span>${esc(x.l)}</span><span class="pc-bar wide ${x.val < 0 ? 'neg-bar' : ''}"><i style="width:${(Math.abs(x.val) / mx) * 100}%"></i></span><b class="${x.val < 0 ? 'neg' : ''}">${bTy(x.val)}</b></li>`).join('') || '<li class="muted">Chưa có HĐ</li>'}</ul>`;
    }
    case 'dong': return `<div class="pc-kpis">${mini('Thu (tiền về)', cur.thu, bDeltaS(cur.thu, prv?.thu))}${mini('Chi', cur.chi, bDeltaS(cur.chi, prv?.chi, false))}${mini('Dòng tiền', cur.dong_tien)}${mini('Số dư cuối kỳ', bBalance([d], P.to))}</div>
      <div class="chart pc-chart" data-pcchart="dong"></div>${kyNote.replace('trước VAT', 'sau VAT')}`;
    case 'cn': {
      const thu = d.hds.filter((x) => x.phai_thu).sort((a, b) => b.phai_thu - a.phai_thu);
      const tra = [...d.hds.filter((x) => x.tp.con_lai).map((x) => ({ l: x.so_ma, val: x.tp.con_lai })), ...(d.tp.chua_gan.con_lai ? [{ l: 'Chưa gắn HĐ CĐT', val: d.tp.chua_gan.con_lai }] : [])].sort((a, b) => b.val - a.val);
      return `<div class="pc-kpis">${mini('Phải thu', H.con_lai)}${mini('Phải trả TP', d.tp.con_lai)}${mini('Đã trả TP', d.tp.da_tt)}${mini('Trả nợ gốc vay', d.tra_goc.sv)}</div>
        <div class="pc-2col"><div><div class="pc-sub-h">Phải thu theo HĐ</div><ul class="pc-list compact">${thu.map((x) => row(x.so_ma, x.phai_thu)).join('') || '<li class="muted">Không có</li>'}</ul></div>
        <div><div class="pc-sub-h">Phải trả thầu phụ theo HĐ CĐT</div><ul class="pc-list compact">${tra.map((x) => row(x.l, x.val)).join('') || '<li class="muted">Không có</li>'}</ul></div></div>
        <div class="pc-note">Sau VAT · phải thu = nghiệm thu − tiền về (âm: CĐT ứng trước)</div>`;
    }
    case 'hm': {
      const tong = K.chi_phi[v];
      const ns = d.nhom.filter((n) => n[v]).sort((a, b) => b[v] - a[v]);
      return `<table class="pc-tbl"><thead><tr><th>Hạng mục chi phí</th><th class="num">Giá trị</th><th class="num">Tỷ trọng</th></tr></thead>
        <tbody>${ns.map((n) => `<tr><td>${esc(n.ten)}${n.code === 'thau_phu' ? ` <span class="muted small">(${d.so_tp} HĐTP · ${d.so_tp_qt} QT)</span>` : ''}</td><td class="num">${bTy(n[v])}</td><td class="num">${bpct(n[v], tong)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Chưa có chi phí</td></tr>'}</tbody>
        <tfoot><tr><td>Tổng chi phí</td><td class="num">${bTy(tong)}</td><td class="num">100%</td></tr></tfoot></table><div class="pc-note">Chi phí dự kiến · tỷ đồng</div>`;
    }
    default: { // tổng quan
      const groups = d.nhom.filter((n) => n[v] > 0).sort((a, b) => b[v] - a[v]);
      const top = groups.slice(0, 5);
      const rest = groups.slice(5).reduce((s2, n) => s2 + n[v], 0);
      const parts = [...top.map((n, i) => ({ l: NHOM_NGAN[n.code] || n.ten, val: n[v], c: PROJ_COLORS[i] })), ...(rest ? [{ l: 'Khác', val: rest, c: '#b5b3ab' }] : [])];
      return `<div class="pc-kpis">${mini('Doanh thu', cur.dt, bDeltaS(cur.dt, prv?.dt), 'k-dt')}${mini('Chi phí', cur.cp, bDeltaS(cur.cp, prv?.cp, false), 'k-cp')}${mini('Lợi nhuận', cur.ln, bDeltaS(cur.ln, prv?.ln), 'k-ln')}${mini('Tỷ suất LN', bpct(cur.ln, cur.dt), '', 'k-ts')}</div>
        <div class="pc-sub-h">Doanh thu – Chi phí – Lợi nhuận (tỷ đồng)</div>
        <div class="chart pc-chart" data-pcchart="tong"></div>
        <div class="pc-2col">
          <div><div class="pc-sub-h">Cơ cấu chi phí</div><div class="pc-donut" data-pcdonut='${JSON.stringify(parts).replace(/'/g, '&#39;')}'></div></div>
          <div><div class="pc-sub-h">Tình hình công nợ</div><ul class="pc-list compact">
            ${row('Phải thu', H.con_lai)}${row('Phải trả TP', d.tp.con_lai)}${row('Tiền về trong kỳ', cur.thu)}${row('Số dư cuối kỳ', bBalance([d], P.to), 'strong')}</ul></div>
        </div>${kyNote}`;
    }
  }
}

function bPcDraw(card) {
  const id = Number(card.dataset.pc);
  const d = BC.du_an.find((x) => x.id === id);
  if (!d) return;
  const P = bPeriod(bScope().list);
  const ch = $('[data-pcchart]', card);
  if (ch) {
    const pts = bSeries([d], BST.vat, P);
    if (ch.dataset.pcchart === 'dong') bColChart(ch, pts, [{ key: 'thu', name: 'Thu', color: BCOL.thu }, { key: 'chi', name: 'Chi', color: BCOL.chi }], { height: 170, valueLabels: pts.length <= 4 });
    else bColChart(ch, pts, [{ key: 'dt', name: 'Doanh thu', color: BCOL.dt }, { key: 'cp', name: 'Chi phí', color: BCOL.cp }, { key: 'ln', name: 'Lợi nhuận', color: BCOL.dk }], { height: 170, valueLabels: pts.length <= 4 });
  }
  const dn = $('[data-pcdonut]', card);
  if (dn) bMiniDonut(dn, JSON.parse(dn.dataset.pcdonut));
}

function bMiniDonut(el, parts) {
  const total = parts.reduce((s2, x) => s2 + x.val, 0);
  if (!total) return bEmpty(el, 'Chưa có chi phí');
  const S = 92, R = 44, r0 = 27, c = S / 2;
  el.innerHTML = '';
  const svg = svgEl('svg', { viewBox: `0 0 ${S} ${S}`, width: S, height: S, role: 'img', 'aria-label': 'Cơ cấu chi phí' }, el);
  let a = 0;
  const pt = (ang, rr) => [c + rr * Math.sin(ang), c - rr * Math.cos(ang)];
  for (const x of parts) {
    let a1 = a + (x.val / total) * Math.PI * 2;
    if (a1 - a >= Math.PI * 2 - 1e-9) a1 = a + Math.PI * 2 - 1e-4;
    const big = a1 - a > Math.PI ? 1 : 0;
    const [x0, y0] = pt(a, R), [x1, y1] = pt(a1, R), [x2, y2] = pt(a1, r0), [x3, y3] = pt(a, r0);
    const path = svgEl('path', { d: `M${x0},${y0}A${R},${R} 0 ${big} 1 ${x1},${y1}L${x2},${y2}A${r0},${r0} 0 ${big} 0 ${x3},${y3}Z`, fill: x.c, stroke: '#fff', 'stroke-width': 1.5 }, svg);
    path.addEventListener('mousemove', (e) => showTip(`<b>${esc(x.l)}</b><br>${bn(x.val)} đ · ${bpct(x.val, total)}`, e.clientX, e.clientY));
    path.addEventListener('mouseleave', hideTip);
    a = a1;
  }
  svgEl('text', { x: c, y: c + 4, 'text-anchor': 'middle', class: 'pc-donut-c' }, svg).textContent = bTy(total);
  const ul = document.createElement('ul');
  ul.className = 'pc-legend';
  ul.innerHTML = parts.map((x) => `<li><i style="background:${x.c}"></i><span title="${esc(x.l)}">${esc(x.l)}</span><b>${bpct(x.val, total).replace(',0%', '%')}</b></li>`).join('');
  el.appendChild(ul);
}

// Ảnh công trình: thu nhỏ (cạnh dài ≤ 1280px, JPEG) rồi tải lên
async function bUploadImage(id, file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Chỉ nhận ảnh JPG, PNG hoặc WEBP');
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.85));
  const r = await fetch(`/api/du-an/${id}/anh`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'X-Requested-With': 'fetch' }, body: blob });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error((j.errors || [j.error]).filter(Boolean).join('; ') || 'Không tải được ảnh'); }
}

$('#b-report').addEventListener('click', async (e) => {
  const card = e.target.closest('.pc-card');
  if (!card) return;
  const id = Number(card.dataset.pc);
  const t = e.target.closest('[data-pt]');
  if (t) {
    pcTab[id] = t.dataset.pt;
    $$('.pc-tabs button', card).forEach((b) => b.classList.toggle('on', b === t));
    $('.pc-body', card).innerHTML = bPcBody(BC.du_an.find((x) => x.id === id), t.dataset.pt);
    return bPcDraw(card);
  }
  if (e.target.closest('[data-pdetail]')) { BST.project = String(id); bSave(); renderReport(); return window.scrollTo({ top: 0, behavior: 'smooth' }); }
  if (e.target.closest('[data-pcimgdel]')) {
    e.stopPropagation();
    if (!confirm('Xóa ảnh công trình này?')) return;
    try { await api(`/api/du-an/${id}/anh`, { method: 'DELETE' }); await loadReport(); } catch (err) { alert(err.message); }
    return;
  }
  if (e.target.closest('[data-pcimg]')) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/jpeg,image/png,image/webp';
    inp.onchange = async () => {
      if (!inp.files[0]) return;
      showMsg($('#b-msg'), 'Đang tải ảnh lên...');
      try { await bUploadImage(id, inp.files[0]); showMsg($('#b-msg'), 'Đã cập nhật ảnh công trình'); await loadReport(); }
      catch (err) { showMsg($('#b-msg'), err.message, 'err'); }
    };
    inp.click();
  }
});

// ---------------------------------------------------------------------
// Sự kiện
// ---------------------------------------------------------------------
$('#b-project').addEventListener('change', (e) => { BST.project = e.target.value; bSave(); renderReport(); });
$('#b-vat').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; BST.vat = b.dataset.v; bSave(); renderReport(); });
$('#b-ky').addEventListener('change', (e) => { BST.ky = e.target.value; bSave(); renderReport(); });
$('#b-ky-custom').addEventListener('change', () => { BST.tu = $('#b-tu').value; BST.den = $('#b-den').value; bSave(); renderReport(); });
$('#b-reload').addEventListener('click', () => loadReport().catch((err) => alert(err.message)));
$('#b-report').addEventListener('click', (e) => {
  if (e.target.id === 'b-open-all' || e.target.id === 'b-close-all') $$('#b-report details.b-proj').forEach((d) => (d.open = e.target.id === 'b-open-all'));
  if (e.target.id === 'f-set-target') return bTargetDialog();
  const go = e.target.dataset.bgo;
  if (go) { e.preventDefault(); revProjectId = Number(e.target.dataset.id); showTab(go); }
});
let bResize;
window.addEventListener('resize', () => { clearTimeout(bResize); bResize = setTimeout(() => { if (BC && !$('#tab-report').hidden) bDrawCharts(bScope().list, BST.vat, bScope().one); }, 200); });

// In / PDF: mở hết chi tiết, vẽ lại biểu đồ theo khổ giấy
let bOpenState = null;
window.addEventListener('beforeprint', () => {
  if ($('#tab-report').hidden || !BC) return;
  bOpenState = $$('#b-report details.b-proj').map((d) => d.open);
  $$('#b-report details.b-proj').forEach((d) => (d.open = true));
});
window.addEventListener('afterprint', () => {
  if (!bOpenState) return;
  $$('#b-report details.b-proj').forEach((d, i) => (d.open = bOpenState[i]));
  bOpenState = null;
});
$('#b-print').addEventListener('click', () => window.print());

// ---------------------------------------------------------------------
// Tải thư viện xuất (nhúng sẵn trong /vendor, chỉ tải khi cần)
// ---------------------------------------------------------------------
const bLibs = {};
function bLoad(src) {
  return (bLibs[src] ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Không tải được thư viện xuất file'));
    document.head.appendChild(s);
  }));
}
const bStamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');
const bFileScope = () => { const { one } = bScope(); return one ? one.ma_du_an.replace(/[^\w-]+/g, '') : 'TatCaDuAn'; };
async function bBusy(btn, fn) {
  const t = btn.textContent;
  btn.disabled = true; btn.textContent = 'Đang xuất...';
  try { await fn(); showMsg($('#b-msg'), ''); } catch (err) { showMsg($('#b-msg'), err.message, 'err'); }
  btn.disabled = false; btn.textContent = t;
}

// ---------- Excel ----------
$('#b-xlsx').addEventListener('click', (e) => bBusy(e.target, async () => {
  await bLoad('/vendor/xlsx-0.18.5.full.min.js');
  const { list, one } = bScope();
  const v = BST.vat, vt = v === 'gt' ? 'trước VAT' : 'sau VAT';
  const T = bTotals(list);
  const wb = XLSX.utils.book_new();
  const add = (name, rows, widths) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    for (const k of Object.keys(ws)) if (k[0] !== '!' && ws[k].t === 'n' && Math.abs(ws[k].v) >= 1000) ws[k].z = '#,##0';
    if (widths) ws['!cols'] = widths.map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, name);
    return ws;
  };
  const table = (name, head, rows, widths) => {
    const ws = add(name, [head, ...rows], widths);
    if (rows.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: head.length - 1 } }) };
  };
  const F = bFinData(list, v);
  const chg = (a, b) => (F.prv && b ? (a - b) / Math.abs(b) : '');
  const tsY = F.ytd.dt ? (F.ytd.ln / F.ytd.dt) * 100 : 0;
  const pctT = (a, t) => (t ? a / t : '');
  const wsF = add('Tai chinh ky', [
    ['TỔNG QUAN TÀI CHÍNH THEO KỲ'], [BC.ten_cong_ty || ''],
    ['Kỳ báo cáo', `${F.P.label} (${F.P.range})`], ['So với kỳ trước', F.P.prev ? `${ymTxt(F.P.prev.from)} – ${ymTxt(F.P.prev.to)}` : '—'], ['Đơn vị', `VNĐ, ${vt} (dòng tiền sau VAT)`], [],
    ['Chỉ tiêu', 'Kỳ này', 'Kỳ trước', '% thay đổi'],
    ['Tổng doanh thu', F.cur.dt, F.prv ? F.prv.dt : '', chg(F.cur.dt, F.prv?.dt)],
    ['Tổng chi phí', F.cur.cp, F.prv ? F.prv.cp : '', chg(F.cur.cp, F.prv?.cp)],
    ['Lợi nhuận', F.cur.ln, F.prv ? F.prv.ln : '', chg(F.cur.ln, F.prv?.ln)],
    ['Tỷ suất lợi nhuận', F.cur.dt ? F.cur.ln / F.cur.dt : 0, F.prv && F.prv.dt ? F.prv.ln / F.prv.dt : '', ''],
    ['Dòng tiền thực tế (thu − chi)', F.cur.dong_tien, F.prv ? F.prv.dong_tien : '', chg(F.cur.dong_tien, F.prv?.dong_tien)],
    ['  Thu (tiền về)', F.cur.thu, F.prv ? F.prv.thu : '', ''], ['  Chi', F.cur.chi, F.prv ? F.prv.chi : '', ''],
    ['Số dư dòng tiền cuối kỳ', F.bal, '', ''], [],
    [`Mục tiêu năm ${F.year}`, `Thực hiện 01/${F.year} – ${ymTxt(F.P.to)}`, 'Mục tiêu', '% đạt'],
    ['Doanh thu', F.ytd.dt, F.tg.dt ?? '', pctT(F.ytd.dt, F.tg.dt)], ['Chi phí', F.ytd.cp, F.tg.cp ?? '', pctT(F.ytd.cp, F.tg.cp)],
    ['Lợi nhuận', F.ytd.ln, F.tg.ln ?? '', pctT(F.ytd.ln, F.tg.ln)], ['Tỷ suất lợi nhuận (%)', Number(tsY.toFixed(2)), F.tg.ty_suat ?? '', pctT(tsY, F.tg.ty_suat)], [],
    ['Theo tháng / quý', 'Doanh thu', 'Chi phí', 'Lợi nhuận', 'Thu', 'Chi', 'Dòng tiền'],
    ...F.series.map((p) => [p.label, p.dt, p.cp, p.ln, p.thu, p.chi, p.dong_tien]), [],
    ['Hiệu quả từng công trình', 'Doanh thu', 'Chi phí', 'Lợi nhuận', 'Tỷ suất LN', 'Tỷ trọng doanh thu'],
    ...F.rows.map((x) => [`${x.d.ma_du_an} – ${x.d.ten_du_an}`, x.dt, x.cp, x.ln, x.dt ? x.ln / x.dt : '', F.cur.dt ? x.dt / F.cur.dt : '']),
  ], [40, 22, 22, 18, 18, 18, 18]);
  for (const k of Object.keys(wsF)) {
    if (k[0] === '!') continue;
    const { r: row, c } = XLSX.utils.decode_cell(k);
    const isPct = (row === 10 && c <= 2) || (c === 3 && ((row >= 7 && row <= 11) || (row >= 17 && row <= 20))) || (row > 21 + F.series.length + 2 && (c === 4 || c === 5));
    if (isPct && wsF[k].t === 'n') wsF[k].z = '0.0%';
  }
  const lnDk = T.dk.dt[v] - T.dk.cp[v], lnTh = T.th.dt[v] - T.th.cp[v];
  add('Tong quan', [
    ['BÁO CÁO TỔNG QUAN DỰ ÁN'], [BC.ten_cong_ty || ''],
    ['Phạm vi', one ? `${one.ma_du_an} – ${one.ten_du_an}` : `Tất cả dự án (${list.length})`],
    ['Lập lúc', new Date(BC.lap_luc).toLocaleString('vi-VN')], ['Người lập', BC.nguoi_lap], ['Phiên bản', BC.phien_ban], ['Đơn vị', `VNĐ, ${vt}`], [],
    ['Chỉ tiêu', 'Dự kiến', 'Thực hiện'],
    ['Doanh thu', T.dk.dt[v], T.th.dt[v]], ['Chi phí', T.dk.cp[v], T.th.cp[v]], ['Lợi nhuận', lnDk, lnTh],
    ['Tỷ suất lợi nhuận', T.dk.dt[v] ? lnDk / T.dk.dt[v] : 0, T.th.dt[v] ? lnTh / T.th.dt[v] : 0], [],
    ['Dòng tiền & công nợ (sau VAT)', 'Giá trị'], ['Tiền về', T.tien_ve], ['Còn phải thu (theo nghiệm thu)', T.th.con_lai], ['Còn lại theo HĐ', T.dk.con_lai],
    ['Đã trả thầu phụ', T.tp_da_tt], ['Còn phải trả thầu phụ', T.tp_con_lai], ['Trả nợ gốc vay (không tính chi phí)', T.tra_goc], [],
    ['Số dự án', T.so_da], ['HĐ chủ đầu tư', T.so_hd], ['HĐ CĐT đã quyết toán', T.so_hd_qt], ['HĐ thầu phụ', T.so_tp], ['HĐ thầu phụ đã quyết toán', T.so_tp_qt],
  ], [38, 22, 22]);
  const ws0 = wb.Sheets['Tong quan'];
  ['B13', 'C13'].forEach((c) => { if (ws0[c]) ws0[c].z = '0.0%'; });
  table('Du an', ['Mã DA', 'Tên dự án', 'Chủ đầu tư', 'Trạng thái', 'Tiến độ %', 'Số HĐ CĐT', 'HĐ đã QT', 'Số HĐTP', 'HĐTP đã QT',
    `DT dự kiến (${vt})`, `CP dự kiến (${vt})`, `LN dự kiến (${vt})`, `DT thực hiện (${vt})`, `CP thực hiện (${vt})`, `LN thực hiện (${vt})`,
    'Tiền về', 'Còn phải thu', 'Đã trả TP', 'Còn phải trả TP', 'Trả nợ gốc vay', 'Số cảnh báo'],
  list.map((d) => [d.ma_du_an, d.ten_du_an, d.chu_dau_tu, d.trang_thai, d.tien_do, d.so_hd, d.so_hd_qt, d.so_tp, d.so_tp_qt,
    d.du_kien.doanh_thu[v], d.du_kien.chi_phi[v], d.du_kien.doanh_thu[v] - d.du_kien.chi_phi[v],
    d.thuc_hien.doanh_thu[v], d.thuc_hien.chi_phi[v], d.thuc_hien.doanh_thu[v] - d.thuc_hien.chi_phi[v],
    d.tien_ve, d.thuc_hien.con_lai, d.tp.da_tt, d.tp.con_lai, d.tra_goc.sv, d.canh_bao.length]),
  [10, 32, 28, 14, 9, 9, 9, 9, 10, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 16, 10]);
  table('HD chu dau tu', ['Mã DA', 'Số HĐ', 'Ngày HĐ', 'VAT %', 'Số PL', `Giá trị HĐ+PL (${vt})`, `Nghiệm thu (${vt})`, '% hoàn thành', 'Đã quyết toán',
    `DT dự kiến (${vt})`, 'Tiền về', 'Còn phải thu', 'Số HĐTP', 'HĐTP đã QT', `Giá trị TP HT/QT (${vt})`, 'Đã trả TP', 'Còn phải trả TP', `Lãi gộp dự kiến (${vt})`],
  list.flatMap((d) => d.hds.map((x) => [d.ma_du_an, x.so_ma, x.ngay || '', x.vat, x.so_pl, x.hd[v], x.nt[v], Number(x.pct_ht.toFixed(4)), x.da_qt ? 'Có' : '',
    x.dk[v], x.tien_ve, x.phai_thu, x.tp.n, x.tp.n_qt, v === 'gt' ? x.tp.qt_gt : x.tp.qt_sv, x.tp.da_tt, x.tp.con_lai, x.dk[v] - (v === 'gt' ? x.tp.qt_gt : x.tp.qt_sv)])),
  [10, 22, 11, 7, 7, 18, 18, 11, 12, 18, 18, 18, 9, 10, 18, 18, 18, 18]);
  table('Thau phu', ['Mã DA', 'Thuộc HĐ CĐT', 'Số HĐ thầu phụ', 'Nhà thầu phụ', 'Số PL', 'Giá trị HĐ+PL (sau VAT)', 'HT/QT (trước VAT)', 'HT/QT (sau VAT)', 'Đã thanh toán', 'Còn lại', 'Trạng thái', 'Ghi chú'],
    list.flatMap((d) => d.chi_tiet.thau_phu.map((x) => [d.ma_du_an, x.hd_cdt, x.so_ma, x.doi_tac, x.so_pl, x.hd_sv, x.qt_gt, x.qt_sv, x.da_tt, x.con_lai, x.trang_thai, x.ghi_chu])),
    [10, 24, 18, 28, 7, 18, 18, 18, 18, 18, 20, 40]);
  table('Chi phi', ['Mã DA', 'Khối', 'Nhóm', 'Hạng mục', 'Nội dung', 'Đối tác', 'Số CT', 'Ngày', 'Trước VAT', 'VAT %', 'Tiền VAT', 'Sau VAT', 'Tính vào chi phí', 'Ghi chú'],
    list.flatMap((d) => d.chi_tiet.chi_phi.map((x) => [d.ma_du_an, x.khoi, x.nhom, x.hang_muc, x.noi_dung, x.doi_tac, x.so_ct, x.ngay || '', x.gia_tri, x.vat, x.tien_vat, x.sau_vat, x.tinh_cp, x.ghi_chu])),
    [10, 20, 28, 28, 34, 24, 18, 11, 16, 7, 14, 16, 18, 30]);
  table('Doanh thu', ['Mã DA', 'Loại', 'Số HĐ/PL – Đợt', 'Thuộc HĐ', 'Ngày', 'Trước VAT', 'VAT %', 'Tiền VAT', 'Sau VAT', 'Ghi chú'],
    list.flatMap((d) => d.chi_tiet.doanh_thu.map((x) => [d.ma_du_an, x.loai, x.so_hieu, x.thuoc_hd, x.ngay || '', x.gia_tri, x.vat, x.tien_vat, x.sau_vat, x.ghi_chu])),
    [10, 8, 28, 26, 11, 18, 7, 16, 18, 30]);
  table('Tien ve', ['Mã DA', 'HĐ', 'Loại', 'Ngày', 'Số tiền', 'Ghi chú'],
    list.flatMap((d) => d.chi_tiet.tien_ve.map((x) => [d.ma_du_an, x.hd, x.loai, x.ngay || '', x.so_tien, x.ghi_chu])), [10, 26, 14, 11, 18, 30]);
  table('Theo thang', ['Tháng', `DT thực hiện (${vt})`, `CP thực hiện (${vt})`, 'DT lũy kế', 'CP lũy kế', 'Thu (tiền về)', 'Chi', 'Chênh lệch thu – chi'],
    bMonths(list, v).map((p) => [p.k, p.dt, p.cp, p.luy_dt, p.luy_cp, p.thu, p.chi, p.thu - p.chi]), [10, 18, 18, 18, 18, 18, 18, 18]);
  table('Canh bao', ['Mã DA', 'Mức', 'Nội dung'], list.flatMap((d) => d.canh_bao.map((w) => [d.ma_du_an, MUC[w.muc], w.noi_dung])), [10, 12, 90]);
  XLSX.writeFile(wb, `BaoCao_${bFileScope()}_${bStamp()}.xlsx`);
}));

// ---------- PowerPoint ----------
$('#b-pptx').addEventListener('click', (e) => bBusy(e.target, async () => {
  await bLoad('/vendor/pptxgenjs-3.12.0.bundle.js');
  const { list, one } = bScope();
  const v = BST.vat, vt = v === 'gt' ? 'trước VAT' : 'sau VAT';
  const T = bTotals(list);
  const NAVY = '1F3A6E', TEAL = '0FA3A3', INK = '1E293B', MUTED = '64748B', LINE = 'E3E9F2';
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.company = BC.ten_cong_ty || '';
  pptx.title = 'Báo cáo tổng quan dự án';
  const FONT = 'Arial';
  const scope = one ? `${one.ma_du_an} – ${one.ten_du_an}` : `Tất cả dự án (${list.length})`;
  const dateTxt = new Date(BC.lap_luc).toLocaleDateString('vi-VN');
  pptx.defineSlideMaster({
    title: 'TMN', background: { color: 'FFFFFF' },
    objects: [
      { rect: { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: TEAL } } },
      { text: { text: `${BC.ten_cong_ty || ''} · Báo cáo tổng quan dự án · ${dateTxt}`, options: { x: 0.5, y: 7.05, w: 9, h: 0.3, fontFace: FONT, fontSize: 9, color: MUTED } } },
    ],
    slideNumber: { x: 12.3, y: 7.05, w: 0.6, h: 0.3, fontFace: FONT, fontSize: 9, color: MUTED, align: 'right' },
  });
  const slide = (title, sub) => {
    const s = pptx.addSlide({ masterName: 'TMN' });
    s.addText(title, { x: 0.5, y: 0.3, w: 12.3, h: 0.6, fontFace: FONT, fontSize: 24, bold: true, color: NAVY });
    if (sub) s.addText(sub, { x: 0.5, y: 0.85, w: 12.3, h: 0.35, fontFace: FONT, fontSize: 12, color: MUTED });
    return s;
  };
  const ty = (n) => bTy(n);
  const hd = (t) => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: NAVY }, align: 'center', valign: 'middle' } });
  const num = (n, extra = {}) => ({ text: typeof n === 'string' ? n : ty(n), options: { align: 'right', color: typeof n === 'number' && n < 0 ? 'D92D35' : INK, ...extra } });
  const tblOpt = { x: 0.5, y: 1.35, w: 12.3, fontFace: FONT, fontSize: 10, color: INK, border: { type: 'solid', pt: 0.5, color: LINE }, autoPage: true, autoPageRepeatHeader: true, autoPageSlideStartY: 1.35, newSlideStartY: 1.35, rowH: 0.3, margin: 0.04 };
  const chartOpt = { x: 0.5, y: 1.35, w: 12.3, h: 5.5, fontFace: FONT, showLegend: true, legendPos: 't', legendFontSize: 11, catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
    valAxisLabelFormatCode: '#,##0.0', valGridLine: { color: LINE, size: 0.5 }, catAxisLineShow: true };

  // 1. Trang bìa
  const s1 = pptx.addSlide();
  s1.background = { color: NAVY };
  s1.addShape(pptx.ShapeType.rect, { x: 0, y: 5.6, w: 13.33, h: 0.08, fill: { color: TEAL } });
  s1.addText(BC.ten_cong_ty || '', { x: 0.8, y: 1.4, w: 11.7, h: 0.5, fontFace: FONT, fontSize: 18, color: 'BFE9E6', bold: true });
  s1.addText('BÁO CÁO TỔNG QUAN DỰ ÁN', { x: 0.8, y: 2.0, w: 11.7, h: 1.0, fontFace: FONT, fontSize: 40, color: 'FFFFFF', bold: true });
  s1.addText(scope, { x: 0.8, y: 3.1, w: 11.7, h: 0.5, fontFace: FONT, fontSize: 20, color: 'FFFFFF' });
  s1.addText(`Ngày lập: ${dateTxt} · Người lập: ${BC.nguoi_lap} · Đơn vị: tỷ đồng (${vt})`, { x: 0.8, y: 4.0, w: 11.7, h: 0.4, fontFace: FONT, fontSize: 14, color: 'BFE9E6' });
  s1.addText('Produced by the Supervisory Board of Tan Minh Nhan Corporation®', { x: 0.8, y: 6.2, w: 11.7, h: 0.4, fontFace: FONT, fontSize: 11, color: 'BFE9E6' });

  // 1b. Tổng quan tài chính theo kỳ
  const F = bFinData(list, v);
  const dPct = (a, b, good = true) => {
    if (!F.prv) return { text: '', color: MUTED };
    if (!b) return { text: '— (kỳ trước = 0)', color: MUTED };
    const p = (a - b) / Math.abs(b);
    return { text: `${p >= 0 ? '▲' : '▼'} ${Math.abs(p * 100).toFixed(1).replace('.', ',')}% so với kỳ trước`, color: (p >= 0) === good ? '0A7D32' : 'C2410C' };
  };
  const sF = slide(`Tổng quan tài chính · ${F.P.label}`, `${F.P.range}${F.P.prev ? ` · so với ${ymTxt(F.P.prev.from)} – ${ymTxt(F.P.prev.to)}` : ''} · Đơn vị: tỷ đồng (${vt}; dòng tiền sau VAT)`);
  [['TỔNG DOANH THU', F.cur.dt, dPct(F.cur.dt, F.prv?.dt), 'Nghiệm thu trong kỳ', 'EDF4FD', '2A78D6'],
    ['TỔNG CHI PHÍ', F.cur.cp, dPct(F.cur.cp, F.prv?.cp, false), `${bpct(F.cur.cp, F.cur.dt)} doanh thu`, 'FDF1EB', 'EB6834'],
    ['LỢI NHUẬN', F.cur.ln, dPct(F.cur.ln, F.prv?.ln), `Tỷ suất LN: ${bpct(F.cur.ln, F.cur.dt)}`, 'EAF8F1', '1BAF7A'],
    ['DÒNG TIỀN THỰC TẾ', F.cur.dong_tien, dPct(F.cur.dong_tien, F.prv?.dong_tien), `Số dư cuối kỳ: ${ty(F.bal)} tỷ`, 'F1EFFC', '6250D6']]
    .forEach(([t, val, dl, sub, bg, ac], i) => {
      const x = 0.5 + i * 2.62;
      sF.addShape(pptx.ShapeType.roundRect, { x, y: 1.45, w: 2.47, h: 2.0, fill: { color: bg }, line: { color: bg }, rectRadius: 0.1 });
      sF.addShape(pptx.ShapeType.rect, { x, y: 1.45, w: 2.47, h: 0.07, fill: { color: ac } });
      sF.addText(t, { x: x + 0.15, y: 1.6, w: 2.2, h: 0.3, fontFace: FONT, fontSize: 10.5, bold: true, color: ac });
      sF.addText([{ text: ty(val), options: { fontSize: 24, bold: true, color: val < 0 ? 'D92D35' : NAVY } }, { text: ' tỷ', options: { fontSize: 11, color: MUTED } }], { x: x + 0.15, y: 1.92, w: 2.25, h: 0.55, fontFace: FONT });
      sF.addText(dl.text, { x: x + 0.15, y: 2.5, w: 2.25, h: 0.3, fontFace: FONT, fontSize: 9.5, bold: true, color: dl.color });
      sF.addText(sub, { x: x + 0.15, y: 2.8, w: 2.25, h: 0.5, fontFace: FONT, fontSize: 9, color: MUTED, valign: 'top' });
    });
  // Mục tiêu năm
  sF.addShape(pptx.ShapeType.roundRect, { x: 11.0, y: 1.45, w: 1.83, h: 2.0, fill: { color: 'FFFFFF' }, line: { color: LINE }, rectRadius: 0.1 });
  sF.addText(`Mục tiêu ${F.year}`, { x: 11.1, y: 1.52, w: 1.7, h: 0.3, fontFace: FONT, fontSize: 10.5, bold: true, color: NAVY });
  const tsY = F.ytd.dt ? (F.ytd.ln / F.ytd.dt) * 100 : 0;
  [['Doanh thu', F.ytd.dt, F.tg.dt, '2A78D6'], ['Chi phí', F.ytd.cp, F.tg.cp, 'EB6834'], ['Lợi nhuận', F.ytd.ln, F.tg.ln, '1BAF7A'], ['Tỷ suất LN', tsY, F.tg.ty_suat, '6250D6']].forEach(([l, a, t, c], i) => {
    const y = 1.88 + i * 0.38;
    const pc = t > 0 ? a / t : 0;
    sF.addText([{ text: l, options: { color: INK } }, { text: t > 0 ? `  ${pc < 0 ? '<0' : Math.round(pc * 100)}%` : '  chưa đặt', options: { bold: true, color: pc < 0 ? 'D92D35' : c } }], { x: 11.1, y, w: 1.7, h: 0.2, fontFace: FONT, fontSize: 8.5 });
    sF.addShape(pptx.ShapeType.rect, { x: 11.12, y: y + 0.22, w: 1.58, h: 0.07, fill: { color: 'EEF2F7' }, line: { color: 'EEF2F7' } });
    if (pc > 0) sF.addShape(pptx.ShapeType.rect, { x: 11.12, y: y + 0.22, w: 1.58 * Math.min(1, pc), h: 0.07, fill: { color: c }, line: { color: c } });
  });
  // Hiệu quả từng công trình
  sF.addText('Hiệu quả từng công trình trong kỳ', { x: 0.5, y: 3.65, w: 8, h: 0.3, fontFace: FONT, fontSize: 12, bold: true, color: NAVY });
  const totF = F.rows.reduce((a, x) => ({ dt: a.dt + x.dt, cp: a.cp + x.cp, ln: a.ln + x.ln }), { dt: 0, cp: 0, ln: 0 });
  sF.addTable([
    ['Công trình', 'Doanh thu', 'Chi phí', 'Lợi nhuận', 'Tỷ suất LN', 'Tỷ trọng DT'].map(hd),
    ...F.rows.map((x) => [{ text: [{ text: '●', options: { color: x.color.slice(1).toUpperCase(), fontSize: 13 } }, { text: `\u00A0\u00A0${x.d.ma_du_an} – ${x.d.ten_du_an}`, options: { bold: true } }] }, num(x.dt), num(x.cp), num(x.ln, { bold: true, color: x.ln < 0 ? 'D92D35' : '0A7D32' }), num(bpct(x.ln, x.dt)), num(bpct(x.dt, F.cur.dt))]),
    [{ text: 'Tổng cộng', options: { bold: true, fill: { color: 'EEF4FB' } } }, ...[totF.dt, totF.cp, totF.ln, bpct(totF.ln, totF.dt), '100%'].map((x) => num(x, { bold: true, fill: { color: 'EEF4FB' } }))],
  ], { ...tblOpt, y: 4.0, autoPageSlideStartY: 1.35, colW: [5.3, 1.4, 1.4, 1.4, 1.4, 1.4], rowH: 0.27, fontSize: 9.5 });
  // Biểu đồ DT–CP–LN theo kỳ + cơ cấu doanh thu
  if (F.series.length) {
    const sC = slide(`Doanh thu – Chi phí – Lợi nhuận · ${F.P.label}`, `Đơn vị: tỷ đồng (${vt})`);
    sC.addChart(pptx.ChartType.bar, ['dt', 'cp', 'ln'].map((k, i) => ({ name: ['Doanh thu', 'Chi phí', 'Lợi nhuận'][i], labels: F.series.map((p) => p.label), values: F.series.map((p) => p[k] / 1e9) })),
      { ...chartOpt, x: 0.5, w: 7.6, barDir: 'col', catAxisLabelPos: 'low', barGrouping: 'clustered', chartColors: ['2A78D6', 'EB6834', '1BAF7A'], showValue: F.series.length <= 6, dataLabelFormatCode: '#,##0.0', dataLabelFontSize: 8 });
    const pos = F.rows.filter((x) => x.dt > 0).sort((a, b) => b.dt - a.dt);
    if (pos.length) {
      sC.addText('Cơ cấu doanh thu theo công trình', { x: 8.4, y: 1.35, w: 4.4, h: 0.3, fontFace: FONT, fontSize: 12, bold: true, color: NAVY });
      sC.addChart(pptx.ChartType.doughnut, [{ name: 'Doanh thu', labels: pos.map((x) => x.d.ma_du_an), values: pos.map((x) => x.dt / 1e9) }],
        { x: 8.3, y: 1.7, w: 4.6, h: 5.1, holeSize: 55, chartColors: pos.map((x) => x.color.slice(1).toUpperCase()), showPercent: true, showValue: false, showLegend: true, legendPos: 'b', legendFontSize: 10, dataLabelColor: 'FFFFFF', dataLabelFontSize: 10, fontFace: FONT });
    }
  }

  // 2. Tổng quan theo hợp đồng
  const lnDk = T.dk.dt[v] - T.dk.cp[v], lnTh = T.th.dt[v] - T.th.cp[v];
  const s2 = slide('Tổng quan theo hợp đồng', `${T.so_da} dự án · ${T.so_hd} HĐ chủ đầu tư (${T.so_hd_qt} đã QT) · ${T.so_tp} HĐ thầu phụ (${T.so_tp_qt} đã QT) · Đơn vị: tỷ đồng`);
  const card = (x, y, label, val, sub, color) => {
    s2.addShape(pptx.ShapeType.roundRect, { x, y, w: 3.9, h: 1.35, fill: { color: 'F5F8FC' }, line: { color: LINE }, rectRadius: 0.08 });
    s2.addShape(pptx.ShapeType.rect, { x, y, w: 3.9, h: 0.07, fill: { color } });
    s2.addText(label, { x: x + 0.2, y: y + 0.15, w: 3.5, h: 0.3, fontFace: FONT, fontSize: 11, color: MUTED, bold: true });
    s2.addText(ty(val), { x: x + 0.2, y: y + 0.45, w: 3.5, h: 0.5, fontFace: FONT, fontSize: 24, bold: true, color: val < 0 ? 'D92D35' : NAVY });
    s2.addText(sub, { x: x + 0.2, y: y + 0.95, w: 3.5, h: 0.3, fontFace: FONT, fontSize: 10, color: MUTED });
  };
  const rowLab = (y, t, sub) => s2.addText([{ text: t.toUpperCase(), options: { bold: true, color: NAVY } }, { text: `  (${sub})`, options: { color: MUTED } }], { x: 0.5, y: y - 0.34, w: 12, h: 0.3, fontFace: FONT, fontSize: 12 });
  const cols = [0.5, 4.7, 8.9];
  [['Dự kiến', 'theo HĐ', 1.62, [['Doanh thu dự kiến', T.dk.dt[v], vt, TEAL], ['Chi phí dự kiến', T.dk.cp[v], `${bpct(T.dk.cp[v], T.dk.dt[v])} doanh thu`, 'EB6834'], ['Lợi nhuận dự kiến', lnDk, `Tỷ suất ${bpct(lnDk, T.dk.dt[v])}`, NAVY]]],
    ['Thực hiện', 'đến nay', 3.37, [['Doanh thu thực hiện', T.th.dt[v], `Đạt ${bpct(T.th.dt[v], T.dk.dt[v])} dự kiến`, TEAL], ['Chi phí thực hiện', T.th.cp[v], `${bpct(T.th.cp[v], T.th.dt[v])} doanh thu`, 'EB6834'], ['Lợi nhuận thực hiện', lnTh, `Tỷ suất ${bpct(lnTh, T.th.dt[v])}`, NAVY]]],
    ['Dòng tiền & công nợ', 'sau VAT', 5.12, [['Tiền về', T.tien_ve, `${bpct(T.tien_ve, T.dk.dt.sv)} giá trị HĐ`, TEAL], ['Còn phải thu', T.th.con_lai, 'Theo khối lượng nghiệm thu', 'EB6834'], ['Còn phải trả thầu phụ', T.tp_con_lai, `Trả nợ gốc vay: ${ty(T.tra_goc)}`, NAVY]]]]
    .forEach(([t, sub, y, cards]) => { rowLab(y, t, sub); cards.forEach(([l, val, s, c], i) => card(cols[i], y, l, val, s, c)); });

  // 3–4. Biểu đồ theo tháng (biểu đồ gốc PowerPoint, sửa được)
  const pts = bMonths(list, v);
  if (pts.length) {
    slide('Doanh thu – Chi phí thực hiện (lũy kế)', `Đơn vị: tỷ đồng (${vt})`).addChart(pptx.ChartType.line, [
      { name: 'Doanh thu', labels: pts.map((p) => p.label), values: pts.map((p) => p.luy_dt / 1e9) },
      { name: 'Chi phí', labels: pts.map((p) => p.label), values: pts.map((p) => p.luy_cp / 1e9) },
    ], { ...chartOpt, chartColors: ['2A78D6', 'EB6834'], lineSize: 2, lineDataSymbolSize: 5 });
    slide('Dòng tiền thực tế theo tháng', 'Thu = tiền về; Chi = chi phí + thanh toán thầu phụ + trả nợ gốc · Đơn vị: tỷ đồng (sau VAT)').addChart(pptx.ChartType.bar, [
      { name: 'Thu', labels: pts.map((p) => p.label), values: pts.map((p) => p.thu / 1e9) },
      { name: 'Chi', labels: pts.map((p) => p.label), values: pts.map((p) => p.chi / 1e9) },
    ], { ...chartOpt, barDir: 'col', barGrouping: 'clustered', chartColors: ['2A78D6', 'EB6834'] });
  }
  // 5. Cơ cấu chi phí
  const cg = bCostGroups(list, v).slice(0, 10).reverse();
  if (cg.length) {
    slide('Cơ cấu chi phí dự kiến theo nhóm', `Đơn vị: tỷ đồng (${vt})`).addChart(pptx.ChartType.bar, [{ name: 'Chi phí', labels: cg.map((x) => x.ten), values: cg.map((x) => x.val / 1e9) }],
      { ...chartOpt, barDir: 'bar', catAxisLabelPos: 'low', chartColors: ['EB6834'], showLegend: false, showValue: true, dataLabelFormatCode: '#,##0.00', dataLabelFontSize: 9 });
  }
  // 6. Lợi nhuận theo dự án / theo HĐ
  if (one) {
    const tp = (x) => (v === 'gt' ? x.qt_gt : x.qt_sv);
    if (one.hds.length) slide('Lãi gộp dự kiến theo HĐ chủ đầu tư', `Doanh thu dự kiến − giá trị thầu phụ thuộc HĐ · Đơn vị: tỷ đồng (${vt})`).addChart(pptx.ChartType.bar,
      [{ name: 'Lãi gộp dự kiến', labels: one.hds.map((x) => x.so_ma), values: one.hds.map((x) => (x.dk[v] - tp(x.tp)) / 1e9) }],
      { ...chartOpt, barDir: 'bar', catAxisLabelPos: 'low', chartColors: ['1BAF7A'], showLegend: false, showValue: true, dataLabelFormatCode: '#,##0.00', dataLabelFontSize: 9 });
  } else {
    const rows = [...list].reverse();
    slide('Lợi nhuận theo dự án', `Dự kiến và thực hiện · Đơn vị: tỷ đồng (${vt})`).addChart(pptx.ChartType.bar, [
      { name: 'Dự kiến', labels: rows.map((d) => d.ma_du_an), values: rows.map((d) => (d.du_kien.doanh_thu[v] - d.du_kien.chi_phi[v]) / 1e9) },
      { name: 'Thực hiện', labels: rows.map((d) => d.ma_du_an), values: rows.map((d) => (d.thuc_hien.doanh_thu[v] - d.thuc_hien.chi_phi[v]) / 1e9) },
    ], { ...chartOpt, barDir: 'bar', catAxisLabelPos: 'low', barGrouping: 'clustered', chartColors: ['1BAF7A', '2A78D6'], showValue: true, dataLabelFormatCode: '#,##0.00', dataLabelFontSize: 9 });
    // 7. Bảng tổng hợp dự án
    slide('Tổng hợp theo dự án', `Đơn vị: tỷ đồng (${vt}; tiền về, phải thu, phải trả sau VAT)`).addTable([
      ['Dự án', 'DT dự kiến', 'CP dự kiến', 'LN dự kiến', '%', 'DT thực hiện', 'CP thực hiện', 'LN thực hiện', '%', 'Tiền về', 'Còn phải thu', 'Phải trả TP'].map(hd),
      ...list.map((d) => {
        const a = d.du_kien.doanh_thu[v] - d.du_kien.chi_phi[v], b = d.thuc_hien.doanh_thu[v] - d.thuc_hien.chi_phi[v];
        return [{ text: `${d.ma_du_an} ${d.ten_du_an}`, options: { bold: true } }, num(d.du_kien.doanh_thu[v]), num(d.du_kien.chi_phi[v]), num(a, { bold: true }), num(bpct(a, d.du_kien.doanh_thu[v])),
          num(d.thuc_hien.doanh_thu[v]), num(d.thuc_hien.chi_phi[v]), num(b, { bold: true }), num(bpct(b, d.thuc_hien.doanh_thu[v])), num(d.tien_ve), num(d.thuc_hien.con_lai), num(d.tp.con_lai)];
      }),
      [{ text: 'TỔNG CỘNG', options: { bold: true, fill: { color: 'EEF4FB' } } }, ...[T.dk.dt[v], T.dk.cp[v], lnDk, bpct(lnDk, T.dk.dt[v]), T.th.dt[v], T.th.cp[v], lnTh, bpct(lnTh, T.th.dt[v]), T.tien_ve, T.th.con_lai, T.tp_con_lai]
        .map((x) => num(x, { bold: true, fill: { color: 'EEF4FB' } }))],
    ], { ...tblOpt, colW: [2.9, 0.95, 0.95, 0.95, 0.65, 0.95, 0.95, 0.95, 0.65, 0.95, 0.95, 0.95] });
  }
  // 8+. Từng dự án (kèm ảnh công trình nếu có)
  const imgs = {};
  await Promise.all(list.filter((d) => d.co_anh).map(async (d) => {
    try {
      const b = await (await fetch(`/api/du-an/${d.id}/anh?v=${d.anh_v}`)).blob();
      const bmp = await createImageBitmap(b);
      imgs[d.id] = { data: await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }), ratio: bmp.width / bmp.height };
    } catch {}
  }));
  for (const d of list) {
    const a = d.du_kien.doanh_thu[v] - d.du_kien.chi_phi[v], b = d.thuc_hien.doanh_thu[v] - d.thuc_hien.chi_phi[v];
    const tp = (x) => (v === 'gt' ? x.qt_gt : x.qt_sv);
    const s = slide(`${d.ma_du_an} – ${d.ten_du_an}`,
      `CĐT: ${d.chu_dau_tu || '—'} · ${d.trang_thai} · Tiến độ ${d.tien_do}% · LN dự kiến ${ty(a)} (${bpct(a, d.du_kien.doanh_thu[v])}) · LN thực hiện ${ty(b)} (${bpct(b, d.thuc_hien.doanh_thu[v])}) · Đơn vị: tỷ đồng`);
    if (imgs[d.id]) {
      const h = 0.95, w = Math.min(2.4, h * imgs[d.id].ratio);
      s.addImage({ data: imgs[d.id].data, x: 12.83 - w, y: 0.22, w, h, rounding: false });
    }
    const rows = d.hds.map((x) => [{ text: x.so_ma + (x.da_qt ? ' (Đã QT)' : ''), options: { bold: true } }, num(x.hd[v]), num(x.nt[v]), num((x.pct_ht * 100).toFixed(1).replace('.', ',') + '%'),
      num(x.tien_ve), num(x.phai_thu), num(String(x.tp.n)), num(tp(x.tp)), num(x.tp.da_tt), num(x.tp.con_lai), num(x.dk[v] - tp(x.tp), { bold: true })]);
    if (d.tp.chua_gan.n) rows.push([{ text: 'Thầu phụ chưa gắn HĐ CĐT', options: { italic: true } }, num(''), num(''), num(''), num(''), num(''), num(String(d.tp.chua_gan.n)), num(tp(d.tp.chua_gan)), num(d.tp.chua_gan.da_tt), num(d.tp.chua_gan.con_lai), num(-tp(d.tp.chua_gan))]);
    s.addTable([
      ['HĐ chủ đầu tư', 'Giá trị HĐ+PL', 'Nghiệm thu', '% HT', 'Tiền về', 'Còn phải thu', 'Số HĐTP', 'TP HT/QT', 'Đã trả TP', 'Còn phải trả', 'Lãi gộp DK'].map(hd),
      ...(rows.length ? rows : [[{ text: 'Chưa có HĐ chủ đầu tư', options: { colspan: 11, align: 'center', color: MUTED } }]]),
    ], { ...tblOpt, colW: [2.5, 1.05, 1.05, 0.75, 1.05, 1.05, 0.75, 1.05, 1.05, 1.0, 1.0] });
  }
  // Cảnh báo
  const warns = list.flatMap((d) => d.canh_bao.map((w) => ({ ...w, da: d.ma_du_an }))).sort((x, y) => ({ cao: 0, tb: 1, thap: 2 }[x.muc] - { cao: 0, tb: 1, thap: 2 }[y.muc]));
  slide('Cảnh báo & lưu ý', `${warns.length} mục cần kiểm tra`).addTable([
    ['Mức', 'Dự án', 'Nội dung'].map(hd),
    ...(warns.length ? warns.map((w) => [{ text: MUC[w.muc], options: { bold: true, color: w.muc === 'cao' ? 'D92D35' : w.muc === 'tb' ? 'B45309' : MUTED } }, w.da, w.noi_dung])
      : [[{ text: 'Không có cảnh báo', options: { colspan: 3, align: 'center', color: MUTED } }]]),
  ], { ...tblOpt, colW: [1.4, 1.6, 9.3] });

  await pptx.writeFile({ fileName: `BaoCao_${bFileScope()}_${bStamp()}.pptx` });
}));

// =====================================================================
// BÁO CÁO TỔNG QUAN – tổng quát + chi tiết, In/PDF, Excel, PowerPoint
// Số liệu: /api/bao-cao (cùng công thức Dashboard). Dùng chung tiện ích của app.js / common.js.
// =====================================================================
let BC = null;                                  // dữ liệu báo cáo
const BST = { project: '', vat: 'gt' };          // phạm vi, cơ sở VAT
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
// Biểu đồ SVG dùng chung (tooltip: showTip/hideTip của app.js)
// ---------------------------------------------------------------------
function bAxis(min, max) { return niceTicks(Math.min(0, min), Math.max(0, max)); }
function bLegend(svg, items, x0) {
  items.forEach(([t, c], i) => {
    const x = x0 + i * 130;
    svgEl('rect', { x, y: 4, width: 12, height: 12, rx: 3, fill: c }, svg);
    svgEl('text', { x: x + 18, y: 14, class: 'ax-lbl strong' }, svg).textContent = t;
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
function bColChart(el, pts, series) {
  if (!pts.length) return bEmpty(el, 'Chưa có số liệu có ngày');
  el.innerHTML = '';
  const W = Math.max(320, el.clientWidth || 600), H = 260, pad = { l: 62, r: 16, t: 28, b: 30 };
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
    });
    if (!(i % every)) svgEl('text', { x: cx, y: H - 10, 'text-anchor': 'middle', class: 'ax-lbl' }, svg).textContent = p.label;
    const hit = svgEl('rect', { x: pad.l + slot * i, y: pad.t, width: slot, height: ih, fill: 'transparent' }, svg);
    hit.addEventListener('mousemove', (e) => showTip(`<b>Tháng ${p.label}</b><table>${series.map((s) => `<tr><td><i style="background:${s.color}"></i>${s.name}</td><td>${bn(p[s.key])}</td></tr>`).join('')}
      <tr class="sum"><td>Chênh lệch</td><td class="${p.thu - p.chi < 0 ? 'neg' : ''}">${bn(p.thu - p.chi)}</td></tr></table>`, e.clientX, e.clientY));
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
      <h1>BÁO CÁO TỔNG QUAN DỰ ÁN</h1>
      <div class="b-meta">Phạm vi: <b>${esc(scope)}</b> · Đơn vị: VNĐ (${vt} trừ khi ghi khác) · Lập lúc ${lap.toLocaleString('vi-VN')} · Người lập: ${esc(BC.nguoi_lap)} · ${esc(BC.phien_ban)}</div>
    </div></div>
  </div>

  <section class="card b-sec">
    <h2>I. Tổng quan</h2>
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
  const pts = bMonths(list, v);
  bLineChart($('#b-ch-line'), pts, [{ key: 'luy_dt', name: 'Doanh thu', color: BCOL.dt }, { key: 'luy_cp', name: 'Chi phí', color: BCOL.cp }]);
  bColChart($('#b-ch-flow'), pts, [{ key: 'thu', name: 'Thu (tiền về)', color: BCOL.thu }, { key: 'chi', name: 'Chi', color: BCOL.chi }]);
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

// ---------------------------------------------------------------------
// Sự kiện
// ---------------------------------------------------------------------
$('#b-project').addEventListener('change', (e) => { BST.project = e.target.value; bSave(); renderReport(); });
$('#b-vat').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; BST.vat = b.dataset.v; bSave(); renderReport(); });
$('#b-reload').addEventListener('click', () => loadReport().catch((err) => alert(err.message)));
$('#b-report').addEventListener('click', (e) => {
  if (e.target.id === 'b-open-all' || e.target.id === 'b-close-all') $$('#b-report details.b-proj').forEach((d) => (d.open = e.target.id === 'b-open-all'));
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

  // 1. Trang bìa
  const s1 = pptx.addSlide();
  s1.background = { color: NAVY };
  s1.addShape(pptx.ShapeType.rect, { x: 0, y: 5.6, w: 13.33, h: 0.08, fill: { color: TEAL } });
  s1.addText(BC.ten_cong_ty || '', { x: 0.8, y: 1.4, w: 11.7, h: 0.5, fontFace: FONT, fontSize: 18, color: 'BFE9E6', bold: true });
  s1.addText('BÁO CÁO TỔNG QUAN DỰ ÁN', { x: 0.8, y: 2.0, w: 11.7, h: 1.0, fontFace: FONT, fontSize: 40, color: 'FFFFFF', bold: true });
  s1.addText(scope, { x: 0.8, y: 3.1, w: 11.7, h: 0.5, fontFace: FONT, fontSize: 20, color: 'FFFFFF' });
  s1.addText(`Ngày lập: ${dateTxt} · Người lập: ${BC.nguoi_lap} · Đơn vị: tỷ đồng (${vt})`, { x: 0.8, y: 4.0, w: 11.7, h: 0.4, fontFace: FONT, fontSize: 14, color: 'BFE9E6' });
  s1.addText('Produced by the Supervisory Board of Tan Minh Nhan Corporation®', { x: 0.8, y: 6.2, w: 11.7, h: 0.4, fontFace: FONT, fontSize: 11, color: 'BFE9E6' });

  // 2. Tổng quan
  const lnDk = T.dk.dt[v] - T.dk.cp[v], lnTh = T.th.dt[v] - T.th.cp[v];
  const s2 = slide('Tổng quan', `${T.so_da} dự án · ${T.so_hd} HĐ chủ đầu tư (${T.so_hd_qt} đã QT) · ${T.so_tp} HĐ thầu phụ (${T.so_tp_qt} đã QT) · Đơn vị: tỷ đồng`);
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
  const chartOpt = { x: 0.5, y: 1.35, w: 12.3, h: 5.5, fontFace: FONT, showLegend: true, legendPos: 't', legendFontSize: 11, catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
    valAxisLabelFormatCode: '#,##0.0', valGridLine: { color: LINE, size: 0.5 }, catAxisLineShow: true };
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
  // 8+. Từng dự án
  for (const d of list) {
    const a = d.du_kien.doanh_thu[v] - d.du_kien.chi_phi[v], b = d.thuc_hien.doanh_thu[v] - d.thuc_hien.chi_phi[v];
    const tp = (x) => (v === 'gt' ? x.qt_gt : x.qt_sv);
    const s = slide(`${d.ma_du_an} – ${d.ten_du_an}`,
      `CĐT: ${d.chu_dau_tu || '—'} · ${d.trang_thai} · Tiến độ ${d.tien_do}% · LN dự kiến ${ty(a)} (${bpct(a, d.du_kien.doanh_thu[v])}) · LN thực hiện ${ty(b)} (${bpct(b, d.thuc_hien.doanh_thu[v])}) · Đơn vị: tỷ đồng`);
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

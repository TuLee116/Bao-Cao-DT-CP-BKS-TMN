// Định dạng số kiểu Việt Nam và các biểu đồ d3 của dashboard.
(function () {
  const loc = d3.formatLocale({ decimal: ',', thousands: '.', grouping: [3], currency: ['', '₫'] });
  const F = {
    tr: loc.format(',.0f'),
    num: loc.format(',.2~f'),
    ty: v => loc.format(',.2f')(v / 1000) + ' tỷ',
    money: v => (Math.abs(v) >= 1000 ? loc.format(',.2f')(v / 1000) + ' tỷ' : loc.format(',.0f')(v) + ' tr'),
    pct: v => (isFinite(v) ? loc.format('.1%')(v) : '—'),
    spct: v => (isFinite(v) ? loc.format('+.1%')(v) : '—'),
    pt: v => (isFinite(v) ? loc.format('+.1f')(v * 100) + ' điểm %' : '—'),
    // Số tiền tính bằng đồng
    vnd: v => (!isFinite(v) ? '—' : Math.abs(v) >= 1e9 ? loc.format(',.2f')(v / 1e9) + ' tỷ' : Math.abs(v) >= 1e6 ? loc.format(',.0f')(v / 1e6) + ' tr' : loc.format(',.0f')(v) + ' đ'),
    trieu: v => (isFinite(v) ? loc.format(',.0f')(v / 1e6) : '—'),
    tyAxis: v => loc.format(',~f')(v / 1e9),
    // Số tỷ gọn để ghi trên đầu cột: 113,7 · 9,14 · 0,85
    tyShort: v => (!isFinite(v) ? '' : loc.format(Math.abs(v) >= 1e11 ? ',.0f' : Math.abs(v) >= 1e10 ? ',.1f' : ',.2f')(v / 1e9)),
    svnd: v => (isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + F.vnd(Math.abs(v)) : '—'),
    int: loc.format(','),
    date: d => (d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : ''),
    dateShort: d => (d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(2, 4) : ''),
    mShort: m => 'T' + (+m.slice(5, 7)) + '/' + m.slice(2, 4),
    mLong: m => 'T' + (+m.slice(5, 7)) + '/' + m.slice(0, 4),
    // Nhận "1.234,5", "1234.5", "1.234.567", "1 234" → số; rỗng → null; sai → NaN
    parse(s) {
      if (typeof s === 'number') return s;
      s = String(s == null ? '' : s).trim().replace(/[\s ]/g, '');
      if (!s) return null;
      if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
      else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
      const n = Number(s);
      return isFinite(n) ? n : NaN;
    }
  };
  const C = [1, 2, 3, 4, 5, 6, 7, 8].map(i => `var(--series-${i})`);

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function newSvg(host, h) {
    host.replaceChildren();
    const w = Math.max(280, host.clientWidth || 640);
    return { w, svg: d3.select(host).append('svg').attr('width', '100%').attr('height', h).attr('viewBox', `0 0 ${w} ${h}`) };
  }
  function yAxis(svg, y, w, mr, fmt, n) {
    const g = svg.append('g').attr('class', 'ax');
    g.call(d3.axisLeft(y).ticks(n).tickSize(0).tickPadding(0).tickFormat(fmt)).attr('font-size', null).attr('font-family', null);
    g.select('.domain').remove();
    const ml = Math.ceil(g.node().getBBox().width) + 10;
    g.attr('transform', `translate(${ml - 10},0)`);
    svg.insert('g', ':first-child').selectAll('line').data(y.ticks(n)).join('line')
      .attr('x1', ml).attr('x2', w - mr).attr('y1', d => y(d)).attr('y2', d => y(d))
      .style('stroke', 'var(--chart-grid)').attr('stroke-width', 1);
    return ml;
  }
  function xLabels(svg, ms, fx, yPos, avail, fmt) {
    const per = avail / ms.length;
    const step = per < 56 ? Math.ceil(56 / per) : 1;
    svg.append('g').attr('class', 'ax').selectAll('text')
      .data(ms.filter((m, i) => (ms.length - 1 - i) % step === 0)).join('text')
      .attr('x', fx).attr('y', yPos).attr('text-anchor', 'middle').text(fmt || F.mShort);
  }
  function baseline(svg, x1, x2, yv) {
    return svg.append('line').attr('x1', x1).attr('x2', x2).attr('y1', yv).attr('y2', yv).style('stroke', 'var(--chart-axis)').attr('stroke-width', 1);
  }
  function tipFor(host) {
    const box = host.parentElement;
    let tip = box.querySelector('.tip');
    if (!tip) { tip = el('div', 'tip'); tip.hidden = true; box.append(tip); }
    tip.hidden = true;
    return {
      show(ev, head, lines) {
        tip.replaceChildren(el('div', 'tip-h', head));
        lines.forEach(([c, n, v]) => {
          const r = el('div', 'tip-r');
          if (c) { const s = el('i', 'sw'); s.style.background = c; r.append(s); }
          r.append(el('span', null, n), el('b', null, v));
          tip.append(r);
        });
        tip.hidden = false;
        const [px, py] = d3.pointer(ev, box);
        const bw = box.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
        let left = px + 14; if (left + tw > bw) left = px - 14 - tw; if (left < 0) left = 0;
        tip.style.left = left + 'px';
        tip.style.top = Math.max(0, Math.min(py - th / 2, box.clientHeight - th)) + 'px';
      },
      hide() { tip.hidden = true; }
    };
  }
  function overlay(svg, items, xOf, width, mt, hgt, onMove, onLeave, onClick) {
    const r = svg.append('g').selectAll('rect').data(items).join('rect')
      .attr('x', d => xOf(d) - width / 2).attr('width', width).attr('y', mt).attr('height', hgt)
      .style('fill', 'transparent').style('cursor', onClick ? 'pointer' : 'crosshair')
      .on('pointerenter pointermove', onMove).on('pointerleave', onLeave);
    if (onClick) r.on('click', onClick);
  }

  // Mọi biểu đồ theo tháng nhận: months = ['YYYY-MM-01', …] và series = [{name, color, values: [số hoặc null theo từng tháng]}].
  // Một trục y duy nhất cho mỗi biểu đồ; fmt định dạng giá trị trong tooltip, axisFmt định dạng nhãn trục.
  const finite = v => v != null && isFinite(v);
  const allValues = series => series.flatMap(s => s.values.filter(finite));

  // Cột nhóm theo tháng, có thể kèm đường (cùng trục).
  function columns(host, months, bars, lines, o) {
    o = o || {};
    const tip = tipFor(host);
    const h = o.height || 300, mt = 12, mr = 8, mb = 26;
    const { svg, w } = newSvg(host, h);
    const vals = allValues(bars.concat(lines));
    const y = d3.scaleLinear([Math.min(0, d3.min(vals) ?? 0), Math.max(0, d3.max(vals) ?? 1) || 1], [h - mb, mt]).nice();
    const ml = yAxis(svg, y, w, mr, o.axisFmt || F.tr, 5);
    const x0 = d3.scaleBand(months, [ml, w - mr]).paddingInner(0.3).paddingOuter(0.15);
    const n = Math.max(1, bars.length), gap = 2;
    const bw = Math.max(1, Math.min(32, (x0.bandwidth() - gap * (n - 1)) / n));
    const off = (x0.bandwidth() - (bw * n + gap * (n - 1))) / 2;
    const hl = svg.append('rect').attr('y', mt).attr('height', h - mb - mt).attr('rx', 4).style('fill', 'var(--chart-grid)').attr('opacity', 0);
    const g = svg.append('g');
    bars.forEach((s, i) => s.values.forEach((v, j) => {
      if (!finite(v)) return;
      const top = y(Math.max(0, v)), bot = y(Math.min(0, v));
      g.append('rect').attr('x', x0(months[j]) + off + i * (bw + gap)).attr('width', bw)
        .attr('y', top).attr('height', Math.max(0, bot - top)).attr('rx', Math.min(4, bw / 2)).style('fill', s.color);
    }));
    baseline(svg, ml, w - mr, y(0));
    const cx = m => x0(m) + x0.bandwidth() / 2;
    lines.forEach(s => {
      const pts = months.map((m, j) => ({ m, v: s.values[j] })).filter(p => finite(p.v));
      svg.append('path').datum(pts).attr('d', d3.line(p => cx(p.m), p => y(p.v)))
        .style('fill', 'none').style('stroke', s.color).attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');
      svg.append('g').selectAll('circle').data(pts).join('circle').attr('cx', p => cx(p.m)).attr('cy', p => y(p.v)).attr('r', 4)
        .style('fill', s.color).style('stroke', 'var(--panel)').attr('stroke-width', 2);
    });
    xLabels(svg, months, cx, h - mb + 17, w - ml - mr);
    const fmt = o.fmt || (v => F.tr(v) + ' tr');
    overlay(svg, months, cx, x0.step(), mt, h - mb - mt, (ev, m) => {
      const j = months.indexOf(m);
      hl.attr('x', x0(m) - 4).attr('width', x0.bandwidth() + 8).attr('opacity', 0.7);
      tip.show(ev, (o.head ? o.head(m) : F.mLong(m)), bars.concat(lines).map(s => [s.color, s.name, finite(s.values[j]) ? fmt(s.values[j]) : '–']));
    }, () => { hl.attr('opacity', 0); tip.hide(); }, o.onPick && ((ev, m) => o.onPick(m)));
  }

  // Đường theo tháng. Một đường: có vùng tô nhạt và nhãn tại điểm thấp nhất, điểm cuối. Nhiều đường: chấm ở điểm cuối.
  function lines(host, months, series, o) {
    o = o || {};
    const tip = tipFor(host);
    const single = series.length === 1;
    const h = o.height || (single ? 240 : 270), mt = single ? 24 : 12, mr = 12, mb = 26;
    const { svg, w } = newSvg(host, h);
    const vals = allValues(series);
    const y = d3.scaleLinear([Math.min(0, d3.min(vals) ?? 0), Math.max(0, (d3.max(vals) ?? 1) * (single ? 1.1 : 1.05)) || 1], [h - mb, mt]).nice();
    const ml = yAxis(svg, y, w, mr, o.axisFmt || F.tr, 5);
    const x = d3.scalePoint(months, [ml + 10, w - mr - 10]);
    const fmt = o.fmt || (v => F.tr(v) + ' tr');
    const base = baseline(svg, ml, w - mr, y(0));
    const rule = svg.append('line').attr('y1', mt).attr('y2', h - mb).style('stroke', 'var(--chart-ref)').attr('stroke-width', 1).attr('opacity', 0);
    series.forEach((s, i) => {
      const pts = months.map((m, j) => ({ m, v: s.values[j] })).filter(p => finite(p.v));
      if (single) {
        const gid = 'grad-' + Math.random().toString(36).slice(2, 8);
        const grad = svg.append('defs').append('linearGradient').attr('id', gid).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
        [[0, .26], [.25, .16], [.5, .08], [.75, .03], [1, 0]].forEach(([of, a]) => grad.append('stop').attr('offset', of).attr('style', `stop-color:${s.color};stop-opacity:${a}`));
        svg.insert('path', () => base.node()).datum(pts).attr('d', d3.area(p => x(p.m), y(0), p => y(p.v))).style('fill', `url(#${gid})`);
      }
      svg.append('path').datum(pts).attr('d', d3.line(p => x(p.m), p => y(p.v)))
        .style('fill', 'none').style('stroke', s.color).attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');
      if (!pts.length) return;
      const last = pts[pts.length - 1];
      const marks = single ? [pts.reduce((m, p) => (p.v < m.v ? p : m)), last] : [last];
      const anchor = px => (px < ml + 40 ? 'start' : px > w - mr - 40 ? 'end' : 'middle');
      [...new Set(marks)].forEach(p => {
        svg.append('circle').attr('cx', x(p.m)).attr('cy', y(p.v)).attr('r', 4.5).style('fill', s.color).style('stroke', 'var(--panel)').attr('stroke-width', 2);
        if (single) svg.append('text').attr('class', 'ptl').attr('x', x(p.m)).attr('y', y(p.v) - 10).attr('text-anchor', anchor(x(p.m)))
          .text((p !== last && pts.length > 1 ? 'Thấp nhất ' : '') + fmt(p.v));
      });
    });
    xLabels(svg, months, x, h - mb + 17, w - ml - mr, o.xFmt);
    const dots = svg.append('g').attr('opacity', 0);
    overlay(svg, months, m => x(m), x.step() || 40, mt, h - mb - mt, (ev, m) => {
      const j = months.indexOf(m);
      const at = series.map(s => ({ s, v: s.values[j] })).filter(r => finite(r.v)).sort((a, b) => b.v - a.v);
      rule.attr('x1', x(m)).attr('x2', x(m)).attr('opacity', single ? 0 : 1);
      dots.attr('opacity', 1).selectAll('circle').data(at).join('circle').attr('cx', x(m)).attr('cy', r => y(r.v)).attr('r', 4)
        .style('fill', r => r.s.color).style('stroke', 'var(--panel)').attr('stroke-width', 2);
      tip.show(ev, (o.headFmt || F.mLong)(m), at.map(r => [single ? null : r.s.color, r.s.name, fmt(r.v)]));
    }, () => { rule.attr('opacity', 0); dots.attr('opacity', 0); tip.hide(); });
  }

  // Cột chồng theo tháng (chỉ giá trị không âm), khe 1px giữa các phần.
  function stacked(host, months, series, o) {
    o = o || {};
    const tip = tipFor(host);
    const h = o.height || 300, mt = 12, mr = 8, mb = 26;
    const { svg, w } = newSvg(host, h);
    const totals = months.map((m, j) => d3.sum(series, s => Math.max(0, s.values[j] || 0)));
    const y = d3.scaleLinear([0, d3.max(totals) || 1], [h - mb, mt]).nice();
    const ml = yAxis(svg, y, w, mr, o.axisFmt || F.tr, 5);
    const x0 = d3.scaleBand(months, [ml, w - mr]).paddingInner(0.35).paddingOuter(0.15);
    const bw = Math.min(40, x0.bandwidth()), off = (x0.bandwidth() - bw) / 2;
    const hl = svg.append('rect').attr('y', mt).attr('height', h - mb - mt).attr('rx', 4).style('fill', 'var(--chart-grid)').attr('opacity', 0);
    const g = svg.append('g');
    months.forEach((m, j) => {
      let acc = 0;
      series.forEach(s => {
        const v = Math.max(0, s.values[j] || 0);
        if (!v) return;
        g.append('rect').attr('x', x0(m) + off).attr('width', bw).attr('y', y(acc + v)).attr('height', Math.max(0, y(acc) - y(acc + v)))
          .style('fill', s.color).style('stroke', 'var(--panel)').attr('stroke-width', 1);
        acc += v;
      });
    });
    baseline(svg, ml, w - mr, y(0));
    const cx = m => x0(m) + x0.bandwidth() / 2;
    xLabels(svg, months, cx, h - mb + 17, w - ml - mr);
    const fmt = o.fmt || (v => F.tr(v) + ' tr');
    overlay(svg, months, cx, x0.step(), mt, h - mb - mt, (ev, m) => {
      const j = months.indexOf(m);
      hl.attr('x', x0(m) - 4).attr('width', x0.bandwidth() + 8).attr('opacity', 0.7);
      tip.show(ev, F.mLong(m), series.map(s => [s.color, s.name, finite(s.values[j]) ? fmt(s.values[j]) : '–']).reverse().concat([[null, 'Tổng', fmt(totals[j])]]));
    }, () => { hl.attr('opacity', 0); tip.hide(); });
  }

  // Thanh ngang tỷ trọng trong kỳ. items: [{name, value, share}]
  function breakdown(host, items, color, fmt) {
    fmt = fmt || (v => F.tr(v) + ' tr');
    host.replaceChildren();
    const max = d3.max(items, r => r.value) || 1;
    items.forEach(r => {
      const row = el('div', 'bar-row');
      const top = el('div', 'bar-top');
      const val = el('span', 'bar-val');
      val.append(el('b', null, fmt(r.value)), document.createTextNode(' · ' + F.pct(r.share)));
      top.append(el('span', null, r.name), val);
      const track = el('div', 'track');
      const bar = el('div', 'bar');
      bar.style.width = (Math.max(0, r.value) / max * 100) + '%';
      bar.style.background = color;
      track.append(bar);
      row.append(top, track);
      host.append(row);
    });
  }

  // Thanh ngang theo nhóm (khu vực, công ty, chủ đầu tư…). cats: [{key, label, values: [số theo từng series]}],
  // series: [{name, color}]. Hỗ trợ giá trị âm (chênh lệch). Một series: ghi giá trị ở đầu thanh.
  function hbars(host, cats, series, o) {
    o = o || {};
    const tip = tipFor(host);
    const n = Math.max(1, series.length), bh = n > 1 ? 12 : 18, gap = 2, rowPad = 10;
    const rowH = n * bh + (n - 1) * gap + rowPad;
    const mt = 4, mb = 24, h = mt + mb + Math.max(1, cats.length) * rowH;
    host.replaceChildren();
    const w = Math.max(280, host.clientWidth || 640);
    const svg = d3.select(host).append('svg').attr('width', '100%').attr('height', h).attr('viewBox', `0 0 ${w} ${h}`);
    const fmt = o.fmt || F.vnd;
    // Cột nhãn: đo nhãn dài nhất, tối đa 38% chiều rộng; nhãn dài bị cắt có dấu …
    const maxL = Math.min(w * 0.38, 260);
    const probe = svg.append('text').attr('class', 'ax');
    const fit = s => {
      probe.text(s);
      if (probe.node().getComputedTextLength() <= maxL) return s;
      let lo = 0, hi = s.length;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; probe.text(s.slice(0, mid) + '…'); if (probe.node().getComputedTextLength() <= maxL) lo = mid; else hi = mid - 1; }
      return s.slice(0, lo) + '…';
    };
    const labels = cats.map(c => fit(c.label));
    let lw = 0; labels.forEach(s => { probe.text(s); lw = Math.max(lw, probe.node().getComputedTextLength()); });
    probe.remove();
    const all = cats.flatMap(c => c.values.filter(v => v != null && isFinite(v)));
    const lo = Math.min(0, d3.min(all) ?? 0), hi = Math.max(0, d3.max(all) ?? 1);
    const valW = n === 1 ? 64 : 24;
    const x = d3.scaleLinear([lo, hi || 1], [lw + 14, w - valW - 6]).nice();
    const yOf = i => mt + i * rowH;
    // lưới
    svg.append('g').selectAll('line').data(x.ticks(4)).join('line').attr('x1', d => x(d)).attr('x2', d => x(d)).attr('y1', mt).attr('y2', h - mb)
      .style('stroke', 'var(--chart-grid)');
    svg.append('g').attr('class', 'ax').selectAll('text').data(x.ticks(4)).join('text').attr('x', d => x(d)).attr('y', h - mb + 16).attr('text-anchor', 'middle').text(o.axisFmt || F.tyAxis);
    const hl = svg.append('rect').attr('x', 0).attr('width', w).attr('height', rowH).attr('rx', 4).style('fill', 'var(--chart-grid)').attr('opacity', 0);
    const g = svg.append('g');
    cats.forEach((c, i) => {
      const y0 = yOf(i) + rowPad / 2;
      g.append('text').attr('class', 'ax hb-label').attr('x', lw + 4).attr('y', y0 + (n * bh + (n - 1) * gap) / 2 + 4).attr('text-anchor', 'end').text(labels[i]);
      series.forEach((s, j) => {
        const v = c.values[j];
        if (v == null || !isFinite(v)) return;
        const xa = x(Math.min(0, v)), xb = x(Math.max(0, v));
        g.append('rect').attr('x', xa).attr('y', y0 + j * (bh + gap)).attr('width', Math.max(1, xb - xa)).attr('height', bh).attr('rx', Math.min(4, bh / 2))
          .style('fill', (o.colorOf && o.colorOf(v, j)) || s.color);
        if (n === 1) g.append('text').attr('class', 'ptl').attr('x', v < 0 ? xa - 4 : xb + 4).attr('y', y0 + bh / 2 + 4).attr('text-anchor', v < 0 ? 'end' : 'start').text(fmt(v));
      });
    });
    svg.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', mt).attr('y2', h - mb).style('stroke', 'var(--chart-axis)');
    svg.append('g').selectAll('rect').data(cats).join('rect').attr('x', 0).attr('width', w).attr('y', (c, i) => yOf(i)).attr('height', rowH)
      .style('fill', 'transparent').style('cursor', o.onPick ? 'pointer' : 'default')
      .on('pointerenter pointermove', (ev, c) => {
        hl.attr('y', yOf(cats.indexOf(c))).attr('opacity', 0.6);
        tip.show(ev, c.label, series.map((s, j) => [n > 1 ? s.color : null, s.name, c.values[j] == null ? '–' : fmt(c.values[j])]).concat(c.extra || []));
      })
      .on('pointerleave', () => { hl.attr('opacity', 0); tip.hide(); })
      .on('click', (ev, c) => { if (o.onPick) o.onPick(c.key); });
  }

  // Cột nhóm theo hạng mục (ví dụ các thời điểm): mỗi nhóm có một cột cho từng series, cùng một trục.
  // cats: [{key, label, sub, values: [số theo từng series], extra}]; series: [{name, color}].
  // Nhãn giá trị ghi trên đầu cột khi đủ chỗ; dòng sub (ví dụ %CPTT/DT) ghi dưới tên nhóm thay cho trục thứ hai.
  function groupCols(host, cats, series, o) {
    o = o || {};
    const tip = tipFor(host);
    const n = Math.max(1, series.length), gap = 2, hasSub = cats.some(c => c.sub);
    const h0 = o.height || 300;
    let { svg, w } = newSvg(host, h0);
    // Tên nhóm: xuống dòng theo từ khi hẹp (tối đa 2 dòng), quá dài thì cắt có dấu …
    const avail = Math.max(40, (w - 60) / Math.max(1, cats.length) - 6);
    const probeC = svg.append('text').attr('class', 'ax col-cat');
    const tw = t => { probeC.text(t); return probeC.node().getComputedTextLength(); };
    const clip = t => { if (tw(t) <= avail) return t; let a = t; while (a.length > 1 && tw(a + '…') > avail) a = a.slice(0, -1); return a + '…'; };
    const wrapLab = t => {
      if (tw(t) <= avail) return [t];
      const ws = t.split(' ');
      for (let i = ws.length - 1; i > 0; i--) { const a = ws.slice(0, i).join(' '); if (tw(a) <= avail) return [a, clip(ws.slice(i).join(' '))]; }
      return [clip(t)];
    };
    const catLines = cats.map(c => wrapLab(c.label));
    const subLines = cats.map(c => (c.sub ? c.sub.split(' · ').reduce((acc, part) => { const last = acc[acc.length - 1]; if (last != null && tw(last + ' · ' + part) <= avail) acc[acc.length - 1] = last + ' · ' + part; else acc.push(part); return acc; }, []).map(clip) : []));
    probeC.remove();
    const nCat = Math.max(1, ...catLines.map(x => x.length)), nSub = hasSub ? Math.max(...subLines.map(x => x.length)) : 0;
    const extraH = (nCat - 1) * 16 + Math.max(0, nSub - 1) * 14;
    const h = h0 + extraH, mt = 22, mr = 8, mb = 28 + (nCat - 1) * 16 + nSub * 15;
    if (extraH) svg.attr('height', h).attr('viewBox', `0 0 ${w} ${h}`);
    const vals = cats.flatMap(c => c.values.filter(finite));
    const y = d3.scaleLinear([Math.min(0, d3.min(vals) ?? 0), Math.max(0, (d3.max(vals) ?? 1) * 1.04) || 1], [h - mb, mt]).nice();
    const ml = yAxis(svg, y, w, mr, o.axisFmt || F.tyAxis, 5);
    const keys = cats.map(c => c.key);
    const x0 = d3.scaleBand(keys, [ml, w - mr]).paddingInner(0.28).paddingOuter(0.14);
    const bw = Math.max(2, Math.min(56, (x0.bandwidth() - gap * (n - 1)) / n));
    const off = (x0.bandwidth() - (bw * n + gap * (n - 1))) / 2;
    const fmt = o.fmt || F.vnd, lab = o.labelFmt || fmt;
    const hl = svg.append('rect').attr('y', mt - 18).attr('height', h - mb - mt + 18).attr('rx', 6).style('fill', 'var(--chart-grid)').attr('opacity', 0);
    const g = svg.append('g');
    // Đo nhãn để chỉ ghi khi vừa độ rộng cột (tránh chữ đè nhau)
    const probe = svg.append('text').attr('class', 'ptl col-val');
    const fits = s => { probe.text(s); return probe.node().getComputedTextLength() <= bw + gap + 2; };
    const showLab = o.labels !== false && cats.every(c => c.values.every(v => !finite(v) || fits(lab(v))));
    probe.remove();
    cats.forEach(c => series.forEach((s, i) => {
      const v = c.values[i];
      if (!finite(v)) return;
      const x = x0(c.key) + off + i * (bw + gap), top = y(Math.max(0, v)), bot = y(Math.min(0, v));
      const r = Math.min(4, bw / 2, Math.max(0, bot - top));
      // Bo tròn 4px ở đầu cột, chân cột vuông trên đường gốc
      const hh = Math.max(0, bot - top);
      g.append('path').attr('d', v >= 0
        ? `M${x},${bot}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${bot}Z`
        : `M${x},${top}V${bot - r}Q${x},${bot} ${x + r},${bot}H${x + bw - r}Q${x + bw},${bot} ${x + bw},${bot - r}V${top}Z`)
        .style('fill', s.color).attr('data-h', hh);
      if (showLab && v !== 0) g.append('text').attr('class', 'ptl col-val').attr('x', x + bw / 2).attr('y', v >= 0 ? top - 5 : bot + 12).attr('text-anchor', 'middle').text(lab(v));
    }));
    baseline(svg, ml, w - mr, y(0));
    const ax = svg.append('g');
    cats.forEach(c => {
      const cx = x0(c.key) + x0.bandwidth() / 2;
      const i = cats.indexOf(c);
      catLines[i].forEach((t, k) => ax.append('text').attr('class', 'ax col-cat').attr('x', cx).attr('y', h - mb + 17 + k * 16).attr('text-anchor', 'middle').text(t));
      subLines[i].forEach((t, k) => ax.append('text').attr('class', 'ax col-sub').attr('x', cx).attr('y', h - mb + 17 + nCat * 16 + k * 14).attr('text-anchor', 'middle').text(t));
    });
    svg.append('g').selectAll('rect').data(cats).join('rect')
      .attr('x', c => x0(c.key) - (x0.step() - x0.bandwidth()) / 2).attr('width', x0.step()).attr('y', 0).attr('height', h)
      .style('fill', 'transparent').style('cursor', o.onPick ? 'pointer' : 'default')
      .on('pointerenter pointermove', (ev, c) => {
        hl.attr('x', x0(c.key) - 6).attr('width', x0.bandwidth() + 12).attr('opacity', 0.7);
        tip.show(ev, c.label, series.map((s, j) => [s.color, s.name, finite(c.values[j]) ? fmt(c.values[j]) : '–']).concat(c.extra || []));
      })
      .on('pointerleave', () => { hl.attr('opacity', 0); tip.hide(); })
      .on('click', (ev, c) => { if (o.onPick) o.onPick(c.key); });
  }

  window.F = F;
  window.Charts = { C, columns, lines, stacked, breakdown, hbars, groupCols };
})();

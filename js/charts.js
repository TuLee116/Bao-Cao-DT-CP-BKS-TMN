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
  function xLabels(svg, ms, fx, yPos, avail) {
    const per = avail / ms.length;
    const step = per < 46 ? Math.ceil(46 / per) : 1;
    svg.append('g').attr('class', 'ax').selectAll('text')
      .data(ms.filter((m, i) => (ms.length - 1 - i) % step === 0)).join('text')
      .attr('x', fx).attr('y', yPos).attr('text-anchor', 'middle').text(F.mShort);
  }
  function baseline(svg, x1, x2, yv) {
    svg.append('line').attr('x1', x1).attr('x2', x2).attr('y1', yv).attr('y2', yv).style('stroke', 'var(--chart-axis)').attr('stroke-width', 1);
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

  // Cột doanh thu & tổng chi phí + đường lợi nhuận. rows: [{month, doanh_thu, tong_chi_phi, loi_nhuan, bien_ln}]
  function revenueCost(host, rows, onPick) {
    const tip = tipFor(host);
    const h = 300, mt = 12, mr = 8, mb = 26;
    const { svg, w } = newSvg(host, h);
    const y = d3.scaleLinear([Math.min(0, d3.min(rows, r => r.loi_nhuan)), d3.max(rows, r => Math.max(r.doanh_thu, r.tong_chi_phi)) || 1], [h - mb, mt]).nice();
    const ml = yAxis(svg, y, w, mr, F.tr, 5);
    const x0 = d3.scaleBand(rows.map(r => r.month), [ml, w - mr]).paddingInner(0.3).paddingOuter(0.15);
    const gap = 2, bw = Math.max(1, Math.min(32, (x0.bandwidth() - gap) / 2));
    const off = (x0.bandwidth() - (bw * 2 + gap)) / 2;
    const hl = svg.append('rect').attr('y', mt).attr('height', h - mb - mt).attr('rx', 4).style('fill', 'var(--chart-grid)').attr('opacity', 0);
    const g = svg.append('g');
    rows.forEach(r => ['doanh_thu', 'tong_chi_phi'].forEach((k, i) => {
      const top = y(Math.max(0, r[k]));
      g.append('rect').attr('x', x0(r.month) + off + i * (bw + gap)).attr('width', bw)
        .attr('y', top).attr('height', Math.max(0, y(0) - top)).attr('rx', Math.min(4, bw / 2)).style('fill', C[i]);
    }));
    baseline(svg, ml, w - mr, y(0));
    const cx = r => x0(r.month) + x0.bandwidth() / 2;
    svg.append('path').datum(rows).attr('d', d3.line(cx, r => y(r.loi_nhuan)))
      .style('fill', 'none').style('stroke', C[2]).attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');
    svg.append('g').selectAll('circle').data(rows).join('circle').attr('cx', cx).attr('cy', r => y(r.loi_nhuan)).attr('r', 4)
      .style('fill', C[2]).style('stroke', 'var(--panel)').attr('stroke-width', 2);
    xLabels(svg, rows.map(r => r.month), m => x0(m) + x0.bandwidth() / 2, h - mb + 17, w - ml - mr);
    overlay(svg, rows, cx, x0.step(), mt, h - mb - mt, (ev, r) => {
      hl.attr('x', x0(r.month) - 4).attr('width', x0.bandwidth() + 8).attr('opacity', 0.7);
      tip.show(ev, F.mLong(r.month) + (r.notes ? ` · ${r.notes} ghi chú` : ''), [
        [C[0], 'Doanh thu', F.tr(r.doanh_thu) + ' tr'],
        [C[1], 'Tổng chi phí', F.tr(r.tong_chi_phi) + ' tr'],
        [C[2], 'Lợi nhuận', F.tr(r.loi_nhuan) + ' tr'],
        [null, 'Biên lợi nhuận', F.pct(r.bien_ln)]
      ]);
    }, () => { hl.attr('opacity', 0); tip.hide(); }, onPick && ((ev, r) => onPick(r.month)));
  }

  // Đường biên lợi nhuận, đánh dấu tháng thấp nhất và tháng cuối.
  function margin(host, rows) {
    const tip = tipFor(host);
    const h = 220, mt = 24, mr = 12, mb = 26;
    const { svg, w } = newSvg(host, h);
    const vals = rows.map(r => r.bien_ln).filter(isFinite);
    const y = d3.scaleLinear([Math.min(0, d3.min(vals)), Math.max(0.01, d3.max(vals) * 1.1)], [h - mb, mt]).nice();
    const ml = yAxis(svg, y, w, mr, d3.format('.0%'), 4);
    const x = d3.scalePoint(rows.map(r => r.month), [ml + 10, w - mr - 10]);
    const ok = rows.filter(r => isFinite(r.bien_ln));
    const gid = 'grad-bien';
    const grad = svg.append('defs').append('linearGradient').attr('id', gid).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
    [[0, .26], [.25, .16], [.5, .08], [.75, .03], [1, 0]].forEach(([o, a]) => grad.append('stop').attr('offset', o).attr('style', `stop-color:${C[2]};stop-opacity:${a}`));
    svg.append('path').datum(ok).attr('d', d3.area(r => x(r.month), y(0), r => y(r.bien_ln))).style('fill', `url(#${gid})`);
    baseline(svg, ml, w - mr, y(0));
    svg.append('path').datum(ok).attr('d', d3.line(r => x(r.month), r => y(r.bien_ln)))
      .style('fill', 'none').style('stroke', C[2]).attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');
    if (ok.length) {
      const last = ok[ok.length - 1];
      const lo = ok.reduce((m, r) => (r.bien_ln < m.bien_ln ? r : m));
      const anchor = px => (px < ml + 40 ? 'start' : px > w - mr - 40 ? 'end' : 'middle');
      (lo === last ? [last] : [lo, last]).forEach(r => {
        const px = x(r.month), py = y(r.bien_ln);
        svg.append('circle').attr('cx', px).attr('cy', py).attr('r', 4.5).style('fill', C[2]).style('stroke', 'var(--panel)').attr('stroke-width', 2);
        svg.append('text').attr('class', 'ptl').attr('x', px).attr('y', py - 10).attr('text-anchor', anchor(px))
          .text((r === lo && ok.length > 1 ? 'Thấp nhất ' : '') + F.pct(r.bien_ln));
      });
    }
    xLabels(svg, rows.map(r => r.month), x, h - mb + 17, w - ml - mr);
    const dot = svg.append('circle').attr('r', 4).style('fill', C[2]).style('stroke', 'var(--panel)').attr('stroke-width', 2).attr('opacity', 0);
    overlay(svg, ok, r => x(r.month), x.step() || 40, mt, h - mb - mt, (ev, r) => {
      dot.attr('cx', x(r.month)).attr('cy', y(r.bien_ln)).attr('opacity', 1);
      tip.show(ev, F.mLong(r.month), [[null, 'Biên lợi nhuận', F.pct(r.bien_ln)], [null, 'Lợi nhuận', F.tr(r.loi_nhuan) + ' tr']]);
    }, () => { dot.attr('opacity', 0); tip.hide(); });
  }

  // Thanh ngang cơ cấu chi phí. items: [{name, value, share}]
  function costBars(host, items) {
    host.replaceChildren();
    const max = d3.max(items, r => r.value) || 1;
    items.forEach(r => {
      const row = el('div', 'bar-row');
      const top = el('div', 'bar-top');
      const val = el('span', 'bar-val');
      val.append(el('b', null, F.tr(r.value) + ' tr'), document.createTextNode(' · ' + F.pct(r.share)));
      top.append(el('span', null, r.name), val);
      const track = el('div', 'track');
      const bar = el('div', 'bar');
      bar.style.width = (r.value / max * 100) + '%';
      bar.style.background = C[1];
      track.append(bar);
      row.append(top, track);
      host.append(row);
    });
  }

  // Đường doanh thu theo kênh. series: [{name, values: [{month, v}]}]
  function channels(host, legend, months, series) {
    const tip = tipFor(host);
    const col = i => C[(3 + i) % C.length];
    legend.replaceChildren(...series.map((s, i) => { const sp = el('span'); const sw = el('i', 'sw line'); sw.style.background = col(i); sp.append(sw, document.createTextNode(s.name)); return sp; }));
    const h = 260, mt = 12, mr = 12, mb = 26;
    const { svg, w } = newSvg(host, h);
    const all = series.flatMap(s => s.values.map(p => p.v));
    const y = d3.scaleLinear([0, (d3.max(all) || 1) * 1.05], [h - mb, mt]).nice();
    const ml = yAxis(svg, y, w, mr, F.tr, 5);
    const x = d3.scalePoint(months, [ml + 10, w - mr - 10]);
    baseline(svg, ml, w - mr, y(0));
    const rule = svg.append('line').attr('y1', mt).attr('y2', h - mb).style('stroke', 'var(--chart-ref)').attr('stroke-width', 1).attr('opacity', 0);
    series.forEach((s, i) => {
      const pts = s.values.filter(p => p.v != null);
      svg.append('path').datum(pts).attr('d', d3.line(p => x(p.month), p => y(p.v)))
        .style('fill', 'none').style('stroke', col(i)).attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');
      const e = pts[pts.length - 1];
      if (e) svg.append('circle').attr('cx', x(e.month)).attr('cy', y(e.v)).attr('r', 4).style('fill', col(i)).style('stroke', 'var(--panel)').attr('stroke-width', 2);
    });
    xLabels(svg, months, x, h - mb + 17, w - ml - mr);
    const dots = svg.append('g').attr('opacity', 0);
    overlay(svg, months, m => x(m), x.step() || 40, mt, h - mb - mt, (ev, m) => {
      const at = series.map((s, i) => ({ i, name: s.name, v: (s.values.find(p => p.month === m) || {}).v })).filter(r => r.v != null).sort((a, b) => b.v - a.v);
      rule.attr('x1', x(m)).attr('x2', x(m)).attr('opacity', 1);
      dots.attr('opacity', 1).selectAll('circle').data(at).join('circle').attr('cx', x(m)).attr('cy', r => y(r.v)).attr('r', 4)
        .style('fill', r => col(r.i)).style('stroke', 'var(--panel)').attr('stroke-width', 2);
      tip.show(ev, F.mLong(m), at.map(r => [col(r.i), r.name, F.tr(r.v) + ' tr']).concat([[null, 'Tổng', F.tr(d3.sum(at, r => r.v)) + ' tr']]));
    }, () => { rule.attr('opacity', 0); dots.attr('opacity', 0); tip.hide(); });
  }

  window.F = F;
  window.Charts = { C, revenueCost, margin, costBars, channels };
})();

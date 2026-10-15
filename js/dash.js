// Lớp dữ liệu nhỏ cho trang tĩnh: đọc CSV trong thư mục data/, tính các chỉ số
// phái sinh (dash.calc) và vẽ lại trang khi dữ liệu về hoặc khi đổi kích thước.
window.dash = (function () {
  const SOURCES = {
    theo_thang: 'data/doanh-thu-chi-phi-theo-thang.csv',
    theo_kenh: 'data/doanh-thu-theo-kenh.csv'
  };
  const store = {};
  const calcs = {};
  const listeners = [];
  let memo = {};

  function data(id) {
    if (calcs[id]) {
      if (memo[id]) return memo[id];
      const ins = calcs[id].inputs.map(data);
      let res;
      if (ins.some(d => d.status === 'error')) res = { status: 'error', data: [], message: 'Nguồn đầu vào lỗi' };
      else if (!ins.every(d => d.status === 'ok')) res = { status: 'loading', data: [] };
      else {
        try { res = { status: 'ok', data: calcs[id].fn(...ins.map(d => d.data)) }; }
        catch (e) { res = { status: 'error', data: [], message: String(e) }; }
      }
      return (memo[id] = res);
    }
    if (store[id]) return store[id];
    if (!SOURCES[id]) return { status: 'missing', data: [] };
    return { status: 'loading', data: [] };
  }

  function notify() {
    memo = {};
    listeners.forEach(fn => {
      try { fn(); } catch (e) { console.error(e); }
    });
  }

  function onData(fn) {
    listeners.push(fn);
    try { fn(); } catch (e) { console.error(e); }
  }

  function calc(id, def) { calcs[id] = def; }

  function load(id) {
    return fetch(SOURCES[id], { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error(r.status + ' ' + r.statusText); return r.text(); })
      .then(t => { const rows = d3.csvParse(t); store[id] = { status: 'ok', data: rows, columns: rows.columns }; })
      .catch(e => { store[id] = { status: 'error', data: [], message: String(e) }; console.error(id, e); });
  }

  const colors = [1, 2, 3, 4, 5, 6, 7, 8].map(i => `var(--series-${i})`);

  document.addEventListener('DOMContentLoaded', () => {
    Promise.all(Object.keys(SOURCES).map(load)).then(notify);
    let lastW = document.body.clientWidth, raf = 0;
    new ResizeObserver(() => {
      const w = document.body.clientWidth;
      if (w === lastW) return;
      lastW = w;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(notify);
    }).observe(document.body);
  });

  return { data, onData, calc, colors };
})();

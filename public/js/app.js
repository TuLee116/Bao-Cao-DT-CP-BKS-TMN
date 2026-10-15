// Ứng dụng một trang: đăng nhập, dashboard, nhập số liệu, danh mục, nhập file, người dùng.
(function () {
  'use strict';
  const cfg = window.APP_CONFIG || {};
  const APP = cfg.APP_NAME || 'Báo cáo doanh thu – chi phí';
  const $app = document.getElementById('app');
  const C = Charts.C;
  let api = null; // gán sau khi window.apiReady xong

  const S = {
    profile: null, needsSetup: false, loaded: false,
    channels: [], categories: [], revenue: [], expenses: [], notes: [], users: [],
    period: '12m', noteMonth: null, editMonth: null, redraw: null
  };

  // ------------------------------------------------------------------
  // Tiện ích DOM
  // ------------------------------------------------------------------
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (['value', 'checked', 'disabled', 'selected', 'hidden'].includes(k)) e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat(Infinity).forEach(c => {
      if (c == null || c === false) return;
      e.append(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return e;
  }
  function toast(msg, err) {
    const t = h('div', { class: 'toast' + (err ? ' err' : '') }, msg);
    const box = document.getElementById('toasts');
    box.append(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => t.remove(), err ? 6500 : 3000);
  }
  // Chạy thao tác bất đồng bộ: khóa nút trong lúc chạy, báo lỗi bằng toast. Trả về true khi thành công.
  async function run(btn, fn) {
    if (btn) btn.disabled = true;
    try { await fn(); return true; }
    catch (e) { console.error(e); toast((e && e.message) || String(e), true); return false; }
    finally { if (btn && btn.isConnected) btn.disabled = false; }
  }
  // Nút xóa hai bước: bấm lần đầu để "lên cò", bấm lần nữa trong 4 giây mới xóa.
  function confirmBtn(label, onConfirm, cls) {
    let timer = 0;
    const b = h('button', { class: 'btn danger ' + (cls || 'sm'), type: 'button' }, label);
    b.addEventListener('click', async () => {
      if (!b.classList.contains('armed')) {
        b.classList.add('armed'); b.textContent = 'Bấm lần nữa để xóa';
        timer = setTimeout(() => { b.classList.remove('armed'); b.textContent = label; }, 4000);
        return;
      }
      clearTimeout(timer);
      await run(b, onConfirm);
    });
    return b;
  }
  const isAdmin = () => !!S.profile && S.profile.role === 'admin';
  const isMember = () => !!S.profile && ['admin', 'viewer'].includes(S.profile.role);
  const ROLE = { admin: 'Admin', viewer: 'Người xem' };
  const ymNow = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const addMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const byName = list => new Map(list.map(c => [c.name.trim().toLowerCase(), c]));
  const route = () => location.hash.replace(/^#\/?/, '').split(/[?#]/)[0];

  // ------------------------------------------------------------------
  // Dữ liệu
  // ------------------------------------------------------------------
  async function loadAll() {
    const d = await api.loadData();
    const [ch, ca, rv, ex, no] = [d.channels, d.categories, d.revenue, d.expenses, d.notes];
    const norm = r => Object.assign({}, r, { month: String(r.month).slice(0, 7) + '-01', amount: Number(r.amount) || 0 });
    Object.assign(S, { channels: ch, categories: ca, revenue: rv.map(norm), expenses: ex.map(norm), notes: no.map(n => Object.assign({}, n, { month: String(n.month).slice(0, 7) + '-01' })) });
    S.users = isAdmin() ? await api.listUsers() : [];
    S.loaded = true;
  }
  async function reload() { await loadAll(); render(); }

  function buildModel() {
    const months = new Map();
    const get = m => { if (!months.has(m)) months.set(m, { month: m, rev: {}, exp: {}, doanh_thu: 0, tong_chi_phi: 0 }); return months.get(m); };
    S.revenue.forEach(r => { const o = get(r.month); o.rev[r.channel_id] = r.amount; o.doanh_thu += r.amount; });
    S.expenses.forEach(r => { const o = get(r.month); o.exp[r.category_id] = r.amount; o.tong_chi_phi += r.amount; });
    const notesBy = d3.rollup(S.notes, v => v.length, n => n.month);
    const rows = [...months.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
    rows.forEach(o => {
      o.loi_nhuan = o.doanh_thu - o.tong_chi_phi;
      o.bien_ln = o.doanh_thu ? o.loi_nhuan / o.doanh_thu : NaN;
      o.notes = notesBy.get(o.month) || 0;
    });
    return rows;
  }
  function periodRows(rows, p) {
    if (p === 'all') return rows;
    if (p.startsWith('y')) return rows.filter(r => r.month.startsWith(p.slice(1)));
    return rows.slice(-12);
  }

  // ------------------------------------------------------------------
  // Đăng nhập & điều hướng
  // ------------------------------------------------------------------
  let authBusy = Promise.resolve();
  function refreshAuth() {
    authBusy = authBusy.then(async () => {
      try {
        const m = await api.me();
        S.profile = m.user;
        S.needsSetup = !!m.needsSetup;
        S.loaded = false;
        render();
        if (S.profile && isMember()) await loadAll();
      } catch (e) {
        console.error(e); toast((e && e.message) || String(e), true);
      }
      render();
    });
    return authBusy;
  }

  function render() {
    S.redraw = null;
    if (!S.profile) return S.needsSetup ? mount(viewSetup(), 'Cài đặt lần đầu') : mount(viewLogin(), 'Đăng nhập');
    if (!S.loaded) return mount(shell(h('div', { class: 'skeleton', style: 'height:320px' })), '');
    const views = {
      '': [viewDashboard, 'Tổng quan'], 'nhap-lieu': [viewEntry, 'Nhập số liệu'], 'danh-muc': [viewCategories, 'Danh mục'],
      'nhap-file': [viewImport, 'Nhập từ file'], 'nguoi-dung': [viewUsers, 'Người dùng'], 'tai-khoan': [viewAccount, 'Tài khoản']
    };
    let r = route();
    if (!views[r] || (['nhap-lieu', 'danh-muc', 'nhap-file', 'nguoi-dung'].includes(r) && !isAdmin())) r = '';
    mount(shell(views[r][0]()), views[r][1]);
    if (S.redraw) S.redraw();
  }
  function mount(node, title) {
    $app.replaceChildren(node);
    document.title = title ? title + ' · ' + APP : APP;
  }

  function demoBar() {
    if (api.mode !== 'demo') return null;
    return h('div', { class: 'demo-bar' }, h('div', { class: 'wrap' },
      h('span', null, h('b', null, 'Chế độ demo. '), 'Không tìm thấy máy chủ nên dữ liệu chỉ lưu trong trình duyệt này và là số liệu mẫu. Triển khai lên Railway hoặc Vercel để dùng thật (xem README).'),
      S.profile ? confirmBtn('Đặt lại dữ liệu demo', async () => { api.reset(); toast('Đã đặt lại dữ liệu demo.'); await refreshAuth(); }, 'sm') : null));
  }

  function shell(content) {
    const r = route();
    const items = [['', 'Tổng quan'], ['nhap-lieu', 'Nhập số liệu', 1], ['danh-muc', 'Danh mục', 1], ['nhap-file', 'Nhập từ file', 1], ['nguoi-dung', 'Người dùng', 1]];
    const nav = h('nav', { class: 'nav', 'aria-label': 'Chức năng' },
      items.filter(i => !i[2] || isAdmin()).map(([k, t]) => h('a', { href: '#/' + k, class: (r === k || (k === '' && !items.some(i => i[0] === r) && r !== 'tai-khoan')) ? 'on' : '' }, t)));
    const who = h('div', { class: 'who' },
      h('span', { class: 'email', title: S.profile.username }, S.profile.full_name || S.profile.username),
      h('span', { class: 'chip ' + S.profile.role }, ROLE[S.profile.role]),
      h('a', { class: 'btn sm', href: '#/tai-khoan' }, 'Tài khoản'),
      h('button', { class: 'btn sm', type: 'button', onclick: e => run(e.currentTarget, async () => { await api.signOut(); location.hash = ''; await refreshAuth(); }) }, 'Đăng xuất'));
    return h('div', null,
      h('header', { class: 'topbar' }, h('div', { class: 'wrap' },
        h('a', { class: 'brand', href: '#/' }, logo(), APP), nav, who)),
      demoBar(),
      h('main', { class: 'wrap' }, content),
      h('footer', { class: 'wrap foot' }, 'Đơn vị số tiền: triệu đồng. Lợi nhuận tính trước thuế TNDN.'));
  }
  function logo() {
    return h('span', { class: 'logo-tile' }, h('img', { src: 'img/logo-mark.png', alt: '', width: 26, height: 26 }));
  }


  // ---------- Đăng nhập ----------
  function authCard(...kids) {
    return h('div', null, demoBar(), h('div', { class: 'wrap auth' }, h('div', { class: 'card auth-card stack' },
      h('div', { class: 'auth-logo' }, h('img', { src: 'img/logo-tmn.png', alt: 'Tân Minh Nhân Corporation', width: 220, height: 149 })), h('h1', null, APP), ...kids)));
  }

  function viewLogin() {
    const user = h('input', { type: 'text', id: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, value: S.lastUser || '' });
    const pw = h('input', { type: 'password', id: 'password', autocomplete: 'current-password', required: true });
    const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Đăng nhập');
    const form = h('form', {
      class: 'stack', onsubmit: async ev => {
        ev.preventDefault();
        S.lastUser = user.value.trim();
        const ok = await run(submit, () => api.signIn(user.value.trim(), pw.value));
        if (ok) await refreshAuth();
      }
    }, h('label', { class: 'f' }, 'Tên đăng nhập', user), h('label', { class: 'f' }, 'Mật khẩu', pw), submit,
    h('p', { class: 'note' }, 'Chưa có tài khoản hoặc quên mật khẩu? Hãy liên hệ admin để được cấp hoặc đặt lại.'));
    const demo = api.mode === 'demo' ? h('div', { class: 'alert warn stack' },
      h('span', null, 'Chế độ demo: chọn một vai trò để xem thử.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', type: 'button', onclick: e => run(e.currentTarget, async () => { await api.signIn('admin', ''); await refreshAuth(); }) }, 'Vào với quyền Admin'),
        h('button', { class: 'btn sm', type: 'button', onclick: e => run(e.currentTarget, async () => { await api.signIn('nguoixem', ''); await refreshAuth(); }) }, 'Vào với quyền Người xem'))) : null;
    return authCard(h('p', { class: 'note' }, 'Đăng nhập để xem báo cáo doanh thu, chi phí và lợi nhuận.'), form, demo);
  }

  // Lần chạy đầu tiên: chưa có tài khoản nào, tạo tài khoản admin.
  function viewSetup() {
    const name = h('input', { type: 'text', id: 'setup-name', autocomplete: 'name' });
    const user = h('input', { type: 'text', id: 'setup-username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, minlength: 3 });
    const p1 = h('input', { type: 'password', id: 'setup-password', autocomplete: 'new-password', required: true, minlength: 8 });
    const p2 = h('input', { type: 'password', id: 'setup-password2', autocomplete: 'new-password', required: true, minlength: 8 });
    const b = h('button', { class: 'btn primary', type: 'submit' }, 'Tạo tài khoản admin');
    return authCard(
      h('div', { class: 'alert ok' }, 'Web chưa có tài khoản nào. Tạo tài khoản admin đầu tiên để bắt đầu; sau đó admin tạo tài khoản cho những người khác.'),
      h('form', {
        class: 'stack', onsubmit: async ev => {
          ev.preventDefault();
          if (p1.value !== p2.value) return toast('Hai mật khẩu chưa khớp nhau.', true);
          const ok = await run(b, () => api.setup(user.value.trim(), name.value.trim(), p1.value));
          if (ok) { toast('Đã tạo tài khoản admin.'); await refreshAuth(); }
        }
      }, h('label', { class: 'f' }, 'Họ và tên', name), h('label', { class: 'f' }, 'Tên đăng nhập (ví dụ: tu.le hoặc email)', user),
      h('label', { class: 'f' }, 'Mật khẩu (ít nhất 8 ký tự)', p1), h('label', { class: 'f' }, 'Nhập lại mật khẩu', p2), b));
  }

  // ------------------------------------------------------------------
  // Tổng quan (dashboard)
  // ------------------------------------------------------------------
  function viewDashboard() {
    const all = buildModel();
    if (!all.length) {
      return h('div', { class: 'card empty' },
        h('h2', null, 'Chưa có số liệu'),
        isAdmin()
          ? [h('p', null, 'Nhập tay từng tháng hoặc tải lên file Excel để bắt đầu.'),
            h('div', { class: 'row' }, h('a', { class: 'btn primary', href: '#/nhap-lieu' }, 'Nhập số liệu tháng'), h('a', { class: 'btn', href: '#/nhap-file' }, 'Nhập từ file Excel'))]
          : h('p', null, 'Admin chưa nhập số liệu nào. Hãy quay lại sau.'));
    }
    const years = [...new Set(all.map(r => r.month.slice(0, 4)))].sort().reverse();
    if (S.period !== '12m' && S.period !== 'all' && !years.includes(S.period.slice(1))) S.period = '12m';
    const rows = periodRows(all, S.period);
    const sel = h('select', { id: 'period', 'aria-label': 'Kỳ báo cáo', onchange: e => { S.period = e.target.value; render(); } },
      h('option', { value: '12m' }, '12 tháng gần nhất'), years.map(y => h('option', { value: 'y' + y }, 'Năm ' + y)), h('option', { value: 'all' }, 'Toàn bộ'));
    sel.value = S.period;

    const sum = k => d3.sum(rows, r => r[k]);
    const tDt = sum('doanh_thu'), tCp = sum('tong_chi_phi'), tLn = tDt - tCp;
    const lo = rows.filter(r => isFinite(r.bien_ln)).reduce((m, r) => (!m || r.bien_ln < m.bien_ln ? r : m), null);
    const lead = h('p', { class: 'lead' },
      `Từ ${F.mLong(rows[0].month)} đến ${F.mLong(rows[rows.length - 1].month)}, doanh thu đạt `, h('b', null, F.ty(tDt)),
      ', tổng chi phí ', h('b', null, F.ty(tCp)), ', lợi nhuận trước thuế ', h('b', { class: tLn < 0 ? 'is-bad' : '' }, F.ty(tLn)),
      ' (biên ', h('b', null, F.pct(tDt ? tLn / tDt : NaN)), ').',
      lo && rows.length > 1 ? [` Biên thấp nhất ở ${F.mLong(lo.month)}: `, h('b', null, F.pct(lo.bien_ln)), '.'] : null);

    const last = rows[rows.length - 1];
    const prev = all[all.indexOf(last) - 1];
    const tile = (label, k, sign) => {
      const v = last[k];
      let delta = null;
      if (prev) {
        const d = k === 'bien_ln' ? v - prev[k] : (prev[k] ? (v - prev[k]) / Math.abs(prev[k]) : NaN);
        const cls = !isFinite(d) || d === 0 ? '' : (d * sign > 0 ? 'is-good' : 'is-bad');
        delta = h('span', { class: 'delta' }, h('b', { class: cls }, k === 'bien_ln' ? F.pt(d) : F.spct(d)), ' so với ' + F.mLong(prev.month));
      }
      return h('div', { class: 'card tile' },
        h('span', { class: 'label' }, label + ' · ' + F.mLong(last.month)),
        h('span', { class: 'big' + (k === 'loi_nhuan' && v < 0 ? ' is-bad' : '') }, k === 'bien_ln' ? F.pct(v) : F.money(v)),
        delta || h('span', { class: 'delta' }, 'Chưa có tháng trước để so sánh'));
    };

    // Cơ cấu chi phí và doanh thu theo kênh trong kỳ
    const catName = new Map(S.categories.map(c => [c.id, c.name]));
    const chName = new Map(S.channels.map(c => [c.id, c.name]));
    const catIds = [...new Set(rows.flatMap(r => Object.keys(r.exp).map(Number)))];
    const costItems = catIds.map(id => ({ id, name: catName.get(id) || 'Khoản mục #' + id, value: d3.sum(rows, r => r.exp[id] || 0) }))
      .filter(x => x.value > 0).sort((a, b) => b.value - a.value);
    const costTotal = d3.sum(costItems, x => x.value) || 1;
    costItems.forEach(x => { x.share = x.value / costTotal; });
    const order = new Map(S.channels.map((c, i) => [c.id, i]));
    const chIds = [...new Set(rows.flatMap(r => Object.keys(r.rev).map(Number)))].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
    const series = chIds.map(id => ({ name: chName.get(id) || 'Kênh #' + id, values: rows.map(r => ({ month: r.month, v: r.rev[id] != null ? r.rev[id] : null })) }));

    const hostDtCp = h('div', { class: 'chart' }), hostBien = h('div', { class: 'chart sm' }), hostCost = h('div', { class: 'bars' });
    const hostCh = h('div', { class: 'chart md' }), legendCh = h('div', { class: 'legend' });
    const notes = notesCard(all);
    S.redraw = () => {
      Charts.revenueCost(hostDtCp, rows, m => notes.open(m));
      Charts.margin(hostBien, rows);
      Charts.costBars(hostCost, costItems);
      Charts.channels(hostCh, legendCh, rows.map(r => r.month), series);
    };

    // Bảng lãi lỗ
    const costCols = costItems.slice().sort((a, b) => (S.categories.findIndex(c => c.id === a.id)) - (S.categories.findIndex(c => c.id === b.id)));
    const table = h('table', { class: 't' },
      h('thead', null, h('tr', null, h('th', null, 'Tháng'), h('th', null, 'Doanh thu'), costCols.map(c => h('th', null, c.name)),
        h('th', { class: 'sum' }, 'Tổng chi phí'), h('th', null, 'Lợi nhuận'), h('th', null, 'Biên LN'), h('th', null, 'Ghi chú'))),
      h('tbody', null, rows.slice().reverse().map(r => h('tr', {
        class: 'click' + (S.noteMonth === r.month ? ' sel' : ''), tabindex: '0', title: 'Xem ghi chú tháng này',
        onclick: () => notes.open(r.month), onkeydown: e => { if (e.key === 'Enter') notes.open(r.month); }
      },
      h('td', null, F.mLong(r.month)), h('td', null, F.tr(r.doanh_thu)), costCols.map(c => h('td', null, r.exp[c.id] != null ? F.tr(r.exp[c.id]) : '–')),
      h('td', { class: 'sum' }, F.tr(r.tong_chi_phi)), h('td', { class: r.loi_nhuan < 0 ? 'is-bad' : '' }, F.tr(r.loi_nhuan)), h('td', null, F.pct(r.bien_ln)),
      h('td', null, r.notes ? r.notes + ' ✎' : '')))));

    return h('div', { class: 'stack', style: 'gap:22px' },
      h('div', null, h('div', { class: 'page-head' }, h('h1', null, 'Tổng quan'), h('label', { class: 'f' }, 'Kỳ báo cáo', sel)), lead),
      h('section', { class: 'tiles', 'aria-label': 'Chỉ số tháng gần nhất' },
        tile('Doanh thu', 'doanh_thu', 1), tile('Tổng chi phí', 'tong_chi_phi', -1), tile('Lợi nhuận trước thuế', 'loi_nhuan', 1), tile('Biên lợi nhuận', 'bien_ln', 1)),
      h('section', { class: 'grid' },
        h('div', { class: 'card wide', id: 'dt-cp' },
          h('h2', null, 'Doanh thu, chi phí và lợi nhuận theo tháng'),
          h('p', { class: 'note' }, 'Bấm vào một tháng để xem ghi chú của tháng đó.'),
          h('div', { class: 'legend' }, h('span', null, sw(C[0]), 'Doanh thu'), h('span', null, sw(C[1]), 'Tổng chi phí'), h('span', null, sw(C[2], true), 'Lợi nhuận')),
          h('div', { class: 'chart-box' }, hostDtCp)),
        h('div', { class: 'card', id: 'bien' }, h('h2', null, 'Biên lợi nhuận'), h('p', { class: 'note' }, 'Lợi nhuận trước thuế chia cho doanh thu.'), h('div', { class: 'chart-box' }, hostBien)),
        h('div', { class: 'card', id: 'co-cau' }, h('h2', null, 'Cơ cấu chi phí'), h('p', { class: 'note' }, 'Tổng từng khoản trong kỳ và tỷ trọng trên tổng chi phí.'), hostCost),
        h('div', { class: 'card wide', id: 'kenh' }, h('h2', null, 'Doanh thu theo kênh bán'), legendCh, h('div', { class: 'chart-box' }, hostCh)),
        h('div', { class: 'card wide', id: 'bang' }, h('h2', null, 'Bảng lãi lỗ theo tháng'), h('p', { class: 'note' }, 'Tháng mới nhất ở trên cùng. Bấm một dòng để xem và thêm ghi chú.'), h('div', { class: 'table-wrap' }, table)),
        notes.card));
  }
  function sw(color, line) { const s = h('i', { class: 'sw' + (line ? ' line' : '') }); s.style.background = color; return s; }

  // Ghi chú theo tháng: ai đã được duyệt cũng viết được; xóa ghi chú của mình, admin xóa mọi ghi chú.
  function notesCard(all) {
    const months = [...new Set(all.map(r => r.month).concat(S.notes.map(n => n.month)))].sort().reverse();
    if (!S.noteMonth || !months.includes(S.noteMonth)) S.noteMonth = months[0];
    const card = h('div', { class: 'card wide', id: 'ghi-chu' });
    function draw() {
      const m = S.noteMonth;
      const sel = h('select', { id: 'note-month', 'aria-label': 'Tháng', onchange: e => { S.noteMonth = e.target.value; draw(); markRow(); } },
        months.map(x => h('option', { value: x }, F.mLong(x))));
      sel.value = m;
      const list = S.notes.filter(n => n.month === m).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      const ta = h('textarea', { id: 'note-text', placeholder: 'Ví dụ: chi phí nhân sự tăng do thưởng Tết…', maxlength: 4000, required: true });
      const add = h('button', { class: 'btn primary', type: 'submit' }, 'Thêm ghi chú');
      card.replaceChildren(
        h('div', { class: 'card-head' }, h('h2', null, 'Ghi chú theo tháng'), sel),
        list.length ? h('div', { class: 'notes' }, list.map(n => h('div', { class: 'note-item' },
          h('p', null, n.content),
          h('div', { class: 'note-meta' },
            h('span', null, (n.author_name || 'Không rõ') + ' · ' + new Date(n.created_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })),
            (n.author_id === S.profile.id || isAdmin()) ? confirmBtn('Xóa', async () => { await api.deleteNote(n.id); toast('Đã xóa ghi chú.'); await reload(); }) : null))))
          : h('p', { class: 'note' }, `Chưa có ghi chú cho ${F.mLong(m)}.`),
        h('form', {
          class: 'stack', onsubmit: async ev => {
            ev.preventDefault();
            const text = ta.value.trim();
            if (!text) return;
            const ok = await run(add, () => api.addNote(m, text));
            if (ok) { toast('Đã thêm ghi chú.'); await reload(); }
          }
        }, h('label', { class: 'f' }, 'Ghi chú mới cho ' + F.mLong(m), ta), h('div', { class: 'row' }, add)));
    }
    function markRow() {
      document.querySelectorAll('#bang tbody tr').forEach((tr, i, arr) => tr.classList.toggle('sel', tr.firstChild.textContent === F.mLong(S.noteMonth)));
    }
    draw();
    return {
      card,
      open(m) { S.noteMonth = m; draw(); markRow(); card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); card.querySelector('textarea').focus({ preventScroll: true }); }
    };
  }

  // ------------------------------------------------------------------
  // Nhập số liệu theo tháng
  // ------------------------------------------------------------------
  function viewEntry() {
    const all = buildModel();
    const next = all.length ? addMonth(all[all.length - 1].month.slice(0, 7), 1) : ymNow();
    const head = h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Nhập số liệu'), h('p', { class: 'lead' }, 'Mỗi tháng gồm doanh thu theo từng kênh bán và từng khoản chi phí, đơn vị triệu đồng.')),
      h('button', { class: 'btn primary', type: 'button', onclick: () => { S.editMonth = next + '-01'; render(); } }, '+ Thêm tháng'));
    const list = all.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, ['Tháng', 'Doanh thu', 'Tổng chi phí', 'Lợi nhuận', 'Biên LN', ''].map(t => h('th', null, t)))),
      h('tbody', null, all.slice().reverse().map(r => h('tr', { class: S.editMonth === r.month ? 'sel' : '' },
        h('td', null, F.mLong(r.month)), h('td', null, F.tr(r.doanh_thu)), h('td', null, F.tr(r.tong_chi_phi)),
        h('td', { class: r.loi_nhuan < 0 ? 'is-bad' : '' }, F.tr(r.loi_nhuan)), h('td', null, F.pct(r.bien_ln)),
        h('td', { class: 'actions' },
          h('button', { class: 'btn sm', type: 'button', onclick: () => { S.editMonth = r.month; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, 'Sửa'),
          confirmBtn('Xóa', async () => { await api.deleteMonth(r.month); if (S.editMonth === r.month) S.editMonth = null; toast('Đã xóa số liệu ' + F.mLong(r.month) + '.'); await reload(); })))))))
      : h('p', { class: 'note' }, 'Chưa có tháng nào. Bấm "+ Thêm tháng" để bắt đầu.');
    return h('div', { class: 'stack', style: 'gap:22px' }, head,
      S.editMonth ? editor(S.editMonth, all) : null,
      h('div', { class: 'card' }, h('h2', null, 'Các tháng đã nhập'), list));
  }

  function editor(month, all) {
    const existing = ym => all.find(r => r.month === ym + '-01');
    const hasCat = !S.channels.length || !S.categories.length;
    const monthIn = h('input', { type: 'month', id: 'ed-month', value: month.slice(0, 7), required: true });
    const warn = h('div', { class: 'alert warn', hidden: true });
    const totals = h('div', { class: 'totals' });
    const fields = [];
    const field = (kind, c, val) => {
      const inp = h('input', { class: 'num', type: 'text', inputmode: 'decimal', id: kind + '-' + c.id, autocomplete: 'off', value: val != null ? F.num(val) : '', placeholder: '0', oninput: update });
      fields.push({ kind, id: c.id, inp });
      return h('label', { class: 'f' }, h('span', null, c.name, c.active ? '' : ' (đang ẩn)'), inp);
    };
    function shown(list, key, rec) { return list.filter(c => c.active || (rec && rec[key][c.id] != null)); }
    const rec0 = existing(month.slice(0, 7));
    const revBox = h('div', { class: 'form-grid' }, shown(S.channels, 'rev', rec0).map(c => field('rev', c, rec0 && rec0.rev[c.id])));
    const expBox = h('div', { class: 'form-grid' }, shown(S.categories, 'exp', rec0).map(c => field('exp', c, rec0 && rec0.exp[c.id])));
    function values() {
      let bad = false;
      const out = { rev: [], exp: [] };
      fields.forEach(f => {
        const n = F.parse(f.inp.value);
        const invalid = n !== null && (!isFinite(n) || n < 0);
        f.inp.classList.toggle('invalid', invalid);
        if (invalid) bad = true;
        out[f.kind].push(f.kind === 'rev' ? { channel_id: f.id, amount: n || 0 } : { category_id: f.id, amount: n || 0 });
      });
      return { bad, out };
    }
    function update() {
      const { out } = values();
      const dt = d3.sum(out.rev, r => r.amount), cp = d3.sum(out.exp, r => r.amount), ln = dt - cp;
      totals.replaceChildren(
        h('span', null, 'Doanh thu', h('b', null, F.num(dt))), h('span', null, 'Tổng chi phí', h('b', null, F.num(cp))),
        h('span', null, 'Lợi nhuận', h('b', { class: ln < 0 ? 'is-bad' : '' }, F.num(ln))), h('span', null, 'Biên', h('b', null, F.pct(dt ? ln / dt : NaN))));
    }
    function checkMonth(fill) {
      const ym = monthIn.value;
      const rec = ym && existing(ym);
      warn.hidden = !(rec && ym + '-01' !== month);
      warn.textContent = rec ? `${F.mLong(ym + '-01')} đã có số liệu. Các ô bên dưới đã được điền theo số liệu đang lưu; bấm Lưu sẽ cập nhật.` : '';
      if (fill && rec) fields.forEach(f => { const v = rec[f.kind][f.id]; f.inp.value = v != null ? F.num(v) : ''; });
      update();
    }
    monthIn.addEventListener('change', () => checkMonth(true));
    const saveBtn = h('button', { class: 'btn primary', type: 'submit' }, 'Lưu số liệu');
    const form = h('form', {
      class: 'card stack', id: 'editor', onsubmit: async ev => {
        ev.preventDefault();
        if (!/^\d{4}-\d{2}$/.test(monthIn.value)) return toast('Hãy chọn tháng.', true);
        const { bad, out } = values();
        if (bad) return toast('Có ô không phải số hợp lệ (đã tô đỏ). Ví dụ đúng: 1.234 hoặc 1.234,5', true);
        const m = monthIn.value + '-01';
        const ok = await run(saveBtn, () => api.saveMonth(m, out.rev, out.exp));
        if (ok) { S.editMonth = null; toast('Đã lưu số liệu ' + F.mLong(m) + '.'); await reload(); }
      }
    },
    h('div', { class: 'card-head' }, h('h2', null, rec0 ? 'Sửa số liệu ' + F.mLong(month) : 'Thêm số liệu tháng'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => { S.editMonth = null; render(); } }, 'Đóng')),
    h('div', { class: 'row' }, h('label', { class: 'f' }, 'Tháng', monthIn)),
    warn,
    hasCat ? h('div', { class: 'alert warn' }, 'Cần có ít nhất một kênh bán và một khoản mục chi phí. ', h('a', { href: '#/danh-muc' }, 'Mở trang Danh mục')) : null,
    h('p', { class: 'section-label' }, h('span', null, 'Doanh thu theo kênh'), h('a', { href: '#/danh-muc' }, 'Sửa danh mục')), revBox,
    h('p', { class: 'section-label' }, h('span', null, 'Chi phí theo khoản mục')), expBox,
    totals,
    h('p', { class: 'note' }, 'Gõ số theo kiểu Việt Nam: dấu chấm ngăn hàng nghìn, dấu phẩy cho phần thập phân (1.234,5). Ô để trống được tính là 0.'),
    h('div', { class: 'row' }, saveBtn, h('button', { class: 'btn', type: 'button', onclick: () => { S.editMonth = null; render(); } }, 'Hủy')));
    checkMonth(false);
    return form;
  }

  // ------------------------------------------------------------------
  // Danh mục: kênh bán & khoản mục chi phí
  // ------------------------------------------------------------------
  function viewCategories() {
    return h('div', { class: 'stack', style: 'gap:22px' },
      h('div', null, h('h1', { class: 'page-head' }, 'Danh mục'), h('p', { class: 'lead' }, 'Thêm, đổi tên, sắp xếp các kênh bán và khoản mục chi phí. Mục đã có số liệu không xóa được; hãy bỏ chọn "Đang dùng" để ẩn khỏi form nhập tháng mới (số liệu cũ vẫn giữ trên báo cáo).')),
      h('div', { class: 'grid' },
        catCard('Kênh bán (doanh thu)', 'kenh', S.channels, S.revenue, 'channel_id', c => api.saveChannel(c), id => api.deleteChannel(id)),
        catCard('Khoản mục chi phí', 'chiphi', S.categories, S.expenses, 'category_id', c => api.saveCategory(c), id => api.deleteCategory(id))));
  }
  function catCard(title, key, list, entries, fk, save, del) {
    const used = new Set(entries.map(e => e[fk]));
    const rows = list.map(c => {
      const name = h('input', { type: 'text', id: `${key}-name-${c.id}`, value: c.name, 'aria-label': 'Tên' });
      const ord = h('input', { type: 'number', class: 'num num-sm', id: `${key}-ord-${c.id}`, value: String(c.sort_order), 'aria-label': 'Thứ tự' });
      const act = h('input', { type: 'checkbox', id: `${key}-act-${c.id}`, checked: c.active, 'aria-label': 'Đang dùng' });
      const sv = h('button', { class: 'btn sm', type: 'button' }, 'Lưu');
      sv.addEventListener('click', async () => {
        const ok = await run(sv, () => save({ id: c.id, name: name.value, sort_order: +ord.value || 0, active: act.checked }));
        if (ok) { toast('Đã lưu "' + name.value.trim() + '".'); await reload(); }
      });
      return h('tr', null, h('td', null, name), h('td', null, ord), h('td', { class: 'l' }, act), h('td', { class: 'actions' }, sv,
        used.has(c.id) ? h('span', { class: 'chip', title: 'Đã có số liệu nên không xóa được' }, 'Có số liệu') : confirmBtn('Xóa', async () => { await del(c.id); toast('Đã xóa.'); await reload(); })));
    });
    const newName = h('input', { type: 'text', id: `${key}-new`, placeholder: 'Tên mới', required: true });
    const addBtn = h('button', { class: 'btn primary', type: 'submit' }, 'Thêm');
    return h('div', { class: 'card', id: key },
      h('h2', null, title),
      h('div', { class: 'table-wrap' }, h('table', { class: 't' },
        h('thead', null, h('tr', null, h('th', null, 'Tên'), h('th', null, 'Thứ tự'), h('th', { class: 'l' }, 'Đang dùng'), h('th', null, ''))),
        h('tbody', null, rows.length ? rows : h('tr', null, h('td', { colspan: 4, class: 'muted' }, 'Chưa có mục nào.'))))),
      h('form', {
        class: 'row', onsubmit: async ev => {
          ev.preventDefault();
          const ok = await run(addBtn, () => save({ name: newName.value, sort_order: (d3.max(list, c => c.sort_order) || 0) + 1, active: true }));
          if (ok) { toast('Đã thêm "' + newName.value.trim() + '".'); await reload(); }
        }
      }, h('label', { class: 'f', style: 'flex:1;min-width:12rem' }, 'Thêm mục mới', newName), addBtn));
  }

  // ------------------------------------------------------------------
  // Nhập từ file Excel / CSV
  // ------------------------------------------------------------------
  let xlsxLoading = null;
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve();
    if (!xlsxLoading) xlsxLoading = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'js/vendor/xlsx.full.min.js'; s.onload = res; s.onerror = () => rej(new Error('Không tải được thư viện đọc Excel.'));
      document.head.append(s);
    });
    return xlsxLoading;
  }
  function parseMonth(v) {
    const fmt = (y, m) => (y >= 1990 && y <= 2100 && m >= 1 && m <= 12 ? y + '-' + String(m).padStart(2, '0') + '-01' : null);
    if (v instanceof Date && !isNaN(v)) { const d = new Date(v.getTime() + 12 * 3600e3); return fmt(d.getFullYear(), d.getMonth() + 1); }
    if (typeof v === 'number') { if (v > 20000 && v < 80000) { const d = XLSX.SSF.parse_date_code(v); return fmt(d.y, d.m); } return null; }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/);
    if (m) return fmt(+m[1], +m[2]);
    m = s.match(/^(?:T|Tháng\s*)?(\d{1,2})[-/.](\d{4})$/i);
    if (m) return fmt(+m[2], +m[1]);
    return null;
  }
  async function parseFile(file) {
    await loadXLSX();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    const isMonthHdr = c => /^(tháng|thang|month|kỳ)$/i.test(String(c).trim());
    const hi = aoa.findIndex(r => r.some(isMonthHdr));
    if (hi < 0) throw new Error('Không tìm thấy cột "Tháng" ở dòng tiêu đề. Hãy dùng file mẫu.');
    const hdr = aoa[hi].map(c => String(c).trim());
    const mi = hdr.findIndex(isMonthHdr);
    const cols = [], ignored = [];
    hdr.forEach((c, i) => {
      if (i === mi || !c) return;
      const m = c.match(/^(DT|CP)\s*[:\-–]\s*(.+)$/i);
      if (!m) { ignored.push(c); return; }
      cols.push({ i, kind: m[1].toUpperCase() === 'DT' ? 'rev' : 'exp', name: m[2].trim(), header: c });
    });
    if (!cols.length) throw new Error('Không có cột số liệu nào. Tiêu đề cột cần bắt đầu bằng "DT:" (doanh thu) hoặc "CP:" (chi phí).');
    const byMonth = new Map(), errors = [];
    aoa.slice(hi + 1).forEach((r, k) => {
      const line = hi + k + 2;
      if (r.every(c => c === '' || c == null)) return;
      const m = parseMonth(r[mi]);
      if (!m) { errors.push(`Dòng ${line}: không đọc được tháng "${r[mi]}". Dùng dạng 2026-09 hoặc 09/2026.`); return; }
      const rec = byMonth.get(m) || { month: m, vals: new Map() };
      cols.forEach(c => {
        const v = r[c.i];
        if (v === '' || v == null) return;
        const n = F.parse(v);
        if (!isFinite(n) || n < 0) { errors.push(`Dòng ${line}, cột "${c.header}": "${v}" không phải số hợp lệ.`); return; }
        rec.vals.set(c.kind + '|' + c.name.toLowerCase(), { kind: c.kind, name: c.name, v: n });
      });
      byMonth.set(m, rec);
    });
    return { cols, ignored, months: [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1)), errors };
  }
  async function downloadXlsx(withData) {
    await loadXLSX();
    const model = buildModel();
    const used = (list, key) => list.filter(c => c.active || (withData && model.some(r => r[key][c.id] != null)));
    const chs = used(S.channels, 'rev'), cats = used(S.categories, 'exp');
    const header = ['Tháng', ...chs.map(c => 'DT: ' + c.name), ...cats.map(c => 'CP: ' + c.name)];
    const body = withData
      ? model.map(r => [r.month.slice(0, 7), ...chs.map(c => r.rev[c.id] ?? ''), ...cats.map(c => r.exp[c.id] ?? '')])
      : [[(model.length ? addMonth(model[model.length - 1].month.slice(0, 7), 1) : ymNow()), ...header.slice(1).map(() => '')]];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    ws['!cols'] = header.map((t, i) => ({ wch: i ? Math.max(12, t.length + 2) : 10 }));
    XLSX.utils.book_append_sheet(wb, ws, 'So lieu');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Hướng dẫn'],
      ['Mỗi dòng là một tháng. Cột "Tháng" ghi dạng 2026-09 (hoặc 09/2026).'],
      ['Cột bắt đầu bằng "DT:" là doanh thu theo kênh; "CP:" là chi phí theo khoản mục.'],
      ['Đơn vị: triệu đồng. Ô để trống thì giữ nguyên số liệu đang có.'],
      ['Có thể thêm cột mới, ví dụ "CP: Thuê mặt bằng"; khi nhập web sẽ hỏi có tạo danh mục mới không.']
    ]), 'Huong dan');
    XLSX.writeFile(wb, withData ? `so-lieu-doanh-thu-chi-phi-${ymNow()}.xlsx` : 'mau-nhap-lieu.xlsx');
  }

  function viewImport() {
    const out = h('div', { class: 'stack' });
    const file = h('input', { type: 'file', id: 'import-file', accept: '.xlsx,.xls,.csv' });
    file.addEventListener('change', async () => {
      const f = file.files[0];
      if (!f) return;
      out.replaceChildren(h('div', { class: 'skeleton', style: 'height:120px' }));
      try { out.replaceChildren(preview(await parseFile(f), f.name)); }
      catch (e) { out.replaceChildren(h('div', { class: 'alert err' }, e.message || String(e))); }
    });
    return h('div', { class: 'stack', style: 'gap:22px' },
      h('div', null, h('h1', { class: 'page-head' }, 'Nhập từ file'), h('p', { class: 'lead' }, 'Tải lên file Excel (.xlsx) hoặc CSV để nhập nhiều tháng cùng lúc.')),
      h('div', { class: 'grid' },
        h('div', { class: 'card' }, h('h2', null, '1. Chuẩn bị file'),
          h('p', { class: 'note' }, 'Dòng đầu là tiêu đề: cột "Tháng", các cột "DT: <tên kênh>" và "CP: <tên khoản mục>". Mỗi dòng sau là một tháng, đơn vị triệu đồng. Ô trống thì giữ nguyên số liệu đang có.'),
          h('div', { class: 'row' },
            h('button', { class: 'btn', type: 'button', onclick: e => run(e.currentTarget, () => downloadXlsx(false)) }, 'Tải file mẫu (.xlsx)'),
            h('button', { class: 'btn', type: 'button', onclick: e => run(e.currentTarget, () => downloadXlsx(true)) }, 'Xuất toàn bộ số liệu (.xlsx)'))),
        h('div', { class: 'card' }, h('h2', null, '2. Chọn file'), h('label', { class: 'f' }, 'File .xlsx, .xls hoặc .csv', file),
          h('p', { class: 'note' }, 'Web sẽ hiện bản xem trước để bạn kiểm tra rồi mới ghi vào dữ liệu.'))),
      out);
  }

  function preview(p, fileName) {
    const chMap = byName(S.channels), catMap = byName(S.categories);
    const newCats = { rev: [], exp: [] };
    p.cols.forEach(c => {
      const map = c.kind === 'rev' ? chMap : catMap;
      if (!map.has(c.name.toLowerCase()) && !newCats[c.kind].some(n => n.toLowerCase() === c.name.toLowerCase())) newCats[c.kind].push(c.name);
    });
    const hasNew = newCats.rev.length + newCats.exp.length > 0;
    const createNew = h('input', { type: 'checkbox', id: 'create-new', checked: true });
    const existing = new Set(buildModel().map(r => r.month));
    const btn = h('button', { class: 'btn primary', type: 'button' }, `Nhập ${p.months.length} tháng`);
    const status = h('div', { class: 'alert', hidden: true });
    btn.disabled = !p.months.length;
    btn.addEventListener('click', () => run(btn, async () => {
      status.hidden = false; status.className = 'alert'; status.textContent = 'Đang nhập…';
      if (hasNew && createNew.checked) {
        let o1 = d3.max(S.channels, c => c.sort_order) || 0, o2 = d3.max(S.categories, c => c.sort_order) || 0;
        for (const n of newCats.rev) await api.saveChannel({ name: n, sort_order: ++o1, active: true });
        for (const n of newCats.exp) await api.saveCategory({ name: n, sort_order: ++o2, active: true });
      }
      const fresh = await api.loadData();
      const chs = fresh.channels, cats = fresh.categories;
      const cm = byName(chs), km = byName(cats);
      let i = 0, skipped = 0;
      for (const m of p.months) {
        const rev = [], exp = [];
        m.vals.forEach(v => {
          const c = (v.kind === 'rev' ? cm : km).get(v.name.toLowerCase());
          if (!c) { skipped++; return; }
          if (v.kind === 'rev') rev.push({ channel_id: c.id, amount: v.v }); else exp.push({ category_id: c.id, amount: v.v });
        });
        await api.saveMonth(m.month, rev, exp);
        status.textContent = `Đang nhập… ${++i}/${p.months.length} tháng`;
      }
      await loadAll();
      status.className = 'alert ok';
      status.replaceChildren(`Đã nhập ${p.months.length} tháng từ ${fileName}.` + (skipped ? ` Bỏ qua ${skipped} ô thuộc danh mục chưa tạo.` : '') + ' ', h('a', { href: '#/' }, 'Xem tổng quan'));
      btn.disabled = true;
      toast('Nhập file xong.');
    }));
    return h('div', { class: 'card stack', id: 'xem-truoc' },
      h('h2', null, '3. Kiểm tra và nhập'),
      h('p', { class: 'note' }, `${fileName}: ${p.months.length} tháng, ${p.cols.filter(c => c.kind === 'rev').length} cột doanh thu, ${p.cols.filter(c => c.kind === 'exp').length} cột chi phí.`),
      p.errors.length ? h('div', { class: 'alert err stack' }, h('b', null, `${p.errors.length} lỗi, các ô/dòng này sẽ bị bỏ qua:`), h('ul', { style: 'margin:0;padding-left:18px' }, p.errors.slice(0, 20).map(e => h('li', null, e))), p.errors.length > 20 ? h('span', null, `…và ${p.errors.length - 20} lỗi khác.`) : null) : null,
      p.ignored.length ? h('div', { class: 'alert warn' }, 'Bỏ qua các cột không có tiền tố "DT:" hoặc "CP:": ' + p.ignored.join(', ')) : null,
      hasNew ? h('div', { class: 'alert warn stack' },
        h('span', null, 'Các danh mục chưa có trên web:'),
        h('div', { class: 'row' }, newCats.rev.map(n => h('span', { class: 'chip new' }, 'Kênh: ' + n)), newCats.exp.map(n => h('span', { class: 'chip new' }, 'Chi phí: ' + n))),
        h('label', { class: 'row', style: 'align-items:center' }, createNew, 'Tạo các danh mục mới này (bỏ chọn thì bỏ qua các cột đó)')) : null,
      p.months.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't' },
        h('thead', null, h('tr', null, ['Tháng', 'Trạng thái', 'Doanh thu', 'Chi phí', 'Số ô'].map(t => h('th', null, t)))),
        h('tbody', null, p.months.map(m => {
          const vs = [...m.vals.values()];
          return h('tr', null, h('td', null, F.mLong(m.month)),
            h('td', null, existing.has(m.month) ? h('span', { class: 'chip over' }, 'Cập nhật') : h('span', { class: 'chip new' }, 'Mới')),
            h('td', null, F.num(d3.sum(vs.filter(v => v.kind === 'rev'), v => v.v))), h('td', null, F.num(d3.sum(vs.filter(v => v.kind === 'exp'), v => v.v))), h('td', null, vs.length));
        })))) : h('p', { class: 'note' }, 'Không có dòng số liệu hợp lệ nào.'),
      h('div', { class: 'row' }, btn), status);
  }

  // ------------------------------------------------------------------
  // Người dùng (admin): tạo tài khoản, đổi vai trò, khóa, đặt lại mật khẩu
  // ------------------------------------------------------------------
  function viewUsers() {
    const nu = {
      name: h('input', { type: 'text', id: 'nu-name', autocomplete: 'off' }),
      user: h('input', { type: 'text', id: 'nu-username', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', required: true, minlength: 3 }),
      pw: h('input', { type: 'text', id: 'nu-password', autocomplete: 'off', required: true, minlength: 8 }),
      role: h('select', { id: 'nu-role' }, h('option', { value: 'viewer' }, 'Người xem'), h('option', { value: 'admin' }, 'Admin'))
    };
    const addBtn = h('button', { class: 'btn primary', type: 'submit' }, 'Tạo tài khoản');
    const gen = h('button', { class: 'btn', type: 'button', onclick: () => { nu.pw.value = randomPassword(); } }, 'Tạo mật khẩu ngẫu nhiên');
    const createForm = h('form', {
      class: 'card stack', id: 'tao-tai-khoan', onsubmit: async ev => {
        ev.preventDefault();
        const uname = nu.user.value.trim(), pw = nu.pw.value;
        const ok = await run(addBtn, () => api.createUser({ username: uname, full_name: nu.name.value.trim(), password: pw, role: nu.role.value }));
        if (ok) { S.lastCreated = { username: uname, password: pw }; toast('Đã tạo tài khoản ' + uname + '.'); await reload(); }
      }
    },
    h('h2', null, 'Tạo tài khoản mới'),
    h('div', { class: 'form-grid' }, h('label', { class: 'f' }, 'Họ và tên', nu.name), h('label', { class: 'f' }, 'Tên đăng nhập', nu.user),
      h('label', { class: 'f' }, 'Mật khẩu tạm (ít nhất 8 ký tự)', nu.pw), h('label', { class: 'f' }, 'Vai trò', nu.role)),
    h('div', { class: 'row' }, addBtn, gen),
    S.lastCreated ? h('div', { class: 'alert ok' }, 'Gửi cho người dùng: tên đăng nhập ', h('b', null, S.lastCreated.username), ', mật khẩu ', h('b', null, S.lastCreated.password),
      '. Họ nên đổi mật khẩu ở trang Tài khoản sau khi đăng nhập.') : null);

    const rows = S.users.map(u => {
      const self = u.id === S.profile.id;
      const role = h('select', { id: 'role-' + u.id, 'aria-label': 'Vai trò của ' + u.username, disabled: self }, Object.entries(ROLE).map(([k, t]) => h('option', { value: k }, t)));
      role.value = u.role;
      role.addEventListener('change', async () => {
        const ok = await run(role, () => api.updateUser(u.id, { role: role.value }));
        if (ok) toast(`Đã đổi ${u.username} thành ${ROLE[role.value]}.`);
        await reload();
      });
      const lock = h('button', { class: 'btn sm' + (u.active ? ' danger' : ''), type: 'button', disabled: self }, u.active ? 'Khóa' : 'Mở khóa');
      lock.addEventListener('click', async () => {
        const ok = await run(lock, () => api.updateUser(u.id, { active: !u.active }));
        if (ok) { toast((u.active ? 'Đã khóa ' : 'Đã mở khóa ') + u.username + '.'); await reload(); }
      });
      const reset = h('button', { class: 'btn sm', type: 'button' }, 'Đặt lại mật khẩu');
      reset.addEventListener('click', async () => {
        const pw = randomPassword();
        const ok = await run(reset, () => api.updateUser(u.id, { password: pw }));
        if (ok) { S.lastCreated = { username: u.username, password: pw }; toast('Đã đặt lại mật khẩu cho ' + u.username + '.'); await reload(); }
      });
      return h('tr', { class: u.active ? '' : 'muted' },
        h('td', null, u.username, self ? ' (bạn)' : ''), h('td', { class: 'l' }, u.full_name || '–'),
        h('td', { class: 'l' }, role), h('td', { class: 'l' }, u.active ? h('span', { class: 'chip viewer' }, 'Đang hoạt động') : h('span', { class: 'chip pending' }, 'Đã khóa')),
        h('td', null, u.created_at ? new Date(u.created_at).toLocaleDateString('vi-VN') : ''),
        h('td', { class: 'actions' }, self ? null : [reset, lock]));
    });
    return h('div', { class: 'stack', style: 'gap:22px' },
      h('div', null, h('h1', { class: 'page-head' }, 'Người dùng'),
        h('p', { class: 'lead' }, 'Admin tạo tài khoản và gửi tên đăng nhập, mật khẩu tạm cho từng người. Người xem chỉ xem báo cáo và viết ghi chú; Admin được sửa số liệu, danh mục và quản lý người dùng. Khóa tài khoản sẽ đăng xuất người đó ngay.')),
      createForm,
      h('div', { class: 'card' }, h('h2', null, 'Danh sách tài khoản'), h('div', { class: 'table-wrap' }, h('table', { class: 't' },
        h('thead', null, h('tr', null, h('th', null, 'Tên đăng nhập'), h('th', { class: 'l' }, 'Họ tên'), h('th', { class: 'l' }, 'Vai trò'), h('th', { class: 'l' }, 'Trạng thái'), h('th', null, 'Ngày tạo'), h('th', null, ''))),
        h('tbody', null, rows)))));
  }
  function randomPassword() {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const a = new Uint32Array(12);
    crypto.getRandomValues(a);
    return Array.from(a, x => chars[x % chars.length]).join('');
  }

  // ------------------------------------------------------------------
  // Tài khoản
  // ------------------------------------------------------------------
  function viewAccount() {
    const cur = h('input', { type: 'password', id: 'acc-current', autocomplete: 'current-password', required: true });
    const p1 = h('input', { type: 'password', id: 'acc-pw', autocomplete: 'new-password', minlength: 8, required: true });
    const p2 = h('input', { type: 'password', id: 'acc-pw2', autocomplete: 'new-password', minlength: 8, required: true });
    const b = h('button', { class: 'btn primary', type: 'submit' }, 'Đổi mật khẩu');
    return h('div', { class: 'stack', style: 'gap:22px' },
      h('h1', { class: 'page-head' }, 'Tài khoản'),
      h('div', { class: 'grid' },
        h('div', { class: 'card' }, h('h2', null, 'Thông tin'),
          h('p', null, h('span', { class: 'muted' }, 'Tên đăng nhập: '), S.profile.username),
          h('p', null, h('span', { class: 'muted' }, 'Họ tên: '), S.profile.full_name || '–'),
          h('p', null, h('span', { class: 'muted' }, 'Vai trò: '), h('span', { class: 'chip ' + S.profile.role }, ROLE[S.profile.role]))),
        h('form', {
          class: 'card stack', onsubmit: async ev => {
            ev.preventDefault();
            if (p1.value !== p2.value) return toast('Hai mật khẩu mới chưa khớp nhau.', true);
            const ok = await run(b, () => api.changePassword(cur.value, p1.value));
            if (ok) { cur.value = p1.value = p2.value = ''; toast(api.mode === 'demo' ? 'Chế độ demo không lưu mật khẩu.' : 'Đã đổi mật khẩu. Các phiên đăng nhập khác đã bị đăng xuất.'); }
          }
        }, h('h2', null, 'Đổi mật khẩu'), h('label', { class: 'f' }, 'Mật khẩu hiện tại', cur),
        h('label', { class: 'f' }, 'Mật khẩu mới (ít nhất 8 ký tự)', p1), h('label', { class: 'f' }, 'Nhập lại mật khẩu mới', p2), h('div', { class: 'row' }, b))));
  }

  // ------------------------------------------------------------------
  // Khởi động
  // ------------------------------------------------------------------
  window.addEventListener('auth-expired', () => { if (S.profile) { S.profile = null; toast('Phiên đăng nhập đã hết. Hãy đăng nhập lại.', true); render(); } });
  window.addEventListener('hashchange', () => { if (route() !== 'nhap-lieu') S.editMonth = null; render(); window.scrollTo(0, 0); });
  let rt = 0, lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    clearTimeout(rt);
    rt = setTimeout(() => { if (S.redraw) S.redraw(); }, 150);
  });
  window.apiReady.then(() => { api = window.api; refreshAuth(); });
})();

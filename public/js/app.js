// Ứng dụng một trang: đăng nhập, tổng quan DT-CP, so sánh, hợp đồng, dữ liệu, danh mục, tùy biến, người dùng.
(function () {
  'use strict';
  const cfg = window.APP_CONFIG || {};
  const APP = cfg.APP_NAME || 'Báo cáo doanh thu – chi phí';
  const $app = document.getElementById('app');
  const C = Charts.C;
  let api = null; // gán sau khi window.apiReady xong

  const S = {
    profile: null, needsSetup: false, loaded: false, users: [],
    snapshots: [], catalog: new Map(), dashboard: null, lines: new Map(), loading: new Set(), snap: null,
    filters: { company: '', region: '', investor: '', stage: '', project: '', q: '' },
    cmp: { mode: 'snap', a: null, b: null, by: 'contract', metric: 'dt', only: false },
    det: { metric: 'dt', months: false }, mx: null, treeSort: null, sugOpen: false,
    open: new Set(), hist: null, catKind: null, custom: null, redraw: null
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
  const route = () => location.hash.replace(/^#\/?/, '').split(/[?#/]/)[0];
  const routeArg = () => { const s = location.hash.replace(/^#\/?/, '').split('?')[0]; const i = s.indexOf('/'); return i < 0 ? '' : decodeURIComponent(s.slice(i + 1)); };

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
      '': [viewDashboard, 'Tổng quan'], 'chi-tiet': [viewDetail, 'Chi tiết DT-CP'], 'so-sanh': [viewCompare, 'So sánh'], 'hop-dong': [viewContract, 'Hợp đồng'], 'du-lieu': [viewData, 'Dữ liệu'],
      'danh-muc': [viewCatalog, 'Danh mục'], 'nguoi-dung': [viewUsers, 'Người dùng'], 'tuy-bien': [viewCustomize, 'Tùy biến'], 'tai-khoan': [viewAccount, 'Tài khoản']
    };
    let r = route();
    if (!views[r] || (['du-lieu', 'danh-muc', 'nguoi-dung', 'tuy-bien'].includes(r) && !isAdmin())) r = '';
    mount(shell(views[r][0]()), views[r][1]);
    applySorts();
    if (S.redraw) S.redraw();
  }
  // Vẽ lại trang mà vẫn giữ ô đang gõ (ví dụ ô tìm kiếm) và vị trí con trỏ.
  function mount(node, title) {
    const a = document.activeElement, id = a && a.id, pos = a && typeof a.selectionStart === 'number' ? a.selectionStart : null;
    $app.replaceChildren(node);
    document.title = title ? title + ' · ' + APP : APP;
    const b = id && document.getElementById(id);
    if (b && b !== document.body) { b.focus({ preventScroll: true }); if (pos != null && b.setSelectionRange) try { b.setSelectionRange(pos, pos); } catch (e) { /* bỏ qua */ } }
  }

  function demoBar() {
    if (api.mode !== 'demo') return null;
    return h('div', { class: 'demo-bar' }, h('div', { class: 'wrap' },
      h('span', null, h('b', null, 'Chế độ demo. '), 'Không tìm thấy máy chủ nên web dùng số liệu GIẢ, chỉ lưu trong trình duyệt này. Triển khai lên Railway hoặc Vercel để dùng dữ liệu thật (xem README).'),
      S.profile ? confirmBtn('Đặt lại dữ liệu demo', async () => { api.reset(); toast('Đã đặt lại dữ liệu demo.'); await refreshAuth(); }, 'sm') : null));
  }

  const views0 = ['', 'chi-tiet', 'so-sanh', 'hop-dong', 'du-lieu', 'danh-muc', 'nguoi-dung', 'tuy-bien', 'tai-khoan'];
  function shell(content) {
    const r = route();
    const items = [['', 'Tổng quan'], ['chi-tiet', 'Chi tiết DT-CP'], ['so-sanh', 'So sánh'], ['du-lieu', 'Dữ liệu', 1], ['danh-muc', 'Danh mục', 1], ['tuy-bien', 'Tùy biến', 1], ['nguoi-dung', 'Người dùng', 1]];
    const nav = h('nav', { class: 'nav', 'aria-label': 'Chức năng' },
      items.filter(i => !i[2] || isAdmin()).map(([k, t]) => h('a', { href: '#/' + k, class: (r === k || (k === '' && (r === 'hop-dong' || !views0.includes(r)))) ? 'on' : '' }, t)));
    const who = h('div', { class: 'who' },
      h('span', { class: 'email', title: S.profile.username }, S.profile.full_name || S.profile.username),
      h('span', { class: 'chip ' + S.profile.role }, ROLE[S.profile.role]),
      h('a', { class: 'btn sm', href: '#/tai-khoan' }, 'Tài khoản'),
      h('button', { class: 'btn sm', type: 'button', onclick: e => run(e.currentTarget, async () => { await api.signOut(); location.hash = ''; await refreshAuth(); }) }, 'Đăng xuất'));
    return h('div', null,
      h('header', { class: 'topbar' }, h('div', { class: 'topbar-in' },
        h('a', { class: 'logo-full', href: '#/', title: 'Về trang Tổng quan' },
          h('img', { src: 'img/logo-ngang.png', alt: 'Tân Minh Nhân Corporation', width: 228, height: 56 })),
        h('div', { class: 'topbar-main' }, h('div', { class: 'topbar-row' }, h('span', { class: 'brand' }, APP), who),
          h('div', { class: 'topbar-row nav-row' }, nav, h('span', { class: 'credit' }, 'Produced by Supervisory Board of Tan Minh Nhan Corporation®'))))),
      demoBar(),
      h('main', { class: 'wrap' }, content),
      h('footer', { class: 'wrap foot' }, 'Số liệu theo file DT-CP (đơn vị đồng). Bảng hiển thị triệu đồng, biểu đồ hiển thị tỷ đồng.'));
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
  // Dữ liệu: các mốc (snapshot) và dòng Hợp đồng/Phụ lục của từng mốc
  // ------------------------------------------------------------------
  async function loadAll() {
    const m = await api.meta();
    S.snapshots = m.snapshots;
    S.catalog = new Map();
    m.catalog.forEach(c => { if (!S.catalog.has(c.kind)) S.catalog.set(c.kind, new Map()); S.catalog.get(c.kind).set(c.code, c); });
    S.dashboard = m.dashboard || null;
    if (!S.snapshots.some(s => s.id === S.snap)) S.snap = S.snapshots.length ? S.snapshots[0].id : null;
    if (S.snap) await getLines(S.snap);
    S.users = isAdmin() ? await api.listUsers() : [];
    S.loaded = true;
  }
  async function reload() { S.lines.clear(); S.hist = null; S.mx = null; await loadAll(); render(); }
  async function getLines(id) { if (!S.lines.has(id)) S.lines.set(id, await api.lines(id)); return S.lines.get(id); }
  // Dòng của một mốc nếu đã tải; nếu chưa, tải nền rồi vẽ lại trang.
  function linesOf(id) {
    if (S.lines.has(id)) return S.lines.get(id);
    if (!S.loading.has(id)) {
      S.loading.add(id);
      getLines(id).then(() => { S.loading.delete(id); render(); }, e => { S.loading.delete(id); toast(e.message, true); });
    }
    return null;
  }
  const snapById = id => S.snapshots.find(s => s.id === id);
  const snapLabel = s => (s ? F.date(s.report_date) + (s.label ? ' · ' + s.label : '') : '');
  const prevSnap = id => { const i = S.snapshots.findIndex(s => s.id === id); return i >= 0 ? S.snapshots[i + 1] || null : null; };
  const skeleton = () => h('div', { class: 'skeleton', style: 'height:320px' });

  // Tên hiển thị cho mã (danh mục do admin đặt; mặc định là mã trong file)
  function nameOf(kind, code) {
    if (!code) return { investor: '(Không rõ chủ đầu tư)', stage: '(Chưa ghi thời điểm)', company: '(Không rõ công ty)', region: '(Không rõ khu vực)' }[kind] || '(Không rõ)';
    const m = S.catalog.get(kind), c = m && m.get(code);
    return c ? c.name : code;
  }
  const catSort = (kind, code) => { const m = S.catalog.get(kind), c = m && m.get(code); return c && c.sort ? c.sort : 1e6; };
  function dimLabel(dim, key, first) {
    if (dim === 'project') return key && key !== '(không rõ)' ? `${key} – ${first.project_name}` : '(Không rõ công trình)';
    if (dim === 'contract') return `${key} – ${first.contract_title || first.contract_no}`;
    if (dim === 'region') return nameOf('region', key) === key && first.region_name ? first.region_name : nameOf('region', key);
    return nameOf(dim, key);
  }
  function costLabel(key) {
    const c = S.catalog.get('cost') && S.catalog.get('cost').get(key);
    if (c) return c.name;
    const s = snapById(S.snap), fromFile = s && s.cost_labels && s.cost_labels[key];
    if (fromFile) return fromFile;
    const d = DTCP.COST_COLS.find(x => x.key === key);
    return d.group === d.label ? d.label : `${d.group} › ${d.label}`;
  }
  const costGroup = key => costLabel(key).split(' › ')[0];

  // ------------------------------------------------------------------
  // Tên gọi và chỉ số
  // ------------------------------------------------------------------
  const DEFAULT_TERMS = {
    count: 'Số hợp đồng', hd: 'Giá trị hợp đồng', sl: 'Sản lượng', slhs: 'Sản lượng hồ sơ', tv: 'Tiền về', dt: 'Doanh thu',
    cp: 'Chi phí trực tiếp', pct: '%CPTT/DT', company: 'Công ty', region: 'Khu vực', project: 'Công trình', investor: 'Chủ đầu tư',
    stage: 'Thời điểm', contract: 'Hợp đồng'
  };
  const TERM_HELP = {
    count: 'Số hợp đồng (mã DT-CP)', hd: 'Cột Giá trị hợp đồng', sl: 'Cột Giá trị sản lượng', slhs: 'Cột Sản lượng hồ sơ', tv: 'Cột Giá trị tiền về',
    dt: 'Cột Doanh thu thời điểm', cp: 'Tổng 15 khoản chi phí trực tiếp', pct: 'Chi phí trực tiếp ÷ doanh thu', company: 'Cột Công ty',
    region: 'Nhóm Khu vực', project: 'Nhóm công trình', investor: 'Mã chủ đầu tư trong số HĐ', stage: 'Cột Thời điểm', contract: 'Dòng hợp đồng (mã DT-CP)'
  };
  function T(k) {
    const src = route() === 'tuy-bien' && S.custom ? S.custom.draft.terms : (S.dashboard || {}).terms;
    const v = src && typeof src[k] === 'string' ? src[k].trim() : '';
    return v || DEFAULT_TERMS[k];
  }
  const lc = s => (s ? s.charAt(0).toLocaleLowerCase('vi') + s.slice(1) : s);
  const METRICS = ['count', 'hd', 'sl', 'slhs', 'tv', 'dt', 'cp', 'pct'];
  const MONEY = ['hd', 'sl', 'slhs', 'tv', 'dt', 'cp'];
  const DIMS = ['region', 'company', 'investor', 'stage', 'project'];
  const GOOD = { dt: 1, hd: 1, tv: 1, sl: 1, slhs: 1, cp: 0, pct: -1, count: 0 };
  const METRIC_COLOR = { dt: C[0], cp: C[1], tv: C[2], hd: C[3], sl: C[4], slhs: C[5], count: C[0], pct: C[2] };
  const fmtM = (k, v) => (k === 'count' ? F.int(v) : k === 'pct' ? F.pct(v) : F.vnd(v));
  function deltaEl(k, a, b, vsText) {
    if (a == null || b == null || !isFinite(a) || !isFinite(b)) return h('span', { class: 'delta' }, vsText ? 'Chưa có mốc trước để so sánh' : '');
    const d = k === 'pct' ? b - a : a ? (b - a) / Math.abs(a) : NaN;
    const good = GOOD[k] > 0 ? d > 0 : GOOD[k] < 0 ? d < 0 : null;
    const cls = !isFinite(d) || d === 0 || good === null ? '' : good ? 'is-good' : 'is-bad';
    const txt = k === 'pct' ? F.pt(d) : k === 'count' ? (b - a > 0 ? '+' : '') + F.int(b - a) : F.spct(d);
    return h('span', { class: 'delta' }, h('b', { class: cls }, txt), vsText ? ' ' + vsText : '');
  }

  // ------------------------------------------------------------------
  // Bộ lọc dùng chung (Tổng quan, So sánh)
  // ------------------------------------------------------------------
  let qTimer = 0;
  function filterBar(lines, opts) {
    const o = opts || {};
    const f = S.filters;
    const opt = (dim, field) => {
      const keys = [...new Set(lines.map(DTCP.DIM_KEY[dim]))];
      const first = new Map(); lines.forEach(l => { const k = DTCP.DIM_KEY[dim](l); if (!first.has(k)) first.set(k, l); });
      keys.sort((a, b) => catSort(dim, a) - catSort(dim, b) || String(a).localeCompare(String(b), 'vi', { numeric: true }));
      const sel = h('select', { id: 'f-' + field, 'aria-label': T(dim) },
        h('option', { value: '' }, 'Tất cả ' + lc(T(dim))), keys.map(k => h('option', { value: k }, dimLabel(dim, k, first.get(k)))));
      sel.value = f[field] || '';
      sel.addEventListener('change', () => { f[field] = sel.value; render(); });
      return h('label', { class: 'f' }, T(dim), sel);
    };
    const any = Object.values(f).some(Boolean);
    let snapSel = null;
    if (o.snap) {
      snapSel = h('select', { id: 'f-snap', 'aria-label': 'Mốc dữ liệu' }, S.snapshots.map(s => h('option', { value: s.id }, snapLabel(s))));
      snapSel.value = S.snap;
      snapSel.addEventListener('change', () => { S.snap = +snapSel.value; render(); });
    }
    return h('div', { class: 'card filters' },
      h('div', { class: 'filter-grid' },
        snapSel ? h('label', { class: 'f' }, 'Mốc dữ liệu', snapSel) : null,
        opt('company', 'company'), opt('region', 'region'), opt('investor', 'investor'), opt('stage', 'stage'), opt('project', 'project'),
        h('label', { class: 'f grow' }, 'Tìm', searchBox(lines))),
      any ? h('div', { class: 'row' }, h('span', { class: 'note' }, 'Đang lọc dữ liệu.'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => { S.filters = { company: '', region: '', investor: '', stage: '', project: '', q: '' }; render(); } }, 'Bỏ lọc')) : null);
  }

  // Gợi ý cho ô Tìm: hợp đồng, công trình, chủ đầu tư. Không phân biệt hoa/thường, có dấu/không dấu,
  // gõ chữ cái đầu cũng được ("tchtkb" → "Thi công hoàn thiện khu BOH").
  const sugCache = new WeakMap();
  function suggestIndex(lines) {
    if (sugCache.has(lines)) return sugCache.get(lines);
    const out = [], seen = new Set();
    const add = (kind, label, sub, apply) => {
      const k = kind + '|' + label;
      if (seen.has(k)) return;
      seen.add(k);
      const text = DTCP.fold(label + ' ' + (sub || ''));
      out.push({ kind, label, sub, apply, text, lab: DTCP.fold(label), ini: text.split(/[^a-z0-9]+/).filter(Boolean).map(w => w[0]).join('') });
    };
    lines.forEach(l => {
      add(T('contract'), `${l.contract_code} · ${l.contract_no}`, l.contract_title, { q: l.contract_code });
      if (l.project_code) add(T('project'), `${l.project_code} – ${l.project_name}`, '', { project: l.project_code });
      if (l.investor) add(T('investor'), nameOf('investor', l.investor), l.investor, { investor: l.investor });
    });
    sugCache.set(lines, out);
    return out;
  }
  function matchSuggest(index, v) {
    const words = v.split(' ').filter(Boolean), one = words.length === 1 && v.length >= 2;
    const hits = [];
    index.forEach(it => {
      let score = -1;
      if (it.lab.startsWith(v)) score = 0;
      else if (words.every(w => it.text.includes(w))) score = (' ' + it.text).includes(' ' + words[0]) ? 1 : 2;
      else if (one && it.ini.includes(v)) score = 3;
      if (score >= 0) hits.push([score, it]);
    });
    hits.sort((a, b) => a[0] - b[0] || a[1].label.localeCompare(b[1].label, 'vi', { numeric: true }));
    return hits.slice(0, 10).map(x => x[1]);
  }
  function searchBox(lines) {
    const f = S.filters;
    const q = h('input', { type: 'search', id: 'f-q', placeholder: 'Mã DT-CP, số HĐ, công trình, chủ đầu tư…', value: f.q || '', autocomplete: 'off',
      role: 'combobox', 'aria-autocomplete': 'list', 'aria-controls': 'f-q-list', 'aria-expanded': 'false' });
    const list = h('ul', { class: 'suggest', id: 'f-q-list', role: 'listbox', hidden: true });
    let items = [], idx = -1;
    const choose = it => {
      if (it.apply.q != null) f.q = it.apply.q;
      else { Object.assign(f, it.apply); f.q = ''; }
      S.sugOpen = false; clearTimeout(qTimer); render();
    };
    const draw = () => {
      const v = DTCP.fold(q.value);
      items = v ? matchSuggest(suggestIndex(lines), v) : [];
      if (idx >= items.length) idx = -1;
      list.replaceChildren(...items.map((it, i) => h('li', { role: 'option', class: i === idx ? 'on' : '', 'aria-selected': i === idx ? 'true' : 'false', onmousedown: e => { e.preventDefault(); choose(it); } },
        h('span', { class: 'sg-kind' }, it.kind), h('span', { class: 'sg-label' }, it.label, it.sub && it.sub !== it.label ? h('small', null, it.sub) : null))));
      list.hidden = !(S.sugOpen && items.length);
      q.setAttribute('aria-expanded', list.hidden ? 'false' : 'true');
    };
    q.addEventListener('input', () => {
      S.sugOpen = true; idx = -1; draw();
      clearTimeout(qTimer); qTimer = setTimeout(() => { f.q = q.value; render(); }, 400);
    });
    q.addEventListener('keydown', e => {
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length) {
        e.preventDefault(); S.sugOpen = true;
        if (e.key === 'ArrowDown') idx = idx + 1 >= items.length ? -1 : idx + 1;
        else idx = idx <= -1 ? items.length - 1 : idx - 1;
        draw();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (idx >= 0 && items[idx]) choose(items[idx]);
        else { S.sugOpen = false; clearTimeout(qTimer); f.q = q.value; render(); }
      } else if (e.key === 'Escape') { S.sugOpen = false; draw(); }
    });
    q.addEventListener('focus', () => { S.sugOpen = true; draw(); });
    q.addEventListener('blur', () => { S.sugOpen = false; list.hidden = true; q.setAttribute('aria-expanded', 'false'); });
    return h('div', { class: 'suggest-wrap' }, q, list);
  }

  // ------------------------------------------------------------------
  // Sắp xếp bảng: bấm tiêu đề cột để xếp giảm dần → tăng dần → về thứ tự mặc định. Ghi nhớ theo bảng.
  // Giá trị lấy từ phần chữ đầu tiên của ô (số kiểu Việt Nam, %, ngày dd/mm/yyyy); ô trống "–" luôn ở cuối.
  // ------------------------------------------------------------------
  const SORT = new Map();
  function sortVal(td) {
    if (!td) return null;
    const n = td.firstChild;
    const s = (n ? n.textContent : '').trim().replace(/\u2212/g, '-');
    if (!s || /^[–—-]$/.test(s)) return null;
    const d = s.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})\b/);
    if (d) return +((d[3].length === 2 ? '20' + d[3] : d[3]) + d[2] + d[1]);
    const m = s.match(/^([+-]?)(\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:,\d+)?)\s*(%|điểm %|tỷ|tr|đ|HĐ)?$/);
    if (m) {
      let x = parseFloat(m[2].replace(/\./g, '').replace(',', '.')) * (m[1] === '-' ? -1 : 1);
      if (m[3] === 'tỷ') x *= 1000;
      return x;
    }
    return s;
  }
  function headerCols(table) {
    const grid = [], map = new Map();
    [...table.tHead.rows].forEach((tr, r) => {
      grid[r] = grid[r] || [];
      let c = 0;
      [...tr.cells].forEach(th => {
        while (grid[r][c]) c++;
        const cs = th.colSpan || 1, rs = th.rowSpan || 1;
        for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) { grid[r + i] = grid[r + i] || []; grid[r + i][c + j] = th; }
        if (cs === 1) map.set(th, c);
        c += cs;
      });
    });
    return map;
  }
  function makeSortable(table, key) {
    const body = table.tBodies[0];
    if (!table.tHead || !body || body.rows.length < 2) return;
    const st = SORT.get(key);
    headerCols(table).forEach((col, th) => {
      if (!th.textContent.trim()) return;
      th.classList.add('sortable');
      th.tabIndex = 0;
      th.title = 'Bấm để sắp xếp';
      if (st && st.col === col) th.setAttribute('aria-sort', st.dir > 0 ? 'ascending' : 'descending');
      const click = () => {
        const cur = SORT.get(key);
        if (cur && cur.col === col) { if (cur.dir === cur.first) cur.dir = -cur.dir; else SORT.delete(key); }
        else {
          const v = [...body.rows].map(r => sortVal(r.cells[col])).find(x => x != null);
          const first = typeof v === 'number' ? -1 : 1; // số: lớn trước; chữ: A → Z
          SORT.set(key, { col, dir: first, first });
        }
        render();
      };
      th.addEventListener('click', click);
      th.addEventListener('keydown', e => { if (e.key === 'Enter') click(); });
    });
    if (!st) return;
    const rows = [...body.rows], vals = new Map(rows.map(r => [r, sortVal(r.cells[st.col])]));
    rows.sort((a, b) => {
      const x = vals.get(a), y = vals.get(b);
      if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1;
      return st.dir * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'vi', { numeric: true }));
    });
    body.append(...rows);
  }
  function applySorts() {
    const page = route() + (routeArg() ? '/*' : '');
    $app.querySelectorAll('table.t').forEach(t => {
      if (t.classList.contains('tree') || t.classList.contains('nosort') || t.querySelector('tbody input, tbody select, tbody textarea')) return;
      makeSortable(t, page + '|' + [...t.tHead.querySelectorAll('th')].map(th => th.textContent).join('|'));
    });
  }

  // ------------------------------------------------------------------
  // Tổng quan (dashboard) – vẽ theo cấu hình do admin tùy biến
  // ------------------------------------------------------------------
  const DEFAULT_DASH = {
    title: 'Tổng quan DT-CP',
    terms: {},
    cards: [
      { id: 'kpi', type: 'kpis', title: '', note: '', dim: 'region', metrics: ['count', 'hd', 'dt', 'cp', 'pct', 'tv'], top: 12, detail: false, width: 'full', hidden: false },
      { id: 'kv', type: 'group', title: '', note: 'Bấm vào một dòng để lọc theo khu vực đó.', dim: 'region', metrics: ['dt', 'cp'], top: 12, detail: false, width: 'half', hidden: false },
      { id: 'cty', type: 'group', title: '', note: 'Bấm vào một dòng để lọc theo công ty đó.', dim: 'company', metrics: ['dt', 'cp'], top: 12, detail: false, width: 'half', hidden: false },
      { id: 'cdt', type: 'group', title: '', note: 'Tỷ lệ chi phí trực tiếp trên doanh thu: thấp hơn là tốt hơn.', dim: 'investor', metrics: ['pct'], top: 12, detail: false, width: 'half', hidden: false },
      { id: 'gd', type: 'group', title: '', note: 'Bấm vào một thời điểm để mở Chi tiết DT-CP của các hợp đồng đang ở thời điểm đó.', dim: 'stage', metrics: ['dt', 'cp'], top: 12, detail: false, width: 'half', hidden: false },
      { id: 'ct', type: 'group', title: '', note: '10 công trình có doanh thu lớn nhất; phần còn lại gộp vào "Khác".', dim: 'project', metrics: ['dt', 'cp'], top: 10, detail: false, width: 'half', hidden: false },
      { id: 'cocau', type: 'costs', title: '', note: 'Tổng từng khoản trong phạm vi đang lọc và tỷ trọng trên tổng chi phí trực tiếp.', dim: 'region', metrics: [], top: 12, detail: false, width: 'half', hidden: false },
      { id: 'bang', type: 'table', title: '', note: 'Bấm vào một dòng để mở hoặc thu gọn; bấm vào hợp đồng hoặc thời điểm để mở Chi tiết DT-CP (so sánh qua các thời điểm và các tháng). Đơn vị: triệu đồng.', dim: 'region', metrics: [], top: 12, detail: false, width: 'full', hidden: false }
    ]
  };
  const CARD_TYPES = { kpis: 'Ô chỉ số', group: 'Biểu đồ theo nhóm', costs: 'Cơ cấu chi phí', table: 'Bảng chi tiết' };
  const clone = x => JSON.parse(JSON.stringify(x));
  const dashConfig = () => (S.dashboard && Array.isArray(S.dashboard.cards) ? S.dashboard : DEFAULT_DASH);
  function autoTitle(c) {
    if (c.type === 'kpis') return 'Chỉ số chính';
    if (c.type === 'costs') return 'Cơ cấu ' + lc(T('cp'));
    if (c.type === 'table') return `Bảng chi tiết: ${T('region')} › ${T('project')} › ${T('contract')}`;
    const ms = (c.metrics || []).map(T);
    return (ms.length ? ms.join(' & ') : 'Biểu đồ') + ' theo ' + lc(T(c.dim));
  }
  function drawAll(draws) { draws.forEach(f => { try { f(); } catch (e) { console.error(e); } }); }
  function sw(color, line) { const s = h('i', { class: 'sw' + (line ? ' line' : '') }); s.style.background = color; return s; }

  function emptyData() {
    return h('div', { class: 'card empty' },
      h('h2', null, 'Chưa có dữ liệu'),
      isAdmin()
        ? [h('p', null, 'Tải lên file "Bảng tổng hợp theo dõi doanh thu - chi phí" (Excel) để bắt đầu. Mỗi lần tải là một mốc dữ liệu để so sánh về sau.'),
          h('a', { class: 'btn primary', href: '#/du-lieu' }, 'Tải file DT-CP')]
        : h('p', null, 'Admin chưa tải dữ liệu nào. Hãy quay lại sau.'));
  }

  function viewDashboard() {
    const cfg = dashConfig();
    if (!S.snapshots.length) return emptyData();
    const all = linesOf(S.snap);
    if (!all) return skeleton();
    const prev = prevSnap(S.snap), prevAll = prev ? linesOf(prev.id) : null;
    const fl = DTCP.filter(all, S.filters);
    const tot = DTCP.total(fl);
    const ptot = prevAll ? DTCP.total(DTCP.filter(prevAll, S.filters)) : null;
    const snap = snapById(S.snap);
    const nProj = new Set(fl.map(l => l.project_code)).size;
    const lead = h('p', { class: 'lead' },
      `Mốc ${F.date(snap.report_date)}: `, h('b', null, F.int(tot.count)), ` ${lc(T('contract'))} thuộc `, h('b', null, F.int(nProj)), ` ${lc(T('project'))}; ${lc(T('hd'))} `,
      h('b', null, F.vnd(tot.hd)), `, ${lc(T('dt'))} `, h('b', null, F.vnd(tot.dt)), `, ${lc(T('cp'))} `, h('b', null, F.vnd(tot.cp)),
      ` (${T('pct')} `, h('b', null, F.pct(tot.pct)), ').');
    const ctx = { lines: fl, tot, ptot, prev, draws: [] };
    const cards = fl.length ? cfg.cards.filter(c => !c.hidden).map(c => renderCard(c, ctx)) : [h('div', { class: 'card empty wide' }, h('p', null, 'Không có dòng nào khớp bộ lọc.'))];
    S.redraw = () => drawAll(ctx.draws);
    return h('div', { class: 'stack', style: 'gap:18px' },
      h('div', null, h('div', { class: 'page-head' }, h('h1', null, cfg.title || DEFAULT_DASH.title),
        isAdmin() ? h('a', { class: 'btn', href: '#/tuy-bien' }, 'Tùy biến dashboard') : null), lead),
      filterBar(all, { snap: true }),
      h('section', { class: 'grid' }, cards));
  }

  function renderCard(card, ctx) {
    const editBtn = isAdmin() && !ctx.preview
      ? h('button', { class: 'btn sm card-edit', type: 'button', title: 'Sửa biểu đồ này', onclick: () => {
        S.custom = S.custom || { draft: clone(dashConfig()), editId: null };
        S.custom.editId = card.id; location.hash = '#/tuy-bien';
      } }, 'Sửa') : null;
    const body = [];
    const empty = msg => h('p', { class: 'note empty-chart' }, msg);
    if (card.type === 'kpis') {
      const vs = ctx.prev && ctx.ptot ? 'so với mốc ' + F.dateShort(ctx.prev.report_date) : null;
      const ms = (card.metrics && card.metrics.length ? card.metrics : DEFAULT_DASH.cards[0].metrics).filter(m => m !== 'tv' || ctx.tot.tv || (ctx.ptot && ctx.ptot.tv));
      body.push(h('div', { class: 'tiles' }, ms.map(m => h('div', { class: 'tile' },
        h('span', { class: 'label' }, T(m)),
        h('span', { class: 'big' + (m === 'pct' && ctx.tot.pct > 1 ? ' is-bad' : '') }, fmtM(m, ctx.tot[m])),
        deltaEl(m, ctx.ptot ? ctx.ptot[m] : null, ctx.tot[m], vs || (ctx.prev ? 'đang tải mốc trước…' : null))))));
    } else if (card.type === 'group') {
      let ms = (card.metrics || []).filter(m => METRICS.includes(m));
      if (ms.includes('pct')) ms = ['pct']; else if (ms.includes('count')) ms = ['count'];
      if (!ms.length) body.push(empty('Chưa chọn dữ liệu cho biểu đồ này.'));
      else {
        const groups = [...DTCP.groupBy(ctx.lines, card.dim).values()];
        const ranked = ['investor', 'project', 'company'].includes(card.dim) || groups.length > card.top;
        if (ranked) groups.sort((a, b) => (b[ms[0]] || 0) - (a[ms[0]] || 0)); else groups.sort((a, b) => catSort(card.dim, a.key) - catSort(card.dim, b.key) || String(a.key).localeCompare(String(b.key), 'vi', { numeric: true }));
        let shown = groups;
        if (groups.length > card.top) {
          const rest = groups.slice(card.top);
          const other = DTCP.total(ctx.lines.filter(l => rest.some(g => g.key === DTCP.DIM_KEY[card.dim](l))));
          shown = groups.slice(0, card.top).concat([Object.assign(other, { key: null, other: rest.length })]);
        }
        const series = ms.map(m => ({ name: T(m), color: METRIC_COLOR[m] }));
        const cats = shown.map(g => ({
          key: g.key, label: g.other ? `Khác (${g.other})` : dimLabel(card.dim, g.key, g.first), values: ms.map(m => g[m]),
          extra: ms.includes('pct') || ms.includes('count') ? [[null, T('dt'), F.vnd(g.dt)], [null, T('count'), F.int(g.count)]] : [[null, T('pct'), F.pct(g.pct)], [null, T('count'), F.int(g.count)]]
        }));
        const host = h('div', { class: 'chart-hb' });
        if (series.length > 1) body.push(h('div', { class: 'legend' }, series.map(s => h('span', null, sw(s.color), s.name))));
        body.push(h('div', { class: 'chart-box' }, host), h('p', { class: 'note axis-note' }, ms[0] === 'pct' ? 'Đơn vị: %' : ms[0] === 'count' ? 'Đơn vị: hợp đồng' : 'Trục: tỷ đồng'));
        const pickable = !ctx.preview && ['company', 'region', 'investor', 'stage', 'project'].includes(card.dim);
        ctx.draws.push(() => Charts.hbars(host, cats, series, {
          fmt: v => fmtM(ms[0], v), axisFmt: ms[0] === 'pct' ? d3.format('.0%') : ms[0] === 'count' ? F.int : F.tyAxis,
          onPick: pickable ? key => {
            if (key == null) return;
            S.filters[card.dim] = key;
            if (card.dim === 'stage') { location.hash = '#/chi-tiet'; return; } // thời điểm → Chi tiết DT-CP
            render(); window.scrollTo({ top: 0, behavior: 'smooth' });
          } : null
        }));
      }
    } else if (card.type === 'costs') {
      const t = ctx.tot;
      let items = DTCP.COST_KEYS.map(k => ({ key: k, name: costLabel(k), value: t.costs[k] }));
      if (!card.detail) {
        const m = new Map();
        items.forEach(x => { const g = costGroup(x.key); m.set(g, (m.get(g) || 0) + x.value); });
        items = [...m].map(([name, value]) => ({ name, value }));
      }
      items = items.filter(x => x.value).sort((a, b) => b.value - a.value);
      const sum = d3.sum(items, x => x.value) || 1;
      items.forEach(x => { x.share = x.value / sum; });
      if (!items.length) body.push(empty('Không có chi phí trong phạm vi đang lọc.'));
      else { const host = h('div', { class: 'bars' }); body.push(host); ctx.draws.push(() => Charts.breakdown(host, items, C[1], F.vnd)); }
    } else if (card.type === 'table') {
      body.push(treeTable(ctx.lines, !!ctx.preview));
    }
    return h('div', { class: 'card' + (card.width === 'full' ? ' wide' : ''), id: 'card-' + card.id, 'data-type': card.type },
      h('div', { class: 'card-head' }, h('h2', null, card.title || autoTitle(card)), editBtn),
      card.note ? h('p', { class: 'note' }, card.note) : null,
      body);
  }

  // Bảng nhiều tầng: Khu vực › Công trình › Hợp đồng (mở/thu gọn)
  function treeTable(lines, preview) {
    const tv = lines.some(l => l.vals.tv);
    const cols = ['hd', 'dt', 'cp', 'pct'].concat(tv ? ['tv'] : []);
    const num = (g, k) => (k === 'pct' ? F.pct(g.pct) : F.trieu(g[k]));
    const tbody = h('tbody');
    const ts = S.treeSort;
    const byKey = (a, b) => String(a.key).localeCompare(String(b.key), 'vi', { numeric: true });
    // Sắp xếp trong từng tầng theo cột đã chọn (bấm tiêu đề cột); không chọn thì theo mã.
    const order = (arr, dflt) => arr.sort(!ts ? dflt : (a, b) => {
      if (ts.k === 'name') return ts.dir * byKey(a, b);
      const x = a[ts.k], y = b[ts.k];
      if (!isFinite(x) || !isFinite(y)) return isFinite(x) ? -1 : isFinite(y) ? 1 : 0;
      return ts.dir * (x - y) || byKey(a, b);
    });
    const regions = order([...DTCP.groupBy(lines, 'region').values()], (a, b) => catSort('region', a.key) - catSort('region', b.key) || byKey(a, b));
    const row = (level, key, label, g, extra, onClick, open) => h('tr', { class: 'lv' + level + (onClick ? ' click' : ''), tabindex: onClick ? '0' : null, onclick: onClick, onkeydown: onClick ? e => { if (e.key === 'Enter') onClick(); } : null },
      h('td', { class: 'l name' }, level < 2 ? h('span', { class: 'tw' }, open ? '▾' : '▸') : null, h('span', null, label)),
      h('td', { class: 'l' }, extra[0] || ''), h('td', { class: 'l' }, extra[1] || ''),
      cols.map(k => h('td', { class: k === 'pct' && g.pct > 1 ? 'is-bad' : '' }, num(g, k))));
    const toggle = key => () => { if (S.open.has(key)) S.open.delete(key); else S.open.add(key); render(); };
    regions.forEach(rg => {
      const rk = 'r:' + rg.key, rOpen = S.open.has(rk);
      tbody.append(row(0, rk, dimLabel('region', rg.key, rg.first), rg, [F.int(rg.count) + ' HĐ', ''], preview ? null : toggle(rk), rOpen));
      if (!rOpen) return;
      const rl = lines.filter(l => l.region === rg.key);
      order([...DTCP.groupBy(rl, 'project').values()], byKey).forEach(pg => {
        const pk = 'p:' + rg.key + ':' + pg.key, pOpen = S.open.has(pk);
        tbody.append(row(1, pk, dimLabel('project', pg.key, pg.first), pg, [F.int(pg.count) + ' HĐ', ''], preview ? null : toggle(pk), pOpen));
        if (!pOpen) return;
        const pl = rl.filter(l => (l.project_code || '(không rõ)') === pg.key);
        order([...DTCP.groupBy(pl, 'contract').values()], byKey).forEach(cg => {
          const f = cg.first;
          tbody.append(row(2, cg.key, `${cg.key} · ${f.contract_no}${f.contract_title ? ' – ' + f.contract_title : ''}`, cg,
            [nameOf('investor', f.investor), preview ? nameOf('stage', f.stage) : h('a', { href: '#/chi-tiet', title: 'Xem Chi tiết DT-CP các hợp đồng ở ' + lc(T('stage')) + ' này', onclick: e => { e.stopPropagation(); S.filters.stage = f.stage || ''; } }, nameOf('stage', f.stage))],
            preview ? null : () => { location.hash = '#/chi-tiet/' + encodeURIComponent(cg.key); }, false));
        });
      });
    });
    const tot = DTCP.total(lines);
    const allKeys = () => { regions.forEach(rg => { S.open.add('r:' + rg.key); [...DTCP.groupBy(lines.filter(l => l.region === rg.key), 'project').keys()].forEach(pk => S.open.add('p:' + rg.key + ':' + pk)); }); };
    return h('div', { class: 'stack' },
      preview ? null : h('div', { class: 'row' },
        h('button', { class: 'btn sm', type: 'button', onclick: () => { allKeys(); render(); } }, 'Mở tất cả'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => { S.open.clear(); render(); } }, 'Thu gọn'),
        h('button', { class: 'btn sm', type: 'button', onclick: e => run(e.currentTarget, () => exportContracts(lines, 'bang-dtcp')) }, 'Xuất Excel')),
      h('div', { class: 'table-wrap tree-wrap' }, h('table', { class: 't tree' },
        h('thead', null, h('tr', null, sortTh('name', `${T('region')} / ${T('project')} / ${T('contract')}`, preview), h('th', { class: 'l' }, T('investor')), h('th', { class: 'l' }, T('stage')),
          cols.map(k => sortTh(k, T(k), preview)))),
        tbody,
        h('tfoot', null, h('tr', null, h('td', { class: 'l' }, 'Tổng cộng'), h('td', { class: 'l' }, F.int(tot.count) + ' HĐ'), h('td'), cols.map(k => h('td', null, num(tot, k))))))));
  }

  function sortTh(k, label, preview) {
    if (preview) return h('th', null, label);
    const ts = S.treeSort, on = ts && ts.k === k;
    const click = () => {
      const first = k === 'name' ? 1 : -1;
      S.treeSort = !on ? { k, dir: first } : ts.dir === first ? { k, dir: -first } : null;
      render();
    };
    return h('th', { class: 'sortable', tabindex: '0', title: 'Bấm để sắp xếp trong từng tầng', 'aria-sort': on ? (ts.dir > 0 ? 'ascending' : 'descending') : null,
      onclick: click, onkeydown: e => { if (e.key === 'Enter') click(); } }, label);
  }

  // Xuất danh sách hợp đồng (theo bộ lọc hiện tại) ra Excel
  async function exportContracts(lines, name) {
    await loadXLSX();
    const snap = snapById(S.snap);
    const head = ['Mã DT-CP', 'Số hợp đồng', 'Nội dung', T('company'), T('region'), T('project'), T('investor'), T('stage'),
      T('hd'), T('sl'), T('slhs'), T('tv'), T('dt')].concat(DTCP.COST_KEYS.map(costLabel), [T('cp'), T('pct')]);
    const body = [...DTCP.groupBy(lines, 'contract').values()].map(g => {
      const f = g.first;
      return [g.key, f.contract_no, f.contract_title, nameOf('company', f.company), dimLabel('region', f.region, f), f.project_code + ' – ' + f.project_name,
        nameOf('investor', f.investor), nameOf('stage', f.stage), g.hd, g.sl, g.slhs, g.tv, g.dt].concat(DTCP.COST_KEYS.map(k => g.costs[k]), [g.cp, isFinite(g.pct) ? g.pct : '']);
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([[`Mốc dữ liệu: ${snapLabel(snap)} – đơn vị: đồng`], head].concat(body));
    ws['!cols'] = head.map((t, i) => ({ wch: i < 3 ? 28 : 16 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Hop dong');
    XLSX.writeFile(wb, `${name}-${snap ? snap.report_date : ''}.xlsx`);
  }

  // ------------------------------------------------------------------
  // Chi tiết một hợp đồng: số liệu mốc hiện tại, diễn biến qua các mốc, dòng HĐ/PL, ghi chú
  // ------------------------------------------------------------------
  function viewContract() {
    const code = routeArg();
    const all = linesOf(S.snap);
    if (!all) return skeleton();
    if (!S.hist || S.hist.code !== code) {
      S.hist = { code, data: null };
      api.contractHistory(code).then(d => { if (S.hist && S.hist.code === code) { S.hist.data = d; render(); } }, e => toast(e.message, true));
    }
    const ls = all.filter(l => l.contract_code === code);
    const hist = S.hist.data;
    const back = h('a', { class: 'btn sm', href: '#/', onclick: e => { if (history.length > 1) { e.preventDefault(); history.back(); } } }, '← Quay lại');
    if (!ls.length && hist && !hist.history.length) return h('div', { class: 'card empty' }, h('h2', null, 'Không tìm thấy hợp đồng ' + code), back);
    const f = ls[0] || null;
    const g = DTCP.total(ls);
    const snap = snapById(S.snap);
    const chips = f ? [
      [T('company'), nameOf('company', f.company)], [T('region'), dimLabel('region', f.region, f)], [T('project'), f.project_code + ' – ' + f.project_name],
      [T('investor'), nameOf('investor', f.investor)], [T('stage'), nameOf('stage', f.stage)]
    ] : [];
    const hostH = h('div', { class: 'chart md' });
    const cards = [];
    cards.push(h('div', { class: 'card wide' },
      h('div', { class: 'card-head' }, h('div', null, h('p', { class: 'eyebrow' }, T('contract') + ' · ' + code), h('h1', { class: 'contract-title' }, f ? f.contract_no : code),
        f && f.contract_title ? h('p', { class: 'lead' }, f.contract_title) : null), back),
      h('div', { class: 'chips' }, chips.map(([k, v]) => h('span', { class: 'chip' }, h('span', { class: 'muted' }, k + ': '), v))),
      f ? h('div', { class: 'tiles' }, ['hd', 'dt', 'cp', 'pct'].concat(g.tv ? ['tv'] : []).map(m => h('div', { class: 'tile' },
        h('span', { class: 'label' }, T(m) + ' · mốc ' + F.dateShort(snap.report_date)), h('span', { class: 'big' }, fmtM(m, g[m]))))) : h('p', { class: 'note' }, 'Hợp đồng không có trong mốc đang chọn.')));
    // Diễn biến
    if (!hist) cards.push(h('div', { class: 'card wide' }, h('div', { class: 'skeleton', style: 'height:200px' })));
    else {
      const hs = hist.history;
      const rows = hs.map((r, i) => {
        const p = hs[i - 1], pct = r.dt ? r.cp / r.dt : NaN;
        return h('tr', { class: r.snapshot_id === S.snap ? 'sel' : '' }, h('td', { class: 'l' }, F.date(r.report_date) + (r.label ? ' · ' + r.label : '')),
          h('td', { class: 'l' }, nameOf('stage', r.stage) + (p && p.stage !== r.stage ? ' (đổi)' : '')),
          h('td', null, F.trieu(r.hd)), h('td', null, F.trieu(r.dt)), h('td', null, p ? deltaEl('dt', p.dt, r.dt) : ''),
          h('td', null, F.trieu(r.cp)), h('td', null, p ? deltaEl('cp', p.cp, r.cp) : ''), h('td', null, F.pct(pct)), h('td', null, F.trieu(r.tv)));
      });
      cards.push(h('div', { class: 'card wide' }, h('h2', null, 'Diễn biến qua các mốc'),
        hs.length > 1 ? [h('div', { class: 'legend' }, h('span', null, sw(C[0], true), T('dt')), h('span', null, sw(C[1], true), T('cp')), h('span', null, sw(C[3], true), T('hd'))), h('div', { class: 'chart-box' }, hostH), h('p', { class: 'note axis-note' }, 'Trục: tỷ đồng')] : h('p', { class: 'note' }, 'Hợp đồng mới có trong một mốc; tải thêm mốc để xem diễn biến.'),
        h('div', { class: 'table-wrap' }, h('table', { class: 't' },
          h('thead', null, h('tr', null, ['Mốc', T('stage'), T('hd'), T('dt'), 'Δ', T('cp'), 'Δ', T('pct'), T('tv')].map((t, i) => h('th', { class: i < 2 ? 'l' : '' }, t)))),
          h('tbody', null, rows))), h('p', { class: 'note' }, 'Đơn vị: triệu đồng. Δ: thay đổi so với mốc liền trước.')));
      if (hs.length > 1) S.redraw = () => Charts.lines(hostH, hs.map(r => r.report_date), [
        { name: T('dt'), color: C[0], values: hs.map(r => r.dt) }, { name: T('cp'), color: C[1], values: hs.map(r => r.cp) }, { name: T('hd'), color: C[3], values: hs.map(r => r.hd) }],
      { fmt: F.vnd, axisFmt: F.tyAxis, xFmt: F.dateShort, headFmt: F.date });
    }
    // Dòng Hợp đồng/Phụ lục
    if (ls.length) {
      const groups = [...new Set(DTCP.COST_KEYS.map(costGroup))];
      const gsum = (l, gname) => DTCP.COST_KEYS.filter(k => costGroup(k) === gname).reduce((t, k) => t + (l.vals[k] || 0), 0);
      cards.push(h('div', { class: 'card wide' }, h('h2', null, 'Các dòng hợp đồng và phụ lục · mốc ' + F.date(snap.report_date)),
        h('div', { class: 'table-wrap' }, h('table', { class: 't' },
          h('thead', null, h('tr', null, h('th', null, 'Dòng'), h('th', null, T('hd')), h('th', null, T('dt')), groups.map(gn => h('th', { title: gn }, gn.replace(/^\d+\.\s*/, ''))), h('th', { class: 'sum' }, T('cp')), h('th', null, T('pct')))),
          h('tbody', null, ls.map(l => { const cp = DTCP.cpOf(l.vals); return h('tr', null, h('td', { class: 'l' }, l.line_label || '–'), h('td', null, F.trieu(l.vals.hd || 0)), h('td', null, F.trieu(l.vals.dt || 0)),
            groups.map(gn => h('td', null, F.trieu(gsum(l, gn)))), h('td', { class: 'sum' }, F.trieu(cp)), h('td', null, F.pct(l.vals.dt ? cp / l.vals.dt : NaN))); })))),
        h('p', { class: 'note' }, 'Đơn vị: triệu đồng.')));
    }
    // Ghi chú
    if (hist) {
      const ta = h('textarea', { id: 'note-text', maxlength: 4000, placeholder: 'Ví dụ: chủ đầu tư đã duyệt phụ lục 02, chi phí thầu phụ tăng…' });
      const add = h('button', { class: 'btn primary', type: 'submit' }, 'Thêm ghi chú');
      cards.push(h('div', { class: 'card wide' }, h('h2', null, 'Ghi chú'),
        hist.notes.length ? h('div', { class: 'notes' }, hist.notes.map(n => h('div', { class: 'note-item' }, h('p', null, n.content),
          h('div', { class: 'note-meta' }, h('span', null, (n.author_name || 'Không rõ') + ' · ' + new Date(n.created_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })),
            (n.author_id === S.profile.id || isAdmin()) ? confirmBtn('Xóa', async () => { await api.deleteContractNote(n.id); S.hist = null; toast('Đã xóa ghi chú.'); render(); }) : null))))
          : h('p', { class: 'note' }, 'Chưa có ghi chú cho hợp đồng này.'),
        h('form', { class: 'stack', onsubmit: async ev => {
          ev.preventDefault();
          const text = ta.value.trim(); if (!text) return;
          const ok = await run(add, () => api.addContractNote(code, text));
          if (ok) { S.hist = null; toast('Đã thêm ghi chú.'); render(); }
        } }, h('label', { class: 'f' }, 'Ghi chú mới', ta), h('div', { class: 'row' }, add))));
    }
    return h('div', { class: 'grid' }, cards);
  }

  // ------------------------------------------------------------------
  // Chi tiết DT-CP: số liệu mới nhất của từng hợp đồng và so sánh giữa các thời điểm 1, 2, 3, 5…
  // Số liệu của một thời điểm = số liệu ở mốc (tháng) cuối cùng hợp đồng còn ở thời điểm đó.
  // Ma trận hợp đồng × mốc tải một lần (đã cộng sẵn ở máy chủ, nén gzip) và giữ trong bộ nhớ tới khi dữ liệu đổi.
  // ------------------------------------------------------------------
  const stageCmp = (a, b) => catSort('stage', a) - catSort('stage', b) || String(a).localeCompare(String(b), 'vi', { numeric: true });
  const latestSnap = () => S.snapshots[0] || null;
  const mval = (r, k) => (k === 'pct' ? (r.dt ? r.cp / r.dt : NaN) : r[k] || 0);
  const fmtCell = (k, v) => (k === 'pct' ? F.pct(v) : F.trieu(v));
  function matrix() {
    if (S.mx && S.mx.data) return S.mx.data;
    if (!S.mx) {
      const mx = S.mx = { data: null };
      api.dtcpMatrix().then(d => {
        if (S.mx !== mx) return;
        const fi = Object.fromEntries(d.fields.map((f, i) => [f, i]));
        const ord = new Map(S.snapshots.map((s, i) => [s.id, S.snapshots.length - i]));
        const byCode = new Map();
        d.rows.forEach(r => {
          const s = snapById(r[fi.snapshot_id]);
          if (!s) return;
          const code = d.codes[r[fi.code]];
          const o = { snapshot_id: s.id, report_date: s.report_date, label: s.label, stage: r[fi.stage] || '', ord: ord.get(s.id) };
          ['hd', 'sl', 'slhs', 'tv', 'dt', 'cp'].forEach(k => { o[k] = r[fi[k]] || 0; });
          if (!byCode.has(code)) byCode.set(code, []);
          byCode.get(code).push(o);
        });
        byCode.forEach(a => a.sort((x, y) => x.ord - y.ord));
        mx.data = byCode;
        render();
      }, e => { if (S.mx === mx) S.mx = null; toast(e.message, true); });
    }
    return null;
  }
  // Gom các mốc của một hợp đồng theo thời điểm; hist xếp theo ngày tăng dần.
  function stagesOf(hist) {
    const m = new Map();
    hist.forEach(r => {
      const k = r.stage || '';
      if (!m.has(k)) m.set(k, { stage: k, first: r, last: r, n: 0 });
      const g = m.get(k); g.last = r; g.n++;
    });
    return [...m.values()].sort((a, b) => stageCmp(a.stage, b.stage));
  }
  const stagePeriod = g => (g.n > 1 ? `${F.dateShort(g.first.report_date)} → ${F.dateShort(g.last.report_date)} · ${g.n} mốc` : `mốc ${F.dateShort(g.last.report_date)}`);
  function dcellSub(k, a, b) {
    if (a == null || b == null) return null;
    const d = k === 'pct' ? b - a : b - a;
    if (!isFinite(d) || Math.abs(d) < (k === 'pct' ? 1e-9 : 1)) return h('span', { class: 'sub' }, 'không đổi');
    const good = GOOD[k] > 0 ? d > 0 : GOOD[k] < 0 ? d < 0 : null;
    return h('span', { class: 'sub ' + (good === null ? '' : good ? 'is-good' : 'is-bad') }, k === 'pct' ? F.pt(d) : (d > 0 ? '+' : '') + F.trieu(d));
  }
  const DET_METRICS = ['dt', 'cp', 'pct', 'hd', 'sl', 'tv'];

  function viewDetail() {
    if (!S.snapshots.length) return emptyData();
    const code = routeArg();
    return code ? detailContract(code) : detailList();
  }

  function detailList() {
    const ls = latestSnap(), all = linesOf(ls.id), mx = matrix();
    const det = S.det;
    const head = h('div', null, h('div', { class: 'page-head' }, h('h1', null, 'Chi tiết DT-CP')),
      h('p', { class: 'lead' }, `Số liệu mới nhất theo mốc `, h('b', null, F.date(ls.report_date)), `. Mỗi cột ${lc(T('stage'))} là số liệu ở tháng cuối cùng hợp đồng nằm ở ${lc(T('stage'))} đó, để so sánh DT-CP qua từng ${lc(T('stage'))}. Bấm vào một hợp đồng để xem chi tiết và số liệu từng tháng.`));
    if (!all || !mx) return h('div', { class: 'stack', style: 'gap:18px' }, head, skeleton());
    const fl = DTCP.filter(all, S.filters);
    const groups = [...DTCP.groupBy(fl, 'contract').values()];
    const items = groups.map(g => {
      const hist = mx.get(g.key) || [];
      const st = stagesOf(hist);
      return { key: g.key, g, f: g.first, st: new Map(st.map(x => [x.stage, x])), order: st.map(x => x.stage), hist };
    });
    const stages = [...new Set(items.flatMap(x => x.order))].sort(stageCmp);
    const m = DET_METRICS.includes(det.metric) ? det.metric : 'dt';
    const mSel = h('select', { id: 'det-metric' }, DET_METRICS.map(k => h('option', { value: k }, T(k))));
    mSel.value = m; mSel.addEventListener('change', () => { det.metric = mSel.value; render(); });
    const controls = h('div', { class: 'card filters' }, h('div', { class: 'filter-grid' }, h('label', { class: 'f' }, 'Chỉ số so sánh trong bảng', mSel)));
    if (!items.length) return h('div', { class: 'stack', style: 'gap:18px' }, head, filterBar(all, { snap: false }), h('div', { class: 'card empty' }, h('p', null, 'Không có hợp đồng nào khớp bộ lọc.')));
    // Tổng theo từng thời điểm (chỉ cộng các hợp đồng đã qua thời điểm đó)
    const agg = stages.map(s => {
      const a = { stage: s, count: 0, hd: 0, sl: 0, tv: 0, dt: 0, cp: 0 };
      items.forEach(x => { const g = x.st.get(s); if (!g) return; a.count++; ['hd', 'sl', 'tv', 'dt', 'cp'].forEach(k => { a[k] += g.last[k]; }); });
      a.pct = a.dt ? a.cp / a.dt : NaN;
      return a;
    });
    const tot = DTCP.total(fl);
    const aggCols = ['count', 'hd', 'sl', 'dt', 'tv', 'cp', 'pct'].filter(k => k !== 'tv' || tot.tv || agg.some(a => a.tv)).filter(k => k !== 'sl' || tot.sl || agg.some(a => a.sl));
    const aggCell = (a, k) => (k === 'count' ? F.int(a.count) : fmtCell(k, a[k]));
    const host = h('div', { class: 'chart-hb' });
    const draws = [() => Charts.hbars(host, agg.map(a => ({ key: a.stage, label: nameOf('stage', a.stage), values: [a.dt, a.cp], extra: [[null, T('count'), F.int(a.count)], [null, T('pct'), F.pct(a.pct)]] })),
      [{ name: T('dt'), color: C[0] }, { name: T('cp'), color: C[1] }], { fmt: F.vnd, axisFmt: F.tyAxis, onPick: key => { S.filters.stage = key; render(); } })];
    S.redraw = () => drawAll(draws);
    const sumCard = h('div', { class: 'card wide' }, h('h2', null, `Tổng hợp theo ${lc(T('stage'))}`),
      h('p', { class: 'note' }, `${F.int(items.length)} ${lc(T('contract'))} đang lọc. Mỗi ${lc(T('stage'))} cộng số liệu của các hợp đồng đã qua ${lc(T('stage'))} đó (tại tháng cuối của ${lc(T('stage'))}). Dòng "Mới nhất" là mốc ${F.date(ls.report_date)}. Đơn vị: triệu đồng.`),
      h('div', { class: 'legend' }, h('span', null, sw(C[0]), T('dt')), h('span', null, sw(C[1]), T('cp'))),
      h('div', { class: 'chart-box' }, host), h('p', { class: 'note axis-note' }, `Trục: tỷ đồng. Bấm vào một ${lc(T('stage'))} để lọc các hợp đồng đang ở ${lc(T('stage'))} đó.`),
      h('div', { class: 'table-wrap' }, h('table', { class: 't' },
        h('thead', null, h('tr', null, h('th', null, T('stage')), aggCols.map(k => h('th', null, T(k))))),
        h('tbody', null, agg.map(a => h('tr', null, h('td', { class: 'l' }, nameOf('stage', a.stage)), aggCols.map(k => h('td', { class: k === 'pct' && a.pct > 1 ? 'is-bad' : '' }, aggCell(a, k)))))),
        h('tfoot', null, h('tr', null, h('td', { class: 'l' }, 'Mới nhất · ' + F.dateShort(ls.report_date)), aggCols.map(k => h('td', null, aggCell(tot, k))))))));
    // Bảng từng hợp đồng
    items.sort((a, b) => (mval(b.g, m) || 0) - (mval(a.g, m) || 0) || String(a.key).localeCompare(String(b.key), 'vi', { numeric: true }));
    const show = items.slice(0, 3000);
    const go = key => () => { location.hash = '#/chi-tiet/' + encodeURIComponent(key); };
    const tbl = h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, h('th', null, T('contract')), h('th', { class: 'l' }, T('stage') + ' hiện tại'),
        stages.map(s => h('th', null, nameOf('stage', s))), h('th', { class: 'sum' }, 'Mới nhất'))),
      h('tbody', null, show.map(x => {
        const cur = x.f.stage || '';
        let prev = null;
        return h('tr', { class: 'click', tabindex: '0', onclick: go(x.key), onkeydown: e => { if (e.key === 'Enter') go(x.key)(); } },
          h('td', { class: 'l name', title: x.f.contract_title || '' }, `${x.key} · ${x.f.contract_no}`),
          h('td', { class: 'l' }, nameOf('stage', cur)),
          stages.map(s => {
            const g = x.st.get(s);
            if (!g) return h('td', { class: 'muted' }, '–');
            const v = mval(g.last, m), el = h('td', { class: s === cur ? 'cur' : '', title: stagePeriod(g) }, fmtCell(m, v), dcellSub(m, prev, v));
            prev = v;
            return el;
          }),
          h('td', { class: 'sum' + (m === 'pct' && x.g.pct > 1 ? ' is-bad' : '') }, fmtCell(m, mval(x.g, m))));
      })),
      h('tfoot', null, h('tr', null, h('td', { class: 'l' }, 'Tổng cộng'), h('td', { class: 'l' }, F.int(items.length) + ' HĐ'),
        agg.map(a => h('td', null, fmtCell(m, mval(a, m)))), h('td', { class: 'sum' }, fmtCell(m, mval(tot, m)))))));
    const tableCard = h('div', { class: 'card wide' },
      h('div', { class: 'card-head' }, h('h2', null, `${T(m)} của từng hợp đồng theo ${lc(T('stage'))}`),
        h('button', { class: 'btn sm', type: 'button', onclick: e => run(e.currentTarget, () => exportDetail(items, stages, ls)) }, 'Xuất Excel')),
      h('p', { class: 'note' }, `Đơn vị: ${m === 'pct' ? '%' : 'triệu đồng'}. Ô tô màu là ${lc(T('stage'))} hiện tại; dòng nhỏ dưới mỗi số là thay đổi so với ${lc(T('stage'))} liền trước. Rê chuột vào ô để xem khoảng tháng. Bấm tiêu đề cột để sắp xếp.` +
        (items.length > show.length ? ` Đang hiện ${show.length} hợp đồng đầu; xuất Excel để xem đủ.` : '')), tbl);
    return h('div', { class: 'stack', style: 'gap:18px' }, head, filterBar(all, { snap: false }), controls, h('div', { class: 'grid' }, sumCard, tableCard));
  }

  async function exportDetail(items, stages, ls) {
    await loadXLSX();
    const ks = ['hd', 'sl', 'tv', 'dt', 'cp', 'pct'];
    const head = ['Mã DT-CP', 'Số hợp đồng', 'Nội dung', T('company'), T('region'), T('project'), T('investor'), T('stage') + ' hiện tại']
      .concat(...stages.map(s => ks.map(k => `${nameOf('stage', s)} · ${T(k)}`).concat(`${nameOf('stage', s)} · Mốc cuối`)), ks.map(k => 'Mới nhất · ' + T(k)));
    const body = items.map(x => {
      const f = x.f;
      return [x.key, f.contract_no, f.contract_title, nameOf('company', f.company), dimLabel('region', f.region, f), f.project_code + ' – ' + f.project_name, nameOf('investor', f.investor), nameOf('stage', f.stage)]
        .concat(...stages.map(s => { const g = x.st.get(s); return g ? ks.map(k => { const v = mval(g.last, k); return isFinite(v) ? v : ''; }).concat(F.date(g.last.report_date)) : ks.map(() => '').concat(''); }),
          ks.map(k => { const v = mval(x.g, k); return isFinite(v) ? v : ''; }));
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([[`Chi tiết DT-CP theo ${lc(T('stage'))} – mốc mới nhất ${snapLabel(ls)} – đơn vị: đồng`], head].concat(body));
    ws['!cols'] = head.map((t, i) => ({ wch: i < 3 ? 28 : 16 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Chi tiet DT-CP');
    XLSX.writeFile(wb, `chi-tiet-dtcp-${ls.report_date}.xlsx`);
  }

  function detailContract(code) {
    const ls = latestSnap(), all = linesOf(ls.id);
    if (!S.hist || S.hist.code !== code) {
      S.hist = { code, data: null };
      api.contractHistory(code).then(d => { if (S.hist && S.hist.code === code) { S.hist.data = d; render(); } }, e => toast(e.message, true));
    }
    const hist = S.hist.data;
    const back = h('a', { class: 'btn sm', href: '#/chi-tiet' }, '← Danh sách');
    if (!all || !hist) return h('div', { class: 'stack' }, h('div', { class: 'row' }, back), skeleton());
    const hs = hist.history;
    if (!hs.length) return h('div', { class: 'card empty' }, h('h2', null, 'Không tìm thấy hợp đồng ' + code), back);
    const f = all.find(l => l.contract_code === code) || (S.lines.get(S.snap) || []).find(l => l.contract_code === code) || null;
    const last = hs[hs.length - 1], prev = hs[hs.length - 2] || null;
    hs.forEach(r => { r.pct = r.dt ? r.cp / r.dt : NaN; });
    const st = stagesOf(hs);
    const cur = last.stage || '';
    const chips = f ? [[T('company'), nameOf('company', f.company)], [T('region'), dimLabel('region', f.region, f)], [T('project'), f.project_code + ' – ' + f.project_name], [T('investor'), nameOf('investor', f.investor)]] : [];
    const draws = [];
    const cards = [];
    const tileKeys = ['hd', 'dt', 'cp', 'pct'].concat(last.sl ? ['sl'] : [], last.tv ? ['tv'] : []);
    cards.push(h('div', { class: 'card wide' },
      h('div', { class: 'card-head' }, h('div', null, h('p', { class: 'eyebrow' }, 'Chi tiết DT-CP · ' + code), h('h1', { class: 'contract-title' }, f ? f.contract_no : code),
        f && f.contract_title ? h('p', { class: 'lead' }, f.contract_title) : null),
      h('div', { class: 'row' }, back, h('a', { class: 'btn sm', href: '#/hop-dong/' + encodeURIComponent(code) }, 'Dòng HĐ/PL & ghi chú'))),
      h('div', { class: 'chips' }, chips.map(([k, v]) => h('span', { class: 'chip' }, h('span', { class: 'muted' }, k + ': '), v)),
        h('span', { class: 'chip stagechg' }, h('span', { class: 'muted' }, T('stage') + ' hiện tại: '), nameOf('stage', cur))),
      last.snapshot_id !== ls.id ? h('div', { class: 'alert warn' }, `Hợp đồng không có trong mốc mới nhất (${F.date(ls.report_date)}); số liệu dưới đây là mốc gần nhất có hợp đồng: ${F.date(last.report_date)}.`) : null,
      h('div', { class: 'tiles' }, tileKeys.map(k => h('div', { class: 'tile' },
        h('span', { class: 'label' }, T(k) + ' · mốc ' + F.dateShort(last.report_date)),
        h('span', { class: 'big' + (k === 'pct' && last.pct > 1 ? ' is-bad' : '') }, fmtM(k, last[k])),
        deltaEl(k, prev ? prev[k] : null, last[k], prev ? 'so với mốc ' + F.dateShort(prev.report_date) : 'Chưa có mốc trước để so sánh'))))));
    // So sánh theo thời điểm
    const groups = [...new Set(DTCP.COST_KEYS.map(costGroup))];
    const gval = (r, gn) => DTCP.COST_KEYS.filter(k => costGroup(k) === gn).reduce((t, k) => t + (r[k] || 0), 0);
    const rowsDef = [['hd', T('hd')], ['sl', T('sl')], ['slhs', T('slhs')], ['tv', T('tv')], ['dt', T('dt')], ['cp', T('cp')], ['pct', T('pct')]]
      .filter(([k]) => !['sl', 'slhs', 'tv'].includes(k) || hs.some(r => r[k]))
      .map(([k, t]) => ({ k, t, get: r => r[k], m: k }))
      .concat(groups.filter(gn => hs.some(r => gval(r, gn))).map(gn => ({ k: 'g:' + gn, t: gn, get: r => gval(r, gn), m: 'cp', sub: true })));
    const hostS = h('div', { class: 'chart-hb' });
    if (st.length > 1) draws.push(() => Charts.hbars(hostS, st.map(g => ({ key: g.stage, label: nameOf('stage', g.stage), values: [g.last.dt, g.last.cp], extra: [[null, T('pct'), F.pct(g.last.pct)], [null, 'Mốc', stagePeriod(g)]] })),
      [{ name: T('dt'), color: C[0] }, { name: T('cp'), color: C[1] }], { fmt: F.vnd, axisFmt: F.tyAxis }));
    cards.push(h('div', { class: 'card wide' }, h('h2', null, `So sánh DT-CP theo ${lc(T('stage'))}`),
      h('p', { class: 'note' }, `Mỗi cột là số liệu ở tháng cuối cùng hợp đồng nằm ở ${lc(T('stage'))} đó; cột tô màu là ${lc(T('stage'))} hiện tại (= số liệu mới nhất). Dòng nhỏ là thay đổi so với ${lc(T('stage'))} liền trước. Đơn vị: triệu đồng.`),
      st.length > 1 ? [h('div', { class: 'legend' }, h('span', null, sw(C[0]), T('dt')), h('span', null, sw(C[1]), T('cp'))), h('div', { class: 'chart-box' }, hostS), h('p', { class: 'note axis-note' }, 'Trục: tỷ đồng')]
        : h('p', { class: 'note' }, `Hợp đồng mới có số liệu ở một ${lc(T('stage'))}. Khi file các tháng sau ghi ${lc(T('stage'))} mới, bảng sẽ có thêm cột để so sánh.`),
      h('div', { class: 'table-wrap' }, h('table', { class: 't nosort' },
        h('thead', null, h('tr', null, h('th', null, 'Chỉ số'), st.map(g => h('th', { class: g.stage === cur ? 'cur' : '' }, nameOf('stage', g.stage) + (g.stage === cur ? ' (hiện tại)' : ''), h('span', { class: 'sub' }, stagePeriod(g)))))),
        h('tbody', null, rowsDef.map(d => h('tr', { class: d.sub ? 'subrow' : '' }, h('td', { class: 'l' + (d.sub ? ' indent' : '') }, d.t),
          st.map((g, i) => {
            const v = d.get(g.last);
            return h('td', { class: (g.stage === cur ? 'cur' : '') + (d.k === 'pct' && v > 1 ? ' is-bad' : '') }, fmtCell(d.k === 'pct' ? 'pct' : 'x', v), i ? dcellSub(d.m, d.get(st[i - 1].last), v) : null);
          }))))))));
    // Số liệu từng tháng (hiện khi bấm)
    const det = S.det;
    const toggle = h('button', { class: 'btn sm', type: 'button', onclick: () => { det.months = !det.months; render(); } }, det.months ? 'Ẩn số liệu từng tháng' : `Hiện số liệu từng tháng (${hs.length} mốc)`);
    const monthCard = h('div', { class: 'card wide' }, h('div', { class: 'card-head' }, h('h2', null, 'Số liệu từng tháng (các mốc cập nhật)'), toggle));
    if (det.months) {
      const hostH = h('div', { class: 'chart md' });
      if (hs.length > 1) {
        monthCard.append(h('div', { class: 'legend' }, h('span', null, sw(C[0], true), T('dt')), h('span', null, sw(C[1], true), T('cp')), h('span', null, sw(C[3], true), T('hd'))), h('div', { class: 'chart-box' }, hostH), h('p', { class: 'note axis-note' }, 'Trục: tỷ đồng'));
        draws.push(() => Charts.lines(hostH, hs.map(r => r.report_date), [
          { name: T('dt'), color: C[0], values: hs.map(r => r.dt) }, { name: T('cp'), color: C[1], values: hs.map(r => r.cp) }, { name: T('hd'), color: C[3], values: hs.map(r => r.hd) }],
        { fmt: F.vnd, axisFmt: F.tyAxis, xFmt: F.dateShort, headFmt: F.date }));
      }
      const tv = hs.some(r => r.tv);
      monthCard.append(h('div', { class: 'table-wrap' }, h('table', { class: 't' },
        h('thead', null, h('tr', null, ['Mốc', T('stage'), T('hd'), T('dt'), 'Δ', T('cp'), 'Δ', T('pct')].concat(tv ? [T('tv')] : []).map((t, i) => h('th', { class: i < 2 ? 'l' : '' }, t)))),
        h('tbody', null, hs.slice().reverse().map(r => {
          const i = hs.indexOf(r), p = hs[i - 1];
          return h('tr', { class: r.snapshot_id === ls.id ? 'sel' : '' }, h('td', { class: 'l' }, F.date(r.report_date) + (r.label ? ' · ' + r.label : '')),
            h('td', { class: 'l' }, nameOf('stage', r.stage) + (p && p.stage !== r.stage ? ' (đổi)' : '')),
            h('td', null, F.trieu(r.hd)), h('td', null, F.trieu(r.dt)), h('td', null, p ? deltaEl('dt', p.dt, r.dt) : ''),
            h('td', null, F.trieu(r.cp)), h('td', null, p ? deltaEl('cp', p.cp, r.cp) : ''), h('td', { class: r.pct > 1 ? 'is-bad' : '' }, F.pct(r.pct)), tv ? h('td', null, F.trieu(r.tv)) : null);
        })))), h('p', { class: 'note' }, 'Đơn vị: triệu đồng. Δ: thay đổi so với mốc liền trước. Mốc mới nhất ở trên cùng.'));
    } else monthCard.append(h('p', { class: 'note' }, `Số liệu của tất cả các tháng vẫn được lưu trên máy chủ; bấm nút để xem và so sánh.`));
    cards.push(monthCard);
    S.redraw = () => drawAll(draws);
    return h('div', { class: 'grid' }, cards);
  }

  // ------------------------------------------------------------------
  // So sánh: giữa hai mốc, hoặc giữa các thời điểm trong một mốc
  // ------------------------------------------------------------------
  function viewCompare() {
    if (!S.snapshots.length) return emptyData();
    const cm = S.cmp;
    const tabs = h('div', { class: 'tabs', role: 'group' },
      [['snap', 'Giữa hai mốc dữ liệu'], ['stage', 'Giữa các ' + lc(T('stage')) + ' (trong một mốc)']].map(([k, t]) =>
        h('button', { type: 'button', class: cm.mode === k ? 'on' : '', 'aria-pressed': cm.mode === k ? 'true' : 'false', onclick: () => { cm.mode = k; render(); } }, t)));
    const head = h('div', null, h('h1', { class: 'page-head' }, 'So sánh DT-CP'), h('p', { class: 'lead' },
      cm.mode === 'snap' ? 'Chọn hai mốc để xem doanh thu, chi phí và tỷ lệ chi phí thay đổi thế nào; bấm vào một hợp đồng để xem diễn biến chi tiết.'
        : `So sánh các nhóm theo cột "${T('stage')}" của file trong cùng một mốc dữ liệu.`), tabs);
    return h('div', { class: 'stack', style: 'gap:18px' }, head, cm.mode === 'snap' ? compareSnapshots() : compareStages());
  }

  function compareSnapshots() {
    const cm = S.cmp;
    if (S.snapshots.length < 2) return h('div', { class: 'card empty' }, h('p', null, 'Cần ít nhất hai mốc dữ liệu để so sánh. Mỗi lần tải file DT-CP mới lên là thêm một mốc.'),
      isAdmin() ? h('a', { class: 'btn primary', href: '#/du-lieu' }, 'Tải thêm file') : null);
    if (!snapById(cm.b)) cm.b = S.snapshots[0].id;
    if (!snapById(cm.a) || cm.a === cm.b) cm.a = (prevSnap(cm.b) || S.snapshots.find(s => s.id !== cm.b)).id;
    const pick = (field, label) => {
      const sel = h('select', { id: 'cmp-' + field }, S.snapshots.map(s => h('option', { value: s.id }, snapLabel(s))));
      sel.value = cm[field];
      sel.addEventListener('change', () => { cm[field] = +sel.value; render(); });
      return h('label', { class: 'f' }, label, sel);
    };
    const bySel = h('select', { id: 'cmp-by' }, [['contract', T('contract')], ['project', T('project')], ['region', T('region')], ['company', T('company')], ['investor', T('investor')], ['stage', T('stage')]].map(([k, t]) => h('option', { value: k }, t)));
    bySel.value = cm.by; bySel.addEventListener('change', () => { cm.by = bySel.value; render(); });
    const mSel = h('select', { id: 'cmp-metric' }, ['dt', 'cp', 'pct', 'hd', 'tv', 'sl'].map(k => h('option', { value: k }, T(k))));
    mSel.value = cm.metric; mSel.addEventListener('change', () => { cm.metric = mSel.value; render(); });
    const only = h('input', { type: 'checkbox', id: 'cmp-only', checked: cm.only });
    only.addEventListener('change', () => { cm.only = only.checked; render(); });
    const controls = h('div', { class: 'card filters' }, h('div', { class: 'filter-grid' }, pick('a', 'Mốc cũ (A)'), pick('b', 'Mốc mới (B)'),
      h('label', { class: 'f' }, 'So sánh theo', bySel), h('label', { class: 'f' }, 'Sắp xếp theo thay đổi của', mSel),
      h('label', { class: 'check' }, only, 'Chỉ hiện dòng có thay đổi')));
    const la = linesOf(cm.a), lb = linesOf(cm.b);
    if (!la || !lb) return h('div', { class: 'stack' }, controls, skeleton());
    const fa = DTCP.filter(la, S.filters), fb = DTCP.filter(lb, S.filters);
    const ta = DTCP.total(fa), tb = DTCP.total(fb);
    const sa = snapById(cm.a), sb = snapById(cm.b);
    // Trạng thái theo hợp đồng
    const ca = DTCP.groupBy(fa, 'contract'), cb = DTCP.groupBy(fb, 'contract');
    const status = code => {
      const a = ca.get(code), b = cb.get(code);
      if (!a) return 'new'; if (!b) return 'gone';
      if ((a.first.stage || '') !== (b.first.stage || '')) return 'stage';
      return ['hd', 'dt', 'cp', 'tv', 'sl'].some(k => Math.abs((a[k] || 0) - (b[k] || 0)) >= 1) ? 'changed' : 'same';
    };
    const allCodes = [...new Set([...ca.keys(), ...cb.keys()])];
    const counts = { new: 0, gone: 0, stage: 0, changed: 0, same: 0 };
    allCodes.forEach(c => counts[status(c)]++);
    const ST = { new: ['Mới', 'new'], gone: ['Không còn', 'gone'], stage: ['Đổi ' + lc(T('stage')), 'stagechg'], changed: ['Thay đổi', 'over'], same: ['Không đổi', ''] };
    const summary = h('div', { class: 'card wide' }, h('h2', null, `Mốc ${F.dateShort(sa.report_date)} → ${F.dateShort(sb.report_date)}`),
      h('div', { class: 'tiles' }, ['dt', 'cp', 'pct', 'hd', 'count'].map(k => h('div', { class: 'tile' }, h('span', { class: 'label' }, T(k)),
        h('span', { class: 'big' }, fmtM(k, tb[k])), h('span', { class: 'delta' }, 'Mốc A: ' + fmtM(k, ta[k])), deltaEl(k, ta[k], tb[k], 'so với mốc A')))),
      h('div', { class: 'chips' }, Object.entries(counts).filter(([k]) => k !== 'same').map(([k, n]) => h('span', { class: 'chip ' + ST[k][1] }, `${ST[k][0]}: ${F.int(n)} ${lc(T('contract'))}`)),
        h('span', { class: 'chip' }, `Không đổi: ${F.int(counts.same)}`)));
    // Nhóm theo chiều đã chọn
    const ga = DTCP.groupBy(fa, cm.by), gb = DTCP.groupBy(fb, cm.by);
    const keys = [...new Set([...ga.keys(), ...gb.keys()])];
    const val = (g, k) => (g ? g[k] : k === 'pct' ? NaN : 0);
    let rows = keys.map(k => {
      const a = ga.get(k), b = gb.get(k), m = cm.metric;
      const d = val(b, m) - val(a, m);
      const st = cm.by === 'contract' ? status(k) : !a ? 'new' : !b ? 'gone' : ['hd', 'dt', 'cp'].some(x => Math.abs(val(a, x) - val(b, x)) >= 1) ? 'changed' : 'same';
      return { key: k, a, b, d, st, label: dimLabel(cm.by, k, (b || a).first) };
    });
    if (cm.only) rows = rows.filter(r => r.st !== 'same');
    rows.sort((x, y) => (Math.abs(y.d) || 0) - (Math.abs(x.d) || 0) || String(x.key).localeCompare(String(y.key), 'vi', { numeric: true }));
    const top = rows.filter(r => isFinite(r.d) && r.d !== 0).slice(0, 15);
    const host = h('div', { class: 'chart-hb' });
    const m = cm.metric;
    const chartCard = h('div', { class: 'card wide' }, h('h2', null, `Thay đổi ${lc(T(m))} lớn nhất theo ${lc(T(cm.by))}`),
      top.length ? [h('div', { class: 'chart-box' }, host), h('p', { class: 'note axis-note' }, m === 'pct' ? 'Đơn vị: điểm %' : 'Trục: tỷ đồng')] : h('p', { class: 'note' }, 'Không có thay đổi nào.'));
    if (top.length) S.redraw = () => Charts.hbars(host, top.map(r => ({ key: r.key, label: r.label, values: [r.d], extra: [[null, 'Mốc A', fmtM(m, val(r.a, m))], [null, 'Mốc B', fmtM(m, val(r.b, m))]] })),
      [{ name: 'Thay đổi ' + lc(T(m)), color: C[0] }],
      { fmt: m === 'pct' ? F.pt : F.svnd, axisFmt: m === 'pct' ? (v => d3.format('+.0f')(v * 100)) : F.tyAxis, colorOf: v => (GOOD[m] === 0 ? C[0] : (v > 0) === (GOOD[m] > 0) ? 'var(--ok)' : 'var(--bad)'),
        onPick: cm.by === 'contract' ? key => { location.hash = '#/hop-dong/' + encodeURIComponent(key); } : null });
    const cell = (g, k) => (g ? (k === 'pct' ? F.pct(g.pct) : F.trieu(g[k])) : '–');
    const dcell = (a, b, k) => {
      const x = val(a, k), y = val(b, k), d = y - x;
      if (!isFinite(d) || !d) return h('td', { class: 'muted' }, '0');
      const good = GOOD[k] > 0 ? d > 0 : GOOD[k] < 0 ? d < 0 : null;
      return h('td', { class: good === null ? '' : good ? 'is-good' : 'is-bad' }, k === 'pct' ? F.pt(d) : (d > 0 ? '+' : '') + F.trieu(d));
    };
    const show = rows.slice(0, 3000);
    const tbl = h('div', { class: 'table-wrap' }, h('table', { class: 't cmp' },
      h('thead', null, h('tr', null, h('th', { rowspan: 2 }, T(cm.by)), h('th', { class: 'l', rowspan: 2 }, 'Trạng thái'),
        ...['dt', 'cp', 'pct'].map(k => h('th', { colspan: 3, class: 'grp' + (k === m ? ' hl' : '') }, T(k)))),
      h('tr', null, ...['dt', 'cp', 'pct'].flatMap(() => [h('th', null, 'A'), h('th', null, 'B'), h('th', null, 'Δ')]))),
      h('tbody', null, show.map(r => h('tr', cm.by === 'contract' ? { class: 'click', tabindex: '0', onclick: () => { location.hash = '#/hop-dong/' + encodeURIComponent(r.key); }, onkeydown: e => { if (e.key === 'Enter') location.hash = '#/hop-dong/' + encodeURIComponent(r.key); } } : null,
        h('td', { class: 'l name' }, r.label),
        h('td', { class: 'l' }, r.st !== 'same' ? h('span', { class: 'chip ' + ST[r.st][1] }, ST[r.st][0] + (r.st === 'stage' ? `: ${nameOf('stage', r.a.first.stage)} → ${nameOf('stage', r.b.first.stage)}` : '')) : h('span', { class: 'muted' }, 'Không đổi')),
        ...['dt', 'cp', 'pct'].flatMap(k => [h('td', null, cell(r.a, k)), h('td', null, cell(r.b, k)), dcell(r.a, r.b, k)]))))));
    const tableCard = h('div', { class: 'card wide' }, h('div', { class: 'card-head' }, h('h2', null, `Chi tiết theo ${lc(T(cm.by))} (${F.int(rows.length)} dòng)`),
      h('button', { class: 'btn sm', type: 'button', onclick: e => run(e.currentTarget, () => exportCompare(rows, sa, sb)) }, 'Xuất Excel')),
      h('p', { class: 'note' }, `Đơn vị: triệu đồng; ${T('pct')} tính bằng %, Δ của nó là điểm %. Xanh là tốt lên, đỏ là xấu đi.` + (rows.length > show.length ? ` Đang hiện ${show.length} dòng đầu; xuất Excel để xem đủ.` : '') + ' Bấm tiêu đề cột để sắp xếp.'), tbl);
    return h('div', { class: 'stack', style: 'gap:18px' }, controls, filterBar(lb, { snap: false }), h('div', { class: 'grid' }, summary, chartCard, tableCard));
  }

  async function exportCompare(rows, sa, sb) {
    await loadXLSX();
    const head = [T(S.cmp.by), 'Trạng thái'].concat(...['hd', 'dt', 'cp', 'tv'].map(k => [T(k) + ' A', T(k) + ' B', T(k) + ' Δ']), [T('pct') + ' A', T('pct') + ' B']);
    const v = (g, k) => (g ? g[k] : 0);
    const body = rows.map(r => [r.label, { new: 'Mới', gone: 'Không còn', stage: 'Đổi thời điểm', changed: 'Thay đổi', same: 'Không đổi' }[r.st]]
      .concat(...['hd', 'dt', 'cp', 'tv'].map(k => [v(r.a, k), v(r.b, k), v(r.b, k) - v(r.a, k)]), [r.a && isFinite(r.a.pct) ? r.a.pct : '', r.b && isFinite(r.b.pct) ? r.b.pct : '']));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([[`So sánh mốc ${snapLabel(sa)} (A) và ${snapLabel(sb)} (B) – đơn vị: đồng`], head].concat(body));
    ws['!cols'] = head.map((t, i) => ({ wch: i ? 16 : 40 }));
    XLSX.utils.book_append_sheet(wb, ws, 'So sanh');
    XLSX.writeFile(wb, `so-sanh-dtcp-${sa.report_date}-${sb.report_date}.xlsx`);
  }

  function compareStages() {
    const all = linesOf(S.snap);
    const snapSel = h('select', { id: 'stg-snap' }, S.snapshots.map(s => h('option', { value: s.id }, snapLabel(s))));
    snapSel.value = S.snap; snapSel.addEventListener('change', () => { S.snap = +snapSel.value; render(); });
    const controls = h('div', { class: 'card filters' }, h('div', { class: 'filter-grid' }, h('label', { class: 'f' }, 'Mốc dữ liệu', snapSel)));
    if (!all) return h('div', { class: 'stack' }, controls, skeleton());
    const fl = DTCP.filter(all, Object.assign({}, S.filters, { stage: '' }));
    const groups = [...DTCP.groupBy(fl, 'stage').values()].sort((a, b) => catSort('stage', a.key) - catSort('stage', b.key) || String(a.key).localeCompare(String(b.key), 'vi', { numeric: true }));
    const tot = DTCP.total(fl);
    const host1 = h('div', { class: 'chart-hb' }), host2 = h('div', { class: 'chart-hb' });
    const cats = ms => groups.map(g => ({ key: g.key, label: nameOf('stage', g.key), values: ms.map(m => g[m]), extra: [[null, T('count'), F.int(g.count)], [null, T('pct'), F.pct(g.pct)]] }));
    S.redraw = () => {
      Charts.hbars(host1, cats(['dt', 'cp']), [{ name: T('dt'), color: C[0] }, { name: T('cp'), color: C[1] }], { fmt: F.vnd, axisFmt: F.tyAxis });
      Charts.hbars(host2, cats(['pct']), [{ name: T('pct'), color: C[2] }], { fmt: F.pct, axisFmt: d3.format('.0%') });
    };
    const cols = ['count', 'hd', 'dt', 'cp', 'pct', 'tv'];
    return h('div', { class: 'stack', style: 'gap:18px' }, controls, filterBar(all, { snap: false }),
      h('div', { class: 'grid' },
        h('div', { class: 'card' }, h('h2', null, `${T('dt')} & ${lc(T('cp'))} theo ${lc(T('stage'))}`), h('div', { class: 'legend' }, h('span', null, sw(C[0]), T('dt')), h('span', null, sw(C[1]), T('cp'))), h('div', { class: 'chart-box' }, host1), h('p', { class: 'note axis-note' }, 'Trục: tỷ đồng')),
        h('div', { class: 'card' }, h('h2', null, `${T('pct')} theo ${lc(T('stage'))}`), h('div', { class: 'chart-box' }, host2)),
        h('div', { class: 'card wide' }, h('h2', null, 'Bảng so sánh'), h('p', { class: 'note' }, `Tên từng ${lc(T('stage'))} đặt ở trang Danh mục. Đơn vị: triệu đồng.`),
          h('div', { class: 'table-wrap' }, h('table', { class: 't' },
            h('thead', null, h('tr', null, h('th', null, T('stage')), cols.map(k => h('th', null, T(k))), h('th', null, 'Tỷ trọng ' + lc(T('dt'))))),
            h('tbody', null, groups.map(g => h('tr', { class: 'click', tabindex: '0', title: 'Lọc dashboard theo ' + lc(T('stage')) + ' này', onclick: () => { S.filters.stage = g.key; location.hash = '#/'; } },
              h('td', { class: 'l' }, nameOf('stage', g.key)), cols.map(k => h('td', null, k === 'count' ? F.int(g.count) : k === 'pct' ? F.pct(g.pct) : F.trieu(g[k]))),
              h('td', null, F.pct(tot.dt ? g.dt / tot.dt : NaN))))),
            h('tfoot', null, h('tr', null, h('td', { class: 'l' }, 'Tổng cộng'), cols.map(k => h('td', null, k === 'count' ? F.int(tot.count) : k === 'pct' ? F.pct(tot.pct) : F.trieu(tot[k]))), h('td', null, '100%'))))))));
  }

  // ------------------------------------------------------------------
  // Dữ liệu (admin): tải file DT-CP thành mốc mới, quản lý các mốc
  // ------------------------------------------------------------------
  let xlsxLoading = null;
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve();
    if (!xlsxLoading) xlsxLoading = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'js/vendor/xlsx.full.min.js'; s.onload = res; s.onerror = () => { xlsxLoading = null; rej(new Error('Không tải được thư viện đọc Excel.')); };
      document.head.append(s);
    });
    return xlsxLoading;
  }

  function viewData() {
    const out = h('div', { class: 'stack' });
    const file = h('input', { type: 'file', id: 'import-file', accept: '.xlsx,.xls,.xlsm' });
    file.addEventListener('change', async () => {
      const f = file.files[0];
      if (!f) return;
      out.replaceChildren(h('div', { class: 'skeleton', style: 'height:160px' }));
      try {
        await loadXLSX();
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
        // Chọn sheet có dòng tiêu đề DT-CP (thường là sheet đầu)
        let parsed = null, lastErr = null;
        for (const name of wb.SheetNames) {
          try { parsed = DTCP.parseRows(XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null })); parsed.sheet = name; break; } catch (e) { lastErr = e; }
        }
        if (!parsed) throw lastErr || new Error('Không đọc được file.');
        out.replaceChildren(importPreview(parsed, f.name));
      } catch (e) { out.replaceChildren(h('div', { class: 'alert err' }, e.message || String(e))); }
    });
    const rows = S.snapshots.map(s => {
      const date = h('input', { type: 'date', id: 'snap-date-' + s.id, value: s.report_date, 'aria-label': 'Ngày báo cáo' });
      const label = h('input', { type: 'text', id: 'snap-label-' + s.id, value: s.label || '', maxlength: 120, placeholder: 'Nhãn (tùy chọn)', 'aria-label': 'Nhãn' });
      const save = h('button', { class: 'btn sm', type: 'button' }, 'Lưu');
      save.addEventListener('click', async () => { const ok = await run(save, () => api.updateSnapshot(s.id, { report_date: date.value, label: label.value })); if (ok) { toast('Đã lưu mốc.'); await reload(); } });
      return h('tr', { class: s.id === S.snap ? 'sel' : '' }, h('td', { class: 'l' }, date), h('td', { class: 'l' }, label), h('td', { class: 'l' }, s.file_name || '–'),
        h('td', null, F.int(s.line_count)), h('td', null, new Date(s.created_at).toLocaleDateString('vi-VN')),
        h('td', { class: 'actions' }, save, h('button', { class: 'btn sm', type: 'button', onclick: () => { S.snap = s.id; location.hash = '#/'; } }, 'Xem'),
          confirmBtn('Xóa', async () => { await api.deleteSnapshot(s.id); if (S.snap === s.id) S.snap = null; toast('Đã xóa mốc ' + F.date(s.report_date) + '.'); await reload(); })));
    });
    return h('div', { class: 'stack', style: 'gap:18px' },
      h('div', null, h('h1', { class: 'page-head' }, 'Dữ liệu DT-CP'), h('p', { class: 'lead' }, 'Mỗi lần tải file "Bảng tổng hợp theo dõi doanh thu - chi phí" lên là một mốc dữ liệu. Giữ các mốc cũ để so sánh diễn biến.')),
      h('div', { class: 'card' }, h('h2', null, 'Tải file mới'),
        h('p', { class: 'note' }, 'Dùng đúng mẫu bảng tổng hợp hiện tại: dòng tiêu đề có "KÝ HIỆU DT-CP", "GIÁ TRỊ HỢP ĐỒNG", "DOANH THU THỜI ĐIỂM", "CHI PHÍ TRỰC TIẾP"… Web tự nhận công ty, khu vực, công trình, hợp đồng, phụ lục, chủ đầu tư (lấy từ số HĐ) và ngày cập nhật. Số liệu giữ nguyên đơn vị đồng như trong file.'),
        h('label', { class: 'f' }, 'File Excel (.xlsx)', file)),
      out,
      h('div', { class: 'card' }, h('h2', null, 'Các mốc dữ liệu'),
        S.snapshots.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't' },
          h('thead', null, h('tr', null, ['Ngày báo cáo', 'Nhãn', 'File', 'Số dòng', 'Ngày tải', ''].map((t, i) => h('th', { class: i < 3 ? 'l' : '' }, t)))),
          h('tbody', null, rows))) : h('p', { class: 'note' }, 'Chưa có mốc nào.')));
  }

  function importPreview(p, fileName) {
    const date = h('input', { type: 'date', id: 'imp-date', value: p.report_date || '', required: true });
    const label = h('input', { type: 'text', id: 'imp-label', maxlength: 120, placeholder: 'Ví dụ: Cập nhật tháng 6' });
    const dupWarn = h('div', { class: 'alert warn', hidden: true });
    const checkDup = () => { const s = S.snapshots.find(x => x.report_date === date.value); dupWarn.hidden = !s; dupWarn.textContent = s ? `Đã có mốc ngày ${F.date(s.report_date)}. Lưu tiếp sẽ tạo thêm một mốc cùng ngày (có thể xóa mốc cũ ở bảng bên dưới).` : ''; };
    date.addEventListener('input', checkDup); checkDup();
    const tot = DTCP.total(p.lines);
    const regions = [...DTCP.groupBy(p.lines, 'region').values()];
    const btn = h('button', { class: 'btn primary', type: 'button' }, 'Lưu mốc dữ liệu');
    btn.addEventListener('click', () => run(btn, async () => {
      if (!date.value) throw new Error('Hãy chọn ngày báo cáo.');
      const r = await api.saveSnapshot({ report_date: date.value, label: label.value.trim(), file_name: fileName, cost_labels: p.cost_labels, company_names: p.company_names, lines: p.lines });
      S.snap = r.id; S.filters = { company: '', region: '', investor: '', stage: '', project: '', q: '' };
      toast('Đã lưu mốc dữ liệu ' + F.date(date.value) + '.');
      await reload(); location.hash = '#/';
    }));
    const nInv = new Set(p.lines.map(l => l.investor).filter(Boolean)).size;
    return h('div', { class: 'card stack', id: 'xem-truoc' },
      h('h2', null, 'Kiểm tra trước khi lưu'),
      h('p', { class: 'note' }, `${fileName}${p.sheet ? ' · sheet "' + p.sheet + '"' : ''}: ${F.int(p.lines.length)} dòng số liệu, ${F.int(tot.count)} hợp đồng, ${F.int(new Set(p.lines.map(l => l.project_code)).size)} công trình, ${regions.length} khu vực, ${nInv} chủ đầu tư.`),
      h('div', { class: 'tiles' }, ['hd', 'dt', 'cp', 'pct'].map(k => h('div', { class: 'tile' }, h('span', { class: 'label' }, T(k)), h('span', { class: 'big' }, fmtM(k, tot[k]))))),
      p.warnings.length ? h('div', { class: 'alert warn stack' }, h('b', null, `${p.warnings.length} lưu ý về file:`), h('ul', { style: 'margin:0;padding-left:18px' }, p.warnings.map(w => h('li', null, w)))) : h('div', { class: 'alert ok' }, 'File đọc được đầy đủ, không có lưu ý nào.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 't' },
        h('thead', null, h('tr', null, h('th', null, T('region')), ['count', 'hd', 'dt', 'cp', 'pct'].map(k => h('th', null, T(k))))),
        h('tbody', null, regions.map(g => h('tr', null, h('td', { class: 'l' }, g.first.region_name || g.key), h('td', null, F.int(g.count)), h('td', null, F.trieu(g.hd)), h('td', null, F.trieu(g.dt)), h('td', null, F.trieu(g.cp)), h('td', null, F.pct(g.pct))))),
        h('tfoot', null, h('tr', null, h('td', { class: 'l' }, 'Tổng cộng'), h('td', null, F.int(tot.count)), h('td', null, F.trieu(tot.hd)), h('td', null, F.trieu(tot.dt)), h('td', null, F.trieu(tot.cp)), h('td', null, F.pct(tot.pct)))))),
      h('p', { class: 'note' }, 'Đơn vị bảng: triệu đồng. Đối chiếu với dòng TỔNG CỘNG trong file trước khi lưu.'),
      h('div', { class: 'form-grid' }, h('label', { class: 'f' }, 'Ngày báo cáo (lấy từ dòng "Cập nhật" trong file)', date), h('label', { class: 'f' }, 'Nhãn (tùy chọn)', label)),
      dupWarn,
      h('div', { class: 'row' }, btn));
  }

  // ------------------------------------------------------------------
  // Danh mục (admin): tên hiển thị cho mã công ty, khu vực, chủ đầu tư, thời điểm, khoản chi phí
  // ------------------------------------------------------------------
  function viewCatalog() {
    const kinds = [['company', T('company')], ['region', T('region')], ['investor', T('investor')], ['stage', T('stage')], ['cost', 'Khoản chi phí']];
    if (!S.catKind) S.catKind = 'investor';
    const tabs = h('div', { class: 'tabs', role: 'group' }, kinds.map(([k, t]) => h('button', { type: 'button', class: S.catKind === k ? 'on' : '', onclick: () => { S.catKind = k; render(); } }, t)));
    const kind = S.catKind;
    const lines = S.snap ? S.lines.get(S.snap) || [] : [];
    const usage = new Map();
    const keyOf = { company: l => l.company, region: l => l.region, investor: l => l.investor, stage: l => l.stage };
    if (keyOf[kind]) lines.forEach(l => { const k = keyOf[kind](l); if (k) { if (!usage.has(k)) usage.set(k, { n: new Set(), first: l }); usage.get(k).n.add(l.contract_code); } });
    const cat = S.catalog.get(kind) || new Map();
    const codes = kind === 'cost' ? DTCP.COST_KEYS : [...new Set([...cat.keys(), ...usage.keys()])].sort((a, b) => catSort(kind, a) - catSort(kind, b) || a.localeCompare(b, 'vi', { numeric: true }));
    const hint = {
      company: 'Mã lấy từ cột CÔNG TY (TMN, QN, TN…).', region: 'Mã là số La Mã của nhóm khu vực trong file.',
      investor: 'Mã chủ đầu tư lấy từ số hợp đồng, ví dụ "12/2026/HĐ/ABC-TMN" → ABC. Đặt tên đầy đủ để báo cáo dễ đọc.',
      stage: 'Giá trị cột "THỜI ĐIỂM" trong file (1, 2, 3, 5, HDNT…). Đặt tên cho từng thời điểm/trạng thái, ví dụ 2 → "Đang thi công".',
      cost: '15 khoản chi phí trực tiếp theo thứ tự cột trong file (K → Y). Dùng dấu " › " để tách nhóm và tên khoản, ví dụ "5. Nhân công › Công nhật".'
    }[kind];
    const rows = codes.map((code, i) => {
      const c = cat.get(code);
      const def = kind === 'cost' ? costLabel(code) : kind === 'region' && usage.get(code) ? usage.get(code).first.region_name : code;
      const name = h('input', { type: 'text', id: `cat-${kind}-${code}`, value: c ? c.name : '', placeholder: def, maxlength: 160, 'aria-label': 'Tên' });
      const sort = h('input', { type: 'number', class: 'num num-sm', id: `cat-sort-${kind}-${code}`, value: String(c ? c.sort : i + 1), 'aria-label': 'Thứ tự' });
      const save = h('button', { class: 'btn sm', type: 'button' }, 'Lưu');
      save.addEventListener('click', async () => {
        const ok = await run(save, () => api.saveCatalog(kind, code, name.value.trim() || def, +sort.value || 0));
        if (ok) { toast('Đã lưu tên cho ' + code + '.'); await reload(); }
      });
      const u = usage.get(code);
      return h('tr', null, h('td', { class: 'l' }, h('code', null, kind === 'cost' ? 'Cột ' + 'KLMNOPQRSTUVWXY'[i] : code)), h('td', null, name), h('td', null, sort),
        h('td', null, kind === 'cost' ? '' : u ? F.int(u.n.size) : '0'), h('td', { class: 'actions' }, save));
    });
    return h('div', { class: 'stack', style: 'gap:18px' },
      h('div', null, h('h1', { class: 'page-head' }, 'Danh mục'), h('p', { class: 'lead' }, 'Đặt tên hiển thị cho các mã trong file. Mã mới xuất hiện khi tải file sẽ tự được thêm vào đây với tên bằng mã.')),
      tabs,
      h('div', { class: 'card' }, h('p', { class: 'note' }, hint),
        codes.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't' },
          h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Mã'), h('th', null, 'Tên hiển thị'), h('th', null, 'Thứ tự'), h('th', null, kind === 'cost' ? '' : 'Số HĐ (mốc đang xem)'), h('th', null, ''))),
          h('tbody', null, rows))) : h('p', { class: 'note' }, 'Chưa có mã nào. Hãy tải file DT-CP ở trang Dữ liệu.')));
  }

  // ------------------------------------------------------------------
  // Tùy biến dashboard (admin): tiêu đề, tên gọi, các thẻ biểu đồ. Sửa trên bản nháp, bấm Lưu mới áp dụng.
  // ------------------------------------------------------------------
  function viewCustomize() {
    if (!S.custom) S.custom = { draft: clone(dashConfig()), editId: null };
    const D = S.custom.draft;
    if (!D.terms) D.terms = {};
    const saved = JSON.stringify(D) === JSON.stringify(dashConfig());
    const status = h('span', { class: 'chip ' + (saved ? 'viewer' : 'pending') }, saved ? 'Đã lưu' : 'Có thay đổi chưa lưu');
    const markDirty = () => { status.className = 'chip pending'; status.textContent = 'Có thay đổi chưa lưu'; };
    const saveBtn = h('button', { class: 'btn primary', type: 'button' }, 'Lưu thay đổi');
    saveBtn.addEventListener('click', async () => {
      const ok = await run(saveBtn, async () => { S.dashboard = await api.saveDashboard(D); });
      if (ok) { S.custom.draft = clone(S.dashboard); toast('Đã lưu. Mọi người sẽ thấy dashboard mới.'); render(); }
    });
    const head = h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Tùy biến dashboard'),
        h('p', { class: 'lead' }, 'Đổi tiêu đề, tên gọi và từng biểu đồ trên trang Tổng quan. Thay đổi chỉ áp dụng cho mọi người sau khi bấm "Lưu thay đổi".')),
      h('div', { class: 'row' }, status,
        h('a', { class: 'btn', href: '#/' }, 'Xem dashboard'),
        h('button', { class: 'btn', type: 'button', onclick: () => { S.custom = { draft: clone(dashConfig()), editId: null }; toast('Đã bỏ các thay đổi chưa lưu.'); render(); } }, 'Bỏ thay đổi'),
        confirmBtn('Khôi phục mặc định', async () => {
          S.dashboard = await api.resetDashboard();
          S.custom = { draft: clone(DEFAULT_DASH), editId: null };
          toast('Đã khôi phục dashboard mặc định.'); render();
        }, ''),
        saveBtn));
    const titleIn = h('input', { type: 'text', id: 'cfg-title', maxlength: 80, value: D.title || '', placeholder: DEFAULT_DASH.title });
    titleIn.addEventListener('input', () => { D.title = titleIn.value; markDirty(); });
    const pageCard = h('div', { class: 'card' }, h('h2', null, 'Tiêu đề trang'), h('label', { class: 'f' }, 'Hiện ở đầu trang Tổng quan', titleIn));
    const termsCard = h('div', { class: 'card wide', id: 'ten-goi' }, h('h2', null, 'Tên gọi'),
      h('p', { class: 'note' }, 'Đổi tên các chỉ số và nhóm dùng khắp web (dashboard, so sánh, bảng, xuất Excel). Để trống để dùng tên mặc định. Tên của từng mã (chủ đầu tư, thời điểm…) đặt ở ', h('a', { href: '#/danh-muc' }, 'trang Danh mục'), '.'),
      h('div', { class: 'form-grid' }, Object.keys(DEFAULT_TERMS).map(k => {
        const inp = h('input', { type: 'text', id: 'term-' + k, maxlength: 60, value: D.terms[k] || '', placeholder: DEFAULT_TERMS[k] });
        inp.addEventListener('input', () => { D.terms[k] = inp.value; markDirty(); });
        inp.addEventListener('change', () => render());
        return h('label', { class: 'f' }, TERM_HELP[k], inp);
      })));
    const addType = h('select', { id: 'add-type', 'aria-label': 'Loại biểu đồ mới' }, Object.entries(CARD_TYPES).map(([k, v]) => h('option', { value: k }, v)));
    const addBtn = h('button', { class: 'btn primary', type: 'button', disabled: D.cards.length >= 24 }, '+ Thêm biểu đồ');
    const toEditor = () => setTimeout(() => { const e = document.getElementById('editor-card'); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
    addBtn.addEventListener('click', () => {
      const type = addType.value;
      const c = { id: 'c' + Date.now().toString(36), type, title: '', note: '', dim: 'region', metrics: type === 'group' ? ['dt', 'cp'] : type === 'kpis' ? ['count', 'dt', 'cp', 'pct'] : [], top: 12, detail: false, width: type === 'group' || type === 'costs' ? 'half' : 'full', hidden: false };
      D.cards.push(c); S.custom.editId = c.id; render(); toEditor();
    });
    const moveBtns = (list, i) => {
      const mv = d => () => { const j = i + d; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; render(); };
      return [h('button', { class: 'btn sm', type: 'button', title: 'Lên', 'aria-label': 'Lên', disabled: i === 0, onclick: mv(-1) }, '↑'),
        h('button', { class: 'btn sm', type: 'button', title: 'Xuống', 'aria-label': 'Xuống', disabled: i === list.length - 1, onclick: mv(1) }, '↓')];
    };
    const cardRows = D.cards.map((c, i) => {
      const vis = h('input', { type: 'checkbox', id: 'vis-' + c.id, checked: !c.hidden, 'aria-label': 'Hiện biểu đồ' });
      vis.addEventListener('change', () => { c.hidden = !vis.checked; render(); });
      return h('tr', { class: S.custom.editId === c.id ? 'sel' : '' },
        h('td', { class: 'l' }, c.title || h('span', { class: 'muted' }, autoTitle(c) + ' (tự động)')), h('td', { class: 'l' }, CARD_TYPES[c.type]), h('td', { class: 'l' }, c.width === 'full' ? 'Cả hàng' : 'Nửa hàng'),
        h('td', { class: 'l' }, vis),
        h('td', { class: 'actions' }, moveBtns(D.cards, i),
          h('button', { class: 'btn sm', type: 'button', onclick: () => { S.custom.editId = c.id; render(); toEditor(); } }, 'Sửa'),
          h('button', { class: 'btn sm danger', type: 'button', onclick: () => { D.cards.splice(i, 1); if (S.custom.editId === c.id) S.custom.editId = null; render(); } }, 'Xóa')));
    });
    const listCard = h('div', { class: 'card wide' },
      h('div', { class: 'card-head' }, h('h2', null, 'Biểu đồ'), h('div', { class: 'row' }, addType, addBtn)),
      h('p', { class: 'note' }, 'Thứ tự trong bảng là thứ tự trên dashboard. Bỏ chọn "Hiện" để ẩn mà không xóa.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 't' },
        h('thead', null, h('tr', null, h('th', null, 'Tiêu đề'), h('th', { class: 'l' }, 'Loại'), h('th', { class: 'l' }, 'Độ rộng'), h('th', { class: 'l' }, 'Hiện'), h('th', null, ''))),
        h('tbody', null, cardRows.length ? cardRows : h('tr', null, h('td', { colspan: 5, class: 'muted' }, 'Chưa có biểu đồ nào.'))))));
    const editing = D.cards.find(c => c.id === S.custom.editId);
    return h('div', { class: 'stack', style: 'gap:18px' }, head, h('div', { class: 'grid' }, pageCard, termsCard, listCard, editing ? cardEditor(editing, markDirty) : null));
  }

  function cardEditor(c, markDirty) {
    const previewHost = h('div', { class: 'grid preview' });
    const drawPreview = () => {
      const all = S.snap ? S.lines.get(S.snap) : null;
      if (!all) { previewHost.replaceChildren(h('p', { class: 'note' }, 'Chưa có dữ liệu để xem trước.')); return; }
      const prev = prevSnap(S.snap), pl = prev ? S.lines.get(prev.id) : null;
      const ctx = { lines: all, tot: DTCP.total(all), ptot: pl ? DTCP.total(pl) : null, prev, draws: [], preview: true };
      previewHost.replaceChildren(renderCard(Object.assign({}, c, { width: 'full' }), ctx));
      drawAll(ctx.draws);
    };
    const title = h('input', { type: 'text', id: 'ed-title', maxlength: 120, value: c.title || '', placeholder: autoTitle(c) + ' (để trống: tự đặt)' });
    title.addEventListener('input', () => { c.title = title.value; markDirty(); drawPreview(); });
    const note = h('textarea', { id: 'ed-note', maxlength: 400, rows: 2 });
    note.value = c.note || '';
    note.addEventListener('input', () => { c.note = note.value; markDirty(); drawPreview(); });
    const type = h('select', { id: 'ed-type' }, Object.entries(CARD_TYPES).map(([k, v]) => h('option', { value: k }, v)));
    type.value = c.type;
    type.addEventListener('change', () => { c.type = type.value; if (c.type === 'group' && !c.metrics.length) c.metrics = ['dt', 'cp']; if (c.type === 'kpis' && !c.metrics.length) c.metrics = ['count', 'dt', 'cp', 'pct']; render(); });
    const width = h('select', { id: 'ed-width' }, h('option', { value: 'full' }, 'Cả hàng'), h('option', { value: 'half' }, 'Nửa hàng'));
    width.value = c.width;
    width.addEventListener('change', () => { c.width = width.value; render(); });
    const checks = (opts, single) => h('div', { class: 'check-grid' }, opts.map(k => {
      const cb = h('input', { type: 'checkbox', id: 'ed-m-' + k, checked: c.metrics.includes(k) });
      cb.addEventListener('change', () => {
        let arr = c.metrics.filter(x => x !== k);
        if (cb.checked) { arr.push(k); if (single && (k === 'pct' || k === 'count')) arr = [k]; else if (single) arr = arr.filter(x => x !== 'pct' && x !== 'count'); }
        c.metrics = METRICS.filter(x => arr.includes(x)); render();
      });
      return h('label', { class: 'check' }, cb, T(k));
    }));
    let data = null;
    if (c.type === 'kpis') data = [h('p', { class: 'section-label' }, 'Các ô chỉ số'), checks(METRICS, false), h('p', { class: 'note' }, 'Mỗi ô hiện giá trị của mốc đang xem và thay đổi so với mốc liền trước.')];
    else if (c.type === 'group') {
      const dim = h('select', { id: 'ed-dim' }, DIMS.map(k => h('option', { value: k }, T(k))));
      dim.value = c.dim; dim.addEventListener('change', () => { c.dim = dim.value; render(); });
      const top = h('input', { type: 'number', id: 'ed-top', min: 3, max: 50, value: String(c.top || 12), class: 'num num-sm' });
      top.addEventListener('change', () => { c.top = Math.max(3, Math.min(50, +top.value || 12)); render(); });
      data = [h('div', { class: 'form-grid' }, h('label', { class: 'f' }, 'Nhóm theo', dim), h('label', { class: 'f' }, 'Số nhóm hiện tối đa (còn lại gộp "Khác")', top)),
        h('p', { class: 'section-label' }, 'Dữ liệu'), checks(METRICS, true),
        h('p', { class: 'note' }, `${T('pct')} và ${lc(T('count'))} khác đơn vị với số tiền nên được vẽ riêng: chọn chúng sẽ bỏ các dữ liệu khác.`)];
    } else if (c.type === 'costs') {
      const det = h('input', { type: 'checkbox', id: 'ed-detail', checked: !!c.detail });
      det.addEventListener('change', () => { c.detail = det.checked; render(); });
      data = [h('label', { class: 'check' }, det, 'Hiện đủ 15 khoản (bỏ chọn: gộp theo 7 nhóm chi phí)')];
    } else data = [h('p', { class: 'note' }, 'Bảng luôn có: ' + [T('region'), T('project'), T('contract'), T('investor'), T('stage'), T('hd'), T('dt'), T('cp'), T('pct')].join(', ') + '.')];
    const el = h('div', { class: 'card wide stack', id: 'editor-card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Sửa biểu đồ'), h('button', { class: 'btn sm', type: 'button', onclick: () => { S.custom.editId = null; render(); } }, 'Đóng')),
      h('div', { class: 'form-grid' }, h('label', { class: 'f' }, 'Tiêu đề', title), h('label', { class: 'f' }, 'Loại', type), h('label', { class: 'f' }, 'Độ rộng', width)),
      h('label', { class: 'f' }, 'Mô tả (hiện dưới tiêu đề, để trống nếu không cần)', note),
      data,
      h('p', { class: 'section-label' }, 'Xem trước (mốc đang xem, chưa lọc)'),
      previewHost);
    S.redraw = drawPreview;
    return el;
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
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  let rt = 0, lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    clearTimeout(rt);
    rt = setTimeout(() => { if (S.redraw) S.redraw(); }, 150);
  });
  window.apiReady.then(() => { api = window.api; refreshAuth(); });
})();

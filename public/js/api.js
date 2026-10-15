// Lớp truy cập dữ liệu. Cùng một giao diện cho hai chế độ:
//  - Máy chủ: gọi API /api/* (Railway, Vercel hoặc chạy trên máy), đăng nhập bằng cookie
//  - Demo: khi không có máy chủ (ví dụ GitHub Pages), dữ liệu GIẢ lưu trong localStorage
// Số tiền tính bằng đồng.
(function () {
  // ------------------------------------------------------------------
  // Máy chủ
  // ------------------------------------------------------------------
  async function call(method, url, body) {
    let r;
    try {
      r = await fetch('api/' + url, {
        method,
        credentials: 'same-origin',
        headers: Object.assign({ 'X-App': '1' }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      throw new Error('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.');
    }
    let data = null;
    try { data = await r.json(); } catch (e) { /* không phải JSON */ }
    if (!r.ok) {
      if (r.status === 401 && url !== 'login' && url !== 'me') window.dispatchEvent(new Event('auth-expired'));
      const e = new Error((data && data.error) || `Lỗi máy chủ (${r.status}). Hãy thử lại.`);
      e.status = r.status;
      throw e;
    }
    return data;
  }

  const serverApi = {
    mode: 'server',
    me: () => call('GET', 'me'),
    setup: (username, fullName, password) => call('POST', 'setup', { username, full_name: fullName, password }),
    signIn: (username, password) => call('POST', 'login', { username, password }),
    signOut: () => call('POST', 'logout', {}),
    changePassword: (current, password) => call('POST', 'me/password', { current, password }),

    meta: () => call('GET', 'meta'),
    lines: id => call('GET', 'snapshots/' + id + '/lines'),
    saveSnapshot: payload => call('POST', 'snapshots', payload),
    updateSnapshot: (id, patch) => call('PUT', 'snapshots/' + id, patch),
    deleteSnapshot: id => call('DELETE', 'snapshots/' + id),
    contractHistory: code => call('GET', 'contracts/' + encodeURIComponent(code) + '/history'),
    addContractNote: (code, content) => call('POST', 'contract-notes', { contract_code: code, content }),
    deleteContractNote: id => call('DELETE', 'contract-notes/' + id),
    saveCatalog: (kind, code, name, sort) => call('PUT', 'catalog', { kind, code, name, sort }),
    saveDashboard: cfg => call('PUT', 'settings/dashboard', cfg).then(r => r.dashboard),
    resetDashboard: () => call('PUT', 'settings/dashboard', { reset: true }).then(r => r.dashboard),

    listUsers: () => call('GET', 'users'),
    createUser: u => call('POST', 'users', u),
    updateUser: (id, patch) => call('PUT', 'users/' + id, patch)
  };

  // ------------------------------------------------------------------
  // Demo (localStorage). Không kiểm tra mật khẩu; số liệu là số GIẢ để xem thử giao diện.
  // ------------------------------------------------------------------
  function demoApi() {
    const KEY = 'bc-dtcp-demo-v4';
    let db = load();
    function load() {
      try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch (e) { /* bỏ qua */ }
      const seed = window.DEMO_SEED ? window.DEMO_SEED() : { snapshots: [], lines: {}, catalog: [] };
      seed.users = [
        { id: 1, username: 'admin', full_name: 'Quản trị (demo)', role: 'admin', active: true, created_at: '2026-01-01T00:00:00Z' },
        { id: 2, username: 'nguoixem', full_name: 'Người xem (demo)', role: 'viewer', active: true, created_at: '2026-01-02T00:00:00Z' }
      ];
      seed.notes = [];
      seed.dashboard = null;
      seed.session = null;
      return seed;
    }
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* bỏ qua: dữ liệu lớn có thể vượt hạn mức */ } };
    const clone = x => JSON.parse(JSON.stringify(x));
    const nextId = arr => arr.reduce((m, r) => Math.max(m, +r.id || 0), 0) + 1;
    const tick = () => new Promise(r => setTimeout(r, 30));
    const me = () => db.users.find(u => u.id === db.session && u.active);
    function need(role) {
      const u = me();
      if (!u) throw new Error('Phiên đăng nhập đã hết. Hãy đăng nhập lại.');
      if (role === 'admin' && u.role !== 'admin') throw new Error('Bạn không có quyền thực hiện thao tác này.');
      return u;
    }
    const pub = u => ({ id: u.id, username: u.username, full_name: u.full_name, role: u.role });
    const catAdd = (kind, code, name) => { if (code && !db.catalog.some(c => c.kind === kind && c.code === code)) db.catalog.push({ kind, code, name: name || code, sort: 0 }); };

    return {
      mode: 'demo',
      reset() { try { localStorage.removeItem(KEY); } catch (e) { /* bỏ qua */ } db = load(); save(); },
      async me() { const u = me(); return { user: u ? pub(u) : null, needsSetup: false }; },
      async setup() { throw new Error('Chế độ demo đã có sẵn tài khoản.'); },
      async signIn(username) {
        await tick();
        const u = db.users.find(x => x.username.toLowerCase() === String(username).trim().toLowerCase());
        if (!u) throw new Error('Tên đăng nhập hoặc mật khẩu không đúng.');
        if (!u.active) throw new Error('Tài khoản đã bị khóa. Hãy liên hệ admin.');
        db.session = u.id; save();
      },
      async signOut() { db.session = null; save(); },
      async changePassword() { need(); await tick(); },

      async meta() {
        need();
        const snaps = db.snapshots.slice().sort((a, b) => (a.report_date < b.report_date ? 1 : a.report_date > b.report_date ? -1 : b.id - a.id));
        return { snapshots: clone(snaps), catalog: clone(db.catalog), dashboard: db.dashboard ? clone(db.dashboard) : null };
      },
      async lines(id) { need(); await tick(); return clone(db.lines[id] || []); },
      async saveSnapshot(p) {
        need('admin'); await tick();
        const id = nextId(db.snapshots);
        db.snapshots.push({ id, report_date: p.report_date, label: p.label || '', file_name: p.file_name || '', cost_labels: p.cost_labels || {}, line_count: p.lines.length, created_at: new Date().toISOString() });
        db.lines[id] = p.lines.map((l, i) => Object.assign({ seq: i + 1 }, l));
        p.lines.forEach(l => {
          catAdd('company', l.company, (p.company_names || {})[l.company]); catAdd('region', l.region, l.region_name);
          catAdd('investor', l.investor); catAdd('stage', l.stage, /^\d+$/.test(l.stage) ? 'Giai đoạn ' + l.stage : l.stage);
        });
        save();
        return { id };
      },
      async updateSnapshot(id, patch) { need('admin'); Object.assign(db.snapshots.find(s => s.id === id), { report_date: patch.report_date, label: patch.label || '' }); save(); },
      async deleteSnapshot(id) { need('admin'); db.snapshots = db.snapshots.filter(s => s.id !== id); delete db.lines[id]; save(); },
      async contractHistory(code) {
        need();
        const cpKeys = DTCP.COST_KEYS;
        const history = db.snapshots.slice().sort((a, b) => (a.report_date < b.report_date ? -1 : 1)).map(s => {
          const ls = (db.lines[s.id] || []).filter(l => l.contract_code === code);
          if (!ls.length) return null;
          const sum = k => ls.reduce((t, l) => t + (l.vals[k] || 0), 0);
          return { snapshot_id: s.id, report_date: s.report_date, label: s.label, stage: ls[0].stage, hd: sum('hd'), sl: sum('sl'), slhs: sum('slhs'), tv: sum('tv'), dt: sum('dt'), cp: cpKeys.reduce((t, k) => t + sum(k), 0) };
        }).filter(Boolean);
        return { history, notes: clone(db.notes.filter(n => n.contract_code === code).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))) };
      },
      async addContractNote(code, content) {
        const u = need();
        db.notes.push({ id: nextId(db.notes), contract_code: code, content, author_id: u.id, author_name: u.full_name || u.username, created_at: new Date().toISOString() });
        save();
      },
      async deleteContractNote(id) {
        const u = need();
        const n = db.notes.find(x => x.id === id);
        if (n && n.author_id !== u.id && u.role !== 'admin') throw new Error('Bạn chỉ xóa được ghi chú của mình.');
        db.notes = db.notes.filter(x => x.id !== id); save();
      },
      async saveCatalog(kind, code, name, sort) {
        need('admin');
        const c = db.catalog.find(x => x.kind === kind && x.code === code);
        if (c) Object.assign(c, { name, sort: sort || 0 }); else db.catalog.push({ kind, code, name, sort: sort || 0 });
        save();
      },
      async saveDashboard(cfg) { need('admin'); await tick(); db.dashboard = clone(cfg); save(); return clone(cfg); },
      async resetDashboard() { need('admin'); db.dashboard = null; save(); return null; },

      async listUsers() { need('admin'); return clone(db.users); },
      async createUser(u) {
        need('admin');
        const name = String(u.username || '').trim();
        if (name.length < 3) throw new Error('Tên đăng nhập cần từ 3 đến 64 ký tự.');
        if (!u.password || u.password.length < 8) throw new Error('Mật khẩu cần ít nhất 8 ký tự.');
        if (db.users.some(x => x.username.toLowerCase() === name.toLowerCase())) throw new Error('Tên đăng nhập này đã có.');
        db.users.push({ id: nextId(db.users), username: name, full_name: u.full_name || '', role: u.role === 'admin' ? 'admin' : 'viewer', active: true, created_at: new Date().toISOString() });
        save();
      },
      async updateUser(id, p) {
        const meU = need('admin');
        if (id === meU.id && ((p.role && p.role !== 'admin') || p.active === false)) throw new Error('Bạn không thể tự hạ quyền hoặc tự khóa tài khoản của mình.');
        if (p.password != null && p.password.length < 8) throw new Error('Mật khẩu cần ít nhất 8 ký tự.');
        const u = db.users.find(x => x.id === id);
        const next = Object.assign({}, u, p.role ? { role: p.role } : {}, p.active != null ? { active: !!p.active } : {}, p.full_name != null ? { full_name: p.full_name } : {});
        const admins = db.users.map(x => (x.id === id ? next : x)).filter(x => x.role === 'admin' && x.active).length;
        if (admins < 1) throw new Error('Phải còn ít nhất một admin đang hoạt động.');
        Object.assign(u, next); save();
      }
    };
  }

  // Chọn chế độ: có máy chủ trả lời /api/health thì dùng máy chủ, không thì dùng demo.
  window.apiReady = (async () => {
    try {
      const r = await fetch('api/health', { cache: 'no-store' });
      const d = r.ok ? await r.json() : null;
      if (d && d.ok) { window.api = serverApi; return; }
    } catch (e) { /* không có máy chủ */ }
    window.api = demoApi();
  })();
})();

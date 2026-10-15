// Lớp truy cập dữ liệu. Cùng một giao diện cho hai chế độ:
//  - Máy chủ: gọi API /api/* (Railway, Vercel hoặc chạy trên máy), đăng nhập bằng cookie
//  - Demo: khi không có máy chủ (ví dụ GitHub Pages), dữ liệu mẫu lưu trong localStorage
// Tháng luôn ở dạng 'YYYY-MM-01'; số tiền tính bằng triệu đồng.
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

    loadData: () => call('GET', 'data'),
    saveChannel: c => (c.id ? call('PUT', 'channels/' + c.id, c) : call('POST', 'channels', c)),
    deleteChannel: id => call('DELETE', 'channels/' + id),
    saveCategory: c => (c.id ? call('PUT', 'categories/' + c.id, c) : call('POST', 'categories', c)),
    deleteCategory: id => call('DELETE', 'categories/' + id),
    saveMonth: (month, revenues, expenses) => call('PUT', 'months/' + month, { revenues, expenses }),
    deleteMonth: month => call('DELETE', 'months/' + month),
    addNote: (month, content) => call('POST', 'notes', { month, content }),
    deleteNote: id => call('DELETE', 'notes/' + id),

    listUsers: () => call('GET', 'users'),
    createUser: u => call('POST', 'users', u),
    updateUser: (id, patch) => call('PUT', 'users/' + id, patch)
  };

  // ------------------------------------------------------------------
  // Demo (localStorage). Không kiểm tra mật khẩu: chỉ để xem thử giao diện.
  // ------------------------------------------------------------------
  function demoApi() {
    const KEY = 'bc-dtcp-demo-v2';
    let db = load();
    function load() {
      try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch (e) { /* bỏ qua */ }
      const seed = JSON.parse(JSON.stringify(window.DEMO_SEED || { channels: [], categories: [], revenue: [], expenses: [], notes: [] }));
      seed.users = [
        { id: 1, username: 'admin', full_name: 'Quản trị (demo)', role: 'admin', active: true, created_at: '2026-01-01T00:00:00Z' },
        { id: 2, username: 'nguoixem', full_name: 'Người xem (demo)', role: 'viewer', active: true, created_at: '2026-01-02T00:00:00Z' }
      ];
      seed.notes.forEach(n => { n.author_id = 1; });
      seed.session = null;
      return seed;
    }
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* bỏ qua */ } };
    const clone = x => JSON.parse(JSON.stringify(x));
    const nextId = arr => arr.reduce((m, r) => Math.max(m, +r.id || 0), 0) + 1;
    const tick = () => new Promise(r => setTimeout(r, 40));
    const me = () => db.users.find(u => u.id === db.session && u.active);
    function need(role) {
      const u = me();
      if (!u) throw new Error('Phiên đăng nhập đã hết. Hãy đăng nhập lại.');
      if (role === 'admin' && u.role !== 'admin') throw new Error('Bạn không có quyền thực hiện thao tác này.');
      return u;
    }
    function saveCat(list, c) {
      const name = String(c.name || '').trim();
      if (!name) throw new Error('Tên cần từ 1 đến 100 ký tự.');
      if (list.some(x => x.name.toLowerCase() === name.toLowerCase() && x.id !== c.id)) throw new Error('Tên này đã tồn tại.');
      if (c.id) Object.assign(list.find(x => x.id === c.id), { name, sort_order: c.sort_order || 0, active: c.active !== false });
      else list.push({ id: nextId(list), name, sort_order: c.sort_order || 0, active: c.active !== false });
      save();
    }
    const upsert = (arr, key, month, rows) => rows.forEach(r => {
      const e = arr.find(x => x.month === month && x[key] === r[key]);
      if (e) e.amount = r.amount; else arr.push({ month, [key]: r[key], amount: r.amount });
    });
    const pub = u => ({ id: u.id, username: u.username, full_name: u.full_name, role: u.role });

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

      async loadData() {
        need();
        const sort = l => clone(l).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
        return { channels: sort(db.channels), categories: sort(db.categories), revenue: clone(db.revenue), expenses: clone(db.expenses), notes: clone(db.notes) };
      },
      async saveChannel(c) { need('admin'); saveCat(db.channels, c); },
      async deleteChannel(id) {
        need('admin');
        if (db.revenue.some(r => r.channel_id === id)) throw new Error('Mục này đang có số liệu nên không xóa được. Hãy bỏ chọn "Đang dùng" để ẩn thay vì xóa.');
        db.channels = db.channels.filter(x => x.id !== id); save();
      },
      async saveCategory(c) { need('admin'); saveCat(db.categories, c); },
      async deleteCategory(id) {
        need('admin');
        if (db.expenses.some(r => r.category_id === id)) throw new Error('Mục này đang có số liệu nên không xóa được. Hãy bỏ chọn "Đang dùng" để ẩn thay vì xóa.');
        db.categories = db.categories.filter(x => x.id !== id); save();
      },
      async saveMonth(month, revenues, expenses) {
        need('admin'); await tick();
        upsert(db.revenue, 'channel_id', month, revenues);
        upsert(db.expenses, 'category_id', month, expenses);
        save();
      },
      async deleteMonth(month) {
        need('admin');
        db.revenue = db.revenue.filter(r => r.month !== month);
        db.expenses = db.expenses.filter(r => r.month !== month);
        save();
      },
      async addNote(month, content) {
        const u = need();
        db.notes.push({ id: nextId(db.notes), month, content, author_id: u.id, author_name: u.full_name || u.username, created_at: new Date().toISOString() });
        save();
      },
      async deleteNote(id) {
        const u = need();
        const n = db.notes.find(x => x.id === id);
        if (n && n.author_id !== u.id && u.role !== 'admin') throw new Error('Bạn chỉ xóa được ghi chú của mình.');
        db.notes = db.notes.filter(x => x.id !== id); save();
      },

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

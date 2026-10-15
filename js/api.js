// Lớp truy cập dữ liệu. Cùng một giao diện cho hai chế độ:
//  - Supabase: đăng nhập thật, dữ liệu dùng chung, phân quyền bằng RLS (xem supabase/schema.sql)
//  - Demo: không cần máy chủ, dữ liệu lưu trong localStorage của trình duyệt này
// Tháng luôn ở dạng 'YYYY-MM-01'; số tiền tính bằng triệu đồng.
(function () {
  const cfg = window.APP_CONFIG || {};
  const useSupabase = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

  // ------------------------------------------------------------------
  // Supabase
  // ------------------------------------------------------------------
  function supabaseApi() {
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const ok = ({ data, error }) => { if (error) throw toError(error); return data; };
    const redirect = () => location.origin + location.pathname;

    async function all(table, select, order) {
      const out = [];
      for (let from = 0; ; from += 1000) {
        let q = sb.from(table).select(select).range(from, from + 999);
        (order || []).forEach(o => { q = q.order(o); });
        const rows = ok(await q);
        out.push(...rows);
        if (rows.length < 1000) return out;
      }
    }

    return {
      mode: 'supabase',
      async getUser() { const { data } = await sb.auth.getSession(); return data.session ? data.session.user : null; },
      onAuthChange(cb) { sb.auth.onAuthStateChange((event, session) => cb(event, session ? session.user : null)); },
      async signIn(email, password) { ok(await sb.auth.signInWithPassword({ email, password })); },
      async signUp(email, password, fullName) {
        const d = ok(await sb.auth.signUp({ email, password, options: { data: { full_name: fullName }, emailRedirectTo: redirect() } }));
        return { needsConfirm: !d.session };
      },
      async signOut() { await sb.auth.signOut(); },
      async resetPassword(email) { ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect() })); },
      async updatePassword(password) { ok(await sb.auth.updateUser({ password })); },

      async getProfile() {
        const u = await this.getUser();
        if (!u) return null;
        const rows = ok(await sb.from('profiles').select('*').eq('id', u.id));
        return rows[0] || { id: u.id, email: u.email, full_name: '', role: 'pending' };
      },
      async listUsers() { return ok(await sb.from('profiles').select('*').order('created_at')); },
      async setRole(id, role) { ok(await sb.from('profiles').update({ role }).eq('id', id)); },
      async deleteUserProfile(id) { ok(await sb.from('profiles').delete().eq('id', id)); },

      async listChannels() { return all('channels', '*', ['sort_order', 'id']); },
      async saveChannel(c) { await saveCat('channels', c); },
      async deleteChannel(id) { ok(await sb.from('channels').delete().eq('id', id)); },
      async listCategories() { return all('expense_categories', '*', ['sort_order', 'id']); },
      async saveCategory(c) { await saveCat('expense_categories', c); },
      async deleteCategory(id) { ok(await sb.from('expense_categories').delete().eq('id', id)); },

      async listRevenue() { return all('revenue_entries', 'month,channel_id,amount', ['month', 'channel_id']); },
      async listExpenses() { return all('expense_entries', 'month,category_id,amount', ['month', 'category_id']); },
      async saveMonth(month, revenues, expenses) {
        if (revenues.length) ok(await sb.from('revenue_entries').upsert(revenues.map(r => ({ month, channel_id: r.channel_id, amount: r.amount, updated_at: new Date().toISOString() }))));
        if (expenses.length) ok(await sb.from('expense_entries').upsert(expenses.map(r => ({ month, category_id: r.category_id, amount: r.amount, updated_at: new Date().toISOString() }))));
      },
      async deleteMonth(month) {
        ok(await sb.from('revenue_entries').delete().eq('month', month));
        ok(await sb.from('expense_entries').delete().eq('month', month));
      },

      async listNotes() { return all('month_notes', '*', ['created_at']); },
      async addNote(month, content, authorName) { ok(await sb.from('month_notes').insert({ month, content, author_name: authorName })); },
      async deleteNote(id) { ok(await sb.from('month_notes').delete().eq('id', id)); }
    };

    async function saveCat(table, c) {
      const row = { name: c.name.trim(), sort_order: c.sort_order || 0, active: c.active !== false };
      if (c.id) ok(await sb.from(table).update(row).eq('id', c.id));
      else ok(await sb.from(table).insert(row));
    }
  }

  // Thông báo lỗi dễ hiểu cho các lỗi thường gặp.
  function toError(e) {
    const m = (e && (e.message || e.error_description)) || String(e);
    const map = [
      [/Invalid login credentials/i, 'Email hoặc mật khẩu không đúng.'],
      [/Email not confirmed/i, 'Email chưa được xác nhận. Hãy mở thư xác nhận trong hộp thư của bạn.'],
      [/User already registered/i, 'Email này đã có tài khoản. Hãy đăng nhập hoặc dùng "Quên mật khẩu".'],
      [/Password should be at least/i, 'Mật khẩu cần ít nhất 6 ký tự.'],
      [/violates foreign key constraint/i, 'Mục này đang có số liệu nên không xóa được. Hãy chuyển sang "Ẩn" thay vì xóa.'],
      [/duplicate key value.*name/i, 'Tên này đã tồn tại.'],
      [/row-level security/i, 'Bạn không có quyền thực hiện thao tác này.'],
      [/Phải còn ít nhất một admin/i, 'Phải còn ít nhất một admin.'],
      [/rate limit/i, 'Thao tác quá nhiều lần. Hãy đợi vài phút rồi thử lại.'],
      [/Failed to fetch/i, 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.']
    ];
    for (const [re, vi] of map) if (re.test(m)) return new Error(vi);
    return new Error(m);
  }

  // ------------------------------------------------------------------
  // Demo (localStorage)
  // ------------------------------------------------------------------
  function demoApi() {
    const KEY = 'bc-dtcp-demo-v1';
    const listeners = [];
    let db = load();

    function load() {
      try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch (e) { /* bỏ qua */ }
      const seed = JSON.parse(JSON.stringify(window.DEMO_SEED || { channels: [], categories: [], revenue: [], expenses: [], notes: [] }));
      seed.users = [{ id: 'demo-admin', email: 'admin@demo.vn', full_name: 'Quản trị (demo)', role: 'admin', created_at: '2026-01-01T00:00:00Z' },
        { id: 'demo-viewer', email: 'xem@demo.vn', full_name: 'Người xem (demo)', role: 'viewer', created_at: '2026-01-02T00:00:00Z' }];
      seed.session = null;
      return seed;
    }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* bỏ qua */ } }
    const nextId = arr => arr.reduce((m, r) => Math.max(m, +r.id || 0), 0) + 1;
    const clone = x => JSON.parse(JSON.stringify(x));
    const tick = () => new Promise(r => setTimeout(r, 60));
    const me = () => db.users.find(u => u.id === db.session);
    function need(role) {
      const u = me();
      if (!u) throw new Error('Bạn cần đăng nhập.');
      if (role === 'admin' && u.role !== 'admin') throw new Error('Bạn không có quyền thực hiện thao tác này.');
      if (role === 'member' && !['admin', 'viewer'].includes(u.role)) throw new Error('Tài khoản đang chờ admin duyệt.');
    }
    function emit(ev) { const u = me(); listeners.forEach(cb => cb(ev, u ? { id: u.id, email: u.email } : null)); }
    function saveCat(list, c) {
      const name = c.name.trim();
      if (!name) throw new Error('Tên không được để trống.');
      if (list.some(x => x.name.toLowerCase() === name.toLowerCase() && x.id !== c.id)) throw new Error('Tên này đã tồn tại.');
      if (c.id) Object.assign(list.find(x => x.id === c.id), { name, sort_order: c.sort_order || 0, active: c.active !== false });
      else list.push({ id: nextId(list), name, sort_order: c.sort_order || 0, active: c.active !== false });
      save();
    }

    return {
      mode: 'demo',
      reset() { try { localStorage.removeItem(KEY); } catch (e) { /* bỏ qua */ } db = load(); save(); emit('SIGNED_OUT'); },
      async getUser() { const u = me(); return u ? { id: u.id, email: u.email } : null; },
      onAuthChange(cb) { listeners.push(cb); },
      async signIn(email, password) {
        await tick();
        const u = db.users.find(x => x.email.toLowerCase() === String(email).trim().toLowerCase());
        if (!u || !password) throw new Error('Email hoặc mật khẩu không đúng.');
        db.session = u.id; save(); emit('SIGNED_IN');
      },
      async signUp(email, password, fullName) {
        await tick();
        email = String(email).trim();
        if (db.users.some(x => x.email.toLowerCase() === email.toLowerCase())) throw new Error('Email này đã có tài khoản. Hãy đăng nhập.');
        if (!password || password.length < 6) throw new Error('Mật khẩu cần ít nhất 6 ký tự.');
        const u = { id: 'demo-' + Date.now(), email, full_name: fullName || '', role: 'pending', created_at: new Date().toISOString() };
        db.users.push(u); db.session = u.id; save(); emit('SIGNED_IN');
        return { needsConfirm: false };
      },
      async signOut() { db.session = null; save(); emit('SIGNED_OUT'); },
      async resetPassword() { await tick(); },
      async updatePassword() { await tick(); },

      async getProfile() { const u = me(); return u ? clone(u) : null; },
      async listUsers() { need('admin'); return clone(db.users); },
      async setRole(id, role) {
        need('admin');
        const u = db.users.find(x => x.id === id);
        if (u.role === 'admin' && role !== 'admin' && db.users.filter(x => x.role === 'admin').length <= 1) throw new Error('Phải còn ít nhất một admin.');
        u.role = role; save();
      },
      async deleteUserProfile(id) { need('admin'); db.users = db.users.filter(x => x.id !== id); save(); },

      async listChannels() { need('member'); return clone(db.channels).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id); },
      async saveChannel(c) { need('admin'); saveCat(db.channels, c); },
      async deleteChannel(id) {
        need('admin');
        if (db.revenue.some(r => r.channel_id === id)) throw new Error('Mục này đang có số liệu nên không xóa được. Hãy chuyển sang "Ẩn" thay vì xóa.');
        db.channels = db.channels.filter(x => x.id !== id); save();
      },
      async listCategories() { need('member'); return clone(db.categories).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id); },
      async saveCategory(c) { need('admin'); saveCat(db.categories, c); },
      async deleteCategory(id) {
        need('admin');
        if (db.expenses.some(r => r.category_id === id)) throw new Error('Mục này đang có số liệu nên không xóa được. Hãy chuyển sang "Ẩn" thay vì xóa.');
        db.categories = db.categories.filter(x => x.id !== id); save();
      },

      async listRevenue() { need('member'); return clone(db.revenue); },
      async listExpenses() { need('member'); return clone(db.expenses); },
      async saveMonth(month, revenues, expenses) {
        need('admin'); await tick();
        revenues.forEach(r => {
          const e = db.revenue.find(x => x.month === month && x.channel_id === r.channel_id);
          if (e) e.amount = r.amount; else db.revenue.push({ month, channel_id: r.channel_id, amount: r.amount });
        });
        expenses.forEach(r => {
          const e = db.expenses.find(x => x.month === month && x.category_id === r.category_id);
          if (e) e.amount = r.amount; else db.expenses.push({ month, category_id: r.category_id, amount: r.amount });
        });
        save();
      },
      async deleteMonth(month) {
        need('admin');
        db.revenue = db.revenue.filter(r => r.month !== month);
        db.expenses = db.expenses.filter(r => r.month !== month);
        save();
      },

      async listNotes() { need('member'); return clone(db.notes); },
      async addNote(month, content, authorName) {
        need('member');
        db.notes.push({ id: nextId(db.notes), month, content, author_id: db.session, author_name: authorName, created_at: new Date().toISOString() });
        save();
      },
      async deleteNote(id) {
        need('member');
        const n = db.notes.find(x => x.id === id), u = me();
        if (n && n.author_id !== u.id && u.role !== 'admin') throw new Error('Bạn chỉ xóa được ghi chú của mình.');
        db.notes = db.notes.filter(x => x.id !== id); save();
      }
    };
  }

  window.api = useSupabase ? supabaseApi() : demoApi();
})();

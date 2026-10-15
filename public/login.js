(async () => {
  try {
    const meta = await api('/api/meta');
    if (meta.needs_setup) return (location.href = '/setup');
    $('#sys-name').textContent = meta.ten_he_thong;
    $('#company').textContent = meta.ten_cong_ty;
    document.title = 'Đăng nhập – ' + meta.ten_he_thong;
    dbWarning(meta);
  } catch { /* vẫn cho đăng nhập */ }
})();

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('button[type=submit]', e.target);
  btn.disabled = true;
  try {
    await api('/api/auth/login', { method: 'POST', body: JSON.stringify(formData(e.target)) });
    location.href = '/';
  } catch (err) {
    showMsg($('#msg'), err.message, 'err');
    e.target.password.value = '';
    e.target.password.focus();
  } finally {
    btn.disabled = false;
  }
});

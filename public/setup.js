(async () => {
  try {
    const meta = await api('/api/meta');
    if (!meta.needs_setup) return (location.href = '/login');
    if (meta.setup_token_required) {
      $('#token-box').hidden = false;
      $('[name=setup_token]').required = true;
    }
    dbWarning(meta);
  } catch (err) {
    showMsg($('#msg'), err.message, 'err');
  }
})();

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = formData(e.target);
  if (data.password !== data.password2) return showMsg($('#msg'), 'Mật khẩu nhập lại không khớp', 'err');
  delete data.password2;
  const btn = $('button[type=submit]', e.target);
  btn.disabled = true;
  try {
    await api('/api/setup', { method: 'POST', body: JSON.stringify(data) });
    location.href = '/';
  } catch (err) {
    showMsg($('#msg'), err.message, 'err');
  } finally {
    btn.disabled = false;
  }
});

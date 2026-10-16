// Tester hệ thống: đọc dữ liệu thô qua API, tự tính lại ĐỘC LẬP và đối chiếu với Dashboard / tab Doanh thu / tab Chi phí
// Chạy: node scripts/tester.js <URL> <tên đăng nhập> <mật khẩu> [--demo]   (--demo: chỉ kiểm tra dự án DEMO-...)
// Ví dụ: node scripts/tester.js https://project-profit-bks-tmn-production.up.railway.app admin 'MatKhau@123'
const [URL_, USER, PASS] = process.argv.slice(2);
const ONLY_DEMO = process.argv.includes('--demo');
if (!URL_ || !USER || !PASS) {
  console.log('Cách dùng: node scripts/tester.js <URL> <tên đăng nhập> <mật khẩu> [--demo]');
  process.exit(2);
}
const BASE = URL_.replace(/\/$/, '');
let cookie = '';
const timing = {};
async function api(method, url, body) {
  const t0 = Date.now();
  const r = await fetch(BASE + url, {
    method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const key = url.replace(/\d+/g, ':id');
  (timing[key] ||= []).push(Date.now() - t0);
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${j?.error || ''}`);
  return j;
}

// ---- Công thức tự viết lại (không dùng code máy chủ) ----
const vatOf = (gt, vat) => {
  if (!vat) return 0;
  const g = BigInt(gt) * BigInt(vat);
  return Number((g + (g < 0n ? -50n : 50n)) / 100n);
};
const sv = (gt, vat) => gt + vatOf(gt, vat);
const fmt = (n) => new Intl.NumberFormat('vi-VN').format(n);

let pass = 0, fail = 0;
const fails = [];
const warns = [];
function check(cond, what, detail = '') {
  if (cond) pass++;
  else { fail++; fails.push(`${what}${detail ? ' — ' + detail : ''}`); }
}

(async () => {
  console.log(`Tester: ${BASE}`);
  await api('POST', '/api/auth/login', { username: USER, password: PASS });
  const all = await api('GET', '/api/du-an');
  const projects = ONLY_DEMO ? all.filter((p) => p.ma_du_an.startsWith('DEMO-')) : all;
  const dash = new Map((await api('GET', '/api/dashboard')).du_an.map((d) => [d.id, d]));
  const rows = [];

  for (const p of projects) {
    const tag = p.ma_du_an;
    const rv = await api('GET', `/api/du-an/${p.id}/doanh-thu`);
    const cp = await api('GET', `/api/du-an/${p.id}/chi-phi`);
    const d = dash.get(p.id);
    check(Boolean(d), `${tag}: có trong Dashboard`);
    if (!d) continue;

    // ---------- DOANH THU ----------
    const hd = rv.items.filter((r) => r.loai === 'hd');
    const qt = rv.items.filter((r) => r.loai === 'qt');
    const masters = hd.filter((r) => r.ma_loai === 'HĐ');
    // Dự kiến: HĐ đã quyết toán -> HT/QT, chưa -> HĐ + PL;  Thực hiện: tổng HT/QT
    const noAccent = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
    let dtGt = 0, dtSv = 0, dtUndated = 0, thGt = 0, thSv = 0, thUndated = 0;
    const used = new Set();
    for (const m of masters) {
      const group = hd.filter((r) => String(r.so_ma).toLowerCase() === String(m.so_ma).toLowerCase());
      const q = qt.filter((r) => r.hd_id === m.id);
      q.forEach((r) => used.add(r.id));
      const daQt = rv.tien_ve.some((t) => t.hd_id === m.id && t.loai === 'quyet_toan') || q.some((r) => noAccent(r.so_hieu).includes('quyet toan'));
      for (const r of daQt && q.length ? q : group) {
        dtGt += r.gia_tri; dtSv += sv(r.gia_tri, r.vat);
        if (!r.ngay) dtUndated += r.gia_tri;
      }
      for (const r of q) {
        thGt += r.gia_tri; thSv += sv(r.gia_tri, r.vat);
        if (!r.ngay) thUndated += r.gia_tri;
      }
      // HĐ: tiền về không vượt giá trị (sau VAT) – cảnh báo nghiệp vụ
      const base = (daQt && q.length ? q : group).reduce((s, r) => s + sv(r.gia_tri, r.vat), 0);
      const tv = rv.tien_ve.filter((t) => t.hd_id === m.id).reduce((s, t) => s + t.so_tien, 0);
      if (tv > base) warns.push(`${tag} / HĐ ${m.so_ma}: tiền về ${fmt(tv)} > giá trị ${fmt(base)}`);
      if (!m.vat) warns.push(`${tag} / HĐ ${m.so_ma}: VAT 0% (tạm tính)`);
    }
    const orphanPl = hd.filter((r) => r.ma_loai !== 'HĐ' && !masters.some((m) => String(m.so_ma).toLowerCase() === String(r.so_ma).toLowerCase()));
    check(orphanPl.length === 0, `${tag}: mọi PL có HĐ gốc`, orphanPl.map((r) => r.so_hieu).join(', '));
    check(qt.every((r) => used.has(r.id)), `${tag}: mọi dòng HT/QT gắn với HĐ gốc`);
    // Mỗi dòng: Sau VAT = Giá trị + VAT (tab Doanh thu)
    check(rv.items.every((r) => r.sau_vat === sv(r.gia_tri, r.vat)), `${tag}: công thức Sau VAT từng dòng Doanh thu`);
    check(rv.tong.hd.sau_vat === hd.reduce((s, r) => s + sv(r.gia_tri, r.vat), 0), `${tag}: tổng HĐ/PL tab Doanh thu`);
    check(rv.tong.qt.sau_vat === qt.reduce((s, r) => s + sv(r.gia_tri, r.vat), 0), `${tag}: tổng HT/QT tab Doanh thu`);
    const tvSum = rv.tien_ve.reduce((s, t) => s + t.so_tien, 0);
    check(rv.tong_tien_ve.tong === tvSum, `${tag}: tổng tiền về tab Doanh thu`);
    check(rv.tien_ve.every((t) => t.hd_id && masters.some((m) => m.id === t.hd_id)), `${tag}: mọi dòng tiền về gắn với HĐ gốc`);

    // ---------- THẦU PHỤ ----------
    let tpGt = 0, tpSv = 0, khoaN = 0, tpUndatedN = 0, tpThSv = 0, tpThGt = 0;
    for (const c of cp.thau_phu) {
      const lines = c.lines;
      const hdSv = lines.reduce((s, l) => s + sv(l.gia_tri, l.vat), 0);
      const hdVat = lines.reduce((s, l) => s + vatOf(l.gia_tri, l.vat), 0);
      const daTt = c.pays.reduce((s, x) => s + x.so_tien, 0);
      const khoa = c.pays.some((x) => x.loai === 'quyet_toan');
      let qSv = lines.reduce((s, l) => s + sv(l.gia_tri_qt ?? l.gia_tri, l.vat), 0);
      let qGt = lines.reduce((s, l) => s + (l.gia_tri_qt ?? l.gia_tri), 0);
      if (khoa) { qSv = daTt; qGt = hdSv ? Math.round(daTt - (daTt * hdVat) / hdSv) : daTt; khoaN++; }
      const t = `${tag} / ${c.so_ma}`;
      check(c.hd_sau_vat === hdSv, `${t}: tổng giá trị HĐ/PL`, `${c.hd_sau_vat} ≠ ${hdSv}`);
      check(c.da_tt === daTt, `${t}: tổng đã thanh toán`);
      check(c.khoa === khoa, `${t}: trạng thái khóa sổ`);
      check(c.qt_sau_vat === qSv, `${t}: HT/QT sau VAT`, `${c.qt_sau_vat} ≠ ${qSv}`);
      check(Math.abs(c.qt_gia_tri - qGt) <= 1, `${t}: HT/QT trước VAT (sai số làm tròn ≤ 1đ)`, `${c.qt_gia_tri} ≠ ${qGt}`);
      check(c.con_lai === qSv - daTt, `${t}: Còn lại = HT/QT − Đã TT`);
      if (khoa) check(c.con_lai === 0, `${t}: đã quyết toán thì Còn lại = 0`);
      if (daTt > qSv) warns.push(`${t}: thanh toán ${fmt(daTt)} vượt HT/QT ${fmt(qSv)}`);
      tpGt += c.qt_gia_tri; tpSv += qSv;
      // Thực hiện: đã QT -> giá trị chốt; chưa -> thanh toán đợt (bỏ tạm ứng), trước VAT tách theo tỷ lệ VAT của HĐ
      if (khoa) { tpThSv += qSv; tpThGt += c.qt_gia_tri; }
      else for (const x of c.pays) if (x.loai !== 'tam_ung') { tpThSv += x.so_tien; tpThGt += x.so_tien - (hdSv ? Math.round((x.so_tien * hdVat) / hdSv) : 0); }
      if (khoa ? !c.pays.some((x) => x.loai === 'quyet_toan' && x.ngay) : lines.some((l) => !l.ngay)) tpUndatedN++;
    }

    // ---------- CHI PHÍ ----------
    const isGoc = (r) => r.nhom === 'tc_tra_no' && r.nhom_con === 'goc';
    const other = cp.items.filter((r) => !isGoc(r));
    const goc = cp.items.filter(isGoc);
    const cpGt = other.reduce((s, r) => s + r.gia_tri, 0) + tpGt;
    const cpSv = other.reduce((s, r) => s + sv(r.gia_tri, r.vat), 0) + tpSv;
    check(cp.tong.sau_vat === cpSv, `${tag}: tổng chi phí tab Chi phí (sau VAT, không gồm trả gốc)`, `${cp.tong.sau_vat} ≠ ${cpSv}`);
    check(cp.tong.ngoai_cp.sau_vat === goc.reduce((s, r) => s + r.sau_vat, 0), `${tag}: trả nợ gốc tách riêng`);
    const khoi = cp.tong.theo_khoi;
    check(khoi.B1.sau_vat + khoi.B2.sau_vat + khoi.B3.sau_vat === cp.tong.sau_vat, `${tag}: Trực tiếp + Gián tiếp + Tài chính = Tổng`);
    const nhomSum = Object.values(cp.tong.theo_nhom).reduce((s, g) => s + g.sau_vat, 0);
    check(nhomSum === cp.tong.sau_vat, `${tag}: tổng các nhóm = Tổng chi phí`);

    // ---------- DASHBOARD ----------
    const K = d.du_kien, H = d.thuc_hien;
    const otherGt = other.reduce((s, r) => s + r.gia_tri, 0), otherSv = other.reduce((s, r) => s + sv(r.gia_tri, r.vat), 0);
    const nPay = cp.thau_phu.reduce((s, c) => s + c.pays.length, 0);
    check(d.so_hd === masters.length, `${tag}: Dashboard – số HĐ`, `${d.so_hd} ≠ ${masters.length}`);
    check(K.doanh_thu.gt === dtGt && K.doanh_thu.sv === dtSv, `${tag}: Dự kiến – Doanh thu`, `${fmt(K.doanh_thu.gt)} ≠ ${fmt(dtGt)}`);
    check(K.chi_phi.sv === cpSv && Math.abs(K.chi_phi.gt - cpGt) <= khoaN, `${tag}: Dự kiến – Chi phí (= tổng tab Chi phí)`, `${fmt(K.chi_phi.sv)} ≠ ${fmt(cpSv)}`);
    check(H.doanh_thu.gt === thGt && H.doanh_thu.sv === thSv, `${tag}: Thực hiện – Doanh thu (= tổng HT/QT)`, `${fmt(H.doanh_thu.gt)} ≠ ${fmt(thGt)}`);
    check(H.chi_phi.sv === otherSv + tpThSv && Math.abs(H.chi_phi.gt - (otherGt + tpThGt)) <= khoaN + nPay, `${tag}: Thực hiện – Chi phí`, `${fmt(H.chi_phi.sv)} ≠ ${fmt(otherSv + tpThSv)}`);
    check(d.tien_ve === tvSum && K.con_lai === dtSv - tvSum && H.con_lai === thSv - tvSum, `${tag}: Tiền về / Còn lại 2 lớp`);
    check(H.doanh_thu.gt <= K.doanh_thu.gt || qt.length > 0, `${tag}: Doanh thu thực hiện không vượt dự kiến khi chưa nghiệm thu`);
    for (const [nm, L] of [['Dự kiến', K], ['Thực hiện', H]]) {
      const sumM = (k) => Object.values(L.thang).reduce((s, m) => s + m[k], 0);
      check(sumM('dt_sv') <= L.doanh_thu.sv || L.doanh_thu.sv < 0, `${tag}: ${nm} – biểu đồ DT không vượt tổng`);
      if (!L.chua_ngay.dt) check(sumM('dt_sv') === L.doanh_thu.sv, `${tag}: ${nm} – tổng DT theo tháng = Doanh thu`);
      if (!L.chua_ngay.cp) check(sumM('cp_sv') === L.chi_phi.sv, `${tag}: ${nm} – tổng CP theo tháng = Chi phí`, `${sumM('cp_sv')} ≠ ${L.chi_phi.sv}`);
    }
    check(dtUndated >= 0 && thUndated >= 0, `${tag}: dòng thiếu ngày`);
    const ln = K.doanh_thu.gt - K.chi_phi.gt, lnTh = H.doanh_thu.gt - H.chi_phi.gt;
    if (ln < 0) warns.push(`${tag}: LỖ DỰ KIẾN ${fmt(ln)} (trước VAT)`);
    rows.push({ tag, hd: masters.length, tp: cp.thau_phu.length, dt: K.doanh_thu.gt, cp: K.chi_phi.gt, ln, dtTh: H.doanh_thu.gt, cpTh: H.chi_phi.gt, lnTh, tv: d.tien_ve, cl: H.con_lai });
  }

  // ---------- Báo cáo ----------
  const pad = (s, n, right) => (right ? String(s).padStart(n) : String(s).padEnd(n));
  const pctS = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—');
  const S = (k) => rows.reduce((s, r) => s + r[k], 0);
  const tbl = (title, kDt, kCp, kLn, extra) => {
    console.log(`\n${title}`);
    console.log(pad('Dự án', 9), pad('HĐ', 3, 1), pad('TP', 4, 1), pad('Doanh thu', 18, 1), pad('Chi phí', 18, 1), pad('Lợi nhuận', 18, 1), pad('Tỷ suất', 8, 1), ...(extra ? [pad('Tiền về', 18, 1), pad('Còn phải thu', 18, 1)] : []));
    for (const r of [...rows, { tag: 'TỔNG', hd: S('hd'), tp: S('tp'), [kDt]: S(kDt), [kCp]: S(kCp), [kLn]: S(kLn), tv: S('tv'), cl: S('cl') }]) {
      console.log(pad(r.tag, 9), pad(r.hd, 3, 1), pad(r.tp, 4, 1), pad(fmt(r[kDt]), 18, 1), pad(fmt(r[kCp]), 18, 1), pad(fmt(r[kLn]), 18, 1), pad(pctS(r[kLn], r[kDt]), 8, 1),
        ...(extra ? [pad(fmt(r.tv), 18, 1), pad(fmt(r.cl), 18, 1)] : []));
    }
  };
  tbl('DỰ KIẾN – theo hợp đồng (trước VAT)', 'dt', 'cp', 'ln');
  tbl('THỰC HIỆN – đến hiện tại (trước VAT; Tiền về / Còn phải thu sau VAT)', 'dtTh', 'cpTh', 'lnTh', true);

  console.log('\nTHỜI GIAN PHẢN HỒI API (ms, trung bình / lớn nhất)');
  for (const [k, v] of Object.entries(timing)) console.log(`  ${pad(k, 32)} ${Math.round(v.reduce((a, b) => a + b, 0) / v.length)} / ${Math.max(...v)}`);

  console.log(`\nCẢNH BÁO NGHIỆP VỤ (${warns.length}) – không phải lỗi hệ thống, cần người kiểm tra số liệu:`);
  warns.slice(0, 30).forEach((w) => console.log('  ⚠ ' + w));
  if (warns.length > 30) console.log(`  … và ${warns.length - 30} cảnh báo khác`);

  console.log(`\nKẾT QUẢ: ${pass} kiểm tra ĐẠT, ${fail} LỖI`);
  fails.slice(0, 50).forEach((f) => console.log('  ✗ ' + f));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('Lỗi tester:', e.message); process.exit(2); });

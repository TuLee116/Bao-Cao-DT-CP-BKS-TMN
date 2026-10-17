// Dữ liệu mẫu để chạy thử hệ thống (tester): 15 công trình điện mặt trời áp mái quy mô hộ kinh doanh, mã DEMO-01..15
//   Mỗi công trình = 1 khách hàng, 1 HĐ lắp đặt (có thể thêm PL01 bổ sung tấm pin / pin lưu trữ)
//   Giai đoạn: Mới ký (khảo sát, tạm ứng) / Đang lắp đặt / Hoàn thành chờ quyết toán / Đã quyết toán
//   Chi phí theo ngành: tấm pin, inverter, pin lưu trữ, khung, cáp-tủ điện, nhân công khoán, đấu nối điện lực...
// Mọi dòng đi qua đúng bộ kiểm tra hợp lệ (lib/validate.js) như khi nhập tay.
const { validateProject, validateRevenue, validateTienVe, validateCost, validateTp, validateTpLine, validateTpPay } = require('./validate');
const { tienVat } = require('./revenue');

const DEMO_PREFIX = 'DEMO-';
const TODAY = '2026-10-15';

// Sinh số ngẫu nhiên có hạt giống (cùng hạt giống -> cùng bộ dữ liệu)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// kwp: công suất; ess: pin lưu trữ (kWh); stage: 0 mới ký, 1 đang lắp đặt, 2 hoàn thành chờ QT, 3 đã quyết toán
// gia: giá bán (triệu đồng/kWp, trước VAT); m: hệ số giá vốn thiết bị (>1 = mua đắt / lỗ)
const PROJECTS = [
  { ten: 'Nhà phố anh Minh – Gò Vấp', kh: 'Anh Nguyễn Văn Minh', loai: 'Hòa lưới bám tải – mái tôn', dd: 'Q. Gò Vấp, TP.HCM', kwp: 5.5, from: '2025-01-08', stage: 3, gia: 11.5, m: 1 },
  { ten: 'Biệt thự chị Lan – Thủ Đức', kh: 'Chị Trần Thị Lan', loai: 'Hybrid lưu trữ – mái BTCT', dd: 'TP. Thủ Đức, TP.HCM', kwp: 10.2, ess: 10, from: '2025-02-20', stage: 3, gia: 11, m: 0.97 },
  { ten: 'Quán cà phê Mộc – Bình Thạnh', kh: 'Hộ KD Cà phê Mộc', loai: 'Hòa lưới bám tải – mái tôn', dd: 'Q. Bình Thạnh, TP.HCM', kwp: 15, from: '2025-04-02', stage: 3, gia: 10.5, m: 1.02 },
  { ten: 'Nhà xưởng may Phú Hòa – Bình Dương', kh: 'Cty TNHH May Phú Hòa', loai: 'Hòa lưới bám tải – mái tôn', dd: 'TP. Thủ Dầu Một, Bình Dương', kwp: 99.5, from: '2025-05-12', stage: 3, gia: 9.2, m: 1.08, tp: true, loan: true },
  { ten: 'Nhà phố anh Tuấn – Quận 7', kh: 'Anh Lê Quốc Tuấn', loai: 'Hòa lưới bám tải – mái BTCT', dd: 'Quận 7, TP.HCM', kwp: 8.2, from: '2025-06-18', stage: 3, gia: 11.2, m: 1.4, phat: 9.5e6 }, // lỗ: dột mái phải bồi thường
  { ten: 'Homestay Đà Lạt Pine', kh: 'Hộ KD Homestay Pine', loai: 'Hybrid lưu trữ – mái tôn', dd: 'TP. Đà Lạt, Lâm Đồng', kwp: 12, ess: 15, from: '2025-08-05', stage: 3, gia: 11.8, m: 1.05, xa: true },
  { ten: 'Cửa hàng VLXD Hưng Thịnh – Hóc Môn', kh: 'Hộ KD VLXD Hưng Thịnh', loai: 'Hòa lưới bám tải – mái tôn', dd: 'H. Hóc Môn, TP.HCM', kwp: 30, from: '2025-09-15', stage: 3, gia: 9.8, m: 1, tp: true },
  { ten: 'Nhà phố chị Hạnh – Tân Bình', kh: 'Chị Phạm Mỹ Hạnh', loai: 'Hòa lưới bám tải – mái tôn', dd: 'Q. Tân Bình, TP.HCM', kwp: 6.6, from: '2025-11-03', stage: 2, gia: 11.6, m: 0.98 },
  { ten: 'Trang trại gà anh Phúc – Củ Chi', kh: 'Anh Đỗ Hồng Phúc', loai: 'Hòa lưới bám tải – mái chuồng trại', dd: 'H. Củ Chi, TP.HCM', kwp: 50, from: '2025-12-10', stage: 2, gia: 9.5, m: 1.3, tp: true, loan: true }, // lỗ: báo giá thấp để cạnh tranh,
  { ten: 'Nhà phố anh Khoa – Phú Nhuận', kh: 'Anh Võ Đăng Khoa', loai: 'Hybrid lưu trữ – mái BTCT', dd: 'Q. Phú Nhuận, TP.HCM', kwp: 8, ess: 10, from: '2026-02-16', stage: 3, gia: 11.4, m: 1 },
  { ten: 'Phòng khám Nha khoa Sài Gòn Smile', kh: 'Phòng khám Sài Gòn Smile', loai: 'Hòa lưới bám tải – mái BTCT', dd: 'Q. 10, TP.HCM', kwp: 20, from: '2026-04-06', stage: 2, gia: 10.6, m: 1.02 },
  { ten: 'Kho lạnh nông sản Long An', kh: 'Hộ KD Nông sản Ba Tâm', loai: 'Hòa lưới bám tải – mái tôn', dd: 'H. Đức Hòa, Long An', kwp: 40, from: '2026-06-22', stage: 1, gia: 9.6, m: 1, tp: true, xa: true }, // đang lắp đặt: đã mua đủ thiết bị, mới nghiệm thu đợt 1
  { ten: 'Nhà phố chị Thu – Quận 12', kh: 'Chị Ngô Hoài Thu', loai: 'Hòa lưới bám tải – mái tôn', dd: 'Quận 12, TP.HCM', kwp: 5, from: '2026-08-25', stage: 1, gia: 11.8, m: 1 },
  { ten: 'Biệt thự anh Hải – Nhà Bè', kh: 'Anh Huỳnh Thanh Hải', loai: 'Hybrid lưu trữ – mái ngói', dd: 'H. Nhà Bè, TP.HCM', kwp: 15, ess: 20, from: '2026-09-20', stage: 0, gia: 12, m: 1 },
  { ten: 'Xưởng mộc Tân Phú', kh: 'Hộ KD Mộc Tân Phú', loai: 'Hòa lưới bám tải – mái tôn', dd: 'Q. Tân Phú, TP.HCM', kwp: 25, from: '2026-10-05', stage: 0, gia: 10, m: 1 },
];
const THAU_PHU = [['Xưởng cơ khí Thành Công', 'Gia công khung sắt nâng mái'], ['Đội lắp đặt Quang Huy', 'Lắp đặt tấm pin (thuê ngoài)'], ['Cty Điện lạnh Minh Khang', 'Kéo cáp, tủ điện tổng']];
const NCC = { pin: ['Cty Năng lượng Sao Mai (Jinko)', 'NPP Longi Miền Nam', 'Cty Canadian Solar VN'], inv: ['NPP Huawei Solar', 'NPP SMA – Growatt', 'NPP Deye Việt Nam'],
  ess: ['NPP Pylontech', 'NPP Dyness'], khung: ['Cty Nhôm Định Hình Á Châu', 'Cty Khung Solar Phát Đạt'], dien: ['Cty Cáp điện Cadivi', 'Cty Thiết bị điện Hồng Phát'], phu: ['Cửa hàng VTĐ Kim Phát', 'Điện nước Tâm An'] };
const BANKS = ['Vietcombank', 'BIDV', 'Agribank'];

function buildPlan(seed = 2026) {
  const r = rng(seed);
  const int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const round = (v, unit = 1000) => Math.round(v / unit) * unit;
  const addDays = (iso, n) => {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    const s = d.toISOString().slice(0, 10);
    return s > TODAY ? TODAY : s;
  };
  const sv = (gt, vat) => gt + tienVat(gt, vat);
  const VAT = 8;

  return PROJECTS.map((P, pi) => {
    const ma = `${DEMO_PREFIX}${String(pi + 1).padStart(2, '0')}`;
    const big = P.kwp >= 30;
    const dur = big ? int(30, 50) : int(8, 20);       // số ngày lắp đặt
    const ngay = P.from;
    const so_ma = `${ma.slice(5)}/${ngay.slice(0, 4)}/HĐLĐ-TTH`;
    const plan = {
      project: { ma_du_an: ma, ten_du_an: P.ten, chu_dau_tu: P.kh, loai_cong_trinh: P.loai, dia_diem: P.dd, cong_suat: P.kwp,
        trang_thai: ['Chuẩn bị', 'Đang thi công', 'Hoàn thành', 'Hoàn thành'][P.stage],
        tien_do: [0, int(40, 80), 100, 100][P.stage], ngay_bat_dau: ngay, ngay_ket_thuc: addDays(ngay, dur + 10) },
      contracts: [], costs: [],
    };
    // ---- Doanh thu: HĐ lắp đặt (+ PL01 bổ sung) ----
    const essGia = 6.2e6; // giá bán pin lưu trữ / kWh
    const gt = round(P.kwp * P.gia * 1e6 + (P.ess || 0) * essGia, 1e5);
    const C = { hd: { ma_loai: 'HĐ', so_ma, ngay, gia_tri: gt, vat: VAT, ghi_chu: `Lắp đặt hệ thống ĐMT ${P.kwp} kWp${P.ess ? ` + lưu trữ ${P.ess} kWh` : ''}` }, pl: [], qt: [], tv: [], tps: [] };
    let tong = gt;
    if (P.stage >= 2 && r() < 0.35) {
      const add = round(P.kwp * 0.1 * P.gia * 1e6, 1e5);
      tong += add;
      C.pl.push({ ma_loai: 'PL01', so_ma, ngay: addDays(ngay, int(5, 12)), gia_tri: add, vat: VAT, ghi_chu: 'Bổ sung thêm tấm pin theo yêu cầu khách hàng' });
    }
    // Tạm ứng 30–50% khi ký; công trình lớn đang lắp đặt: thanh toán theo tiến độ (chưa ghi nhận doanh thu)
    // Hoàn thành lắp đặt: 1 dòng ghi nhận doanh thu; thanh toán tới 95% (giữ 5% bảo hành), quyết toán phần còn lại
    const tu = round(sv(tong, VAT) * pick([0.3, 0.4, 0.5]), 1e5);
    if (P.stage > 0 || r() < 0.7) C.tv.push({ loai: 'tam_ung', so_tien: tu, ngay: addDays(ngay, int(1, 5)) });
    const done = addDays(ngay, dur);
    let daTra = C.tv.reduce((a, t) => a + t.so_tien, 0);
    const nts = []; // mốc tiến độ { ngay } – chi phí, thầu phụ bám theo
    if (P.stage === 1 && big) {
      const n1 = addDays(ngay, Math.round(dur * 0.6));
      nts.push({ ngay: n1 });
      const tra = round(sv(tong, VAT) * 0.3, 1e5);
      C.tv.push({ loai: 'dot', dot: 1, so_tien: tra, ngay: addDays(n1, int(2, 6)) }); daTra += tra;
    }
    if (P.stage >= 2) {
      nts.push({ ngay: done });
      C.qt.push({ so_hieu: 'Hoàn thành lắp đặt, đóng điện', ngay: done, gia_tri: tong, vat: VAT });
      const tra = Math.max(0, round(sv(tong, VAT) * 0.95 - daTra, 1000));
      if (P.stage === 3) C.tv.push({ loai: 'quyet_toan', so_tien: sv(tong, VAT) - daTra, ngay: addDays(done, int(3, 15)) });
      else if (r() < 0.6) C.tv.push({ loai: 'dot', dot: 1, so_tien: tra, ngay: addDays(done, int(3, 12)) });
    }
    // ---- Chi phí trực tiếp ----
    const cp = (nhom, nhom_con, noi_dung, val, ngay2, extra = {}) => { if (val) plan.costs.push({ nhom, nhom_con, noi_dung, so_ct: so_ma, ngay: ngay2, gia_tri: round(val, 1000), vat: 8, ...extra }); };
    const kw = P.kwp * (tong / gt); // công suất thực tế (gồm PL bổ sung)
    const mua = addDays(ngay, int(2, 6)); // ngày mua thiết bị
    const lap = P.stage >= 1;              // đã đặt hàng thiết bị
    const tyLe = P.stage >= 2 ? 1 : P.stage === 1 ? 0.6 : 0; // tỷ lệ khối lượng lắp đặt
    cp('to_chuc', null, `Khảo sát mái, thiết kế, mô phỏng sản lượng ${P.kwp} kWp`, 0.12e6 * P.kwp + 1.5e6, addDays(ngay, -int(3, 10)), { vat: 0 });
    if (lap) {
      cp('vat_tu', 'tam_pin', `Tấm pin ${Math.ceil((kw * 1000) / 580)} tấm × 580Wp`, kw * 3.05e6 * P.m, mua, { doi_tac: pick(NCC.pin) });
      cp('vat_tu', 'inverter', `Inverter ${P.ess ? 'hybrid' : 'hòa lưới'} ${Math.round(kw)} kW`, kw * (P.ess ? 1.9e6 : 1.25e6) * P.m, mua, { doi_tac: pick(NCC.inv) });
      if (P.ess) cp('vat_tu', 'luu_tru', `Pin lưu trữ Lithium ${P.ess} kWh`, P.ess * 4.4e6 * P.m, mua, { doi_tac: pick(NCC.ess) });
      cp('vat_tu', 'khung', 'Ray nhôm, kẹp, chân L, bulong', kw * 0.85e6, mua, { doi_tac: pick(NCC.khung) });
      cp('vat_tu', 'chinh', 'Cáp DC/AC, MC4, tủ điện, CB, SPD, tiếp địa', kw * 0.75e6, addDays(mua, int(1, 4)), { doi_tac: pick(NCC.dien) });
      cp('vat_tu', 'phu', 'Ống luồn, ốc vít, keo, dây rút', kw * 0.12e6, addDays(mua, int(2, 8)), { doi_tac: pick(NCC.phu) });
      cp('nhan_cong', 'van_chuyen', 'Vận chuyển tấm pin, thiết bị lên công trình', (P.xa ? 6e6 : 1.2e6) + kw * 0.05e6, addDays(mua, 1), { vat: 0 });
      cp('nhan_cong', 'giao_khoan', `Khoán lắp đặt ${P.kwp} kWp${tyLe < 1 ? ' – tạm ứng đội' : ''}`, kw * (big ? 0.7e6 : 0.95e6) * tyLe, addDays(ngay, Math.round(dur * Math.max(0.5, tyLe))), { vat: 0 });
      cp('nhan_cong', 'bao_che', 'Dây an toàn, thang, che chắn mái', 0.6e6 + kw * 0.03e6, addDays(mua, 2), { vat: 0 });
      if (big) cp('may_moc', null, 'Thuê xe cẩu đưa tấm pin lên mái', 3.5e6 + kw * 0.04e6, addDays(mua, int(3, 6)));
    }
    if (P.stage >= 2) {
      cp('nhan_cong', 'thi_nghiem', 'Đo cách điện, điện trở tiếp địa, chạy thử', 0.8e6 + kw * 0.02e6, done, { vat: 0 });
      cp('nhan_cong', 've_sinh', 'Vệ sinh tấm pin, dọn dẹp mái sau lắp đặt', 0.5e6, done, { vat: 0 });
      cp('thu_tuc', null, 'Hồ sơ đấu nối điện lực, thay công tơ 2 chiều', big ? 6e6 : 2.2e6, addDays(done, int(-3, 5)), { vat: 0, doi_tac: 'Điện lực khu vực' });
      if (r() < 0.2) cp('khac', null, 'Chi phí phát sinh chưa có chứng từ ngày', 0.6e6, null, { vat: 0 });
    }
    // ---- Thầu phụ (công trình lớn) ----
    if (P.tp && lap) {
      const [doi_tac, hm] = big && P.kwp >= 80 ? THAU_PHU[1] : THAU_PHU[0];
      const tgt = round(kw * (hm.startsWith('Lắp') ? 0.35e6 : 0.45e6) * P.m, 1e5);
      const T = { tp: { so_ma: `TP-01/${ma.slice(5)}`, doi_tac, ghi_chu: `${hm} – thuộc HĐ khách hàng ${so_ma}` },
        hd: { ngay: addDays(ngay, 3), gia_tri: tgt, vat: 8, gia_tri_qt: null }, pl: [], pays: [] };
      const tSv = sv(tgt, 8);
      const tuTp = round(tSv * 0.3, 1000);
      T.pays.push({ loai: 'tam_ung', so_tien: tuTp, ngay: addDays(ngay, 5) });
      if (P.stage >= 2) {
        T.hd.gia_tri_qt = tgt;
        T.pays.push({ loai: 'quyet_toan', so_tien: tSv - tuTp, ngay: addDays(done, int(5, 15)) });
      } else if (nts.length) {
        T.pays.push({ loai: 'dot', dot: 1, so_tien: round(tSv * 0.6 * 0.9 - tuTp * 0.6, 1000), ngay: addDays(nts[0].ngay, int(3, 8)) });
      }
      C.tps.push(T);
    }
    // ---- Chi phí gián tiếp, bán hàng & tài chính (phân bổ theo công trình) ----
    if (r() < 0.6 || P.kwp >= 20) cp('gt_ngoai_giao', 'bgd2', 'Hoa hồng người giới thiệu khách hàng', tong * 0.02, addDays(ngay, int(1, 10)), { vat: 0 });
    cp('gt_ngoai_giao', 'bgd0', 'Quảng cáo Facebook/Google phân bổ', tong * 0.006, addDays(ngay, -int(5, 20)), { vat: 0 });
    if (lap) {
      cp('gt_tien_ich', 've_may_bay', 'Xăng xe đi khảo sát, thi công', (P.xa ? 3.5e6 : 0.8e6) + kw * 0.02e6, addDays(ngay, Math.round(dur / 2)), { vat: 0 });
      if (P.xa) cp('gt_tien_ich', 'cong_trinh', 'Lưu trú, ăn uống đội thi công', 4.5e6, addDays(ngay, Math.round(dur / 2)), { vat: 0 });
      cp('gt_luong', 'luong', 'Lương kỹ thuật, kế toán phân bổ', tong * 0.035 * Math.max(0.3, tyLe), addDays(ngay, dur), { vat: 0 });
    }
    if (P.stage === 3 && r() < 0.5) cp('gt_luong', 'thuong_dot', 'Thưởng hoàn thành công trình', tong * 0.006, addDays(done, 10), { vat: 0 });
    if (P.loan) {
      const bank = pick(BANKS);
      const goc = round(tong * 0.15, 1e5);
      plan.costs.push({ nhom: 'tc_chi_phi', nhom_con: null, noi_dung: 'Phí giải ngân vốn lưu động', doi_tac: bank, ngay: mua, gia_tri: round(goc * 0.002, 1000), vat: 0 });
      for (let k = 1; k <= 3; k++) {
        const d = addDays(mua, 30 * k);
        if (d >= TODAY) break;
        plan.costs.push({ nhom: 'tc_tra_no', nhom_con: 'lai', noi_dung: `Lãi vay vốn lưu động tháng ${k}`, doi_tac: bank, ngay: d, gia_tri: round(goc * 0.0075, 1000), vat: 0 });
      }
      const dg = addDays(mua, 90);
      if (dg < TODAY) plan.costs.push({ nhom: 'tc_tra_no', nhom_con: 'goc', noi_dung: 'Trả nợ gốc vay vốn lưu động', doi_tac: bank, ngay: dg, gia_tri: goc, vat: 0 });
    }
    if (P.phat) plan.costs.push({ nhom: 'tc_phat', nhom_con: null, noi_dung: 'Bồi thường dột mái, sửa chữa trần nhà khách hàng', ngay: addDays(done, 25), gia_tri: P.phat, vat: 0 });
    plan.contracts.push(C);
    return plan;
  });
}

// Ghi vào CSDL; báo lỗi rõ nếu một dòng không qua kiểm tra hợp lệ
async function seedDemo(store, userId, seed) {
  const must = ({ data, errors }, what) => {
    if (errors.length) throw new Error(`Dữ liệu mẫu không hợp lệ (${what}): ${errors.join('; ')}`);
    return data;
  };
  const plans = buildPlan(seed);
  const count = { du_an: 0, hd: 0, pl: 0, ht_qt: 0, tien_ve: 0, thau_phu: 0, tp_thanh_toan: 0, chi_phi: 0 };
  for (const P of plans) {
    const pid = (await store.createProject(must(validateProject(P.project), P.project.ma_du_an), userId)).id;
    count.du_an++;
    for (const C of P.contracts) {
      const hdId = (await store.createRevenue(pid, must(validateRevenue({ loai: 'hd', ...C.hd }), C.hd.so_ma), userId)).id;
      count.hd++;
      for (const l of C.pl) { await store.createRevenue(pid, must(validateRevenue({ loai: 'hd', ...l }), l.ma_loai), userId); count.pl++; }
      for (const q of C.qt) { await store.createRevenue(pid, must(validateRevenue({ loai: 'qt', hd_id: hdId, ...q }), q.so_hieu), userId); count.ht_qt++; }
      for (const t of C.tv) { await store.createTienVe(pid, must(validateTienVe({ hd_id: hdId, ...t }), 'tiền về'), userId); count.tien_ve++; }
      for (const T of C.tps) {
        const tpId = (await store.createTp(pid, must(validateTp({ ...T.tp, hd_cdt_id: hdId }), T.tp.so_ma), must(validateTpLine({ ...T.hd, ma_loai: 'HĐ' }), T.tp.so_ma), userId)).id;
        count.thau_phu++;
        for (const l of T.pl) await store.createTpLine(tpId, must(validateTpLine(l), T.tp.so_ma + ' ' + l.ma_loai), userId);
        for (const p of T.pays) { await store.createTpPay(tpId, must(validateTpPay(p), T.tp.so_ma + ' thanh toán'), userId); count.tp_thanh_toan++; }
      }
    }
    for (const c of P.costs) { await store.createCost(pid, must(validateCost({ ...c, _new: true }), c.noi_dung), userId); count.chi_phi++; }
  }
  return count;
}

module.exports = { DEMO_PREFIX, buildPlan, seedDemo };

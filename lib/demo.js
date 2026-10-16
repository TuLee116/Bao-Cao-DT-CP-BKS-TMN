// Dữ liệu mẫu để chạy thử hệ thống (tester): 12 dự án mã DEMO-01..12
//   Mỗi dự án 5–10 HĐ chủ đầu tư ở các giai đoạn: Mới ký / Đang thi công / Đã quyết toán
//   Mỗi HĐ CĐT 5–10 HĐ thầu phụ (ở các giai đoạn tạm ứng / thanh toán đợt / quyết toán) + chi phí khác
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

const PROJECTS = [
  { ten: 'Nhà xưởng KCN Tân Uyên', cdt: 'Cty TNHH Điện tử Sao Việt', trang_thai: 'Đang thi công', from: '2025-01-05', stages: [0.15, 0.45, 0.4], margin: 0.98 },
  { ten: 'Trung tâm thương mại Long Hậu', cdt: 'Cty CP Đầu tư Long Hậu', trang_thai: 'Đang thi công', from: '2025-04-10', stages: [0.25, 0.6, 0.15], margin: 1.24 },
  { ten: 'Khu nhà ở xã hội Bình Chánh', cdt: 'Cty CP Địa ốc Phú Lợi', trang_thai: 'Hoàn thành', from: '2024-11-01', stages: [0, 0.1, 0.9], margin: 0.92 },
  { ten: 'Kho lạnh Cảng Cát Lái', cdt: 'Tổng Cty Tân Cảng', trang_thai: 'Đang thi công', from: '2025-08-15', stages: [0.4, 0.5, 0.1], margin: 1.5, phat: 0.01 }, // dự án lỗ (thử số âm)
  { ten: 'Bệnh viện Đa khoa Thủ Đức', cdt: 'Ban QLDA Đầu tư XD TP. Thủ Đức', trang_thai: 'Chuẩn bị', from: '2026-03-01', stages: [0.7, 0.3, 0], margin: 1.6 }, // lỗ nhẹ,
  { ten: 'Trường THPT Nhơn Trạch', cdt: 'Ban QLDA ĐTXD tỉnh Đồng Nai', trang_thai: 'Đang thi công', from: '2025-02-15', stages: [0.2, 0.5, 0.3], margin: 1.05 },
  { ten: 'Cao ốc văn phòng Quận 7', cdt: 'Cty CP Phát triển Nam Sài Gòn', trang_thai: 'Hoàn thành', from: '2024-12-10', stages: [0, 0.15, 0.85], margin: 0.95 },
  { ten: 'Nhà máy xử lý nước thải Hiệp Phước', cdt: 'Cty CP KCN Hiệp Phước', trang_thai: 'Đang thi công', from: '2025-06-01', stages: [0.3, 0.55, 0.15], margin: 1.1 },
  { ten: 'Hạ tầng Khu dân cư Nhơn Đức', cdt: 'Cty TNHH Địa ốc Nhà Bè', trang_thai: 'Đang thi công', from: '2025-03-20', stages: [0.2, 0.5, 0.3], margin: 1.35, phat: 0.005 }, // lỗ
  { ten: 'Trung tâm Logistics Sóng Thần', cdt: 'Cty CP Kho vận Sóng Thần', trang_thai: 'Đang thi công', from: '2025-10-01', stages: [0.45, 0.5, 0.05], margin: 1.0 },
  { ten: 'Khách sạn Sea View Vũng Tàu', cdt: 'Cty CP Du lịch Biển Xanh', trang_thai: 'Đang thi công', from: '2026-01-15', stages: [0.6, 0.4, 0], margin: 1.15 },
  { ten: 'Trạm biến áp 110kV Củ Chi', cdt: 'Ban QLDA Điện lực miền Nam', trang_thai: 'Hoàn thành', from: '2024-10-15', stages: [0, 0.05, 0.95], margin: 0.9 },
];
const NHA_THAU = ['Cty Nền Móng Phía Nam', 'Cty Cơ điện Hưng Phát', 'Cty Kết cấu thép Đại Dũng', 'Cty PCCC Thành Đạt', 'Cty Nhôm kính Việt Á',
  'Cty Sơn & Chống thấm Kova', 'Cty Thang máy Thiên Nam', 'Cty Cảnh quan Xanh', 'Cty HVAC Lạnh Việt', 'Cty Xây lắp Hòa Bình Minh',
  'Cty Ống & Phụ kiện Bình Minh', 'Cty Điện nhẹ Sài Gòn', 'Cty Hạ tầng Phước Thành', 'Cty Cửa cuốn Austdoor Nam', 'Cty Trần thạch cao Vĩnh Tường'];
const HANG_MUC_TP = ['Cọc khoan nhồi', 'Kết cấu thép', 'Cơ điện (M&E)', 'PCCC', 'Nhôm kính mặt dựng', 'Chống thấm', 'Thang máy', 'Cảnh quan', 'HVAC', 'Hoàn thiện', 'Cấp thoát nước', 'Điện nhẹ', 'San lấp mặt bằng', 'Cửa cuốn', 'Trần thạch cao'];
const NCC = ['Thép Hòa Phát', 'Bê tông Lê Phan', 'Xi măng Hà Tiên', 'VLXD Minh Tâm', 'Gạch Đồng Tâm'];
const BANKS = ['Vietcombank', 'BIDV', 'VietinBank', 'NCB', 'MB Bank'];

function buildPlan(seed = 2026) {
  const r = rng(seed);
  const int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const round = (v, unit = 1000000) => Math.round(v / unit) * unit;
  const addDays = (iso, n) => {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    const s = d.toISOString().slice(0, 10);
    return s > TODAY ? TODAY : s;
  };
  const sv = (gt, vat) => gt + tienVat(gt, vat);

  return PROJECTS.map((P, pi) => {
    const ma = `${DEMO_PREFIX}${String(pi + 1).padStart(2, '0')}`;
    const plan = {
      project: { ma_du_an: ma, ten_du_an: P.ten, chu_dau_tu: P.cdt, trang_thai: P.trang_thai, tien_do: 0,
        ngay_bat_dau: P.from, ngay_ket_thuc: addDays(P.from, int(540, 900)) },
      contracts: [], costs: [],
    };
    const nHd = int(5, 10);
    let doneWeight = 0;
    for (let h = 1; h <= nHd; h++) {
      const x = r();
      const stage = x < P.stages[0] ? 0 : x < P.stages[0] + P.stages[1] ? 1 : 2; // 0 mới ký, 1 đang TC, 2 đã QT
      const so_ma = `${String(h).padStart(2, '0')}/${ma.slice(5)}/2025/HĐTC`;
      const span = Math.max(0, Math.round((new Date(TODAY) - new Date(P.from)) / 86400000));
      const need = stage === 0 ? 20 : stage === 1 ? 130 : 330;   // số ngày cần cho các đợt nghiệm thu / quyết toán
      const ngay = addDays(P.from, int(0, Math.max(0, span - need)));
      const vat = r() < 0.12 ? 0 : pick([8, 10, 10]);
      const gt = round(int(3, 40) * 1e9 * (0.5 + r()), 1e6);
      const C = { stage, hd: { ma_loai: 'HĐ', so_ma, ngay, gia_tri: gt, vat, ghi_chu: ['Mới ký', 'Đang thi công', 'Đã quyết toán'][stage] },
        pl: [], qt: [], tv: [], tps: [] };
      // Phụ lục: tăng / giảm
      let tongHd = gt;
      for (let k = 1, n = stage === 0 ? int(0, 1) : int(0, 3); k <= n; k++) {
        const g = round(gt * (r() < 0.3 ? -1 : 1) * (0.03 + r() * 0.12), 1e6);
        tongHd += g;
        C.pl.push({ ma_loai: 'PL' + String(k).padStart(2, '0'), so_ma, ngay: addDays(ngay, 60 * k + int(0, 30)), gia_tri: g, vat, ghi_chu: g < 0 ? 'Phụ lục giảm khối lượng' : 'Phát sinh tăng' });
      }
      // Nghiệm thu / quyết toán (HT/QT) và tiền về
      const tamUng = r() < 0.85 ? round(sv(tongHd, vat) * (0.1 + r() * 0.2), 1000) : 0;
      if (tamUng && stage >= 0 && (stage > 0 || r() < 0.6)) C.tv.push({ loai: 'tam_ung', so_tien: tamUng, ngay: addDays(ngay, int(5, 25)) });
      const daUng = C.tv.length ? tamUng : 0;
      const nts = [];        // các đợt nghiệm thu: { ngay, g } – chi phí và thanh toán thầu phụ bám theo
      if (stage >= 1) {
        const tongQt = stage === 2 ? round(tongHd * (0.95 + r() * 0.08), 1e6) : round(tongHd * (0.2 + r() * 0.6), 1e6);
        const nDot = int(2, 5);
        let con = tongQt, ngayNt = ngay, daTra = 0;
        for (let d = 1; d <= nDot; d++) {
          const last = d === nDot;
          const g = last ? con : round(tongQt / nDot * (0.7 + r() * 0.6), 1e6);
          con -= g;
          ngayNt = addDays(ngayNt, int(35, 75));
          nts.push({ ngay: ngayNt, g });
          const quyetToan = last && stage === 2;
          C.qt.push({ so_hieu: quyetToan ? 'Quyết toán' : `Nghiệm thu đợt ${d}`, ngay: r() < 0.06 ? null : ngayNt, gia_tri: g, vat });
          // Thanh toán đợt: giá trị nghiệm thu sau VAT − thu hồi tạm ứng − giữ lại 5% (đợt cuối của HĐ đang TC có thể chưa trả)
          if (quyetToan) {
            const phaiTra = round(sv(tongQt, vat) * 0.95, 1000) - daUng - daTra;
            if (phaiTra > 0) C.tv.push({ loai: 'quyet_toan', so_tien: phaiTra, ngay: addDays(ngayNt, int(20, 45)) });
          } else if (!(last && r() < 0.5)) {
            const tra = Math.max(0, round(sv(g, vat) * 0.95 - (daUng * g) / tongQt, 1000));
            daTra += tra;
            C.tv.push({ loai: 'dot', dot: d, so_tien: tra, ngay: addDays(ngayNt, int(15, 40)) });
          }
        }
      }
      // Thầu phụ cho HĐ này
      const nTp = int(5, 10);
      const tyLeTp = (0.62 / nTp) * P.margin;
      for (let t = 1; t <= nTp; t++) {
        const hm = HANG_MUC_TP[(h * 3 + t) % HANG_MUC_TP.length];
        const tvat = r() < 0.1 ? 0 : pick([8, 10]);
        const tgt = round(tongHd * tyLeTp * (0.6 + r() * 0.8), 1e6);
        const tngay = addDays(ngay, int(10, 60));
        // giai đoạn HĐTP theo giai đoạn HĐ CĐT: 0 chưa TT, 1 tạm ứng, 2 đang TT, 3 quyết toán (khóa sổ)
        const ts = stage === 0 ? int(0, 1) : stage === 1 ? 2 : (r() < 0.85 ? 3 : 2);
        const T = { tp: { so_ma: `TP-${String(h).padStart(2, '0')}.${String(t).padStart(2, '0')}/${ma.slice(5)}`, doi_tac: NHA_THAU[(h + t * 2) % NHA_THAU.length], ghi_chu: `${hm} – thuộc HĐ CĐT ${so_ma}` },
          hd: { ngay: tngay, gia_tri: tgt, vat: tvat, gia_tri_qt: null }, pl: [], pays: [] };
        let tTong = tgt;
        for (let k = 1, n = ts >= 2 ? int(0, 2) : 0; k <= n; k++) {
          const g = round(tgt * (r() < 0.35 ? -1 : 1) * (0.05 + r() * 0.15), 1e6);
          tTong += g;
          T.pl.push({ ma_loai: 'PL' + String(k).padStart(2, '0'), ngay: addDays(tngay, 45 * k), gia_tri: g, vat: tvat, gia_tri_qt: null });
        }
        const tSv = sv(tTong, tvat);
        // Tạm ứng khi khởi công; thanh toán đợt theo từng đợt nghiệm thu của HĐ CĐT (giữ lại 10%), sau nghiệm thu 10–25 ngày
        const tamUngTp = ts >= 1 ? round(tSv * (0.1 + r() * 0.05), 1000) : 0;
        if (tamUngTp) T.pays.push({ loai: 'tam_ung', so_tien: tamUngTp, ngay: addDays(tngay, int(3, 15)) });
        if (ts >= 2 && nts.length) {
          // Mỗi đợt: giá trị khối lượng × 90% (giữ lại 10%) − thu hồi tạm ứng theo tỷ lệ; tổng không vượt giá trị HĐTP
          let paid = tamUngTp;
          nts.forEach((n, d) => {
            const ratio = n.g / tongHd;
            let tra = Math.max(0, round(tSv * ratio * 0.9 - tamUngTp * ratio, 1000));
            tra = Math.min(tra, Math.max(0, round(tSv * 0.95, 1000) - paid));
            paid += tra;
            T.pays.push({ loai: 'dot', dot: d + 1, so_tien: tra, ngay: r() < 0.04 ? null : addDays(n.ngay, int(10, 25)) });
          });
        }
        if (ts === 3) {
          // Quyết toán: HT/QT từng dòng ±4%, khoản quyết toán = phần còn lại -> khóa sổ
          T.hd.gia_tri_qt = round(tgt * (0.97 + r() * 0.07), 1e6);
          T.pl.forEach((l) => { l.gia_tri_qt = l.gia_tri; });
          const qtSv = sv(T.hd.gia_tri_qt + T.pl.reduce((s2, l) => s2 + l.gia_tri_qt, 0), tvat);
          const paid = T.pays.reduce((s2, p2) => s2 + p2.so_tien, 0);
          const lastNt = nts.length ? nts[nts.length - 1].ngay : tngay;
          T.pays.push({ loai: 'quyet_toan', so_tien: Math.max(0, qtSv - paid), ngay: addDays(lastNt, int(30, 60)) });
        }
        C.tps.push(T);
      }
      // Chi phí trực tiếp khác (Số CT ghi số HĐ CĐT): phát sinh theo từng đợt nghiệm thu, đúng tỷ lệ khối lượng
      const base = tongHd;   // biên lợi nhuận từng công trình điều chỉnh qua giá trị thầu phụ (P.margin)
      const cp = (nhom, nhom_con, noi_dung, val, ngay2, extra = {}) => plan.costs.push({ nhom, nhom_con, noi_dung, so_ct: so_ma, ngay: ngay2,
        gia_tri: round(val, 1000), vat: pick([8, 10, 10, 0]), ...extra });
      const pr = nts.reduce((a, n) => a + n.g, 0) / tongHd;   // tỷ lệ khối lượng đã nghiệm thu
      nts.forEach((n, d) => {
        const f = n.g / tongHd;
        cp('vat_tu', 'chinh', `Thép, bê tông đợt ${d + 1}`, base * 0.05 * f * (0.9 + r() * 0.2), addDays(n.ngay, -int(10, 25)), { doi_tac: pick(NCC) });
        cp('nhan_cong', 'giao_khoan', `Tổ đội thi công đợt ${d + 1}`, base * 0.03 * f * (0.9 + r() * 0.2), addDays(n.ngay, int(0, 10)));
      });
      if (nts.length) {
        const d0 = addDays(nts[0].ngay, -int(20, 40));
        cp('vat_tu', 'phu', 'Vật tư phụ, tiêu hao', base * 0.008 * pr, d0, { doi_tac: pick(NCC) });
        cp('nhan_cong', pick(['van_chuyen', 've_sinh', 'bao_che', 'thi_nghiem']), 'Nhân công phục vụ', base * 0.006 * pr, d0);
        cp('may_moc', null, 'Thuê cẩu, máy đào', base * 0.01 * pr, d0);
        if (r() < 0.25) cp('vat_tu', 'chinh', 'Hoàn trả vật tư thừa (giảm trừ)', -base * 0.003 * pr, addDays(nts[nts.length - 1].ngay, 15), { doi_tac: pick(NCC) });
        if (r() < 0.2) cp('khac', null, 'Chi phí khác chưa có chứng từ ngày', base * 0.002 * pr, null);
      } else if (r() < 0.5) {
        cp('to_chuc', null, 'Huy động lán trại, văn phòng công trường', base * 0.004, addDays(ngay, int(10, 30)));
      }
      doneWeight += stage === 2 ? 1 : stage === 1 ? 0.5 : 0.05;
      plan.contracts.push(C);
    }
    plan.project.tien_do = Math.round((doneWeight / nHd) * 100);
    // Chi phí chung của dự án: gián tiếp + tài chính, theo tháng
    const months = Math.max(3, Math.min(24, Math.round((new Date(TODAY) - new Date(P.from)) / (30.4 * 86400000))));
    const tongDt = plan.contracts.reduce((s, c) => s + c.hd.gia_tri, 0);
    for (let m = 0; m < months; m++) {
      const ngay = addDays(P.from, 30 * m + 25);
      plan.costs.push({ nhom: 'gt_luong', nhom_con: 'luong', noi_dung: `Lương BCH tháng ${m + 1}`, ngay, gia_tri: round(tongDt * 0.0025, 1000), vat: 0 });
      plan.costs.push({ nhom: 'gt_tien_ich', nhom_con: pick(['tien_ich', 'cong_trinh', 've_may_bay']), noi_dung: `Tiện ích, phục vụ tháng ${m + 1}`, ngay, gia_tri: round(tongDt * 0.0004 * (0.5 + r()), 1000), vat: 10 });
    }
    plan.costs.push({ nhom: 'gt_luong', nhom_con: 'thuong_le', noi_dung: 'Thưởng Tết âm lịch', ngay: addDays(P.from, 120), gia_tri: round(tongDt * 0.003, 1000), vat: 0 });
    plan.costs.push({ nhom: 'gt_ngoai_giao', nhom_con: pick(['bgd1', 'bgd2', 'bgd0']), noi_dung: 'Chi ngoại giao', ngay: addDays(P.from, int(30, 300)), gia_tri: round(tongDt * 0.002, 1000), vat: 0 });
    plan.costs.push({ nhom: 'tc_chi_phi', nhom_con: null, noi_dung: 'Phí bảo lãnh thực hiện HĐ', ngay: addDays(P.from, 10), gia_tri: round(tongDt * 0.0015, 1000), vat: 0 });
    const bank = pick(BANKS);
    for (let k = 1, n = int(2, 4); k <= n; k++) {
      const d = addDays(P.from, 90 * k);
      plan.costs.push({ nhom: 'tc_tra_no', nhom_con: 'goc', noi_dung: `Trả nợ gốc kỳ ${k}`, doi_tac: bank, ngay: d, gia_tri: round(tongDt * 0.02, 1000), vat: 0 });
      plan.costs.push({ nhom: 'tc_tra_no', nhom_con: 'lai', noi_dung: `Lãi vay kỳ ${k}`, doi_tac: bank, ngay: d, gia_tri: round(tongDt * 0.0018, 1000), vat: 0 });
    }
    if (P.phat) plan.costs.push({ nhom: 'tc_phat', nhom_con: null, noi_dung: 'Phạt chậm tiến độ', ngay: addDays(P.from, 200), gia_tri: round(tongDt * P.phat, 1000), vat: 0 });
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

// Dữ liệu GIẢ cho chế độ demo (không phải số liệu thật của công ty). Cấu trúc giống bảng tổng hợp DT-CP:
// công ty → khu vực → công trình → hợp đồng (mã DT-CP) → dòng Hợp đồng/Phụ lục, 3 mốc cập nhật để thử so sánh.
window.DEMO_SEED = function () {
  let seed = 20260609;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const between = (a, b) => a + (b - a) * rnd();
  const regions = [['I', 'Đà Nẵng'], ['II', 'Sài Gòn'], ['III', 'Khu vực còn lại'], ['IV', 'Phú Quốc - còn lại']];
  const investors = ['CDA', 'CDB', 'CDC', 'CDD', 'CDE', 'CDF'];
  const projectNames = ['Khu nghỉ dưỡng Mẫu A', 'Tổ hợp căn hộ Mẫu B', 'Khách sạn Mẫu C', 'Trung tâm thương mại Mẫu D', 'Biệt thự Mẫu E',
    'Nhà ga Mẫu F', 'Khu đô thị Mẫu G', 'Công viên Mẫu H', 'Tòa văn phòng Mẫu I', 'Bến du thuyền Mẫu K', 'Resort Mẫu L', 'Chung cư Mẫu M'];
  const works = ['Thi công hoàn thiện khu BOH', 'Thi công xây trát phần thân', 'Thi công trần thạch cao', 'Thi công hoàn thiện nội thất',
    'Thi công phần thô kết cấu', 'Thi công cải tạo sảnh', 'Thi công mặt ngoài', 'Thi công hạ tầng kỹ thuật'];
  // Tỷ trọng 15 khoản chi phí (k..y)
  const weights = { k: 4, l: 18, m: 1.5, n: 1, o: 1.5, p: 22, q: 16, r: 3, s: 2, t: 1, u: 0.5, v: 0.5, w: 0.6, x: 1.5, y: 0.2 };
  const wsum = Object.values(weights).reduce((a, b) => a + b, 0);

  const contracts = [];
  projectNames.forEach((pn, pi) => {
    const [rc, rn] = regions[pi % 4];
    const pcode = `KV${pi % 4 + 1}-${String(10 + pi).padStart(2, '0')}`;
    const nC = 2 + Math.floor(rnd() * 3);
    for (let ci = 0; ci < nC; ci++) {
      const company = rnd() < 0.75 ? 'TMN' : rnd() < 0.7 ? 'QN' : 'TN';
      const inv = investors[Math.floor(rnd() * investors.length)];
      const hd = Math.round(between(2, 60) * 1e9);
      contracts.push({
        company, region: rc, region_name: rn, project_code: pcode, project_name: pn + ' - 2025', project_stage: '2',
        contract_code: `${pcode}.${String(ci + 1).padStart(2, '0')}${company === 'TMN' ? '' : '-' + company}`,
        contract_no: `HĐ số ${100 + contracts.length}/2025/HĐ/${inv}-${company}`, contract_title: works[Math.floor(rnd() * works.length)],
        investor: inv, hd, pl: rnd() < 0.5 ? Math.round(hd * between(0.05, 0.25)) : 0,
        progress: between(0.25, 0.7), ratio: between(0.62, 0.86), stage: rnd() < 0.15 ? '1' : rnd() < 0.85 ? '2' : '3', bornAt: rnd() < 0.12 ? 1 : 0
      });
    }
  });

  const dates = ['2026-03-31', '2026-04-30', '2026-06-09'];
  const snapshots = [], lines = {};
  dates.forEach((date, si) => {
    const id = si + 1;
    snapshots.push({ id, report_date: date, label: si === 2 ? 'Cập nhật tháng 6' : '', file_name: `bang-tong-hop-dtcp-${date}.xlsx`, cost_labels: {}, line_count: 0, created_at: date + 'T08:00:00Z' });
    const out = [];
    contracts.forEach((c, i) => {
      if (si < c.bornAt) return;
      if (i === 3 && si === 2) return; // một hợp đồng không còn trong mốc mới nhất
      const progress = Math.min(1, c.progress + si * between(0.05, 0.18));
      const ratio = c.ratio + (si ? between(-0.03, 0.04) : 0);
      const stage = si === 2 && c.stage === '2' && i % 5 === 0 ? '3' : c.stage;
      const parts = [['Hợp đồng', c.hd]].concat(c.pl ? [['Phụ lục 01', c.pl]] : []);
      parts.forEach(([label, hd]) => {
        const dt = Math.round(hd * progress);
        const vals = { hd, dt };
        Object.keys(weights).forEach(k => { const v = Math.round(dt * ratio * weights[k] / wsum * between(0.8, 1.2)); if (v) vals[k] = v; });
        if (si === 2) vals.tv = Math.round(dt * between(0.5, 0.9));
        out.push(Object.assign({ seq: out.length + 1, stage, line_label: label, vals }, {
          company: c.company, region: c.region, region_name: c.region_name, project_code: c.project_code, project_name: c.project_name,
          project_stage: c.project_stage, contract_code: c.contract_code, contract_no: c.contract_no, contract_title: c.contract_title, investor: c.investor
        }));
      });
    });
    lines[id] = out;
    snapshots[si].line_count = out.length;
  });
  const catalog = [
    { kind: 'company', code: 'TMN', name: 'Tân Minh Nhân', sort: 1 }, { kind: 'company', code: 'QN', name: 'Quốc Nhân', sort: 2 }, { kind: 'company', code: 'TN', name: 'Thành Nhân', sort: 3 }
  ].concat(regions.map(([c, n], i) => ({ kind: 'region', code: c, name: n, sort: i + 1 })),
    investors.map((c, i) => ({ kind: 'investor', code: c, name: 'Chủ đầu tư mẫu ' + 'ABCDEF'[i], sort: i + 1 })),
    ['1', '2', '3'].map((c, i) => ({ kind: 'stage', code: c, name: 'Thời điểm ' + c, sort: i + 1 })));
  return { snapshots, lines, catalog };
};

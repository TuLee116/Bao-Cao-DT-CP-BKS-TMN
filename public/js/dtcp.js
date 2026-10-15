// Mô hình dữ liệu DT-CP công trình: đọc file Excel "Bảng tổng hợp theo dõi doanh thu - chi phí"
// và tổng hợp số liệu theo công ty / khu vực / công trình / chủ đầu tư / thời điểm / hợp đồng.
// Đơn vị số tiền: đồng (như trong file).
(function (root) {
  'use strict';

  // 15 khoản chi phí trực tiếp theo thứ tự cột trong file (K..Y). Tên lấy từ file khi nhập; đây là tên mặc định.
  const COST_COLS = [
    { key: 'k', group: '1. Vật tư chính', label: 'Hợp Nhân' },
    { key: 'l', group: '1. Vật tư chính', label: 'Đối tác khác' },
    { key: 'm', group: '2. Vật tư phụ', label: 'Đề xuất bộ phận kế toán mua' },
    { key: 'n', group: '2. Vật tư phụ', label: 'Công trình mua' },
    { key: 'o', group: '3. Máy móc - thiết bị thuê', label: 'Máy móc - thiết bị công trình thuê' },
    { key: 'p', group: '4. Thầu phụ', label: 'Thầu phụ' },
    { key: 'q', group: '5. Nhân công', label: 'Nhân công giao khoán' },
    { key: 'r', group: '5. Nhân công', label: 'Chi phí công nhật' },
    { key: 's', group: '5. Nhân công', label: 'Nhân công vận chuyển' },
    { key: 't', group: '5. Nhân công', label: 'Hỗ trợ đội thi công/công nhân' },
    { key: 'u', group: '5. Nhân công', label: 'Vệ sinh công nghiệp/sắp xếp thiết bị' },
    { key: 'v', group: '5. Nhân công', label: 'Bao che sàn/biện pháp/thưởng' },
    { key: 'w', group: '5. Nhân công', label: 'Chi phí thí nghiệm' },
    { key: 'x', group: '6. Chi phí văn phòng, tổ chức thi công', label: 'Chi phí văn phòng, tổ chức thi công' },
    { key: 'y', group: '7. Chi phí khác - NCB', label: 'Chi phí khác - NCB' }
  ];
  const COST_KEYS = COST_COLS.map(c => c.key);
  const VALUE_KEYS = ['hd', 'sl', 'slhs', 'tv', 'dt'];

  const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const up = s => norm(s).toLocaleUpperCase('vi');
  const ROMAN = /^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV)$/;
  // "QUỐC NHÂN" → "QN" (chữ cái đầu, bỏ dấu)
  const initials = s => norm(s).split(' ').filter(Boolean).map(w => w[0].normalize('NFD').replace(/[̀-ͯ]/g, '').replace('Đ', 'D').replace('đ', 'd').toUpperCase()).join('');
  const titleCase = s => norm(s).toLocaleLowerCase('vi').replace(/(^|[\s(/-])(\S)/g, (m, a, b) => a + b.toLocaleUpperCase('vi'));

  // aoa: mảng các dòng (mảng ô) của sheet, như XLSX.utils.sheet_to_json(ws, {header: 1, raw: true, defval: null}).
  function parseRows(aoa) {
    const warnings = [];
    // 1. Dòng tiêu đề: có "KÝ HIỆU" và "GIÁ TRỊ HỢP ĐỒNG"
    const hr = aoa.findIndex(r => r && r.some(c => /KÝ HIỆU/.test(up(c))) && r.some(c => /GIÁ TRỊ HỢP ĐỒNG/.test(up(c))));
    if (hr < 0) throw new Error('Không tìm thấy dòng tiêu đề (cần có cột "KÝ HIỆU DT-CP" và "GIÁ TRỊ HỢP ĐỒNG"). Hãy dùng đúng mẫu bảng tổng hợp DT-CP.');
    const H = aoa[hr].map(up);
    const find = (re, not) => H.findIndex(c => re.test(c) && !(not && not.test(c)));
    const col = {
      stt: find(/^STT$/), company: find(/^CÔNG TY$/), code: find(/KÝ HIỆU/), name: find(/TÊN CÔNG TRÌNH/),
      stage: find(/^THỜI\s*[DĐ]I[ỂE]M/), hd: find(/GIÁ TRỊ HỢP ĐỒNG/), sl: find(/SẢN LƯỢNG/, /HỒ SƠ/), slhs: find(/SẢN LƯỢNG HỒ SƠ/),
      tv: find(/TIỀN VỀ/), dt: find(/DOANH THU/), cost0: find(/CHI PHÍ TRỰC TIẾP/), costEnd: find(/GIÁ TRỊ CHI PHÍ/)
    };
    if (col.stt < 0) col.stt = 0;
    ['company', 'code', 'name', 'hd', 'dt', 'cost0'].forEach(k => { if (col[k] < 0) throw new Error(`Không tìm thấy cột ${{ company: '"CÔNG TY"', code: '"KÝ HIỆU DT-CP"', name: '"TÊN CÔNG TRÌNH"', hd: '"GIÁ TRỊ HỢP ĐỒNG"', dt: '"DOANH THU THỜI ĐIỂM"', cost0: '"CHI PHÍ TRỰC TIẾP"' }[k]} ở dòng tiêu đề.`); });
    // 2. Cột chi phí: từ "CHI PHÍ TRỰC TIẾP" tới trước "GIÁ TRỊ CHI PHÍ"; tên lấy từ 3 dòng tiêu đề con.
    const end = col.costEnd > col.cost0 ? col.costEnd : col.cost0 + COST_KEYS.length;
    const costIdx = [];
    for (let i = col.cost0; i < end; i++) costIdx.push(i);
    if (costIdx.length !== COST_KEYS.length) warnings.push(`File có ${costIdx.length} cột chi phí (mẫu chuẩn có 15); web đọc ${Math.min(costIdx.length, 15)} cột đầu.`);
    const costLabels = {};
    let group = '';
    costIdx.slice(0, COST_KEYS.length).forEach((ci, j) => {
      const sub = [1, 2, 3].map(d => norm((aoa[hr + d] || [])[ci]));
      if (sub[0]) group = sub[0];
      const item = sub[2] || sub[1] || sub[0];
      const g = titleCase(group.replace(/\s*-\s*/g, ' - '));
      costLabels[COST_KEYS[j]] = item && up(item) !== up(group) ? `${g} › ${item}` : g || COST_COLS[j].label;
    });
    // 3. Ngày cập nhật: dòng phía trên tiêu đề có "CẬP NHẬT ... dd/mm/yyyy"
    let reportDate = '';
    for (let r = 0; r < hr; r++) {
      const s = (aoa[r] || []).map(norm).join(' ');
      const m = s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
      if (m && /CẬP NHẬT|NGÀY/i.test(s)) { reportDate = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; break; }
    }
    // 4. Duyệt các dòng. Nhận biết theo mã DT-CP: mã hợp đồng bắt đầu bằng mã công trình (KV3-11.12 thuộc KV3-11).
    const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
    const lines = [], companyNames = {}, seen = new Map(), notes = [];
    let region = { code: '', name: '' }, project = null, contract = null, skipped = 0, groupCode = '';
    const readVals = row => {
      const vals = {};
      let any = false;
      [['hd', col.hd], ['sl', col.sl], ['slhs', col.slhs], ['tv', col.tv], ['dt', col.dt]].forEach(([k, ci]) => { const v = ci >= 0 ? num(row[ci]) : null; if (v != null && v !== 0) { vals[k] = v; any = true; } });
      costIdx.slice(0, COST_KEYS.length).forEach((ci, j) => { const v = num(row[ci]); if (v != null && v !== 0) { vals[COST_KEYS[j]] = v; any = true; } });
      return any ? vals : null;
    };
    const pushLine = (ct, label, vals) => lines.push({
      company: ct.company, region: region.code, region_name: region.name,
      project_code: project ? project.code : '', project_name: project ? project.name : '', project_stage: project ? project.stage : '',
      contract_code: ct.code, contract_no: ct.no, contract_title: ct.title, investor: ct.investor,
      stage: ct.stage, line_label: label, vals
    });
    // Hợp đồng không có dòng chi tiết nhưng ghi số ngay trên dòng hợp đồng: lấy số ở dòng đó.
    const closeContract = () => {
      if (contract && !contract.n && contract.own) { pushLine(contract, 'Số liệu trên dòng hợp đồng', contract.own); notes.push(contract.row); }
      contract = null;
    };
    for (let r = hr + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const a = row[col.stt], b = norm(row[col.company]), c = norm(row[col.code]), d = norm(row[col.name]);
      const e = col.stage >= 0 ? norm(row[col.stage]) : '';
      const A = norm(a);
      if (/^TỔNG CỘNG/.test(up(A)) || /^TỔNG CỘNG/.test(up(c))) break;
      if (/^B\d+$/.test(A) && c) { // nhóm công ty: "B1 TÂN MINH NHÂN"
        groupCode = initials(c);
        companyNames[groupCode] = titleCase(c);
        closeContract(); continue;
      }
      if (/^B$/.test(A)) { closeContract(); continue; }
      if (ROMAN.test(A) && /KHU VỰC/.test(up(d))) {
        closeContract();
        region = { code: A, name: titleCase(d.replace(/^KHU VỰC\s+[IVX]+\s*[.:-]?\s*/i, '')) || d };
        project = null; continue;
      }
      const codeIsText = c && typeof row[col.code] === 'string';
      const underProject = project && codeIsText && up(c).startsWith(up(project.code)) && up(c) !== up(project.code);
      const isContract = codeIsText && (b || underProject) && !(typeof a === 'number' && Number.isInteger(a) && !b);
      if (!isContract && (codeIsText && !b || (typeof a === 'number' && Number.isInteger(a) && !b))) { // công trình
        closeContract();
        project = codeIsText ? { code: c, name: d, stage: e } : null;
        if (codeIsText && !(typeof a === 'number')) warnings.push(`Dòng ${r + 1}: công trình ${c} thiếu số thứ tự (cột STT) – web vẫn nhận là công trình.`);
        continue;
      }
      if (isContract) { // hợp đồng (mã DT-CP)
        closeContract();
        const m = d.match(/^(.*?)\s+-\s*(.+)$/s);
        const no = m ? norm(m[1]) : d, title = m ? norm(m[2]) : '';
        const inv = (no.match(/\/\s*([A-ZĐ]{2,}[A-ZĐ0-9]*)\s*-\s*[A-ZĐ]{1,5}\b/) || d.match(/\/\s*([A-ZĐ]{2,}[A-ZĐ0-9]*)\s*-\s*[A-ZĐ]{1,5}\b/) || [])[1] || '';
        let company = b;
        if (!company) {
          company = (c.match(/-(QN|TN|TMN)$/i) || no.match(/-(TMN|QN|TN)\b/) || [])[1] || groupCode || '';
          warnings.push(`Dòng ${r + 1}: hợp đồng ${c} thiếu cột CÔNG TY – web tạm lấy "${company || '?'}".`);
        }
        contract = { company: company.toUpperCase(), code: c, no, title, investor: inv, stage: e || (project && project.stage) || '', row: r + 1, n: 0, own: readVals(row) };
        const prev = seen.get(up(c));
        if (prev && prev.no !== no) warnings.push(`Mã DT-CP ${c} bị trùng ở dòng ${prev.row} và dòng ${r + 1} (hai hợp đồng khác nhau) – web đang cộng chung, nên sửa lại mã trong file.`);
        else if (!prev) seen.set(up(c), { row: r + 1, no });
        continue;
      }
      const vals = readVals(row);
      if (!vals) continue;
      if (!contract) { skipped++; continue; }
      contract.n++;
      pushLine(contract, d, vals);
    }
    closeContract();
    if (notes.length) warnings.push(`${notes.length} hợp đồng không có dòng chi tiết nên web lấy số ngay trên dòng hợp đồng (dòng ${notes.slice(0, 12).join(', ')}${notes.length > 12 ? '…' : ''}).`);
    if (skipped) warnings.push(`${skipped} dòng có số liệu nhưng không nằm dưới hợp đồng nào nên bị bỏ qua.`);
    if (!lines.length) throw new Error('Không đọc được dòng số liệu nào dưới các hợp đồng.');
    return { report_date: reportDate, cost_labels: costLabels, company_names: companyNames, lines, warnings };
  }

  // ---------- Tổng hợp ----------
  const cpOf = v => COST_KEYS.reduce((s, k) => s + (v[k] || 0), 0);
  function blank() { return { hd: 0, sl: 0, slhs: 0, tv: 0, dt: 0, cp: 0, costs: Object.fromEntries(COST_KEYS.map(k => [k, 0])), contracts: new Set(), lines: 0 }; }
  function add(acc, l) {
    const v = l.vals || {};
    VALUE_KEYS.forEach(k => { acc[k] += v[k] || 0; });
    COST_KEYS.forEach(k => { acc.costs[k] += v[k] || 0; });
    acc.cp += cpOf(v);
    acc.contracts.add(l.contract_code);
    acc.lines++;
    return acc;
  }
  function finish(acc) { acc.count = acc.contracts.size; acc.pct = acc.dt ? acc.cp / acc.dt : NaN; return acc; }
  function total(lines) { return finish(lines.reduce(add, blank())); }
  // Khóa nhóm cho từng chiều
  const DIM_KEY = {
    company: l => l.company, region: l => l.region, project: l => l.project_code || '(không rõ)', investor: l => l.investor || '',
    stage: l => l.stage || '', contract: l => l.contract_code
  };
  function groupBy(lines, dim) {
    const m = new Map();
    lines.forEach(l => {
      const k = DIM_KEY[dim](l);
      if (!m.has(k)) m.set(k, Object.assign(blank(), { key: k, first: l }));
      add(m.get(k), l);
    });
    m.forEach(finish);
    return m;
  }
  // Chuẩn hóa để tìm kiếm: không phân biệt chữ hoa/thường, có dấu/không dấu ("thi cong" khớp "Thi Công").
  const fold = s => norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
  function filter(lines, f) {
    const q = fold(f.q);
    return lines.filter(l => (!f.company || l.company === f.company) && (!f.region || l.region === f.region) &&
      (!f.investor || l.investor === f.investor) && (!f.stage || l.stage === f.stage) && (!f.project || l.project_code === f.project) &&
      (!q || fold([l.contract_code, l.contract_no, l.contract_title, l.project_code, l.project_name].join(' ')).includes(q)));
  }

  root.DTCP = { COST_COLS, COST_KEYS, VALUE_KEYS, parseRows, total, groupBy, filter, cpOf, DIM_KEY, fold };
})(typeof window !== 'undefined' ? window : globalThis);

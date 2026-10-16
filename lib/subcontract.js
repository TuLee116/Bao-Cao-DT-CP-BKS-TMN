// Thầu phụ theo hợp đồng (HĐTP): HĐ/PL + Thanh toán; tổng hợp giá trị
//   Giá trị HĐ/PL sau VAT  = Giá trị + Tiền VAT (cùng công thức Doanh thu)
//   Giá trị HT/QT          = giá trị HT/QT đã nhập; chưa quyết toán -> bằng giá trị HĐ/PL
//   Còn lại                = HT/QT sau VAT − Đã thanh toán
const { calcLine } = require('./revenue');

const plNum = (l) => (l === 'HĐ' ? 0 : Number(String(l || '').slice(2)) || 9999);
const TT_ORDER = { tam_ung: 0, dot: 1, quyet_toan: 2 };

function buildContracts(data) {
  return data.contracts.map((c) => {
    const lines = data.lines.filter((l) => l.tp_id === c.id)
      .sort((a, b) => plNum(a.ma_loai) - plNum(b.ma_loai) || a.id - b.id)
      .map((l) => {
        const hd = calcLine({ gia_tri: l.gia_tri, vat: l.vat });
        const daQt = l.gia_tri_qt !== null && l.gia_tri_qt !== undefined;
        const qt = calcLine({ gia_tri: daQt ? l.gia_tri_qt : l.gia_tri, vat: l.vat });
        return {
          ...l, so_hieu: `${l.ma_loai} ${c.so_ma}`, da_qt: daQt,
          tien_vat: hd.tien_vat, sau_vat: hd.sau_vat, tam_tinh: hd.tam_tinh,
          qt_gia_tri: qt.gia_tri, qt_tien_vat: qt.tien_vat, qt_sau_vat: qt.sau_vat,
        };
      });
    const pays = data.pays.filter((p) => p.tp_id === c.id)
      .sort((a, b) => TT_ORDER[a.loai] - TT_ORDER[b.loai] || (a.dot || 0) - (b.dot || 0) || a.id - b.id);
    const sum = (arr, f) => arr.reduce((s, x) => s + x[f], 0);
    const hd_sau_vat = sum(lines, 'sau_vat');
    const qt_sau_vat = sum(lines, 'qt_sau_vat');
    const da_tt = sum(pays, 'so_tien');
    return {
      ...c, lines, pays,
      so_pl: lines.filter((l) => l.ma_loai !== 'HĐ').length,
      hd_gia_tri: sum(lines, 'gia_tri'), hd_sau_vat,
      qt_gia_tri: sum(lines, 'qt_gia_tri'), qt_tien_vat: sum(lines, 'qt_tien_vat'), qt_sau_vat,
      da_qt: lines.length > 0 && lines.every((l) => l.da_qt),
      tam_tinh: lines.some((l) => l.tam_tinh),
      da_tt, con_lai: qt_sau_vat - da_tt,
    };
  });
}

function summarizeContracts(list) {
  const sum = (f) => list.reduce((s, c) => s + c[f], 0);
  return { so_hd: list.length, hd_sau_vat: sum('hd_sau_vat'), qt_gia_tri: sum('qt_gia_tri'), qt_tien_vat: sum('qt_tien_vat'),
    qt_sau_vat: sum('qt_sau_vat'), da_tt: sum('da_tt'), con_lai: sum('con_lai') };
}

module.exports = { buildContracts, summarizeContracts };

// Phiên bản hệ thống: V[lần cập nhật trong ngày].[dd].[mm].[yy]  (vd: V01.16.10.26)
//   Lần cập nhật thứ nhất trong ngày = V01, lần 2 = V02...; sang ngày mới quay về V01.
//   Tăng phiên bản: node scripts/bump-version.js (đọc / ghi version.json)
const fs = require('fs');
const path = require('path');

function formatVersion({ lan, ngay }) {
  const [y, m, d] = String(ngay).split('-');
  return `V${String(lan).padStart(2, '0')}.${d}.${m}.${y.slice(2)}`;
}

function readVersion() {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8'));
    const [y, m, d] = v.ngay.split('-');
    return { ma: formatVersion(v), lan: v.lan, ngay: `${d}/${m}/${y}` };
  } catch {
    return { ma: 'không rõ', lan: 0, ngay: '' };
  }
}

module.exports = { formatVersion, readVersion };

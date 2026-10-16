// Tăng phiên bản trước mỗi lần phát hành: V[lần trong ngày].[dd].[mm].[yy]
//   Cùng ngày (giờ Việt Nam) -> lần + 1;  sang ngày mới -> lần = 1
// Chạy: node scripts/bump-version.js
const fs = require('fs');
const path = require('path');
const { formatVersion } = require('../lib/version');

const file = path.join(__dirname, '..', 'version.json');
const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date()); // YYYY-MM-DD
const next = cur.ngay === today ? { lan: cur.lan + 1, ngay: today } : { lan: 1, ngay: today };
fs.writeFileSync(file, JSON.stringify(next) + '\n');
console.log(`${formatVersion(cur)} -> ${formatVersion(next)}`);

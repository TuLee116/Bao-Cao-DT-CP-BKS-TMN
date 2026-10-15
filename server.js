// Chạy máy chủ (Railway hoặc trên máy): node server.js
const app = require('./server/app');

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Báo cáo doanh thu – chi phí đang chạy tại http://localhost:${port}`);
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    console.warn('Chưa có DATABASE_URL: trang web vẫn mở được nhưng API sẽ báo lỗi cho tới khi kết nối PostgreSQL.');
  }
});

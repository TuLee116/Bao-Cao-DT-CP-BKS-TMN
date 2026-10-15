# Báo cáo doanh thu – chi phí

Web theo dõi doanh thu, chi phí và lợi nhuận theo tháng, có đăng nhập và phân quyền. Chạy trên **Railway** hoặc **Vercel**, dữ liệu lưu trong **PostgreSQL**.

- **Tổng quan**: 4 chỉ số tháng gần nhất, biểu đồ doanh thu/chi phí/lợi nhuận, biên lợi nhuận, cơ cấu chi phí, doanh thu theo kênh, bảng lãi lỗ; lọc theo 12 tháng gần nhất, từng năm hoặc toàn bộ.
- **Ghi chú theo tháng**: mọi người viết được; xóa ghi chú của mình, admin xóa được mọi ghi chú.
- **Nhập số liệu** (admin): thêm/sửa/xóa số liệu từng tháng.
- **Danh mục** (admin): thêm, đổi tên, sắp xếp, ẩn kênh bán và khoản mục chi phí.
- **Nhập từ file** (admin): tải lên Excel/CSV nhiều tháng, xem trước rồi mới ghi; tải file mẫu, xuất toàn bộ số liệu ra Excel.
- **Người dùng** (admin): tạo tài khoản, đổi vai trò, khóa/mở khóa, đặt lại mật khẩu.

Đơn vị số tiền: **triệu đồng**. Lợi nhuận = doanh thu − tổng chi phí (trước thuế TNDN).

## Tài khoản và vai trò

- Lần đầu mở web (database trống), web hiện form **tạo tài khoản admin đầu tiên**. Hãy làm việc này ngay sau khi triển khai.
- Không có tự đăng ký. Admin tạo tài khoản ở trang **Người dùng** rồi gửi tên đăng nhập và mật khẩu tạm cho từng người. Người dùng tự đổi mật khẩu ở trang **Tài khoản**.
- Quên mật khẩu: admin bấm **Đặt lại mật khẩu**, web tạo mật khẩu ngẫu nhiên để gửi lại.

| Vai trò | Xem báo cáo | Viết ghi chú | Sửa số liệu, danh mục, quản lý người dùng |
|---|---|---|---|
| Admin | ✓ | ✓ | ✓ |
| Người xem | ✓ | ✓ | |

Bảo mật: mật khẩu băm bằng bcrypt; phiên đăng nhập lưu bằng cookie HttpOnly (30 ngày); khóa tài khoản hoặc đặt lại mật khẩu sẽ đăng xuất người đó ngay; giới hạn 10 lần đăng nhập sai / 15 phút; mọi thao tác ghi dữ liệu đều kiểm tra quyền ở máy chủ.

## Triển khai lên Railway (khuyên dùng)

Chi phí: gói Hobby khoảng 5 USD/tháng (đã gồm 5 USD tài nguyên, đủ cho web nội bộ nhỏ).

1. Đăng nhập https://railway.com bằng tài khoản GitHub.
2. **New Project → Deploy from GitHub repo** → chọn `Bao-Cao-DT-CP-BKS-TMN`.
3. Trong project, bấm **+ Create → Database → Add PostgreSQL**.
4. Mở service web → **Variables** → **Add Variable Reference** → chọn `DATABASE_URL` của PostgreSQL.
5. Mở service web → **Settings → Networking → Generate Domain** để có địa chỉ dạng `https://xxx.up.railway.app`.
6. Mở địa chỉ đó và tạo tài khoản admin đầu tiên.

Railway tự chạy `npm start`, và tự triển khai lại mỗi lần push lên nhánh đã chọn.

## Triển khai lên Vercel

Gói Hobby miễn phí nhưng theo điều khoản của Vercel chỉ dành cho mục đích phi thương mại. Web dùng cho công ty nên dùng gói Pro.

1. Đăng nhập https://vercel.com bằng GitHub → **Add New → Project** → chọn repo này. Framework Preset: **Other**, để trống Build Command, bấm **Deploy**.
2. Vào project → **Storage → Create Database → Neon (Postgres)** → kết nối với project. Vercel tự thêm biến `DATABASE_URL`.
3. **Deployments → Redeploy** để nhận biến mới.
4. Mở địa chỉ `https://xxx.vercel.app` và tạo tài khoản admin đầu tiên.

Ghi chú: trên Vercel, giới hạn đăng nhập sai được đếm riêng cho từng phiên bản máy chủ nên kém chặt hơn trên Railway.

## Chế độ demo

Khi không có máy chủ (ví dụ mở qua GitHub Pages hoặc chỉ phục vụ thư mục `public/`), web tự chạy ở **chế độ demo**: dữ liệu mẫu lưu trong trình duyệt, có nút vào nhanh với quyền Admin hoặc Người xem. Chỉ dùng để xem thử.

## Chạy trên máy

Cần Node.js 18+ và PostgreSQL.

```bash
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/baocao npm start
# mở http://localhost:3000
```

Bảng dữ liệu được tạo tự động lần đầu máy chủ nhận yêu cầu (xem `server/schema.js`).

## Định dạng file nhập

Dòng đầu là tiêu đề. Cột `Tháng` (dạng `2026-09` hoặc `09/2026`), các cột `DT: <tên kênh>` là doanh thu và `CP: <tên khoản mục>` là chi phí. File mẫu có số liệu 12 tháng: `public/data/mau-nhap-lieu.csv` (số liệu mẫu, không phải số thật).

| Tháng | DT: Bán lẻ cửa hàng | DT: Thương mại điện tử | CP: Giá vốn hàng bán | CP: Nhân sự |
|---|---|---|---|---|
| 2026-09 | 1059 | 1100 | 1489 | 442 |

Ô để trống thì giữ nguyên số liệu đang có. Cột có tên kênh/khoản mục chưa tồn tại thì web hỏi có tạo mới không.

## Cấu trúc

```
server.js              Chạy máy chủ (Railway / trên máy)
api/index.js           Điểm vào cho Vercel
vercel.json            Cấu hình Vercel
server/app.js          API: đăng nhập, phân quyền, số liệu, danh mục, ghi chú, người dùng
server/db.js           Kết nối PostgreSQL (DATABASE_URL), tự tạo bảng
server/schema.js       Lược đồ bảng
public/                Giao diện
  index.html, css/app.css
  js/app.js            Các trang
  js/api.js            Gọi API máy chủ, hoặc chế độ demo
  js/charts.js         Biểu đồ d3 và định dạng số kiểu Việt Nam
  js/vendor/           d3 7.9.0, SheetJS 0.18.5
```

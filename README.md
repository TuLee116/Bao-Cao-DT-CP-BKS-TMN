# Báo cáo doanh thu – chi phí (DT-CP) công trình

Web theo dõi doanh thu – chi phí công trình của Tân Minh Nhân từ file Excel **"Bảng tổng hợp theo dõi doanh thu - chi phí"**, có đăng nhập và phân quyền. Chạy trên **Railway** (hoặc Vercel), dữ liệu lưu trong **PostgreSQL**.

- **Dữ liệu** (admin): tải file DT-CP lên; mỗi lần tải là một **mốc** (ngày lấy từ dòng "CẬP NHẬT: NGÀY …"). Web tự nhận công ty, khu vực, công trình, hợp đồng (mã DT-CP, số HĐ), phụ lục, chủ đầu tư (mã trong số HĐ, ví dụ `12/2026/HĐ/ABC-TMN` → ABC) và giai đoạn (cột THỜI ĐIỂM). Có bước xem trước, đối chiếu tổng và cảnh báo lỗi trong file (mã DT-CP trùng, thiếu cột công ty, thiếu STT…).
- **Tổng quan**: lọc theo mốc, công ty, khu vực, chủ đầu tư, giai đoạn, công trình, tìm kiếm; chỉ số chính có so sánh với mốc liền trước; biểu đồ theo khu vực, công ty, chủ đầu tư, giai đoạn, công trình (bấm để lọc); cơ cấu 15 khoản chi phí trực tiếp; bảng nhiều tầng Khu vực › Công trình › Hợp đồng; xuất Excel.
- **So sánh**: giữa hai mốc bất kỳ (theo hợp đồng, công trình, khu vực, công ty, chủ đầu tư, giai đoạn; đánh dấu hợp đồng mới, không còn, thay đổi, đổi giai đoạn; biểu đồ thay đổi lớn nhất; xuất Excel) hoặc giữa các giai đoạn trong một mốc.
- **Hợp đồng**: số liệu mốc đang xem, diễn biến qua mọi mốc, các dòng Hợp đồng/Phụ lục theo nhóm chi phí, ghi chú.
- **Danh mục** (admin): đặt tên hiển thị cho mã công ty, khu vực, chủ đầu tư, giai đoạn, 15 khoản chi phí.
- **Tùy biến** (admin): tiêu đề, tên gọi các chỉ số/nhóm, thêm/sửa/ẩn/sắp xếp biểu đồ, có xem trước.
- **Người dùng** (admin): tạo tài khoản, đổi vai trò, khóa/mở khóa, đặt lại mật khẩu.

Số liệu lưu đúng đơn vị **đồng** như file; bảng hiển thị triệu đồng, biểu đồ hiển thị tỷ đồng. %CPTT/DT = tổng chi phí trực tiếp ÷ doanh thu thời điểm.

Cách tính khớp với dòng TỔNG CỘNG của file: web cộng các dòng Hợp đồng/Phụ lục dưới mỗi hợp đồng; hợp đồng không có dòng chi tiết thì lấy số ngay trên dòng hợp đồng. Mã DT-CP bị trùng trong file sẽ bị cộng chung (web cảnh báo khi tải lên).

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

Railway build bằng `Dockerfile` trong repo và tự triển khai lại mỗi lần push lên nhánh đã chọn. `Dockerfile` cũng dùng được cho Coolify hoặc bất kỳ máy chủ nào có Docker.

## Triển khai lên Vercel

Gói Hobby miễn phí nhưng theo điều khoản của Vercel chỉ dành cho mục đích phi thương mại. Web dùng cho công ty nên dùng gói Pro.

1. Đăng nhập https://vercel.com bằng GitHub → **Add New → Project** → chọn repo này. Framework Preset: **Other**, để trống Build Command, bấm **Deploy**.
2. Vào project → **Storage → Create Database → Neon (Postgres)** → kết nối với project. Vercel tự thêm biến `DATABASE_URL`.
3. **Deployments → Redeploy** để nhận biến mới.
4. Mở địa chỉ `https://xxx.vercel.app` và tạo tài khoản admin đầu tiên.

Ghi chú: trên Vercel, giới hạn đăng nhập sai được đếm riêng cho từng phiên bản máy chủ nên kém chặt hơn trên Railway.

## Chế độ demo

Khi không có máy chủ (ví dụ mở qua GitHub Pages hoặc chỉ phục vụ thư mục `public/`), web tự chạy **chế độ demo** với **số liệu giả** (3 mốc, tên công trình/chủ đầu tư giả), lưu trong trình duyệt. Chỉ để xem thử. Repo này công khai nên **không đưa file số liệu thật vào repo**; hãy tải file thật lên web đã triển khai.

## Chạy trên máy

Cần Node.js 18+ và PostgreSQL.

```bash
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/baocao npm start
# mở http://localhost:3000
```

Bảng dữ liệu được tạo tự động lần đầu máy chủ nhận yêu cầu (xem `server/schema.js`).

## Định dạng file nhập

Dùng mẫu bảng tổng hợp DT-CP hiện tại (sheet đầu tiên có dòng tiêu đề). Web tìm cột theo **tên tiêu đề**, không theo vị trí:
`STT`, `CÔNG TY`, `KÝ HIỆU DT-CP`, `TÊN CÔNG TRÌNH`, `THỜI ĐIỂM`, `GIÁ TRỊ HỢP ĐỒNG`, `GIÁ TRỊ SẢN LƯỢNG ĐẾN…`, `GIÁ TRỊ SẢN LƯỢNG HỒ SƠ ĐẾN…`, `GIÁ TRỊ TIỀN VỀ ĐẾN…`, `DOANH THU THỜI ĐIỂM`, 15 cột từ `CHI PHÍ TRỰC TIẾP` tới trước `GIÁ TRỊ CHI PHÍ`.

Cấu trúc dòng: nhóm công ty (B1, B2…) → khu vực (I, II… "KHU VỰC …") → công trình (STT số, mã như `KV1.1-14`) → hợp đồng (có CÔNG TY, mã như `KV1.1-14.01`) → các dòng "Hợp đồng", "Phụ lục 01"… Dòng "TỔNG CỘNG" kết thúc bảng.

## Cấu trúc

```
server.js              Chạy máy chủ (Railway / trên máy)
Dockerfile             Build cho Railway / Coolify / Docker
api/index.js           Điểm vào cho Vercel
server/app.js          API: đăng nhập, phân quyền, mốc dữ liệu, danh mục, ghi chú, người dùng
server/db.js           Kết nối PostgreSQL (DATABASE_URL), tự tạo bảng
server/schema.js       Lược đồ bảng
public/                Giao diện
  js/dtcp.js           Đọc file Excel DT-CP và tổng hợp số liệu
  js/app.js            Các trang
  js/api.js            Gọi API máy chủ, hoặc chế độ demo
  js/charts.js         Biểu đồ d3, định dạng số kiểu Việt Nam
  js/demo-seed.js      Số liệu GIẢ cho chế độ demo
  js/vendor/           d3 7.9.0, SheetJS 0.18.5
```

# Báo cáo doanh thu – chi phí

Web theo dõi doanh thu, chi phí và lợi nhuận theo tháng, có đăng nhập và phân quyền.

- **Tổng quan**: 4 chỉ số tháng gần nhất, biểu đồ doanh thu/chi phí/lợi nhuận, biên lợi nhuận, cơ cấu chi phí, doanh thu theo kênh, bảng lãi lỗ; lọc theo 12 tháng gần nhất, từng năm hoặc toàn bộ.
- **Ghi chú theo tháng**: mọi thành viên viết được; xóa ghi chú của mình, admin xóa được mọi ghi chú.
- **Nhập số liệu** (admin): thêm/sửa/xóa số liệu từng tháng.
- **Danh mục** (admin): thêm, đổi tên, sắp xếp, ẩn kênh bán và khoản mục chi phí.
- **Nhập từ file** (admin): tải lên Excel/CSV nhiều tháng, xem trước rồi mới ghi; tải file mẫu và xuất toàn bộ số liệu ra Excel.
- **Người dùng** (admin): duyệt tài khoản mới, đổi vai trò.

Đơn vị số tiền: **triệu đồng**. Lợi nhuận = doanh thu − tổng chi phí (trước thuế TNDN).

## Vai trò

| Vai trò | Xem báo cáo | Viết ghi chú | Sửa số liệu, danh mục, duyệt người dùng |
|---|---|---|---|
| Admin | ✓ | ✓ | ✓ |
| Người xem | ✓ | ✓ | |
| Chờ duyệt | | | |

Người mới tự đăng ký ở trang đăng nhập và ở trạng thái **Chờ duyệt** cho tới khi admin cấp quyền.
**Tài khoản đầu tiên đăng ký sẽ tự động là Admin**, vì vậy hãy đăng ký tài khoản của bạn ngay sau khi cài đặt.

## Hai chế độ chạy

- **Chế độ demo** (mặc định khi `js/config.js` để trống): không cần máy chủ, dữ liệu mẫu lưu trong trình duyệt của từng người. Chỉ để xem thử.
- **Chế độ Supabase**: đăng nhập thật, dữ liệu dùng chung, phân quyền kiểm soát ở cơ sở dữ liệu (Row Level Security).

## Cài đặt Supabase (khoảng 10 phút)

1. Tạo tài khoản và project miễn phí tại https://supabase.com (chọn vùng Singapore cho gần Việt Nam). Ghi lại mật khẩu database.
2. Vào **SQL Editor → New query**, dán toàn bộ nội dung `supabase/schema.sql`, bấm **Run**.
3. Vào **Authentication → URL Configuration**:
   - **Site URL**: `https://tulee116.github.io/Bao-Cao-DT-CP-BKS-TMN/`
   - **Redirect URLs**: thêm `https://tulee116.github.io/Bao-Cao-DT-CP-BKS-TMN/` (và `http://localhost:8000/` nếu chạy thử trên máy).
4. Vào **Project Settings → API**, sao chép **Project URL** và khóa **anon public**, dán vào `js/config.js`:
   ```js
   SUPABASE_URL: 'https://xxxx.supabase.co',
   SUPABASE_ANON_KEY: 'eyJhbGciOi...',
   ```
   Khóa *anon* là khóa công khai, để trong mã nguồn là bình thường vì quyền truy cập được chặn bằng RLS.
   **Tuyệt đối không dán khóa `service_role`.**
5. Commit và push. Mở web, chọn **Đăng ký** và tạo tài khoản đầu tiên (sẽ là Admin). Mở email xác nhận **trong cùng trình duyệt** rồi đăng nhập.
6. (Tùy chọn) Có sẵn số liệu mẫu: sau khi đã có tài khoản admin, chạy `supabase/seed.sql` trong SQL Editor. Hoặc nhập số thật bằng trang **Nhập từ file**.

Ghi chú:
- Gói miễn phí của Supabase giới hạn số email gửi mỗi giờ. Khi có nhiều người đăng ký, nên cấu hình SMTP riêng (Authentication → Emails → SMTP).
- Project miễn phí tạm dừng sau 7 ngày không có truy cập; vào trang Supabase bấm **Restore** để chạy lại.
- Muốn tắt tự đăng ký: Authentication → Sign In / Providers → tắt **Allow new users to sign up**, rồi mời người dùng bằng **Authentication → Users → Invite**.
- Link xác nhận email và link đặt lại mật khẩu cần mở trên cùng trình duyệt đã gửi yêu cầu.

## Định dạng file nhập

Dòng đầu là tiêu đề. Cột `Tháng` (dạng `2026-09` hoặc `09/2026`), các cột `DT: <tên kênh>` là doanh thu và `CP: <tên khoản mục>` là chi phí. Ví dụ: `data/mau-nhap-lieu.csv`.

| Tháng | DT: Bán lẻ cửa hàng | DT: Thương mại điện tử | CP: Giá vốn hàng bán | CP: Nhân sự |
|---|---|---|---|---|
| 2026-09 | 1059 | 1100 | 1489 | 442 |

Ô để trống thì giữ nguyên số liệu đang có. Cột có tên kênh/khoản mục chưa tồn tại thì web hỏi có tạo mới không.

## Đưa lên web bằng GitHub Pages

**Settings → Pages → Build and deployment**: chọn **Deploy from a branch**, branch `main`, thư mục `/ (root)`.
Trang chạy tại `https://tulee116.github.io/Bao-Cao-DT-CP-BKS-TMN/`.

## Chạy trên máy

```bash
python3 -m http.server 8000
# mở http://localhost:8000
```

## Cấu trúc

```
index.html              Khung trang
css/app.css             Giao diện (sáng/tối)
js/config.js            Cấu hình Supabase
js/api.js               Truy cập dữ liệu: Supabase hoặc demo (localStorage)
js/app.js               Các trang: đăng nhập, tổng quan, nhập liệu, danh mục, nhập file, người dùng
js/charts.js            Biểu đồ d3 và định dạng số kiểu Việt Nam
js/demo-seed.js         Dữ liệu mẫu cho chế độ demo
js/vendor/              d3 7.9.0, supabase-js 2.45.4, SheetJS 0.18.5 (đóng gói sẵn)
supabase/schema.sql     Bảng, vai trò, phân quyền RLS
supabase/seed.sql       Dữ liệu mẫu (tùy chọn)
data/mau-nhap-lieu.csv  File mẫu để nhập
```

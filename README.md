# Hệ thống Quản lý dự án – BKS

Web quản lý dự án xây dựng có đăng nhập, phân quyền, khởi tạo lần đầu. Chạy trên Railway, deploy tự động từ GitHub.

**Công nghệ:** Node.js 18+ · Express · PostgreSQL. Ngoài `express` và `pg` không dùng thư viện nào khác. Mật khẩu được mã hóa bằng scrypt.

## Chức năng
| Mục | Mô tả |
|---|---|
| **Khởi tạo lần đầu** (`/setup`) | Khi chưa có tài khoản nào: nhập tên công ty, tên hệ thống, tạo tài khoản Quản trị. Sau đó trang này tự khóa. |
| **Đăng nhập** (`/login`) | Phiên lưu 7 ngày trong CSDL. Sai quá 10 lần trong 15 phút thì bị chặn tạm. |
| **Dự án** | Dashboard KPI, thêm/sửa/xóa, tìm kiếm không dấu, xuất CSV cho Excel, ghi nhận người cập nhật. |
| **Doanh thu** | Theo từng công trình: (1) Hợp đồng/Phụ lục, (2) Hoàn thành/Quyết toán – nhiều dòng, tự tính VAT, sau VAT, dòng tổng; (3) Giá trị tiền về – Tạm ứng, TT Đợt 1..n (chèn dòng), Quyết toán, sửa trực tiếp trên bảng. Ngày nhập dạng dd/mm/yyyy. |
| **Chi phí** | Theo từng công trình, 6 nhóm: Thầu phụ · Vật tư (chính/phụ) · Nhân công (giao khoán, công nhật, vận chuyển, vệ sinh/sắp xếp thiết bị, bao che/biện pháp, thí nghiệm) · Máy móc thiết bị · Tổ chức thi công/VP · Chi phí khác. Tự tính VAT, bảng cây có tổng và tỷ trọng từng nhóm. Dùng chung công trình đang chọn với tab Doanh thu. |
| **Tài khoản** (Quản trị) | Tạo / sửa / khóa / xóa tài khoản, đặt lại mật khẩu, phân quyền. |
| **Cài đặt** (Quản trị) | Đổi tên công ty, tên hệ thống. |
| **Cá nhân** | Đổi mật khẩu của chính mình. |

### Công thức Doanh thu
- **Tiền VAT** = làm tròn(Giá trị trước VAT × VAT% ÷ 100), VAT là số nguyên 0–100
- **Giá trị sau VAT** = Giá trị trước VAT + Tiền VAT
- **VAT = 0%** (hoặc để trống) → chưa có VAT: Giá trị sau VAT = Giá trị trước VAT, đánh dấu **Tạm tính**
- Cho phép giá trị âm (phụ lục giảm). Tính bằng số nguyên chính xác, không sai lệch làm tròn số thực.

### Liên kết HĐ/PL
- Mục 1: chọn **Loại** (HĐ, PL01, PL02...) + nhập **Số mã HĐ** → hiển thị "HĐ ABC-123", "PL01 ABC-123". Không trùng trong cùng công trình. Chọn PL khi chưa nhập Số mã sẽ tự lấy Số mã của HĐ.
- Mục 2: mỗi dòng HT/QT bắt buộc chọn **Số HĐ** (chỉ hợp đồng gốc, không chọn PL) từ ô tìm kiếm có gợi ý; gợi ý kèm giá trị HĐ tổng = HĐ + các PL cùng Số mã.
- Mục 3: mỗi dòng tiền về chọn **Số HĐ** (hợp đồng gốc). Số đợt và Quyết toán tính riêng theo từng HĐ; bảng nhóm theo HĐ, có dòng Cộng tiền về từng HĐ. Dữ liệu cũ: công trình có đúng 1 HĐ thì tự gắn, nhiều HĐ thì hiện "Chưa chọn HĐ" để chọn.
- Không xóa được (và không đổi thành PL) một HĐ đang được dòng HT/QT hoặc Tiền về tham chiếu.
- Dữ liệu cũ dạng "HĐ ABC-123" tự tách thành Loại + Số mã khi máy chủ khởi động.

### Passcode xóa Số HĐ/PL
- Quản trị đặt/đổi ở tab **Cài đặt** (phải nhập lại mật khẩu đăng nhập). Passcode gồm đúng 8 chữ số, chặn dãy dễ đoán; lưu dạng mã hóa một chiều.
- Xóa dòng HĐ/PL ở mục 1 bắt buộc nhập passcode; chưa đặt passcode thì không ai xóa được.
- HĐ đang có PL / HT/QT / Tiền về gắn vào: hộp xác nhận liệt kê toàn bộ dữ liệu kèm theo; nhập đúng passcode sẽ **xóa toàn bộ hợp đồng** (HĐ + PL cùng Số mã + HT/QT + Tiền về) trong một giao dịch.
- Sai 5 lần / 15 phút → khóa chức năng xóa của tài khoản đó 15 phút.
- Mọi lần đặt passcode và xóa HĐ/PL đều ghi nhật ký `[NHẬT KÝ]` trong log máy chủ (Railway → Deploy Logs).

### Thầu phụ (nhóm 1 Chi phí) – theo hợp đồng
- Form Thêm chi phí, chọn nhóm **1. Thầu phụ** → tạo HĐ thầu phụ: Số HĐ, Nhà thầu phụ, Ngày ký, Giá trị HĐ, VAT, Ghi chú.
- Bảng **1. Thầu phụ – theo hợp đồng**: Số HĐ | Nhà thầu phụ | Tổng giá trị HĐ (gồm PL) | Tổng giá trị HT/QT | Giá trị thanh toán | Giá trị còn lại | Ghi chú.
- **Nhấp đúp vào Số HĐ thầu phụ** (hoặc nút Chi tiết, hoặc nhấp đúp ô Số HĐ thầu phụ trên form) → bảng nhập chi tiết:
  - HĐ/PL (tập con HĐ → PL01, PL02...): Ngày, Giá trị trước VAT, VAT, Giá trị HT/QT (trống = chưa quyết toán → bằng giá trị HĐ/PL).
  - Thanh toán: Tạm ứng / TT Đợt n / Quyết toán.
  - **Còn lại = HT/QT sau VAT − Thanh toán.**
- Nhóm 1 trong tổng chi phí = tổng giá trị HT/QT của các HĐ thầu phụ.
- Xóa HĐ thầu phụ hoặc PL cần Passcode; dòng HĐ gốc chỉ xóa cùng cả hợp đồng.

### Phân quyền
| Quyền | Xem dự án | Thêm/sửa/xóa dự án | Quản lý tài khoản & cài đặt |
|---|:-:|:-:|:-:|
| Quản trị | ✔ | ✔ | ✔ |
| Nhập liệu | ✔ | ✔ | |
| Chỉ xem | ✔ | | |

### Quy tắc mật khẩu
Áp dụng khi khởi tạo, tạo tài khoản, đặt lại và đổi mật khẩu. Máy chủ kiểm tra bắt buộc; giao diện hiện danh sách điều kiện ✓/✗ ngay khi gõ.
- Tối thiểu 8 ký tự (tối đa 128), không có khoảng trắng
- Có chữ viết hoa, chữ viết thường, chữ số và ký tự đặc biệt
- Không chứa tên đăng nhập; mật khẩu mới phải khác mật khẩu hiện tại

Mật khẩu cũ đặt theo quy tắc trước vẫn đăng nhập được; quy tắc mới áp dụng từ lần đổi mật khẩu kế tiếp.

Các ràng buộc an toàn:
- Luôn phải còn ít nhất 1 Quản trị đang hoạt động.
- Không ai tự hạ quyền, tự khóa hoặc tự xóa tài khoản của chính mình.
- Khi bị khóa, đổi quyền hoặc đặt lại mật khẩu, người dùng bị đăng xuất ngay.

## Cấu trúc
```
server.js          # Trang + API
lib/db.js          # PostgreSQL (tự tạo bảng) / bộ nhớ tạm khi chạy thử
lib/auth.js        # Mật khẩu, phiên đăng nhập, phân quyền, chống dò mật khẩu
lib/validate.js    # Kiểm tra dữ liệu
views/             # index.html, login.html, setup.html
public/            # CSS + JS giao diện
railway.json       # Cấu hình deploy
```

## Deploy lên Railway
1. Railway → **New Project → Deploy from GitHub repo** → chọn repo này.
2. Trong project: **+ Create → Database → PostgreSQL**. Chờ báo *Active*.
3. Service web → **Variables**:
   | Biến | Giá trị |
   |---|---|
   | `DATABASE_URL` | **New Variable → Add Reference → Postgres → DATABASE_URL**, hoặc dán giá trị copy từ tab Variables của Postgres |
   | `SETUP_TOKEN` | Một chuỗi bí mật bất kỳ (khuyến nghị) |
4. **Settings → Networking → Generate Domain**.
5. Mở domain → trang **Khởi tạo hệ thống** hiện ra → nhập thông tin → xong.
6. Kiểm tra `https://<domain>/health` → `{"status":"ok","db":"postgres"}`.

> Các biến `APP_USER` / `APP_PASS` của bản cũ không còn dùng, có thể xóa.
> Nếu web hiện thanh vàng *"chưa kết nối PostgreSQL"* thì `DATABASE_URL` đang rỗng: xem lại bước 2–3.

## Chạy thử trên máy
```bash
npm install
npm start            # http://localhost:3000 – dùng bộ nhớ tạm
```

## API
| Method | URL | Quyền |
|---|---|---|
| GET | `/health` | Công khai |
| GET | `/api/meta` | Công khai |
| POST | `/api/setup` | Chỉ khi chưa có tài khoản |
| POST | `/api/auth/login`, `/api/auth/logout` | Công khai |
| GET | `/api/auth/me` · POST `/api/auth/change-password` | Đã đăng nhập |
| GET | `/api/du-an` | Đã đăng nhập |
| POST/PUT/DELETE | `/api/du-an[/:id]` | Quản trị, Nhập liệu |
| GET/POST/PUT/DELETE | `/api/users[/:id]` | Quản trị |
| GET/PUT | `/api/settings` | GET: đã đăng nhập · PUT: Quản trị |

Mọi request POST/PUT/DELETE phải có header `X-Requested-With: fetch` (chống CSRF).

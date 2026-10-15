# Web Quản lý dự án xây dựng (Railway + GitHub)

Node.js + Express + PostgreSQL. Có dashboard KPI, thêm/sửa/xóa dự án, tìm kiếm, xuất CSV cho Excel.

## Cấu trúc
```
server.js        # Máy chủ + API (/api/du-an), /health, đăng nhập
db.js            # Kết nối PostgreSQL (hoặc bộ nhớ tạm khi chạy thử)
public/          # Giao diện: index.html, style.css, app.js
railway.json     # Cấu hình deploy Railway
.env.example     # Mẫu biến môi trường
```

## Chạy thử trên máy
```bash
npm install
npm start        # mở http://localhost:3000
```
Không có `DATABASE_URL` → dữ liệu lưu tạm trong bộ nhớ (mất khi tắt).

## Deploy lên Railway qua GitHub
1. **Đẩy code lên GitHub**
   ```bash
   git remote add origin https://github.com/<tai-khoan>/qlda-web.git
   git push -u origin main
   ```
2. **Railway** → New Project → *Deploy from GitHub repo* → chọn repo `qlda-web`.
3. Trong project: **+ New → Database → PostgreSQL**.
4. Vào service web → **Variables**, thêm:
   | Biến | Giá trị |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (chọn từ gợi ý) |
   | `APP_USER` | tên đăng nhập |
   | `APP_PASS` | mật khẩu mạnh |
5. **Settings → Networking → Generate Domain** để có link truy cập.
6. Mỗi lần `git push` lên nhánh `main`, Railway tự build & deploy lại.

Bảng `du_an` được tạo tự động lần chạy đầu. Kiểm tra: `https://<domain>/health` → `{"status":"ok","db":"postgres"}`.

## API
| Method | URL | Mô tả |
|---|---|---|
| GET | `/api/du-an` | Danh sách dự án |
| POST | `/api/du-an` | Thêm |
| PUT | `/api/du-an/:id` | Sửa |
| DELETE | `/api/du-an/:id` | Xóa |
| GET | `/health` | Kiểm tra hệ thống |

Ràng buộc dữ liệu: bắt buộc mã + tên dự án; mã không trùng; giải ngân ≤ giá trị HĐ; tiến độ 0–100%; ngày kết thúc ≥ ngày bắt đầu.

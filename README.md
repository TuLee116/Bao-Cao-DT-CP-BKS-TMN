# Báo cáo doanh thu – chi phí

Dashboard tĩnh (HTML + d3) hiển thị doanh thu, chi phí, lợi nhuận và biên lợi nhuận theo tháng, cơ cấu chi phí và doanh thu theo kênh bán.

> Số liệu hiện tại là **dữ liệu mẫu**. Thay bằng số thật bằng cách sửa các file trong `data/`.

## Cấu trúc

```
index.html                              Trang dashboard
js/dash.js                              Đọc CSV, tính chỉ số, vẽ lại khi dữ liệu/kích thước thay đổi
js/d3.min.js                            d3 v7.9.0 (đóng gói sẵn, không cần CDN)
data/doanh-thu-chi-phi-theo-thang.csv   thang, doanh_thu, gia_von, chi_phi_ban_hang, chi_phi_nhan_su, chi_phi_quan_ly, chi_phi_tai_chinh
data/doanh-thu-theo-kenh.csv            thang, kenh, doanh_thu
```

Đơn vị: triệu đồng. Cột `thang` có dạng `YYYY-MM`.

Cách tính:
- Tổng chi phí = giá vốn + bán hàng + nhân sự + quản lý + tài chính
- Lợi nhuận (trước thuế) = doanh thu − tổng chi phí
- Biên lợi nhuận = lợi nhuận ÷ doanh thu

## Chạy trên máy

Trang đọc CSV bằng `fetch`, nên cần một web server (mở trực tiếp file `index.html` sẽ không tải được dữ liệu):

```bash
python3 -m http.server 8000
# mở http://localhost:8000
```

## Đưa lên web bằng GitHub Pages

1. Đẩy repo lên GitHub.
2. Vào **Settings → Pages**, mục **Build and deployment** chọn **Deploy from a branch**, branch `main`, thư mục `/ (root)`.
3. Sau khoảng 1 phút trang có tại `https://<tên-tài-khoản>.github.io/<tên-repo>/`.

Mỗi lần sửa CSV và push, trang tự cập nhật.

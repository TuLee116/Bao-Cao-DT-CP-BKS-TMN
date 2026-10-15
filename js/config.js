// Cấu hình kết nối Supabase.
// Lấy hai giá trị này trong Supabase → Project Settings → API:
//   - Project URL           → SUPABASE_URL
//   - anon / public API key → SUPABASE_ANON_KEY  (khóa công khai, được phép để trong mã nguồn)
// KHÔNG BAO GIỜ dán khóa "service_role" vào đây.
// Để trống cả hai thì web chạy ở chế độ demo: dữ liệu lưu trong trình duyệt của từng người.
window.APP_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  APP_NAME: 'Báo cáo doanh thu – chi phí'
};

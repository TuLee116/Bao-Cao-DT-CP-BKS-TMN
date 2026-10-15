-- Dữ liệu MẪU (không phải số liệu thật): 12 tháng T10/2025–T9/2026, đơn vị triệu đồng.

-- Chạy sau schema.sql nếu muốn có sẵn số liệu để xem thử. Có thể xóa sau trong trang Nhập số liệu.

begin;

insert into public.channels (name, sort_order) values
  ('Bán lẻ cửa hàng', 1),
  ('Thương mại điện tử', 2),
  ('Bán sỉ / đại lý', 3)
on conflict (name) do nothing;

insert into public.expense_categories (name, sort_order) values
  ('Giá vốn hàng bán', 1),
  ('Nhân sự', 2),
  ('Quản lý doanh nghiệp', 3),
  ('Bán hàng & marketing', 4),
  ('Tài chính (lãi vay)', 5)
on conflict (name) do nothing;

insert into public.revenue_entries (month, channel_id, amount)
select v.month::date, c.id, v.amount from (values
  ('2025-10-01', 'Bán lẻ cửa hàng', 911),
  ('2025-10-01', 'Thương mại điện tử', 706),
  ('2025-10-01', 'Bán sỉ / đại lý', 557),
  ('2025-11-01', 'Bán lẻ cửa hàng', 945),
  ('2025-11-01', 'Thương mại điện tử', 785),
  ('2025-11-01', 'Bán sỉ / đại lý', 565),
  ('2025-12-01', 'Bán lẻ cửa hàng', 1106),
  ('2025-12-01', 'Thương mại điện tử', 932),
  ('2025-12-01', 'Bán sỉ / đại lý', 658),
  ('2026-01-01', 'Bán lẻ cửa hàng', 1192),
  ('2026-01-01', 'Thương mại điện tử', 1000),
  ('2026-01-01', 'Bán sỉ / đại lý', 723),
  ('2026-02-01', 'Bán lẻ cửa hàng', 860),
  ('2026-02-01', 'Thương mại điện tử', 711),
  ('2026-02-01', 'Bán sỉ / đại lý', 496),
  ('2026-03-01', 'Bán lẻ cửa hàng', 911),
  ('2026-03-01', 'Thương mại điện tử', 792),
  ('2026-03-01', 'Bán sỉ / đại lý', 563),
  ('2026-04-01', 'Bán lẻ cửa hàng', 971),
  ('2026-04-01', 'Thương mại điện tử', 844),
  ('2026-04-01', 'Bán sỉ / đại lý', 597),
  ('2026-05-01', 'Bán lẻ cửa hàng', 948),
  ('2026-05-01', 'Thương mại điện tử', 918),
  ('2026-05-01', 'Bán sỉ / đại lý', 606),
  ('2026-06-01', 'Bán lẻ cửa hàng', 1020),
  ('2026-06-01', 'Thương mại điện tử', 952),
  ('2026-06-01', 'Bán sỉ / đại lý', 630),
  ('2026-07-01', 'Bán lẻ cửa hàng', 1047),
  ('2026-07-01', 'Thương mại điện tử', 1037),
  ('2026-07-01', 'Bán sỉ / đại lý', 643),
  ('2026-08-01', 'Bán lẻ cửa hàng', 1028),
  ('2026-08-01', 'Thương mại điện tử', 1009),
  ('2026-08-01', 'Bán sỉ / đại lý', 618),
  ('2026-09-01', 'Bán lẻ cửa hàng', 1059),
  ('2026-09-01', 'Thương mại điện tử', 1100),
  ('2026-09-01', 'Bán sỉ / đại lý', 669)
) as v(month, name, amount) join public.channels c on c.name = v.name
on conflict (month, channel_id) do update set amount = excluded.amount;

insert into public.expense_entries (month, category_id, amount)
select v.month::date, c.id, v.amount from (values
  ('2025-10-01', 'Giá vốn hàng bán', 1092),
  ('2025-10-01', 'Nhân sự', 371),
  ('2025-10-01', 'Quản lý doanh nghiệp', 307),
  ('2025-10-01', 'Bán hàng & marketing', 200),
  ('2025-10-01', 'Tài chính (lãi vay)', 42),
  ('2025-11-01', 'Giá vốn hàng bán', 1154),
  ('2025-11-01', 'Nhân sự', 378),
  ('2025-11-01', 'Quản lý doanh nghiệp', 322),
  ('2025-11-01', 'Bán hàng & marketing', 208),
  ('2025-11-01', 'Tài chính (lãi vay)', 40),
  ('2025-12-01', 'Giá vốn hàng bán', 1380),
  ('2025-12-01', 'Nhân sự', 399),
  ('2025-12-01', 'Quản lý doanh nghiệp', 307),
  ('2025-12-01', 'Bán hàng & marketing', 321),
  ('2025-12-01', 'Tài chính (lãi vay)', 40),
  ('2026-01-01', 'Giá vốn hàng bán', 1529),
  ('2026-01-01', 'Nhân sự', 661),
  ('2026-01-01', 'Quản lý doanh nghiệp', 324),
  ('2026-01-01', 'Bán hàng & marketing', 315),
  ('2026-01-01', 'Tài chính (lãi vay)', 41),
  ('2026-02-01', 'Giá vốn hàng bán', 1046),
  ('2026-02-01', 'Nhân sự', 400),
  ('2026-02-01', 'Quản lý doanh nghiệp', 324),
  ('2026-02-01', 'Bán hàng & marketing', 193),
  ('2026-02-01', 'Tài chính (lãi vay)', 43),
  ('2026-03-01', 'Giá vốn hàng bán', 1181),
  ('2026-03-01', 'Nhân sự', 411),
  ('2026-03-01', 'Quản lý doanh nghiệp', 332),
  ('2026-03-01', 'Bán hàng & marketing', 200),
  ('2026-03-01', 'Tài chính (lãi vay)', 45),
  ('2026-04-01', 'Giá vốn hàng bán', 1215),
  ('2026-04-01', 'Nhân sự', 409),
  ('2026-04-01', 'Quản lý doanh nghiệp', 340),
  ('2026-04-01', 'Bán hàng & marketing', 218),
  ('2026-04-01', 'Tài chính (lãi vay)', 42),
  ('2026-05-01', 'Giá vốn hàng bán', 1278),
  ('2026-05-01', 'Nhân sự', 426),
  ('2026-05-01', 'Quản lý doanh nghiệp', 334),
  ('2026-05-01', 'Bán hàng & marketing', 237),
  ('2026-05-01', 'Tài chính (lãi vay)', 43),
  ('2026-06-01', 'Giá vốn hàng bán', 1375),
  ('2026-06-01', 'Nhân sự', 419),
  ('2026-06-01', 'Quản lý doanh nghiệp', 346),
  ('2026-06-01', 'Bán hàng & marketing', 237),
  ('2026-06-01', 'Tài chính (lãi vay)', 44),
  ('2026-07-01', 'Giá vốn hàng bán', 1387),
  ('2026-07-01', 'Nhân sự', 424),
  ('2026-07-01', 'Quản lý doanh nghiệp', 350),
  ('2026-07-01', 'Bán hàng & marketing', 245),
  ('2026-07-01', 'Tài chính (lãi vay)', 42),
  ('2026-08-01', 'Giá vốn hàng bán', 1389),
  ('2026-08-01', 'Nhân sự', 438),
  ('2026-08-01', 'Quản lý doanh nghiệp', 344),
  ('2026-08-01', 'Bán hàng & marketing', 231),
  ('2026-08-01', 'Tài chính (lãi vay)', 45),
  ('2026-09-01', 'Giá vốn hàng bán', 1489),
  ('2026-09-01', 'Nhân sự', 442),
  ('2026-09-01', 'Quản lý doanh nghiệp', 363),
  ('2026-09-01', 'Bán hàng & marketing', 269),
  ('2026-09-01', 'Tài chính (lãi vay)', 41)
) as v(month, name, amount) join public.expense_categories c on c.name = v.name
on conflict (month, category_id) do update set amount = excluded.amount;

insert into public.month_notes (month, content, author_id, author_name)
select '2026-01-01', 'Chi phí nhân sự tăng do thưởng Tết; biên lợi nhuận tháng này thấp nhất năm.', id, 'Dữ liệu mẫu'
from public.profiles where role = 'admin' order by created_at limit 1;

commit;

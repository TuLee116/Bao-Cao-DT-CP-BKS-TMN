// Lược đồ PostgreSQL. Chạy tự động (idempotent) khi máy chủ nhận yêu cầu API đầu tiên.
// Đơn vị số tiền: triệu đồng. Cột month luôn là ngày 1 của tháng.
module.exports = `
create table if not exists users (
  id             integer generated always as identity primary key,
  username       text not null,
  full_name      text not null default '',
  role           text not null default 'viewer' check (role in ('admin', 'viewer')),
  password_hash  text not null,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
create unique index if not exists users_username_key on users (lower(username));

create table if not exists sessions (
  token_hash  text primary key,
  user_id     integer not null references users(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists sessions_user_idx on sessions (user_id);

-- Mã QR đăng nhập trên điện thoại: tạo từ phiên đang đăng nhập, dùng 1 lần, hết hạn sau 2 phút. Chỉ lưu băm.
create table if not exists login_qr (
  token_hash  text primary key,
  user_id     integer not null references users(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists login_qr_user_idx on login_qr (user_id);

-- Mốc dữ liệu: mỗi lần tải file DT-CP lên là một mốc (ngày cập nhật của file).
create table if not exists snapshots (
  id           integer generated always as identity primary key,
  report_date  date not null,
  label        text not null default '',
  file_name    text not null default '',
  cost_labels  jsonb not null default '{}',
  line_count   integer not null default 0,
  created_at   timestamptz not null default now(),
  created_by   integer references users(id) on delete set null
);

-- Dòng Hợp đồng/Phụ lục của từng mốc. vals: hd, sl, slhs, tv, dt và 15 khoản chi phí k..y (đồng).
create table if not exists snapshot_lines (
  snapshot_id     integer not null references snapshots(id) on delete cascade,
  seq             integer not null,
  company         text not null default '',
  region          text not null default '',
  region_name     text not null default '',
  project_code    text not null default '',
  project_name    text not null default '',
  project_stage   text not null default '',
  contract_code   text not null default '',
  contract_no     text not null default '',
  contract_title  text not null default '',
  investor        text not null default '',
  stage           text not null default '',
  line_label      text not null default '',
  vals            jsonb not null default '{}',
  primary key (snapshot_id, seq)
);
create index if not exists snapshot_lines_contract_idx on snapshot_lines (contract_code);

-- Tên hiển thị cho mã: công ty, khu vực, chủ đầu tư, thời điểm, khoản chi phí.
create table if not exists catalog (
  kind  text not null,
  code  text not null,
  name  text not null,
  sort  integer not null default 0,
  primary key (kind, code)
);

-- Ghi chú theo hợp đồng (mã DT-CP).
create table if not exists contract_notes (
  id             integer generated always as identity primary key,
  contract_code  text not null,
  content        text not null check (length(trim(content)) between 1 and 4000),
  author_id      integer references users(id) on delete set null,
  author_name    text not null default '',
  created_at     timestamptz not null default now()
);
create index if not exists contract_notes_code_idx on contract_notes (contract_code);

-- Cấu hình dùng chung (ví dụ bố cục dashboard do admin tùy biến), lưu dạng JSON.
create table if not exists app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  integer references users(id) on delete set null
);

-- Đổi từ ngữ "Giai đoạn" → "Thời điểm" (chạy một lần): chỉ đổi tên mặc định "Giai đoạn <mã>" trong danh mục,
-- tên admin tự đặt khác mẫu này giữ nguyên; đổi chữ trong cấu hình dashboard đã lưu.
do $$ begin
  if not exists (select 1 from app_settings where key = 'mig_thoi_diem') then
    update catalog set name = 'Thời điểm ' || code where kind = 'stage' and name = 'Giai đoạn ' || code;
    update app_settings set value = replace(replace(value::text, 'Giai đoạn', 'Thời điểm'), 'giai đoạn', 'thời điểm')::jsonb where key = 'dashboard_v2';
    insert into app_settings (key, value) values ('mig_thoi_diem', 'true');
  end if;
end $$;
`;

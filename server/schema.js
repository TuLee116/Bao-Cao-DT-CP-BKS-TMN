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

create table if not exists channels (
  id          integer generated always as identity primary key,
  name        text not null check (length(trim(name)) between 1 and 100),
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists channels_name_key on channels (lower(name));

create table if not exists expense_categories (
  id          integer generated always as identity primary key,
  name        text not null check (length(trim(name)) between 1 and 100),
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists expense_categories_name_key on expense_categories (lower(name));

create table if not exists revenue_entries (
  month       date not null check (extract(day from month) = 1),
  channel_id  integer not null references channels(id) on delete restrict,
  amount      numeric(18, 2) not null default 0 check (amount >= 0),
  updated_at  timestamptz not null default now(),
  updated_by  integer references users(id) on delete set null,
  primary key (month, channel_id)
);

create table if not exists expense_entries (
  month        date not null check (extract(day from month) = 1),
  category_id  integer not null references expense_categories(id) on delete restrict,
  amount       numeric(18, 2) not null default 0 check (amount >= 0),
  updated_at   timestamptz not null default now(),
  updated_by   integer references users(id) on delete set null,
  primary key (month, category_id)
);

create table if not exists month_notes (
  id           integer generated always as identity primary key,
  month        date not null check (extract(day from month) = 1),
  content      text not null check (length(trim(content)) between 1 and 4000),
  author_id    integer references users(id) on delete set null,
  author_name  text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists month_notes_month_idx on month_notes (month);
`;

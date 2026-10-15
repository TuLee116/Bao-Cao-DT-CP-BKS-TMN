-- =====================================================================
-- Báo cáo doanh thu – chi phí: lược đồ cơ sở dữ liệu cho Supabase
-- Chạy toàn bộ file này một lần trong Supabase → SQL Editor.
-- Đơn vị số tiền: triệu đồng.
-- =====================================================================

-- ---------- Người dùng & vai trò ----------
-- admin   : xem + thêm/sửa/xóa số liệu, danh mục, duyệt người dùng
-- viewer  : chỉ xem dashboard và viết ghi chú
-- pending : vừa đăng ký, chờ admin duyệt, chưa xem được gì
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  role        text not null default 'pending' check (role in ('admin', 'viewer', 'pending')),
  created_at  timestamptz not null default now()
);

-- Tài khoản đầu tiên đăng ký thành admin; các tài khoản sau chờ duyệt.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    case when exists (select 1 from public.profiles where role = 'admin') then 'pending' else 'admin' end
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin', 'viewer'), false)
$$;

-- Không cho hạ quyền admin cuối cùng (tránh khóa mình ra khỏi hệ thống).
create or replace function public.keep_one_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and new.role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'Phải còn ít nhất một admin.';
  end if;
  return new;
end $$;

drop trigger if exists profiles_keep_one_admin on public.profiles;
create trigger profiles_keep_one_admin
  before update of role on public.profiles
  for each row execute function public.keep_one_admin();

-- ---------- Danh mục ----------
create table if not exists public.channels (
  id          bigint generated always as identity primary key,
  name        text not null unique check (length(trim(name)) > 0),
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.expense_categories (
  id          bigint generated always as identity primary key,
  name        text not null unique check (length(trim(name)) > 0),
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------- Số liệu theo tháng ----------
-- month luôn là ngày 1 của tháng, ví dụ 2026-09-01.
create table if not exists public.revenue_entries (
  month       date not null check (extract(day from month) = 1),
  channel_id  bigint not null references public.channels(id) on delete restrict,
  amount      numeric(18, 2) not null default 0 check (amount >= 0),
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid() references auth.users(id) on delete set null,
  primary key (month, channel_id)
);

create table if not exists public.expense_entries (
  month        date not null check (extract(day from month) = 1),
  category_id  bigint not null references public.expense_categories(id) on delete restrict,
  amount       numeric(18, 2) not null default 0 check (amount >= 0),
  updated_at   timestamptz not null default now(),
  updated_by   uuid default auth.uid() references auth.users(id) on delete set null,
  primary key (month, category_id)
);

-- ---------- Ghi chú theo tháng ----------
create table if not exists public.month_notes (
  id           bigint generated always as identity primary key,
  month        date not null check (extract(day from month) = 1),
  content      text not null check (length(trim(content)) between 1 and 4000),
  author_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name  text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists month_notes_month_idx on public.month_notes (month);

-- ---------- Phân quyền theo dòng (RLS) ----------
alter table public.profiles           enable row level security;
alter table public.channels           enable row level security;
alter table public.expense_categories enable row level security;
alter table public.revenue_entries    enable row level security;
alter table public.expense_entries    enable row level security;
alter table public.month_notes        enable row level security;

-- profiles: ai cũng đọc được hồ sơ của mình; admin đọc và đổi vai trò của mọi người.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete to authenticated
  using (public.is_admin() and id <> auth.uid());

-- Danh mục và số liệu: thành viên đọc, admin ghi.
do $$
declare t text;
begin
  foreach t in array array['channels', 'expense_categories', 'revenue_entries', 'expense_entries'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_member())', t);
    execute format('drop policy if exists %1$s_write on public.%1$s', t);
    execute format('create policy %1$s_write on public.%1$s for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- Ghi chú: thành viên đọc và viết; xóa ghi chú của mình, admin xóa mọi ghi chú.
drop policy if exists month_notes_select on public.month_notes;
create policy month_notes_select on public.month_notes for select to authenticated
  using (public.is_member());
drop policy if exists month_notes_insert on public.month_notes;
create policy month_notes_insert on public.month_notes for insert to authenticated
  with check (public.is_member() and author_id = auth.uid());
drop policy if exists month_notes_delete on public.month_notes;
create policy month_notes_delete on public.month_notes for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

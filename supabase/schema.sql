-- ตารางและกฎความปลอดภัยสำหรับ HealthTracker
-- วิธีใช้: เปิด Supabase > SQL Editor แล้ววางทั้งไฟล์นี้ กด Run
-- แก้อีเมลแอดมินในบรรทัด insert ท้ายไฟล์ก่อนรัน

-- ผู้ใช้ที่ได้รับอนุญาตให้เข้าระบบ (อีเมล Gmail เป็นคีย์)
create table if not exists public.app_users (
  email        text primary key,
  display_name text not null,
  pages        text[] not null default '{}',
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ผลการคัดกรอง
create table if not exists public.screening_records (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  name        text not null,
  age         int,
  screen_date date not null,
  sbp         int,
  dbp         int,
  fbs         int,
  answers     jsonb,
  created_by  text default (auth.jwt() ->> 'email'),
  created_at  timestamptz not null default now()
);

-- ถ้าตารางถูกสร้างไว้แล้ว ให้เพิ่มคอลัมน์ answers
alter table public.screening_records add column if not exists answers jsonb;

-- ฟังก์ชันตรวจสิทธิ์ (security definer เพื่อไม่ให้วนซ้ำกับ RLS ของตาราง app_users)
create or replace function public.has_page(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_users u
    where lower(u.email) = lower(auth.jwt() ->> 'email')
      and u.active and p = any(u.pages)
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_page('admin');
$$;

alter table public.app_users enable row level security;
alter table public.screening_records enable row level security;

-- ผู้ใช้อ่านแถวของตัวเองได้ แอดมินจัดการผู้ใช้ได้ทั้งหมด
drop policy if exists "users read self" on public.app_users;
create policy "users read self" on public.app_users
  for select using (lower(email) = lower(auth.jwt() ->> 'email'));
drop policy if exists "admin manage users" on public.app_users;
create policy "admin manage users" on public.app_users
  for all using (public.is_admin()) with check (public.is_admin());

-- ผลคัดกรอง: ผู้ที่มีสิทธิ์ form หรือ dashboard หรือ report อ่านได้ ผู้ที่มีสิทธิ์ form เพิ่มได้ แอดมินแก้และลบได้
drop policy if exists "read records" on public.screening_records;
create policy "read records" on public.screening_records
  for select using (public.has_page('form') or public.has_page('dashboard') or public.has_page('report') or public.has_page('register') or public.has_page('followup'));
drop policy if exists "insert records" on public.screening_records;
create policy "insert records" on public.screening_records
  for insert with check (public.has_page('form'));
drop policy if exists "admin update records" on public.screening_records;
create policy "admin update records" on public.screening_records
  for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin delete records" on public.screening_records;
create policy "admin delete records" on public.screening_records
  for delete using (public.is_admin());

-- การติดตามผู้มีผลสีส้มหรือสีแดง (ภายใน 7 วัน)
create table if not exists public.follow_ups (
  id          uuid primary key default gen_random_uuid(),
  record_id   uuid not null references public.screening_records(id) on delete cascade,
  visited_at  date not null,
  result      text,
  note        text,
  created_by  text default (auth.jwt() ->> 'email'),
  created_at  timestamptz not null default now()
);
alter table public.follow_ups enable row level security;
drop policy if exists "read follow ups" on public.follow_ups;
create policy "read follow ups" on public.follow_ups
  for select using (public.has_page('followup') or public.has_page('register') or public.has_page('report'));
drop policy if exists "insert follow ups" on public.follow_ups;
create policy "insert follow ups" on public.follow_ups
  for insert with check (public.has_page('fu_record'));
drop policy if exists "admin delete follow ups" on public.follow_ups;
create policy "admin delete follow ups" on public.follow_ups
  for delete using (public.is_admin());

-- แอดมินคนแรก (แก้อีเมลก่อนรัน)
insert into public.app_users (email, display_name, pages)
values ('YOUR_ADMIN_GMAIL@gmail.com', 'ผู้ดูแลระบบ', array['dashboard','form','report','admin'])
on conflict (email) do nothing;

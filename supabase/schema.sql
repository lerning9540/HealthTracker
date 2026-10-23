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

-- การวัดความดันที่บ้าน 7 วัน (BP Home) โดย อสม.
create table if not exists public.bp_home_readings (
  id           uuid primary key default gen_random_uuid(),
  record_id    uuid not null references public.screening_records(id) on delete cascade,
  day_number   int not null check (day_number between 1 and 7),
  measured_at  date not null,
  systolic     int not null,
  diastolic    int not null,
  created_by   text default (auth.jwt() ->> 'email'),
  created_at   timestamptz not null default now()
);
alter table public.bp_home_readings enable row level security;
drop policy if exists "read bp home" on public.bp_home_readings;
create policy "read bp home" on public.bp_home_readings
  for select using (public.has_page('followup') or public.has_page('register') or public.has_page('report'));
drop policy if exists "insert bp home" on public.bp_home_readings;
create policy "insert bp home" on public.bp_home_readings
  for insert with check (public.has_page('fu_record'));
drop policy if exists "admin delete bp home" on public.bp_home_readings;
create policy "admin delete bp home" on public.bp_home_readings
  for delete using (public.is_admin());

-- สถานะและหมายเหตุของพยาบาลต่อผู้รับการคัดกรอง
alter table public.screening_records add column if not exists nurse_status text;
alter table public.screening_records add column if not exists nurse_note text;
alter table public.screening_records add column if not exists nurse_updated_at timestamptz;
drop policy if exists "nurse update status" on public.screening_records;
create policy "nurse update status" on public.screening_records
  for update using (public.has_page('followup')) with check (public.has_page('followup'));

-- บันทึกความดันรายครั้ง (เช้า/เย็น) โดย อสม.
create table if not exists public.bp_logs (
  id           uuid primary key default gen_random_uuid(),
  record_id    uuid not null references public.screening_records(id) on delete cascade,
  measured_at  date not null,
  session      text not null,
  systolic     int not null,
  diastolic    int not null,
  created_by   text default (auth.jwt() ->> 'email'),
  created_at   timestamptz not null default now()
);
alter table public.bp_logs enable row level security;
drop policy if exists "read bp logs" on public.bp_logs;
create policy "read bp logs" on public.bp_logs
  for select using (public.has_page('followup') or public.has_page('register') or public.has_page('report'));
drop policy if exists "insert bp logs" on public.bp_logs;
create policy "insert bp logs" on public.bp_logs
  for insert with check (public.has_page('fu_record'));
drop policy if exists "admin delete bp logs" on public.bp_logs;
create policy "admin delete bp logs" on public.bp_logs
  for delete using (public.is_admin());

-- การรับทราบการแจ้งเตือน
create table if not exists public.notification_acks (
  id               uuid primary key default gen_random_uuid(),
  record_id        uuid not null references public.screening_records(id) on delete cascade,
  kind             text not null,
  acknowledged_by  text default (auth.jwt() ->> 'email'),
  created_at       timestamptz not null default now()
);
alter table public.notification_acks enable row level security;
drop policy if exists "read acks" on public.notification_acks;
create policy "read acks" on public.notification_acks
  for select using (public.has_page('followup') or public.has_page('register'));
drop policy if exists "insert acks" on public.notification_acks;
create policy "insert acks" on public.notification_acks
  for insert with check (public.has_page('followup'));

-- ตรวจว่าชื่อผู้ใช้นี้ได้รับอนุญาตให้ใช้ระบบหรือยัง (เรียกได้จากหน้าเข้าสู่ระบบโดยไม่ต้องล็อกอิน)
create or replace function public.is_allowed_email(p_email text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_users u
    where lower(u.email) = lower(p_email) and u.active
  );
$$;
grant execute on function public.is_allowed_email(text) to anon, authenticated;

-- ===== โหมดทดสอบ: ล็อกอินด้วยชื่อผู้ใช้และรหัสผ่านที่เก็บในตาราง app_users =====
-- ไม่ปลอดภัยสำหรับข้อมูลจริง เพราะหน้าเว็บอ่านและเขียนตารางได้ทั้งหมดด้วย anon key
create extension if not exists pgcrypto with schema extensions;
alter table public.app_users add column if not exists password_hash text;

-- ตรวจชื่อผู้ใช้และรหัสผ่าน คืนข้อมูลผู้ใช้ถ้าถูกต้อง
create or replace function public.login_user(p_username text, p_password text)
returns table(username text, display_name text, pages text[])
language sql security definer set search_path = public, extensions as $$
  select u.email, u.display_name, u.pages
  from public.app_users u
  where lower(u.email) = lower(trim(p_username)) and u.active
    and u.password_hash is not null
    and u.password_hash = extensions.crypt(p_password, u.password_hash);
$$;

-- ตั้งหรือเปลี่ยนรหัสผ่านของผู้ใช้
create or replace function public.set_password(p_username text, p_password text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  update public.app_users
  set password_hash = extensions.crypt(p_password, extensions.gen_salt('bf'))
  where lower(email) = lower(trim(p_username));
  return found;
end $$;

grant execute on function public.login_user(text, text) to anon, authenticated;
grant execute on function public.set_password(text, text) to anon, authenticated;

-- ไม่ให้หน้าเว็บอ่านหรือแก้ค่ารหัสที่เข้ารหัสแล้วโดยตรง
revoke select (password_hash) on public.app_users from anon, authenticated;
revoke update (password_hash) on public.app_users from anon, authenticated;

-- เปิดอ่านและเขียนตารางให้หน้าเว็บ (โหมดทดสอบ)
do $$
declare t text;
begin
  foreach t in array array['app_users','screening_records','follow_ups','bp_home_readings','bp_logs','notification_acks'] loop
    execute format('drop policy if exists "test open" on public.%I', t);
    execute format('create policy "test open" on public.%I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- บัญชีผู้ดูแลระบบหลัก: ชื่อผู้ใช้ admin รหัส Isc1888
-- รันครั้งเดียวใน SQL Editor (ลบบัญชีเก่าที่ใช้อีเมลภายในทิ้งก่อน)
-- delete from public.app_users where email = 'admin@healthtracker.app';
-- insert into public.app_users (email, display_name, pages, password_hash)
-- values ('admin', 'ผู้ดูแลระบบ', array['dashboard','form','register','followup','fu_record','notify','report','admin'], extensions.crypt('Isc1888', extensions.gen_salt('bf')))
-- on conflict (email) do update set password_hash = excluded.password_hash, pages = excluded.pages, active = true;

-- ข้อมูลตัวอย่าง (mockup) สำหรับทดสอบหน้าติดตามผล, BP Home, BP รายครั้ง และการแจ้งเตือน
-- ต้องรัน seed_demo.sql ก่อน แล้วค่อยรันไฟล์นี้ครั้งเดียวใน SQL Editor
-- ถ้าเคยรันไฟล์ใดไฟล์หนึ่งซ้ำ ให้ลบข้อมูลตัวอย่างก่อน (ดูคำสั่งด้านล่าง) แล้วรันใหม่ทั้งสองไฟล์
-- ลบข้อมูลตัวอย่างทั้งหมดได้ด้วย: delete from public.screening_records where code like 'DEMO-%';

-- 1) เพิ่มผู้ป่วยตัวอย่างสำหรับกรณีเกินกำหนดติดตาม และครบ 7 วัน
insert into public.screening_records (code, name, age, screen_date, sbp, dbp, fbs, answers)
values
('DEMO-009', 'ประชาชนตัวอย่าง 009', null, '2026-10-12', 150, 92, 130, '{"fFasting":"fast8"}'),
('DEMO-010', 'ประชาชนตัวอย่าง 010', null, '2026-10-15', 172, 100, 98, '{"fFasting":"fast8"}');

-- 2) กำหนดการงดอาหาร (NPO) ให้ผู้ป่วยเดิม เพื่อให้เกณฑ์น้ำตาลทำงานถูกต้อง
update public.screening_records
set answers = coalesce(answers, '{}'::jsonb) || '{"fFasting":"fast8"}'::jsonb
where code in ('DEMO-001', 'DEMO-002', 'DEMO-003', 'DEMO-004', 'DEMO-005');
update public.screening_records
set answers = coalesce(answers, '{}'::jsonb) || '{"fFasting":"notfast"}'::jsonb
where code = 'DEMO-006';

-- 3) สถานะการติดตามของพยาบาล
update public.screening_records set nurse_status = 'monitoring_home_bp', nurse_note = 'ให้วัดที่บ้านต่อ 7 วัน', nurse_updated_at = now()
where code = 'DEMO-001';
update public.screening_records set nurse_status = 'follow_up_needed', nurse_note = 'ค่าน้ำตาลและความดันยังสูง นัดติดตาม', nurse_updated_at = now()
where code = 'DEMO-005';

-- 4) ประวัติการติดตาม (follow_ups)
insert into public.follow_ups (record_id, visited_at, result, note)
values
((select id from public.screening_records where code = 'DEMO-001' order by created_at limit 1), '2026-10-22', 'ต้องติดตามต่อ', 'วัดความดันที่บ้านได้ 3 วัน ค่ายังสูงเล็กน้อย'),
((select id from public.screening_records where code = 'DEMO-003' order by created_at limit 1), '2026-10-21', 'ปรับการดูแล', 'แนะนำลดเค็มและนัดวัดซ้ำ'),
((select id from public.screening_records where code = 'DEMO-010' order by created_at limit 1), '2026-10-22', 'ควบคุมได้ดี', 'วัดครบ 7 วัน ค่าเฉลี่ยใกล้เกณฑ์');

-- 5) BP Home 7 วัน (bp_home_readings)
-- DEMO-001: วัดแล้ว 3 วัน
insert into public.bp_home_readings (record_id, day_number, measured_at, systolic, diastolic)
values
((select id from public.screening_records where code = 'DEMO-001' order by created_at limit 1), 1, '2026-10-21', 146, 90),
((select id from public.screening_records where code = 'DEMO-001' order by created_at limit 1), 2, '2026-10-22', 142, 88),
((select id from public.screening_records where code = 'DEMO-001' order by created_at limit 1), 3, '2026-10-22', 138, 86);
-- DEMO-005: วัดแล้ว 2 วัน
insert into public.bp_home_readings (record_id, day_number, measured_at, systolic, diastolic)
values
((select id from public.screening_records where code = 'DEMO-005' order by created_at limit 1), 1, '2026-10-20', 158, 98),
((select id from public.screening_records where code = 'DEMO-005' order by created_at limit 1), 2, '2026-10-21', 152, 94);
-- DEMO-010: วัดครบ 7 วัน
insert into public.bp_home_readings (record_id, day_number, measured_at, systolic, diastolic)
select (select id from public.screening_records where code = 'DEMO-010' order by created_at limit 1), d, date '2026-10-15' + (d - 1), 170 - d * 2, 98 - d
from generate_series(1, 7) as d;

-- 6) BP รายครั้ง (bp_logs) ของ DEMO-005
insert into public.bp_logs (record_id, measured_at, session, systolic, diastolic)
values
((select id from public.screening_records where code = 'DEMO-005' order by created_at limit 1), '2026-10-22', 'เช้า', 158, 96),
((select id from public.screening_records where code = 'DEMO-005' order by created_at limit 1), '2026-10-22', 'เย็น', 150, 94);

-- 7) การรับทราบแจ้งเตือนตัวอย่าง (DEMO-001 รับทราบการแจ้งเตือนกลุ่มสงสัยป่วยแล้ว)
insert into public.notification_acks (record_id, kind)
values
((select id from public.screening_records where code = 'DEMO-001' order by created_at limit 1), 'SUSPECTED');

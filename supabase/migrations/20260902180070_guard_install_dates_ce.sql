-- ============================================================================
-- guard_install_dates_ce
-- ----------------------------------------------------------------------------
-- ทำไมต้องมีไฟล์นี้
--   migration ตัวนี้ถูก apply ลงฐานข้อมูลจริงไปแล้ว (schema_migrations
--   version = 20260901163729) แต่ไฟล์ในสาขานี้หายไป — เป็น drift ชุดเดียวกับ
--   9 ตัวที่กู้ไว้ในคอมมิต ac0989e (เครื่องหลุดหลัง apply แต่ก่อนเขียนไฟล์)
--   ใครที่ replay จาก supabase/migrations/ จะได้ฐานข้อมูลไม่เหมือนของจริง
--   เนื้อ SQL ด้านล่างคัดมาจาก supabase_migrations.schema_migrations.statements
--   ของแถวนั้นตรง ๆ แล้วห่อด้วย guard ให้รันซ้ำได้เท่านั้น ไม่ได้แก้ตรรกะใด
--
-- ตัวงานเองทำอะไร
--   คอลัมน์ install_start / install_end ของ public.production_work_orders_bbps
--   เป็นชนิด date แต่ข้อมูลเก่าบางแถวถูกกรอกด้วย "ปี พ.ศ." ลงไปตรง ๆ เช่น 2569
--   แทนที่จะเป็น 2026 ผลคือวันติดตั้งไปโผล่อีก 543 ปีข้างหน้า ซึ่งทำให้
--   ทุกอย่างที่เรียงตามวันติดตั้ง (คิว ปฏิทิน การเตือนล่วงหน้า) ผิดแบบเงียบ ๆ
--   ไฟล์นี้ทำสองอย่าง
--     1) แปลงแถวที่ปีอยู่ในช่วง พ.ศ. ที่เป็นไปได้ (2400-2700) กลับเป็น ค.ศ.
--     2) ใส่ check constraint บังคับช่วงปีธุรกิจ 2000-2100
--        เพื่อกันข้อมูลผิดจาก "ทุกช่องทาง" ไม่ใช่แค่ช่องทางที่เรารู้จักวันนี้
--        — การล้างข้อมูลอย่างเดียวโดยไม่ปิดประตู แปลว่าอีกเดือนก็ต้องล้างใหม่
--   หลักการเดียวกับ migration reject_buddhist_era_years_in_document_dates
--   ที่ทำไว้ก่อนหน้าฝั่งเอกสาร ต่างกันแค่ตารางปลายทาง
--
-- ทำไมช่วงถึงเป็น 2400-2700 ไม่ใช่ "ปีไหนก็ตามที่มากกว่า 2400"
--   เพื่อไม่ให้เผลอไปลบ 543 ปีออกจากค่าที่บังเอิญเพี้ยนด้วยสาเหตุอื่น
--   ช่วงนี้ครอบคลุม พ.ศ. ที่เป็นไปได้จริงของงานติดตั้ง (2400 = ค.ศ. 1857,
--   2700 = ค.ศ. 2157) แต่ไม่กว้างจนกลืนค่าขยะรูปแบบอื่นเข้ามาแปลงด้วย
--
-- สถานะที่ยืนยันจากฐานข้อมูลจริงหลัง apply:
--   แถวที่ปี install_start/install_end อยู่ในช่วง 2400-2700 = 0 แถว
--   constraint ที่มีอยู่จริงบน production_work_orders_bbps:
--     production_work_orders_install_start_ce_check
--     production_work_orders_install_end_ce_check
--
-- ไฟล์นี้รันซ้ำได้
--   * update มี where จำกัดเฉพาะแถวที่ยังผิดอยู่ รันซ้ำแล้วแตะ 0 แถว
--   * add constraint ถูกห่อด้วย do-block ที่เช็ค pg_constraint ก่อน
--     (alter table ... add constraint ไม่มี if not exists ใน PostgreSQL)
-- ============================================================================

-- ข้อมูลเก่าบางแถวกรอกปี พ.ศ. ลงในคอลัมน์ date โดยตรง เช่น 2569 แทน 2026
-- แปลงเฉพาะช่วงปี พ.ศ. ที่เป็นไปได้ แล้วบังคับช่วงปีธุรกิจเพื่อกันข้อมูลผิดจากทุกช่องทาง
update public.production_work_orders_bbps
set
  install_start = case
    when extract(year from install_start) between 2400 and 2700
      then (install_start - interval '543 years')::date
    else install_start
  end,
  install_end = case
    when extract(year from install_end) between 2400 and 2700
      then (install_end - interval '543 years')::date
    else install_end
  end
where extract(year from install_start) between 2400 and 2700
   or extract(year from install_end) between 2400 and 2700;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.production_work_orders_bbps'::regclass
      and conname = 'production_work_orders_install_start_ce_check'
  ) then
    alter table public.production_work_orders_bbps
      add constraint production_work_orders_install_start_ce_check
        check (install_start is null or install_start between date '2000-01-01' and date '2100-12-31');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.production_work_orders_bbps'::regclass
      and conname = 'production_work_orders_install_end_ce_check'
  ) then
    alter table public.production_work_orders_bbps
      add constraint production_work_orders_install_end_ce_check
        check (install_end is null or install_end between date '2000-01-01' and date '2100-12-31');
  end if;
end
$$;

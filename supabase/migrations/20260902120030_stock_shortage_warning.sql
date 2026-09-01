-- FloorNow P3-4 (4/4): ส่งคำเตือน "ของไม่พอสำหรับงานที่ใกล้ถึงวันติดตั้ง"
--
-- ช่องทางแจ้งเตือน: ใช้ floor_notifications ผ่าน public.notify_floor_role ซึ่งเป็นช่องทางเดิมของแอป
-- (supabase/migrations/20260825020000_shared_visibility_event_notifications.sql)
-- เหตุผลที่ไม่สร้างช่องทางใหม่:
--   * มีหน้าจอรออยู่แล้ว — components/notifications/notification-center.tsx (กระดิ่ง + realtime)
--     และ app/share/queue/page.tsx อ่านตารางนี้อยู่แล้ว ไม่ต้องเขียน UI ใหม่ให้คนต้องเรียนรู้เพิ่ม
--   * มีเส้นทาง push ต่ออยู่แล้ว — floor_push_deliveries + /api/notifications/process
--   * มีกลไกกันซ้ำอยู่แล้ว — unique index floor_notifications_user_dedupe_idx (recipient_user_id, dedupe_key)
--     คู่กับ on conflict do nothing ใน notify_floor_role
--
-- ผู้รับ: role 'warehouse' (คนที่ลงมือหาของได้จริง) และ 'head_technician' (คนที่ต้องตัดสินใจเลื่อน/เปลี่ยนแผน)
-- ไม่ส่งหา sales/executive เพราะคำเตือนนี้ต้องการ "คนลงมือ" ไม่ใช่ผู้รับทราบ
--
-- ความ idempotent: dedupe_key ถูกประกอบ "ฝั่งเซิร์ฟเวอร์" จาก job_no + วันที่ (เวลาไทย) เท่านั้น
-- ผู้เรียกส่งคีย์เองไม่ได้ จึงรันซ้ำกี่รอบในวันเดียวกันก็ไม่เกิดแจ้งเตือนใบที่สอง
-- (วันถัดไปคีย์เปลี่ยน จึงเตือนซ้ำได้ ซึ่งตั้งใจ เพราะของยังขาดอยู่และวันติดตั้งใกล้เข้ามาอีกวัน)

begin;

create or replace function public.raise_job_stock_shortage_warning(
  p_job_no text,
  p_appointment_id uuid,
  p_as_of_date date,
  p_title text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job_no text := btrim(coalesce(p_job_no, ''));
  v_as_of date := coalesce(p_as_of_date, (now() at time zone 'Asia/Bangkok')::date);
  v_dedupe text;
  v_before integer := 0;
  v_after integer := 0;
begin
  -- เขียนได้เฉพาะงานเบื้องหลัง (service_role) หรือผู้ดูแลระบบ — แพตเทิร์นเดียวกับ sync_floor_staff_from_employee_master
  if (select auth.uid()) is null then
    if coalesce((select auth.jwt()->>'role'), '') <> 'service_role'
       and session_user not in ('postgres', 'supabase_admin') then
      raise exception 'ต้องเป็นงานเบื้องหลังของระบบจึงจะส่งคำเตือนสต็อกได้';
    end if;
  elsif not (select public.is_floor_staff_admin()) then
    raise exception 'ต้องเป็นผู้ดูแลระบบจึงจะส่งคำเตือนสต็อกได้';
  end if;

  if v_job_no = '' then
    raise exception 'ต้องระบุเลขที่งาน (job_no)';
  end if;
  if not exists (select 1 from public.install_jobs j where j.job_no = v_job_no) then
    raise exception 'ไม่พบงานเลขที่ %', v_job_no;
  end if;

  -- คีย์กันซ้ำประกอบที่นี่ที่เดียว ผู้เรียกกำหนดเองไม่ได้
  v_dedupe := 'stock_shortage:' || v_job_no || ':' || v_as_of::text;

  select count(*) into v_before
    from public.floor_notifications n
   where n.dedupe_key is not null
     and starts_with(n.dedupe_key, v_dedupe || ':');

  perform public.notify_floor_role(
    'warehouse', 'stock_shortage_warning',
    left(coalesce(nullif(btrim(p_title), ''), 'ของไม่พอสำหรับงานที่ใกล้ถึงวันติดตั้ง'), 200),
    left(coalesce(p_body, ''), 1000),
    '/orders/' || v_job_no,
    v_job_no, p_appointment_id, v_dedupe
  );
  perform public.notify_floor_role(
    'head_technician', 'stock_shortage_warning',
    left(coalesce(nullif(btrim(p_title), ''), 'ของไม่พอสำหรับงานที่ใกล้ถึงวันติดตั้ง'), 200),
    left(coalesce(p_body, ''), 1000),
    '/orders/' || v_job_no,
    v_job_no, p_appointment_id, v_dedupe
  );

  select count(*) into v_after
    from public.floor_notifications n
   where n.dedupe_key is not null
     and starts_with(n.dedupe_key, v_dedupe || ':');

  return jsonb_build_object(
    'jobNo', v_job_no,
    'asOfDate', v_as_of,
    'dedupeKey', v_dedupe,
    'inserted', v_after - v_before,
    'alreadySent', v_before
  );
end;
$function$;

comment on function public.raise_job_stock_shortage_warning(text, uuid, date, text, text) is
  'ส่งคำเตือนของไม่พอเข้ากล่องแจ้งเตือนเดิม (floor_notifications) ให้ role warehouse และ head_technician หนึ่งใบต่อหนึ่งงานต่อหนึ่งวัน — คีย์กันซ้ำสร้างฝั่งเซิร์ฟเวอร์จาก job_no + วันที่เวลาไทย';

revoke all on function public.raise_job_stock_shortage_warning(text, uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.raise_job_stock_shortage_warning(text, uuid, date, text, text) to service_role;

notify pgrst, 'reload schema';

commit;

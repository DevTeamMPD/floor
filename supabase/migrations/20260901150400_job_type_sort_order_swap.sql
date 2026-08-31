-- FloorNow P1: RPC สลับลำดับประเภทงานแบบอะตอมมิก (ทรานแซกชันเดียว)
--
-- ที่มา: final review ข้อ 15 (Minor) — หน้าจอเรียก save_job_type สองครั้งพร้อมกันด้วย Promise.all
-- ซึ่งเป็นคนละทรานแซกชัน ถ้าตัวหนึ่งสำเร็จอีกตัวล้ม (เน็ตหลุดกลางคัน / role ถูกปิดระหว่างนั้น)
-- จะเหลือ sort_order ซ้ำกันสองแถวถาวร โดยไม่มี unique บน sort_order คอยดักและไม่มีทางย้อนกลับอัตโนมัติ
-- การสลับลำดับเป็นการกระทำเดียวในสายตาผู้ใช้ จึงต้องสำเร็จหรือล้มทั้งคู่เท่านั้น
--
-- ฟังก์ชันใหม่ทั้งตัว ไม่ทับของเดิม (save_job_type ยังใช้ต่อได้ตามปกติสำหรับการแก้ไขทีละแถว)

begin;

create or replace function public.swap_job_type_sort_order(
  p_id_a uuid,
  p_id_b uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_first public.job_types%rowtype;
  v_second public.job_types%rowtype;
begin
  select * into v_actor from public.floor_staff_profiles
  where id = (select auth.uid()) and is_active and role in ('admin', 'head_technician');
  if v_actor.id is null then
    raise exception 'ต้องเป็น admin หรือ head_technician เท่านั้นจึงจะสลับลำดับประเภทงานได้';
  end if;

  if p_id_a is null or p_id_b is null or p_id_a = p_id_b then
    raise exception 'ต้องระบุประเภทงานสองรายการที่ไม่ซ้ำกันเพื่อสลับลำดับ';
  end if;

  -- ล็อกสองแถวตามลำดับ id ที่แน่นอนเสมอ (น้อยก่อนมาก) กัน deadlock กรณีสองคนสลับคู่เดียวกันสวนทางกัน
  select * into v_first from public.job_types where id = least(p_id_a, p_id_b) for update;
  select * into v_second from public.job_types where id = greatest(p_id_a, p_id_b) for update;
  if v_first.id is null or v_second.id is null then
    raise exception 'ไม่พบประเภทงานที่ต้องการสลับลำดับ';
  end if;

  update public.job_types set sort_order = v_second.sort_order, updated_at = now() where id = v_first.id;
  update public.job_types set sort_order = v_first.sort_order, updated_at = now() where id = v_second.id;
end;
$function$;

revoke all on function public.swap_job_type_sort_order(uuid, uuid) from public, anon;
grant execute on function public.swap_job_type_sort_order(uuid, uuid) to authenticated;

commit;

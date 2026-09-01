-- P5-1 — เอกสารควบคุมต้องมีคนอนุมัติก่อนใช้งาน (ISO 9001:2015 ข้อ 7.5.2)
--
-- สภาพเดิม:
--   lib/documents/generation-worker.ts:finalizeGeneratedDocument() ตั้ง status = 'approved'
--   ให้เอกสารทุกใบทันทีที่สร้างเสร็จ โดยไม่มี approved_by แล้วเขียน audit event
--   detail.mode = 'phase_1_auto_approve' ผ่าน check ได้เพราะ is_system_generated = true
--   แปลว่าวันนี้ "อนุมัติ" ไม่ได้แปลว่ามีใครอ่านและรับผิดชอบ — มันแปลว่าไฟล์อัปโหลดสำเร็จ
--
-- เส้นที่ลากและเหตุผล — ไม่ได้เปลี่ยนทุกชนิดเอกสาร:
--   document_class = 'controlled_document' (work_order, boq, ncr) → ต้องมีคนอนุมัติ
--     ข้อ 7.5.2 พูดถึงเอกสารที่องค์กร "สร้างและปรับปรุง" แล้วนำไปใช้สั่งงาน
--     ใบสั่งงานและ BOQ คือสิ่งที่ช่างและคลังลงมือทำตาม ถ้าผิดแล้วออกไป งานก็ผิดตาม
--     จึงต้องมีคนตรวจความเหมาะสมและความเพียงพอก่อนออกใช้ ตามตัวบทของข้อนี้ตรง ๆ
--   document_class = 'quality_record' (pick_confirmation, installation_report,
--     customer_acceptance, remnant_report, handover, csat) → อนุมัติอัตโนมัติต่อไป
--     ของพวกนี้คือ "บันทึก" ว่าเกิดอะไรขึ้นไปแล้ว ไม่ใช่เอกสารสั่งงาน
--     ข้อ 7.5.2 ไม่ได้บังคับให้อนุมัติบันทึกก่อนออก — บันทึกถูกคุมด้วยข้อ 7.5.3
--     (การเก็บรักษาและป้องกันการแก้ไข) ซึ่งระบบทำอยู่แล้วผ่าน version + superseded
--     และถ้าบังคับให้คนกดอนุมัติใบยืนยันการหยิบของทุกใบ จะได้คิวที่ไม่มีใครเคลียร์
--     แล้วงานหน้างานจะติดอยู่หลังคิวนั้น — เป็นการเอาความปลอดภัยไปแลกกับงานที่หยุดเดิน
--
-- ของเดิมต้องไม่พัง:
--   เอกสาร 30 ใบที่ approved ไปแล้ววันนี้ ไม่ถูกแตะเลยแม้แต่ใบเดียว
--   migration นี้ไม่ update แถวเดิม ไม่เปลี่ยนสถานะย้อนหลัง และไม่ทำให้ใบไหนค้าง
--   การเปลี่ยนมีผลกับเอกสารควบคุมที่ "สร้างใหม่หลังจากนี้" เท่านั้น
--   ถ้า SharePoint สร้างเอกสารไม่ได้ ทุกอย่างยังเหมือนเดิม — ด่านนี้อยู่หลังการสร้างไฟล์
--
-- ใครอนุมัติได้ และทำไม:
--   admin, head_technician, cs — ชุดเดียวกับที่ /document-control ประกาศไว้ใน lib/nav.ts
--   การอนุมัติเอกสารเป็นหน้าที่ควบคุม ไม่ใช่งานปฏิบัติการ จึงไม่เปิดให้ staff ทั้ง 37 คน
--   ต่างจากหน้าคลังที่ต้องเปิดกว้างเพราะคนทำงานจริงถือ role staff
--   (ข้อจำกัดที่ต้องรู้: วันนี้มีคนถือ 3 role นี้และยัง active รวม 3 คน และ
--    head_technician 1 คนนั้นยังไม่เคยเข้าระบบเลย — บันทึกไว้ในรายงาน ไม่ซ่อน)

begin;

-- ---------------------------------------------------------------------------
-- 1) นโยบาย — แหล่งความจริงเดียวว่าเอกสารชนิดไหนต้องใช้คนอนุมัติ
--    ทั้ง RPC, worker และหน้าจออ่านจากที่นี่ที่เดียว
-- ---------------------------------------------------------------------------
create or replace function public.document_approval_policy()
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select jsonb_build_object(
    'humanApprovalClasses', jsonb_build_array('controlled_document'),
    'autoApproveClasses',   jsonb_build_array('quality_record', 'external_reference'),
    'approverRoles',        jsonb_build_array('admin', 'head_technician', 'cs'),
    'pendingStatus',        'under_review',
    'note', 'เอกสารควบคุมต้องมีคนอนุมัติก่อนใช้งานตาม ISO 9001:2015 ข้อ 7.5.2; '
         || 'บันทึกคุณภาพเป็นหลักฐานว่าเกิดอะไรขึ้นไปแล้ว จึงอนุมัติอัตโนมัติต่อไปได้'
  );
$function$;

comment on function public.document_approval_policy() is
  'นโยบายการอนุมัติเอกสาร — บอกว่า document_class ไหนต้องใช้คนอนุมัติ ไหนอัตโนมัติได้ '
  'และตำแหน่งไหนมีสิทธิ์อนุมัติ แหล่งความจริงเดียวที่ทั้ง RPC worker และหน้าจออ่านร่วมกัน';

revoke all on function public.document_approval_policy() from public, anon, authenticated;
grant execute on function public.document_approval_policy() to authenticated, service_role;

create or replace function public.document_requires_human_approval(p_document_class text)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select coalesce(
    public.document_approval_policy()->'humanApprovalClasses' ? coalesce(p_document_class, ''),
    false
  );
$function$;

comment on function public.document_requires_human_approval(text) is
  'true = เอกสารชนิดนี้ต้องมีคนกดอนุมัติก่อนจึงจะใช้งานได้ (ปัจจุบันคือ controlled_document)';

revoke all on function public.document_requires_human_approval(text) from public, anon, authenticated;
grant execute on function public.document_requires_human_approval(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) เหตุผลการตีกลับ — เก็บเป็นคอลัมน์จริง ไม่ใช่ยัดลง change_summary
--    เพิ่มคอลัมน์อย่างเดียว ไม่แตะคอลัมน์เดิมและไม่แก้ constraint เดิม
-- ---------------------------------------------------------------------------
alter table public.floor_job_documents add column if not exists rejected_at timestamptz;
alter table public.floor_job_documents add column if not exists rejected_by uuid;
alter table public.floor_job_documents add column if not exists rejection_reason text;
alter table public.floor_job_documents add column if not exists submitted_for_review_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'floor_job_documents_rejected_by_fkey'
      and conrelid = 'public.floor_job_documents'::regclass
  ) then
    alter table public.floor_job_documents add constraint floor_job_documents_rejected_by_fkey
      foreign key (rejected_by) references public.floor_staff_profiles(id) on delete set null;
  end if;

  -- ตีกลับแล้วต้องมีเหตุผลเสมอ — "ไม่ผ่าน" เฉย ๆ ใช้ทำงานต่อไม่ได้
  if not exists (
    select 1 from pg_constraint where conname = 'floor_job_documents_rejection_needs_reason'
      and conrelid = 'public.floor_job_documents'::regclass
  ) then
    alter table public.floor_job_documents add constraint floor_job_documents_rejection_needs_reason
      check (
        rejected_at is null
        or (rejected_by is not null and btrim(coalesce(rejection_reason, '')) <> '')
      );
  end if;
end $$;

comment on column public.floor_job_documents.rejection_reason is
  'เหตุผลที่ผู้อนุมัติตีกลับเอกสารฉบับนี้ — บังคับให้มีเมื่อมี rejected_at (constraint) '
  'เพราะคนที่ต้องแก้ต้องรู้ว่าต้องแก้อะไร';
comment on column public.floor_job_documents.submitted_for_review_at is
  'เวลาที่เอกสารเข้าคิวรออนุมัติ ใช้วัดว่าคิวค้างมานานแค่ไหน';

create index if not exists floor_job_documents_pending_review_idx
  on public.floor_job_documents(submitted_for_review_at)
  where status = 'under_review';

-- ---------------------------------------------------------------------------
-- 2b) เปิดคำว่า 'rejected' ให้ audit trail บันทึกการตีกลับได้
--     floor_job_document_events_event_type_check เดิมมี 7 ค่าและไม่มี 'rejected'
--     นี่คือการ "เพิ่มค่าที่ยอมรับ" ไม่ใช่การเปลี่ยนความหมายของค่าเดิม —
--     ค่าเดิมทั้ง 7 ยังอยู่ครบและแถวเดิมทุกแถวยังผ่าน constraint เหมือนเดิม
--     ถ้าไม่เพิ่ม การตีกลับจะเขียน audit ไม่ได้ แปลว่าจะมีการกระทำที่ไม่มีร่องรอย
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'floor_job_document_events_event_type_check'
       and conrelid = 'public.floor_job_document_events'::regclass
       and pg_get_constraintdef(oid) like '%rejected%'
  ) then
    alter table public.floor_job_document_events
      drop constraint if exists floor_job_document_events_event_type_check;
    alter table public.floor_job_document_events
      add constraint floor_job_document_events_event_type_check
      check (event_type = any (array[
        'created', 'uploaded', 'submitted_for_review', 'approved',
        'superseded', 'archived', 'opened', 'rejected'
      ]));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) ด่านสิทธิ์ร่วมของ RPC ชุดนี้
-- ---------------------------------------------------------------------------
create or replace function public.document_approval_guard(p_action text)
returns public.floor_staff_profiles
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_roles text[];
begin
  select array(select jsonb_array_elements_text(public.document_approval_policy()->'approverRoles'))
    into v_roles;

  select * into v_actor from public.floor_staff_profiles
   where id = (select auth.uid()) and is_active;
  if v_actor.id is null then
    raise exception 'ต้องเข้าสู่ระบบด้วยบัญชีพนักงานที่ยังใช้งานอยู่ จึงจะ%ได้', p_action;
  end if;
  if not (v_actor.role = any(v_roles)) then
    raise exception 'บัญชีของคุณไม่มีสิทธิ์% — ต้องเป็นตำแหน่ง %',
      p_action, array_to_string(v_roles, ' หรือ ');
  end if;
  return v_actor;
end;
$function$;

comment on function public.document_approval_guard(text) is
  'ด่านสิทธิ์ร่วมของ RPC อนุมัติเอกสาร อ่านรายชื่อตำแหน่งจาก document_approval_policy() '
  'เรียกได้จากฟังก์ชัน security definer ตัวอื่นเท่านั้น';

revoke all on function public.document_approval_guard(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) คิวเอกสารรออนุมัติ — หน้าจออ่านผ่านตัวนี้ตัวเดียว
-- ---------------------------------------------------------------------------
create or replace function public.pending_document_approvals()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_rows jsonb;
begin
  if not (select public.is_floor_staff_active()) then
    raise exception 'ต้องเป็นพนักงานที่ยังใช้งานอยู่จึงจะดูคิวอนุมัติเอกสารได้';
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x."submittedAt"), '[]'::jsonb) into v_rows
  from (
    select d.id                as "documentId",
           d.job_no            as "jobNo",
           d.document_code      as "documentCode",
           d.document_type      as "documentType",
           d.document_class     as "documentClass",
           d.workflow_stage     as "workflowStage",
           d.file_name          as "fileName",
           d.version            as "version",
           d.provider_web_url   as "webUrl",
           d.change_summary     as "changeSummary",
           d.is_system_generated as "systemGenerated",
           coalesce(d.submitted_for_review_at, d.created_at) as "submittedAt",
           d.created_at         as "createdAt",
           d.rejection_reason   as "lastRejectionReason",
           j.customer_name      as "customerName",
           -- "ใครขอ": เอกสารที่ระบบสร้างไม่มีคนอัปโหลด จึงต้องบอกว่ามาจากเหตุการณ์อะไร
           up.full_name         as "requestedByName",
           gj.source_event      as "sourceEvent"
      from public.floor_job_documents d
      left join public.install_jobs j on j.job_no = d.job_no
      left join public.floor_staff_profiles up on up.id = d.uploaded_by
      left join public.floor_document_generation_jobs gj on gj.id = d.generation_job_id
     where d.status = 'under_review'
  ) x;

  return jsonb_build_object(
    'policy', public.document_approval_policy(),
    'canApprove', (
      select p.role = any(array(select jsonb_array_elements_text(public.document_approval_policy()->'approverRoles')))
        from public.floor_staff_profiles p where p.id = (select auth.uid()) and p.is_active
    ),
    'pending', coalesce(v_rows, '[]'::jsonb)
  );
end;
$function$;

comment on function public.pending_document_approvals() is
  'คิวเอกสารที่รอคนอนุมัติ พร้อมบอกว่าเป็นเอกสารอะไรของงานไหน และมาจากเหตุการณ์ใด '
  'พนักงาน active ทุกคนดูได้ (โปร่งใส) แต่การกดอนุมัติยังจำกัดตาม approverRoles';

revoke all on function public.pending_document_approvals() from public, anon, authenticated;
grant execute on function public.pending_document_approvals() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) อนุมัติ — เซ็ต approved_by/approved_at/effective_from พร้อมกัน
--    แล้วรัน supersede ต่อ (ตรรกะเดิมที่เคยผูกอยู่กับ auto-approve ใน worker)
-- ---------------------------------------------------------------------------
create or replace function public.approve_job_document(
  p_document_id uuid,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_doc public.floor_job_documents%rowtype;
  v_previous public.floor_job_documents%rowtype;
  v_now timestamptz := now();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  v_actor := public.document_approval_guard('อนุมัติเอกสาร');

  select * into v_doc from public.floor_job_documents where id = p_document_id for update;
  if v_doc.id is null then
    raise exception 'ไม่พบเอกสารที่เลือก';
  end if;
  if v_doc.status = 'approved' then
    raise exception 'เอกสาร % ถูกอนุมัติไปแล้ว', coalesce(v_doc.document_code, v_doc.file_name);
  end if;
  if v_doc.status not in ('draft', 'under_review') then
    raise exception 'เอกสารสถานะ "%" อนุมัติไม่ได้ — อนุมัติได้เฉพาะฉบับที่ยังรอตรวจเท่านั้น', v_doc.status;
  end if;

  update public.floor_job_documents set
    status = 'approved',
    approved_by = v_actor.id,
    approved_at = v_now,
    effective_from = v_now,
    -- ล้างร่องรอยการตีกลับรอบก่อน เพื่อไม่ให้ใบที่อนุมัติแล้วยังโชว์เหตุผลตีกลับค้างอยู่
    rejected_at = null,
    rejected_by = null,
    rejection_reason = null,
    updated_at = v_now
  where id = p_document_id;

  insert into public.floor_job_document_events(document_id, event_type, detail)
  values (p_document_id, 'approved', jsonb_build_object(
    'mode', 'human_approval',
    'approvedBy', v_actor.id,
    'approvedByName', v_actor.full_name,
    'approverRole', v_actor.role,
    'note', v_note
  ));

  -- แทนที่ฉบับก่อนหน้า — ย้ายมาจาก generation-worker.ts เพื่อให้ผูกกับ "การอนุมัติ"
  -- ไม่ใช่ผูกกับ "การสร้างไฟล์เสร็จ" อย่างเดิม ฉบับเก่าต้องมีผลอยู่จนกว่าฉบับใหม่จะผ่าน
  select * into v_previous from public.floor_job_documents
   where job_no = v_doc.job_no
     and document_type = v_doc.document_type
     and workflow_stage = v_doc.workflow_stage
     and status = 'approved'
     and id <> p_document_id
     and version < v_doc.version
   order by version desc limit 1;

  if v_previous.id is not null then
    update public.floor_job_documents set
      status = 'superseded', superseded_at = v_now, superseded_by = p_document_id, updated_at = v_now
    where id = v_previous.id and status = 'approved';
    insert into public.floor_job_document_events(document_id, event_type, detail)
    values (v_previous.id, 'superseded', jsonb_build_object('superseded_by', p_document_id));
  end if;

  return jsonb_build_object(
    'documentId', p_document_id,
    'status', 'approved',
    'supersededDocumentId', v_previous.id
  );
end;
$function$;

comment on function public.approve_job_document(uuid, text) is
  'คนอนุมัติเอกสารควบคุมตาม ISO 9001:2015 ข้อ 7.5.2 — เซ็ต approved_by/approved_at/effective_from '
  'พร้อมกันตามที่ constraint floor_job_documents_approval_complete บังคับ '
  'แล้วเปลี่ยนฉบับก่อนหน้าเป็น superseded (ตรรกะนี้ย้ายมาจาก generation worker)';

revoke all on function public.approve_job_document(uuid, text) from public, anon, authenticated;
grant execute on function public.approve_job_document(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) ตีกลับ — ต้องมีเหตุผลเสมอ และไม่ทำให้เอกสารหาย
-- ---------------------------------------------------------------------------
create or replace function public.reject_job_document(
  p_document_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_doc public.floor_job_documents%rowtype;
  v_now timestamptz := now();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  v_actor := public.document_approval_guard('ตีกลับเอกสาร');

  if v_reason is null then
    raise exception 'การตีกลับเอกสารต้องระบุเหตุผล — คนที่ต้องแก้ต้องรู้ว่าต้องแก้อะไร';
  end if;
  if length(v_reason) < 10 then
    raise exception 'เหตุผลสั้นเกินไป กรุณาอธิบายให้คนที่มาอ่านทีหลังเข้าใจได้ว่าเอกสารมีปัญหาอะไร';
  end if;

  select * into v_doc from public.floor_job_documents where id = p_document_id for update;
  if v_doc.id is null then
    raise exception 'ไม่พบเอกสารที่เลือก';
  end if;
  if v_doc.status not in ('draft', 'under_review') then
    raise exception 'เอกสารสถานะ "%" ตีกลับไม่ได้ — ตีกลับได้เฉพาะฉบับที่ยังรอตรวจเท่านั้น', v_doc.status;
  end if;

  -- คงสถานะไว้ที่ draft ไม่ลบและไม่ archive: ฉบับนี้ยังต้องอยู่ให้แก้และส่งใหม่ได้
  -- และฉบับที่อนุมัติไปก่อนหน้ายังมีผลใช้งานอยู่เหมือนเดิม
  update public.floor_job_documents set
    status = 'draft',
    rejected_at = v_now,
    rejected_by = v_actor.id,
    rejection_reason = v_reason,
    updated_at = v_now
  where id = p_document_id;

  insert into public.floor_job_document_events(document_id, event_type, detail)
  values (p_document_id, 'rejected', jsonb_build_object(
    'rejectedBy', v_actor.id,
    'rejectedByName', v_actor.full_name,
    'approverRole', v_actor.role,
    'reason', v_reason
  ));

  return jsonb_build_object('documentId', p_document_id, 'status', 'draft', 'rejected', true);
end;
$function$;

comment on function public.reject_job_document(uuid, text) is
  'ตีกลับเอกสารที่ยังไม่ผ่าน พร้อมเหตุผลที่บังคับให้ยาวพอจะเข้าใจได้ '
  'เอกสารกลับไปเป็น draft ไม่ถูกลบ และฉบับที่อนุมัติไปก่อนหน้ายังมีผลอยู่';

revoke all on function public.reject_job_document(uuid, text) from public, anon, authenticated;
grant execute on function public.reject_job_document(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

-- P4-9 — tech_teams.eval_avg เลิกเป็นเลขที่ไม่มีใครคำนวณ
--
-- สภาพก่อนหน้า: tech_teams.eval_avg เป็น numeric default 0 ที่ไม่มีโค้ดไหนเขียนเลยทั้งระบบ
-- (grep ทั้ง repo เจอที่เดียวคือ app/(admin)/appointments/page.tsx:802 ที่ "อ่าน" มาโชว์เป็นดาว
--  โดยมีเงื่อนไข eval_avg > 0 — ซึ่งไม่เคยเป็นจริง จึงไม่เคยมีดาวขึ้นสักดวง)
--
-- สเกลที่ต้องรักษาไว้: จอนั้นโชว์ `★ {eval_avg.toFixed(1)}` แปลว่าคอลัมน์นี้เป็น "ดาว 0–5"
-- การเขียนคะแนน 0–100 ลงไปตรง ๆ จะทำให้จอเดิมโชว์ "★ 87.3" ซึ่งเป็นการเปลี่ยนความหมาย
-- ของคอลัมน์เดิม — ต้องห้าม ไฟล์นี้จึงเก็บคะแนนดิบ 0–100 ไว้ในตารางใหม่
-- แล้วเขียนกลับไปที่ eval_avg เป็นดาว (คะแนน/20) เท่านั้น
--
-- ทำไมต้องมีตารางแยก ไม่ใช่แค่ตัวเลขเดียว:
--   เลขรวมโดด ๆ ที่ไม่มีใครตรวจสอบที่มาได้ แย่กว่าไม่มีเลข เพราะคนจะเอาไปตัดสินใจโดยไม่รู้ว่ามันมาจากอะไร
--   ตารางนี้จึงเก็บ "คะแนนย่อยแต่ละด้าน + จำนวนตัวอย่างของด้านนั้น + ค่าดิบก่อนถ่วง" ไว้ครบ
--   หน้าจอกางให้ดูได้ทุกตัวว่าทำไมทีมนี้ได้เท่านี้
--
-- คณิตศาสตร์การให้คะแนน (ถ่วงน้ำหนัก + กฎกลุ่มตัวอย่างเล็ก) *ไม่ได้* อยู่ในไฟล์นี้
--   อยู่ที่ lib/provider-eval.ts เป็นฟังก์ชันบริสุทธิ์ที่มีเทสครบทุกองค์ประกอบ
--   ฝั่ง SQL ทำหน้าที่เดียวคือ "นับของจริงที่ระบบรู้" แล้วส่งตัวเลขดิบออกไป
--   เหตุผล: กฎการให้คะแนนจะถูกถกเถียงและแก้บ่อยกว่าวิธีนับ และแก้ในที่ที่ทดสอบได้ง่ายกว่าย่อมดีกว่า

begin;

-- ---------------------------------------------------------------------------
-- 1) ตารางผลคะแนน — หนึ่งทีมหนึ่งแถว (ผลล่าสุด)
-- ---------------------------------------------------------------------------
create table if not exists public.tech_team_eval_scores (
  team_id uuid primary key references public.tech_teams(id) on delete cascade,
  computed_at timestamptz not null default now(),
  method_version text not null,

  -- คะแนนรวม 0–100 (null = ไม่มีข้อมูลสักด้านเดียว จึงไม่มีคะแนนให้แสดง)
  eval_score numeric,
  -- ดาว 0–5 = eval_score/20 เก็บซ้ำไว้เพื่อให้ตรวจได้ว่าที่เขียนลง tech_teams คือค่าไหน
  eval_avg numeric,

  -- has_data = มีข้อมูลอย่างน้อยหนึ่งด้าน  /  is_provisional = งานยังน้อยเกินกว่าจะประกาศดาว
  has_data boolean not null default false,
  is_provisional boolean not null default true,
  job_count integer not null default 0,

  csat_score numeric,   csat_raw numeric,   csat_sample integer not null default 0,
  ncr_score numeric,    ncr_raw numeric,    ncr_sample integer not null default 0,
  ncr_weighted numeric not null default 0,  ncr_count integer not null default 0,
  ontime_score numeric, ontime_raw numeric, ontime_sample integer not null default 0,
  ftp_score numeric,    ftp_raw numeric,    ftp_sample integer not null default 0,

  updated_at timestamptz not null default now(),

  constraint tech_team_eval_scores_method_not_blank check (btrim(method_version) <> ''),
  constraint tech_team_eval_scores_score_range check (eval_score is null or (eval_score >= 0 and eval_score <= 100)),
  constraint tech_team_eval_scores_avg_range check (eval_avg is null or (eval_avg >= 0 and eval_avg <= 5)),
  constraint tech_team_eval_scores_component_range check (
    (csat_score is null or (csat_score >= 0 and csat_score <= 100)) and
    (ncr_score is null or (ncr_score >= 0 and ncr_score <= 100)) and
    (ontime_score is null or (ontime_score >= 0 and ontime_score <= 100)) and
    (ftp_score is null or (ftp_score >= 0 and ftp_score <= 100))
  ),
  constraint tech_team_eval_scores_sample_nonneg check (
    job_count >= 0 and csat_sample >= 0 and ncr_sample >= 0 and ontime_sample >= 0 and ftp_sample >= 0
    and ncr_count >= 0 and ncr_weighted >= 0
  ),
  -- ไม่มีข้อมูล = ห้ามมีคะแนน  (กันไม่ให้ "0 คะแนน" ถูกเข้าใจผิดว่าเป็นทีมที่แย่)
  constraint tech_team_eval_scores_no_data_no_score check (has_data or (eval_score is null and eval_avg is null)),
  -- งานน้อยกว่า 3 ใบ ห้ามถูกบันทึกว่าเป็นคะแนนที่นิ่งแล้ว — เป็นหลักประกันระดับโครงสร้าง
  -- ไม่ใช่แค่มารยาทของโค้ดที่คำนวณ ใครเขียนเข้ามาทางไหนก็ผ่านด่านนี้ไม่ได้
  constraint tech_team_eval_scores_small_sample_is_provisional check (job_count >= 3 or is_provisional)
);

comment on table public.tech_team_eval_scores is
  'คะแนนประเมินทีมช่าง/ผู้ให้บริการ พร้อมคะแนนย่อยรายด้านและจำนวนตัวอย่าง '
  'คำนวณโดย lib/provider-eval.ts ผ่าน /api/providers/eval-recompute แล้วเขียนผ่าน apply_tech_team_eval_scores';
comment on column public.tech_team_eval_scores.is_provisional is
  'true = งานยังน้อยกว่าเกณฑ์ขั้นต่ำ คะแนนยังไม่นิ่ง และจะไม่ถูกเขียนกลับไปที่ tech_teams.eval_avg';
comment on column public.tech_team_eval_scores.ncr_weighted is
  'จำนวน NC ถ่วงน้ำหนักตามความรุนแรงและสาเหตุ (cause_code) — ดู lib/provider-eval.ts';

create index if not exists tech_team_eval_scores_computed_at_idx on public.tech_team_eval_scores(computed_at desc);

alter table public.tech_team_eval_scores enable row level security;

revoke all on public.tech_team_eval_scores from anon, authenticated;

grant select on public.tech_team_eval_scores to authenticated;

drop policy if exists tech_team_eval_scores_active_staff_read on public.tech_team_eval_scores;
create policy tech_team_eval_scores_active_staff_read on public.tech_team_eval_scores
  for select to authenticated using ((select public.is_floor_staff_active()));

-- ---------------------------------------------------------------------------
-- 2) ตัวเลขดิบที่ระบบรู้จริง — ไม่มีการให้คะแนนใด ๆ ในนี้ มีแต่การนับ
-- ---------------------------------------------------------------------------
create or replace function public.tech_team_eval_inputs()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with team_jobs as (
    -- หนึ่งงานนับหนึ่งครั้งต่อทีม แม้จะมีหลายนัด (เลื่อนนัด/กลับไปซ้ำ)
    select distinct a.tech_id as team_id, a.job_id as job_no
    from public.appointments a
    join public.install_jobs j on j.job_no = a.job_id
    where a.tech_id is not null and a.job_id is not null
  ),
  planned as (
    -- "แผน" คือนัดล่าสุดของทีมนั้นบนงานนั้น เพราะการเลื่อนนัดที่ตกลงกับลูกค้าแล้ว
    -- คือแผนใหม่จริง ๆ ไม่ใช่ความสาย
    select a.tech_id as team_id, a.job_id as job_no,
           max((a.slot_end at time zone 'Asia/Bangkok')::date) as planned_date
    from public.appointments a
    where a.tech_id is not null and a.job_id is not null
    group by a.tech_id, a.job_id
  ),
  done as (
    -- วันที่ทำงานเสร็จจริง: completed_date ก่อน ถ้าไม่มีถอยไปวันที่ปิดงาน
    select j.job_no,
           coalesce(j.completed_date, (j.closed_at at time zone 'Asia/Bangkok')::date) as done_date
    from public.install_jobs j
  ),
  csat as (
    select e.job_no, avg(e.satisfaction_score::numeric) as score
    from public.job_evaluations e
    where e.satisfaction_score is not null
    group by e.job_no
  ),
  ncr as (
    select n.job_no,
           count(*) as cnt,
           sum(
             (case n.severity when 'critical' then 1.0 when 'high' then 1.0 when 'medium' then 0.5 else 0.25 end)
             *
             -- สาเหตุที่เป็นเรื่องของทีมติดตั้งเองนับเต็ม ที่เหลือนับ 0.25
             -- เพราะของมาไม่ครบเพราะคลัง ไม่ควรถูกตีเป็นฝีมือช่างเต็ม ๆ
             -- แต่ก็ไม่ควรเป็นศูนย์ เพราะงานที่ลูกค้าเจอปัญหาก็ยังคือหน้างานเดียวกัน
             (case when coalesce(n.cause_code, 'OTHER') in ('INSTALL', 'OTHER') then 1.0 else 0.25 end)
           ) as weighted
    from public.ncr_reports n
    where n.job_no is not null
    group by n.job_no
  ),
  acc as (
    select r.job_no,
           count(*) as rows_n,
           count(*) filter (where r.result = 'pass') as pass_n,
           count(*) filter (where r.result is distinct from 'pass' and r.result is distinct from 'na') as not_pass_n,
           -- ผ่านตั้งแต่ครั้งแรก = ไม่มีบรรทัดไหนถูกบันทึกซ้ำ
           -- (RPC เขียนแบบ on conflict do update set updated_at = now() ดังนั้น updated_at > created_at
           --  แปลว่าบรรทัดนั้นถูกบันทึกใหม่อย่างน้อยหนึ่งครั้ง)
           count(*) filter (where r.updated_at > r.created_at) as rerecord_n
    from public.job_acceptance_results r
    group by r.job_no
  )
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x."teamName"), '[]'::jsonb)
  from (
    select t.id as "teamId",
           t.name as "teamName",
           t.provider_type as "providerType",
           coalesce(t.is_active, true) as "isActive",
           count(tj.job_no)::int as "jobCount",
           coalesce(sum(c.score), 0)::numeric as "csatSum",
           count(c.score)::int as "csatCount",
           coalesce(sum(n.weighted), 0)::numeric as "ncrWeighted",
           coalesce(sum(n.cnt), 0)::int as "ncrCount",
           count(*) filter (where p.planned_date is not null and d.done_date is not null)::int as "onTimeBase",
           count(*) filter (where p.planned_date is not null and d.done_date is not null and d.done_date <= p.planned_date)::int as "onTimeCount",
           count(*) filter (where a.rows_n > 0)::int as "firstPassBase",
           count(*) filter (where a.rows_n > 0 and a.not_pass_n = 0 and a.pass_n > 0 and a.rerecord_n = 0)::int as "firstPassCount"
    from public.tech_teams t
    left join team_jobs tj on tj.team_id = t.id
    left join planned p on p.team_id = t.id and p.job_no = tj.job_no
    left join done d on d.job_no = tj.job_no
    left join csat c on c.job_no = tj.job_no
    left join ncr n on n.job_no = tj.job_no
    left join acc a on a.job_no = tj.job_no
    group by t.id, t.name, t.provider_type, t.is_active
  ) x;
$function$;

comment on function public.tech_team_eval_inputs() is
  'ตัวเลขดิบต่อทีมสำหรับคำนวณคะแนนผู้ให้บริการ (P4-9) — นับอย่างเดียว ไม่ให้คะแนน '
  'ผู้เรียกคือ /api/providers/eval-recompute ที่รันด้วย service_role';

-- ---------------------------------------------------------------------------
-- 3) เขียนผลคะแนนกลับ — ทางเขียนเดียวของตารางนี้และของ tech_teams.eval_avg
-- ---------------------------------------------------------------------------
create or replace function public.apply_tech_team_eval_scores(p_scores jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row jsonb;
  v_team uuid;
  v_written int := 0;
  v_stars int := 0;
  v_provisional int := 0;
begin
  if p_scores is null or jsonb_typeof(p_scores) <> 'array' then
    raise exception 'ต้องส่งผลคะแนนมาเป็น array';
  end if;

  for v_row in select value from jsonb_array_elements(p_scores) loop
    v_team := nullif(v_row->>'teamId', '')::uuid;
    if v_team is null then
      raise exception 'ผลคะแนนบางรายการไม่มี teamId';
    end if;
    if not exists (select 1 from public.tech_teams where id = v_team) then
      raise exception 'ไม่พบทีมช่างรหัส % — ข้อมูลอาจถูกลบระหว่างคำนวณ', v_team;
    end if;
    if nullif(btrim(coalesce(v_row->>'methodVersion', '')), '') is null then
      raise exception 'ผลคะแนนต้องระบุเวอร์ชันของวิธีคำนวณ (methodVersion) เสมอ';
    end if;

    insert into public.tech_team_eval_scores as s (
      team_id, computed_at, method_version, eval_score, eval_avg, has_data, is_provisional, job_count,
      csat_score, csat_raw, csat_sample,
      ncr_score, ncr_raw, ncr_sample, ncr_weighted, ncr_count,
      ontime_score, ontime_raw, ontime_sample,
      ftp_score, ftp_raw, ftp_sample, updated_at
    ) values (
      v_team, now(), btrim(v_row->>'methodVersion'),
      (v_row->>'evalScore')::numeric, (v_row->>'evalAvg')::numeric,
      coalesce((v_row->>'hasData')::boolean, false),
      coalesce((v_row->>'isProvisional')::boolean, true),
      coalesce((v_row->>'jobCount')::int, 0),
      (v_row->>'csatScore')::numeric, (v_row->>'csatRaw')::numeric, coalesce((v_row->>'csatSample')::int, 0),
      (v_row->>'ncrScore')::numeric, (v_row->>'ncrRaw')::numeric, coalesce((v_row->>'ncrSample')::int, 0),
      coalesce((v_row->>'ncrWeighted')::numeric, 0), coalesce((v_row->>'ncrCount')::int, 0),
      (v_row->>'onTimeScore')::numeric, (v_row->>'onTimeRaw')::numeric, coalesce((v_row->>'onTimeSample')::int, 0),
      (v_row->>'ftpScore')::numeric, (v_row->>'ftpRaw')::numeric, coalesce((v_row->>'ftpSample')::int, 0),
      now()
    )
    on conflict (team_id) do update set
      computed_at = excluded.computed_at, method_version = excluded.method_version,
      eval_score = excluded.eval_score, eval_avg = excluded.eval_avg,
      has_data = excluded.has_data, is_provisional = excluded.is_provisional, job_count = excluded.job_count,
      csat_score = excluded.csat_score, csat_raw = excluded.csat_raw, csat_sample = excluded.csat_sample,
      ncr_score = excluded.ncr_score, ncr_raw = excluded.ncr_raw, ncr_sample = excluded.ncr_sample,
      ncr_weighted = excluded.ncr_weighted, ncr_count = excluded.ncr_count,
      ontime_score = excluded.ontime_score, ontime_raw = excluded.ontime_raw, ontime_sample = excluded.ontime_sample,
      ftp_score = excluded.ftp_score, ftp_raw = excluded.ftp_raw, ftp_sample = excluded.ftp_sample,
      updated_at = now();

    v_written := v_written + 1;

    -- เขียนดาวกลับไปที่ tech_teams เฉพาะคะแนนที่ "นิ่งพอจะประกาศ" เท่านั้น
    -- ทีมที่ข้อมูลยังน้อย ไม่ประกาศดาว และไม่ไปแตะค่าเดิมของมันด้วย
    if coalesce((v_row->>'hasData')::boolean, false)
       and not coalesce((v_row->>'isProvisional')::boolean, true)
       and (v_row->>'evalAvg') is not null then
      update public.tech_teams set eval_avg = round((v_row->>'evalAvg')::numeric, 2) where id = v_team;
      v_stars := v_stars + 1;
    else
      v_provisional := v_provisional + 1;
    end if;
  end loop;

  return jsonb_build_object('written', v_written, 'starsPublished', v_stars, 'heldBack', v_provisional);
end;
$function$;

comment on function public.apply_tech_team_eval_scores(jsonb) is
  'บันทึกผลคะแนนที่ lib/provider-eval.ts คำนวณมา และเขียน tech_teams.eval_avg (ดาว 0–5) '
  'เฉพาะทีมที่ has_data และไม่ provisional — ทีมที่ข้อมูลยังน้อยจะไม่ถูกประกาศดาวและไม่ถูกแตะค่าเดิม';

-- ---------------------------------------------------------------------------
-- 4) สิทธิ์ — anon ต้องไม่เหลืออะไรเลยบนของใหม่ทั้งหมดในไฟล์นี้
-- ---------------------------------------------------------------------------
revoke all on function public.tech_team_eval_inputs() from public, anon, authenticated;
grant execute on function public.tech_team_eval_inputs() to service_role;

revoke all on function public.apply_tech_team_eval_scores(jsonb) from public, anon, authenticated;
grant execute on function public.apply_tech_team_eval_scores(jsonb) to service_role;

notify pgrst, 'reload schema';

commit;

-- P4-9 (ต่อ) — เก็บสองตัวเลขที่ทำให้คนตรวจคะแนนได้เอง
--
-- ระหว่างทดลองกับข้อมูลจริงเจอสองเรื่องที่ตารางเดิมยังตอบไม่ได้:
--
-- 1) performance_score — คะแนนจากผลงานล้วน ๆ ก่อนถูกหดตามจำนวนงาน
--    ถ้าเก็บแต่คะแนนสุดท้าย คนจะแยกไม่ออกว่า "ทีมนี้ทำได้ 87 แต่ยังรู้จักกันน้อยเลยเหลือ 73"
--    ต่างจาก "ทีมนี้ทำได้ 73 จริง ๆ" — สองอย่างนี้ต้องคุยกันคนละแบบ
--
-- 2) direct_evidence — จำนวนจุดข้อมูลที่ "มีคนบันทึกไว้จริง"
--    (คะแนนลูกค้า + งานที่เทียบวันนัดได้ + ผลตรวจรับ) ไม่นับด้าน NC
--    เหตุผล: ด้าน NC ให้คะแนนเต็มกับทีมที่ไม่มีใครเปิด NC ใส่ ซึ่งวันนี้เป็นจริงกับทุกทีม
--    เพราะ ncr_reports ยังมี 0 แถวทั้งระบบ — ถ้าไม่แยกตัวเลขนี้ออกมา ทีมที่ไม่มีข้อมูลอะไรเลย
--    จะได้ดาวราว 3.6 ดวงจากความว่างเปล่า และไม่มีใครในหน้าจอมองออกว่าทำไม
--    การไม่มีข่าวร้ายยังไม่ใช่ข่าวดี — เกณฑ์ประกาศดาวจึงต้องดูตัวเลขนี้ด้วย (lib/provider-eval.ts)
--
-- additive ล้วน: เพิ่มคอลัมน์ nullable/มี default บนตารางที่ไฟล์ 20260902200030 เพิ่งสร้างเอง
-- ยังไม่มีข้อมูลจริงในตารางนี้สักแถว

begin;

alter table public.tech_team_eval_scores add column if not exists performance_score numeric;
alter table public.tech_team_eval_scores add column if not exists direct_evidence integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tech_team_eval_scores_performance_range'
      and conrelid = 'public.tech_team_eval_scores'::regclass
  ) then
    alter table public.tech_team_eval_scores add constraint tech_team_eval_scores_performance_range
      check (performance_score is null or (performance_score >= 0 and performance_score <= 100));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'tech_team_eval_scores_direct_evidence_nonneg'
      and conrelid = 'public.tech_team_eval_scores'::regclass
  ) then
    alter table public.tech_team_eval_scores add constraint tech_team_eval_scores_direct_evidence_nonneg
      check (direct_evidence >= 0);
  end if;
end $$;

comment on column public.tech_team_eval_scores.performance_score is
  'คะแนนรวมจากผลงานล้วน ๆ ก่อนหดตามจำนวนงาน — ต่างจาก eval_score ที่หดแล้ว';
comment on column public.tech_team_eval_scores.direct_evidence is
  'จุดข้อมูลที่มีคนบันทึกไว้จริง = คะแนนลูกค้า + งานที่เทียบวันนัดได้ + ผลตรวจรับ (ไม่นับด้าน NC)';

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
      team_id, computed_at, method_version, eval_score, eval_avg, performance_score, direct_evidence,
      has_data, is_provisional, job_count,
      csat_score, csat_raw, csat_sample,
      ncr_score, ncr_raw, ncr_sample, ncr_weighted, ncr_count,
      ontime_score, ontime_raw, ontime_sample,
      ftp_score, ftp_raw, ftp_sample, updated_at
    ) values (
      v_team, now(), btrim(v_row->>'methodVersion'),
      (v_row->>'evalScore')::numeric, (v_row->>'evalAvg')::numeric,
      (v_row->>'performanceScore')::numeric, coalesce((v_row->>'directEvidence')::int, 0),
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
      performance_score = excluded.performance_score, direct_evidence = excluded.direct_evidence,
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

revoke all on function public.apply_tech_team_eval_scores(jsonb) from public, anon, authenticated;
grant execute on function public.apply_tech_team_eval_scores(jsonb) to service_role;

notify pgrst, 'reload schema';

commit;

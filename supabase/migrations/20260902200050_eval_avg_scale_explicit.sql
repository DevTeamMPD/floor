-- P4-9 (ต่อ) — ปัดดาวให้ตรงกับสเกลจริงของคอลัมน์ แทนที่จะให้ postgres ปัดให้เงียบ ๆ
--
-- ที่มา: โพรบ 7b พบว่าเขียน 4.29 ลง tech_teams.eval_avg แล้วอ่านกลับมาได้ 4.3
-- เพราะคอลัมน์เดิมเป็น numeric(3,1) — เก็บได้ทศนิยมเดียวและไม่เกิน 99.9
-- (ซึ่งเป็นหลักฐานอีกชิ้นว่าคอลัมน์นี้ถูกออกแบบมาเป็น "ดาว 0–5" ไม่ใช่คะแนน 0–100
--  ถ้าเขียนคะแนน 100 ลงไปตรง ๆ จะ overflow ทันที)
--
-- การพึ่งให้ฐานข้อมูลปัดให้เองแบบเงียบ ๆ ทำให้ค่าที่บันทึกไว้สองที่ไม่ตรงกันโดยไม่มีใครรู้
-- ไฟล์นี้จึงปัดที่ต้นทางให้ชัด: tech_teams.eval_avg = ทศนิยม 1 ตำแหน่งตามสเกลของคอลัมน์
-- ส่วน tech_team_eval_scores.eval_avg ยังเก็บ 2 ตำแหน่งตามที่คำนวณได้จริง เพื่อให้ตรวจย้อนได้
--
-- additive ล้วน: แทนที่ฟังก์ชันของงานนี้เองด้วย create or replace (ลายเซ็นเดิม)

begin;

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
    -- ปัดทศนิยม 1 ตำแหน่งให้ตรงกับ numeric(3,1) ของคอลัมน์ ไม่ปล่อยให้ฐานข้อมูลปัดให้เงียบ ๆ
    if coalesce((v_row->>'hasData')::boolean, false)
       and not coalesce((v_row->>'isProvisional')::boolean, true)
       and (v_row->>'evalAvg') is not null then
      update public.tech_teams set eval_avg = round((v_row->>'evalAvg')::numeric, 1) where id = v_team;
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

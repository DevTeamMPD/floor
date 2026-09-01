-- P4-9.2 — "ไม่มีใครเปิด NC" ต้องแปลว่า "ยังไม่มีหลักฐาน" ไม่ใช่ "ไม่มีปัญหา"
--
-- ที่มา (ผลรีวิว lib/provider-eval.ts:166):
--   ด้าน NC ให้ค่าดิบ 100 ทันทีที่ ncr_weighted = 0 และยังส่ง "จำนวนงานทั้งหมด" เข้าไปเป็น
--   จำนวนตัวอย่างด้วย ด้านนี้จึงแทบไม่ถูกหดเข้าหาค่ากลางเลย ทั้งที่วันนี้ ncr_reports มี 0 แถว
--   ทั้งระบบ — ไม่เคยมีใครเปิดใบ NC สักใบ ทุกทีมจึงได้คะแนนเกือบเต็มบน 25% ของคะแนนรวม
--   จากข้อเท็จจริงที่ว่า "ฟีเจอร์หนึ่งยังไม่มีใครใช้" ไม่ใช่จากการทำงานที่ดี
--   ตัวเลขจริงในฐานข้อมูลนี้ตอนพบปัญหา: ค่ากลางด้าน NC = 94.2 และคะแนนด้าน NC ของทีม 23 งาน = 99.0
--
--   เคสที่รีวิวประกอบขึ้นมาแล้วเป็นจริง: ทีมที่ลูกค้าให้ 2 จาก 5 ดาว (5 งาน ผ่านทั้งประตู 3 งาน
--   และ 5 จุดหลักฐาน) แต่ไม่มีใครเปิด NC ใส่ ได้ราว 3.3-3.5 ดาว — สัญญาณที่ตรงที่สุดบอกว่างานแย่
--   แต่คะแนนบอกว่าใช้ได้
--
-- คณิตศาสตร์ของกฎใหม่อยู่ที่ lib/provider-eval.ts (ncrProcessCredibility) ตามหลักเดิมของงานนี้:
--   ฝั่ง SQL "นับของจริง" ฝั่ง TS "ให้คะแนน" ไฟล์นี้จึงไม่มีสูตรคะแนน มีแต่
--   (1) ที่เก็บตัวคูณความน่าเชื่อ เพื่อให้หน้าจอกางที่มาได้ และ
--   (2) ด่านระดับตารางที่ทำให้กฎ "ไม่มีหลักฐานพอ = ห้ามประกาศดาว" ข้ามด้วยโค้ดฝั่งไหนก็ไม่ได้
--
-- ทำไมด่านหลักฐานต้องอยู่ในฐานข้อมูลด้วย (ผลรีวิวข้อรอง):
--   เกณฑ์ "งานอย่างน้อย 3 ใบ" มี check constraint ที่ตารางอยู่แล้ว
--   (tech_team_eval_scores_small_sample_is_provisional) แต่เกณฑ์ "หลักฐาน 5 จุด" อยู่ใน TypeScript
--   ที่เดียว — คนเขียนโค้ดคนถัดไปที่เรียก apply_tech_team_eval_scores เองโดยไม่ผ่าน
--   lib/provider-eval.ts จะประกาศดาวให้ทีมที่ไม่มีหลักฐานได้ โดยไม่มีอะไรในฐานข้อมูลห้ามไว้เลย
--   ไฟล์นี้ปิดช่องนั้นด้วยเกณฑ์ระดับเดียวกัน
--
-- additive ล้วน: เพิ่มคอลัมน์ nullable + เพิ่ม constraint บนตารางของงานนี้เอง
--   (tech_team_eval_scores สร้างที่ไฟล์ 20260902200030) และแทนที่ฟังก์ชันของงานนี้เองที่ลายเซ็นเดิม
--   ตอนรันไฟล์นี้ตารางมี 0 แถว (ยืนยันด้วยโพรบ P10 ใน p44-probes.sql) การเพิ่ม constraint
--   จึงไม่มีแถวเดิมให้ขัดแย้ง และไม่มีการแก้ไฟล์ migration ที่รันไปแล้วแม้แต่ไฟล์เดียว

begin;

-- ---------------------------------------------------------------------------
-- 1) เก็บตัวคูณความน่าเชื่อของระบบ NC ไว้กับผลคะแนน — เพื่อให้ "ทำไมด้าน NC ถึงเป็นแบบนี้"
--    ตรวจย้อนได้จากแถวเดียวกัน ไม่ต้องไปเดาจากที่อื่น
-- ---------------------------------------------------------------------------
alter table public.tech_team_eval_scores add column if not exists ncr_credibility numeric;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tech_team_eval_scores_ncr_credibility_range'
      and conrelid = 'public.tech_team_eval_scores'::regclass
  ) then
    alter table public.tech_team_eval_scores add constraint tech_team_eval_scores_ncr_credibility_range
      check (ncr_credibility is null or (ncr_credibility >= 0 and ncr_credibility <= 1));
  end if;

  -- หัวใจของการแก้ครั้งนี้ ในรูปที่ฐานข้อมูลบังคับเองได้:
  -- ถ้าระบบ NC ยังไม่ถูกใช้จริง (ตัวคูณ = 0) จะมีงานสักใบถูกนับเป็นตัวอย่างของด้าน NC ไม่ได้เลย
  if not exists (
    select 1 from pg_constraint where conname = 'tech_team_eval_scores_ncr_silence_not_evidence'
      and conrelid = 'public.tech_team_eval_scores'::regclass
  ) then
    alter table public.tech_team_eval_scores add constraint tech_team_eval_scores_ncr_silence_not_evidence
      check (coalesce(ncr_credibility, 0) > 0 or ncr_sample = 0);
  end if;

  -- เกณฑ์หลักฐานขั้นต่ำ 5 จุด ระดับเดียวกับเกณฑ์งาน 3 ใบ (MIN_DIRECT_EVIDENCE ใน TS)
  if not exists (
    select 1 from pg_constraint where conname = 'tech_team_eval_scores_thin_evidence_is_provisional'
      and conrelid = 'public.tech_team_eval_scores'::regclass
  ) then
    alter table public.tech_team_eval_scores add constraint tech_team_eval_scores_thin_evidence_is_provisional
      check (direct_evidence >= 5 or is_provisional);
  end if;
end $$;

comment on column public.tech_team_eval_scores.ncr_credibility is
  'ระบบ NC ของทั้งบริษัทถูกใช้จริงแค่ไหน 0-1 (ปริมาณใบ NC x อัตราต่องาน) '
  '0 = ยังไม่มีใครเปิดใบ NC เลย ความเงียบจึงไม่ถูกนับเป็นคุณภาพ — คำนวณที่ lib/provider-eval.ts';
comment on column public.tech_team_eval_scores.ncr_sample is
  'จำนวนงานของทีมที่นับเป็นหลักฐานด้าน NC ได้จริง = floor(job_count x ncr_credibility) '
  'ไม่ใช่จำนวนงานทั้งหมด — งานจะเป็นหลักฐานได้ก็ต่อเมื่อมีเหตุให้เชื่อว่ามีคนตรวจจริง';
comment on column public.tech_team_eval_scores.direct_evidence is
  'จุดข้อมูลที่มีคนบันทึก/สังเกตไว้จริง = คะแนนลูกค้า + งานที่เทียบวันนัดได้ + ผลตรวจรับ + งานที่นับ NC ได้จริง';

-- ---------------------------------------------------------------------------
-- 2) ทางเขียนเดียวของตาราง — เพิ่มการเก็บ ncr_credibility และด่านหลักฐานที่พูดภาษาคน
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
  v_has_data boolean;
  v_is_provisional boolean;
  v_evidence int;
  v_jobs int;
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

    v_has_data := coalesce((v_row->>'hasData')::boolean, false);
    v_is_provisional := coalesce((v_row->>'isProvisional')::boolean, true);
    v_evidence := coalesce((v_row->>'directEvidence')::int, 0);
    v_jobs := coalesce((v_row->>'jobCount')::int, 0);

    -- ด่านทั้งสองข้อ พูดเป็นภาษาไทยก่อนที่ check constraint จะเป็นคนพูด
    -- (constraint ยังอยู่และยังเป็นหลักประกันสุดท้าย ถ้ามีใครเขียนตารางโดยไม่ผ่านฟังก์ชันนี้)
    if v_has_data and not v_is_provisional and v_jobs < 3 then
      raise exception 'ทีม % มีงานที่นับได้ % ใบ ต้องมีอย่างน้อย 3 ใบจึงจะประกาศดาวได้', v_team, v_jobs;
    end if;
    if v_has_data and not v_is_provisional and v_evidence < 5 then
      raise exception 'ทีม % มีหลักฐานที่บันทึกไว้จริง % จุด ต้องมีอย่างน้อย 5 จุดจึงจะประกาศดาวได้ '
        '(การที่ไม่มีใครเปิดใบ NC ใส่ ไม่นับเป็นหลักฐาน)', v_team, v_evidence;
    end if;

    insert into public.tech_team_eval_scores as s (
      team_id, computed_at, method_version, eval_score, eval_avg, performance_score, direct_evidence,
      has_data, is_provisional, job_count,
      csat_score, csat_raw, csat_sample,
      ncr_score, ncr_raw, ncr_sample, ncr_weighted, ncr_count, ncr_credibility,
      ontime_score, ontime_raw, ontime_sample,
      ftp_score, ftp_raw, ftp_sample, updated_at
    ) values (
      v_team, now(), btrim(v_row->>'methodVersion'),
      (v_row->>'evalScore')::numeric, (v_row->>'evalAvg')::numeric,
      (v_row->>'performanceScore')::numeric, v_evidence,
      v_has_data, v_is_provisional, v_jobs,
      (v_row->>'csatScore')::numeric, (v_row->>'csatRaw')::numeric, coalesce((v_row->>'csatSample')::int, 0),
      (v_row->>'ncrScore')::numeric, (v_row->>'ncrRaw')::numeric, coalesce((v_row->>'ncrSample')::int, 0),
      coalesce((v_row->>'ncrWeighted')::numeric, 0), coalesce((v_row->>'ncrCount')::int, 0),
      (v_row->>'ncrCredibility')::numeric,
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
      ncr_credibility = excluded.ncr_credibility,
      ontime_score = excluded.ontime_score, ontime_raw = excluded.ontime_raw, ontime_sample = excluded.ontime_sample,
      ftp_score = excluded.ftp_score, ftp_raw = excluded.ftp_raw, ftp_sample = excluded.ftp_sample,
      updated_at = now();

    v_written := v_written + 1;

    -- เขียนดาวกลับไปที่ tech_teams เฉพาะคะแนนที่ "นิ่งพอจะประกาศ" เท่านั้น
    -- ทีมที่ข้อมูลยังน้อย ไม่ประกาศดาว และไม่ไปแตะค่าเดิมของมันด้วย
    -- ปัดทศนิยม 1 ตำแหน่งให้ตรงกับ numeric(3,1) ของคอลัมน์ ไม่ปล่อยให้ฐานข้อมูลปัดให้เงียบ ๆ
    if v_has_data and not v_is_provisional and (v_row->>'evalAvg') is not null then
      update public.tech_teams set eval_avg = round((v_row->>'evalAvg')::numeric, 1) where id = v_team;
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
  'เฉพาะทีมที่ has_data และไม่ provisional — ประตูสองข้อ (งาน >= 3 ใบ, หลักฐาน >= 5 จุด) '
  'ถูกบังคับทั้งในฟังก์ชันนี้และเป็น check constraint ที่ตาราง';

-- ---------------------------------------------------------------------------
-- 3) สิทธิ์ — เหมือนเดิมทุกประการ anon ต้องไม่เหลืออะไรเลย
-- ---------------------------------------------------------------------------
revoke all on function public.apply_tech_team_eval_scores(jsonb) from public, anon, authenticated;
grant execute on function public.apply_tech_team_eval_scores(jsonb) to service_role;

notify pgrst, 'reload schema';

commit;

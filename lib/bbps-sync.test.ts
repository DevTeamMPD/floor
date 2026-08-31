import { describe, it, expect } from "vitest";
import {
  collectBlockDates,
  jobHasYearWarning,
  findClashes,
  formatClashNote,
  mergeClashFlag,
  buildClashNotice,
  parseBbpsWorkOrders,
  CLASH_FLAG_PREFIX,
  type BbpsJob,
  type ClashRow,
} from "./bbps-sync";

describe("collectBlockDates", () => {
  it("วันเดียว → คืนวันนั้น (ไม่เลื่อนวันจาก timezone)", () => {
    // เคยมีบั๊ก: สร้าง Date ด้วย +07:00 แล้วอ่าน getDate() ใน UTC ทำให้เลื่อน -1 วัน
    expect(collectBlockDates({ id: "1", installStart: "2026-08-19", installEnd: "2026-08-19" })).toEqual(["2026-08-19"]);
  });

  it("หลายวัน → คืนทุกวันในช่วง (inclusive)", () => {
    expect(collectBlockDates({ id: "1", installStart: "2026-08-24", installEnd: "2026-08-25" }))
      .toEqual(["2026-08-24", "2026-08-25"]);
  });

  it("ปี พ.ศ. (>2100) → ไม่ block (ไม่แปลง 543 อัตโนมัติ)", () => {
    expect(collectBlockDates({ id: "1", installStart: "2569-08-24", installEnd: "2569-08-24" })).toEqual([]);
  });

  it("วันที่เป็น null → ไม่พัง คืน []", () => {
    expect(collectBlockDates({ id: "1", installStart: null, installEnd: null })).toEqual([]);
  });

  it("มีแค่ installStart (end = null) → block วันเดียว", () => {
    expect(collectBlockDates({ id: "1", installStart: "2026-09-04", installEnd: null })).toEqual(["2026-09-04"]);
  });

  it("ดึงจาก workOrders ได้ + รวม/เรียง/ไม่ซ้ำ", () => {
    const j: BbpsJob = { id: "1", installStart: null, installEnd: null,
      workOrders: [{ start: "2026-08-20", end: "2026-08-20" }, { start: "2026-08-19", end: "2026-08-20" }] };
    expect(collectBlockDates(j)).toEqual(["2026-08-19", "2026-08-20"]);
  });

  it("ข้ามเดือน (สิ้นเดือน→ต้นเดือน) นับต่อเนื่องถูก", () => {
    expect(collectBlockDates({ id: "1", installStart: "2026-08-31", installEnd: "2026-09-02" }))
      .toEqual(["2026-08-31", "2026-09-01", "2026-09-02"]);
  });
});

describe("jobHasYearWarning", () => {
  it("ค.ศ. ปกติ → false", () => {
    expect(jobHasYearWarning({ id: "1", installStart: "2026-08-19", installEnd: "2026-08-19" })).toBe(false);
  });
  it("พ.ศ. (>2100) → true", () => {
    expect(jobHasYearWarning({ id: "1", installStart: "2569-08-24" })).toBe(true);
  });
  it("null → false", () => {
    expect(jobHasYearWarning({ id: "1", installStart: null, installEnd: null })).toBe(false);
  });
  it("เจอปี พ.ศ. ใน workOrders ก็เตือน", () => {
    expect(jobHasYearWarning({ id: "1", workOrders: [{ start: "2569-01-01" }] })).toBe(true);
  });
});

// งาน BBPS ถูกจองให้ทีม B เต็มวัน 09:00-17:00 (+07) เสมอ
// เดิม lib/bbps-sync.ts insert ทับได้เลยโดยไม่เช็คอะไร — 20 ส.ค. 2026 จึงมีงาน BBPS
// ทับบล็อก "วันหยุด" ของทีม B ไปแล้วจริง
describe("findClashes", () => {
  const day = (d: string, start: string, end: string, notes: string | null = null): ClashRow =>
    ({ slot_start: `${d}T${start}:00+07:00`, slot_end: `${d}T${end}:00+07:00`, notes });

  it("ไม่มีคิวอื่น -> ไม่ชน", () => {
    expect(findClashes(["2026-09-10"], [])).toEqual([]);
  });

  it("มีคิวเต็มวันอยู่แล้ว -> ชน และบอกว่าชนกับอะไร", () => {
    expect(findClashes(["2026-09-10"], [day("2026-09-10", "09", "17", "วันหยุด")]))
      .toEqual([{ date: "2026-09-10", withLabel: "วันหยุด" }]);
  });

  it("ทับบางส่วนช่วงบ่าย -> ชน", () => {
    expect(findClashes(["2026-09-10"], [day("2026-09-10", "13", "15", "งานแก้ไข")]))
      .toEqual([{ date: "2026-09-10", withLabel: "งานแก้ไข" }]);
  });

  it("คนละวัน -> ไม่ชน", () => {
    expect(findClashes(["2026-09-10"], [day("2026-09-11", "09", "17", "งานอื่น")])).toEqual([]);
  });

  it("คิวข้ามวันที่เริ่มก่อนช่วงที่ขอ แล้วลากมาทับ -> ต้องชน", () => {
    // ช่องโหว่เดิมของการเช็คฝั่ง browser: กรองด้วย slot_start ในช่วงวันที่เลือกเท่านั้น
    // คิวที่เริ่มวันก่อนหน้าแต่ลากข้ามมา จึงไม่เคยถูกมองเห็น
    const spanning: ClashRow = { slot_start: "2026-09-09T09:00:00+07:00", slot_end: "2026-09-10T17:00:00+07:00", notes: "งานสองวัน" };
    expect(findClashes(["2026-09-10"], [spanning]))
      .toEqual([{ date: "2026-09-10", withLabel: "งานสองวัน" }]);
  });

  it("จบพอดีตอน 09:00 -> ต่อกันได้ ไม่ถือว่าชน", () => {
    expect(findClashes(["2026-09-10"], [day("2026-09-10", "07", "09", "งานเช้ามืด")])).toEqual([]);
  });

  it("หลายวัน -> รายงานเฉพาะวันที่ชนจริง", () => {
    const others = [day("2026-09-11", "09", "17", "🔒 BBPS · ลูกค้าอื่น")];
    expect(findClashes(["2026-09-10", "2026-09-11", "2026-09-12"], others))
      .toEqual([{ date: "2026-09-11", withLabel: "🔒 BBPS" }]);
  });

  it("ไม่มี notes -> ใช้ job_id, ไม่มีทั้งคู่ -> 'งานอื่น'", () => {
    const withJob: ClashRow = { slot_start: "2026-09-10T09:00:00+07:00", slot_end: "2026-09-10T17:00:00+07:00", notes: null, job_id: "BBPS-xyz" };
    const bare: ClashRow = { slot_start: "2026-09-10T09:00:00+07:00", slot_end: "2026-09-10T17:00:00+07:00" };
    expect(findClashes(["2026-09-10"], [withJob])[0].withLabel).toBe("BBPS-xyz");
    expect(findClashes(["2026-09-10"], [bare])[0].withLabel).toBe("งานอื่น");
  });
});

describe("mergeClashFlag", () => {
  const note = formatClashNote([{ date: "2026-09-10", withLabel: "วันหยุด" }])!;

  it("ยังไม่มี flag เดิม -> ได้ note ใหม่", () => {
    expect(mergeClashFlag(null, note)).toBe(note);
  });

  it("มี flag เดิมเรื่องอื่น -> ต่อท้าย ไม่ทับของเดิม", () => {
    expect(mergeClashFlag("ข้อมูลไม่ครบ: ชื่อลูกค้า", note))
      .toBe(`ข้อมูลไม่ครบ: ชื่อลูกค้า · ${note}`);
  });

  it("sync ซ้ำด้วย clash เดิม -> ไม่สะสมซ้ำ (idempotent)", () => {
    expect(mergeClashFlag(mergeClashFlag("ข้อมูลไม่ครบ: ชื่อลูกค้า", note), note))
      .toBe(`ข้อมูลไม่ครบ: ชื่อลูกค้า · ${note}`);
  });

  it("clash หายไปแล้ว -> ถอด note ออก เหลือแต่ flag อื่น", () => {
    expect(mergeClashFlag(`ข้อมูลไม่ครบ: ชื่อลูกค้า · ${note}`, null)).toBe("ข้อมูลไม่ครบ: ชื่อลูกค้า");
  });

  it("ไม่เหลืออะไรเลย -> null (ไม่ใช่ string ว่าง)", () => {
    expect(mergeClashFlag(note, null)).toBeNull();
    expect(mergeClashFlag(null, null)).toBeNull();
  });

  it("note ขึ้นต้นด้วย prefix ที่ระบุไว้ เพื่อให้ถอดออกได้ภายหลัง", () => {
    expect(note.startsWith(CLASH_FLAG_PREFIX)).toBe(true);
  });
});

describe("formatClashNote", () => {
  it("ไม่ชน -> null", () => {
    expect(formatClashNote([])).toBeNull();
  });
  it("ชนหลายวัน -> รวมเป็นบรรทัดเดียวอ่านออก", () => {
    expect(formatClashNote([
      { date: "2026-09-10", withLabel: "วันหยุด" },
      { date: "2026-09-11", withLabel: "งานคุณเอ" },
    ])).toBe(`${CLASH_FLAG_PREFIX} 2026-09-10 (วันหยุด), 2026-09-11 (งานคุณเอ)`);
  });
});

describe("buildClashNotice", () => {
  const jobNo = "BBPS-b8046f99-1699-47a2-8995-46e25295a083";
  const one = [{ date: "2026-09-10", withLabel: "วันหยุด" }];

  it("ไม่ชน -> null (ไม่ส่งข้อความรบกวน)", () => {
    expect(buildClashNotice(jobNo, [])).toBeNull();
  });

  it("บอกวันที่ชนและชนกับอะไร ครบทุกวัน", () => {
    const n = buildClashNotice(jobNo, [
      { date: "2026-09-10", withLabel: "วันหยุด" },
      { date: "2026-09-11", withLabel: "งานคุณเอ" },
    ])!;
    expect(n.body).toContain("2026-09-10 — ชนกับ วันหยุด");
    expect(n.body).toContain("2026-09-11 — ชนกับ งานคุณเอ");
    expect(n.body).toContain("ยังไม่ได้จองคิวให้");
  });

  it("ชุดวันที่ชนเดิม -> id เดิมทุกครั้ง (sync ซ้ำไม่ทำให้ BBPS ได้ข้อความซ้ำ)", () => {
    // ต้องรอให้เวลาเดินจริงก่อนเรียกรอบสอง ไม่งั้นถ้า id ผูกกับเวลา เทสต์จะผ่านทั้งที่ผิด
    const first = buildClashNotice(jobNo, one)!.externalMessageId;
    const until = Date.now() + 5;
    while (Date.now() < until) { /* ปล่อยให้นาฬิกาเดิน */ }
    expect(buildClashNotice(jobNo, one)!.externalMessageId).toBe(first);
  });

  it("คนละงาน หรือคนละชุดวันที่ -> คนละ id", () => {
    const a = buildClashNotice(jobNo, one)!.externalMessageId;
    const b = buildClashNotice("BBPS-other", one)!.externalMessageId;
    const c = buildClashNotice(jobNo, [{ date: "2026-09-12", withLabel: "วันหยุด" }])!.externalMessageId;
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("id ไม่ยาวเกินจนใช้เป็น header ไม่ได้ แม้ชนหลายสิบวัน", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ date: `2026-09-${String(i % 28 + 1).padStart(2, "0")}`, withLabel: "งานอื่น" }));
    expect(buildClashNotice(jobNo, many)!.externalMessageId.length).toBeLessThan(40);
  });

  it("id ขึ้นต้นด้วย lendi- ตามรูปแบบที่ฝั่ง BBPS ใช้ตัดซ้ำ", () => {
    expect(buildClashNotice(jobNo, one)!.externalMessageId.startsWith("lendi-")).toBe(true);
  });
});


// T2: BBPS ส่งใบสั่งงานมาครบ 37 ฟิลด์ต่อใบอยู่แล้ว (to_jsonb(w) ฝั่ง BBPS) แต่เดิมโค้ดนี้อ่านไปใช้
// แค่ seq/start/end ที่เหลือถูกทิ้งดิบไว้ใน install_jobs.raw_payload ไม่มีใครอ่าน
// parseBbpsWorkOrders เป็นฟังก์ชันบริสุทธิ์ที่แปลง workOrders ดิบให้เป็นแถวพร้อมเขียนลง
// install_job_work_orders — ไม่แตะฐานข้อมูล
describe("parseBbpsWorkOrders", () => {
  // ตัวอย่างจริงจากข้อมูล production (ตัดข้อมูลลูกค้าออก) — ครบทุกฟิลด์ที่ BBPS ส่งมา
  const fullOrder = {
    id: "3afc28e2-ca6f-41e7-9e58-cac2df3ee0ee",
    seq: 1,
    start: "2026-08-24",
    end: "2026-08-24",
    install_start: "2026-08-24",
    install_end: "2026-08-24",
    location_address: "อยู่หลังปั๊ม",
    location_map_link: "https://maps.app.goo.gl/ZGzMshQAvHzHweBSA",
    contact_name: "คุณรุ่งนภา",
    contact_phone: "0821592931",
    manpower: "ช่าง 2 คน",
    materials: "พื้น EVA 20 แผ่น",
    task_details: "รายละเอียดงานรวม",
    task_ball_pit: "Playspace 3 platform สีชมพูขาว",
    task_workshop_set: "Set Basic 7 รายการ",
    task_gym: "ขนาด 1.2*0.9 เมตร ยึดกับผนังห้อง",
    task_floor: null,
    task_other: null,
    constraint_access_time: "ได้ตลอดเวลา นัด 09.30-10.00 ได้เลย",
    constraint_logistics: null,
    constraint_work_area: "วางหน้าร้านได้ หรือวางในร้านได้เลย",
    constraint_obstacles: "ไม่มี",
    constraint_ground: "พื้น eva",
    constraint_utilities: "มีไฟ",
    constraint_noise_dust: "ใช้เสียงได้",
    constraint_weather: null,
    constraint_site_authority: null,
    acceptance_criteria: "เกณฑ์ตรวจรับรวม",
    acceptance_photos: null,
    acceptance_quality_check: null,
    acceptance_documents: null,
    acceptance_signoff: null,
    acceptance_followup: null,
    design_images: ["https://example.supabase.co/design/1.jpg"],
    site_photos: ["https://example.supabase.co/site/1.jpg"],
    created_at: "2026-08-17T13:22:02.499221+00:00",
    updated_at: "2026-08-22T10:58:38.902481+00:00",
  };

  it("payload จริงที่มีครบทุกฟิลด์ → แปลงครบ ไม่ตกหล่น", () => {
    const rows = parseBbpsWorkOrders({ id: "job-1", workOrders: [fullOrder] });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.external_work_order_id).toBe(fullOrder.id);
    expect(row.seq).toBe(1);
    expect(row.install_start).toBe("2026-08-24");
    expect(row.install_end).toBe("2026-08-24");
    expect(row.location_address).toBe(fullOrder.location_address);
    expect(row.location_map_link).toBe(fullOrder.location_map_link);
    expect(row.contact_name).toBe(fullOrder.contact_name);
    expect(row.contact_phone).toBe(fullOrder.contact_phone);
    expect(row.manpower).toBe(fullOrder.manpower);
    expect(row.materials).toBe(fullOrder.materials);
    expect(row.task_details).toBe(fullOrder.task_details);
    expect(row.task_ball_pit).toBe(fullOrder.task_ball_pit);
    expect(row.task_workshop_set).toBe(fullOrder.task_workshop_set);
    expect(row.task_gym).toBe(fullOrder.task_gym);
    expect(row.task_floor).toBeNull();
    expect(row.task_other).toBeNull();
    expect(row.constraint_access_time).toBe(fullOrder.constraint_access_time);
    expect(row.constraint_logistics).toBeNull();
    expect(row.constraint_work_area).toBe(fullOrder.constraint_work_area);
    expect(row.constraint_obstacles).toBe(fullOrder.constraint_obstacles);
    expect(row.constraint_ground).toBe(fullOrder.constraint_ground);
    expect(row.constraint_utilities).toBe(fullOrder.constraint_utilities);
    expect(row.constraint_noise_dust).toBe(fullOrder.constraint_noise_dust);
    expect(row.constraint_weather).toBeNull();
    expect(row.constraint_site_authority).toBeNull();
    expect(row.acceptance_criteria).toBe(fullOrder.acceptance_criteria);
    expect(row.acceptance_photos).toBeNull();
    expect(row.acceptance_quality_check).toBeNull();
    expect(row.acceptance_documents).toBeNull();
    expect(row.acceptance_signoff).toBeNull();
    expect(row.acceptance_followup).toBeNull();
    expect(row.design_images).toEqual(["https://example.supabase.co/design/1.jpg"]);
    expect(row.site_photos).toEqual(["https://example.supabase.co/site/1.jpg"]);
    expect(row.raw).toEqual(fullOrder);
  });

  it("workOrders เป็น null → คืน [] ไม่ throw", () => {
    expect(parseBbpsWorkOrders({ id: "job-1", workOrders: null })).toEqual([]);
  });

  it("ไม่มี workOrders เลย → คืน [] ไม่ throw", () => {
    expect(parseBbpsWorkOrders({ id: "job-1" })).toEqual([]);
  });

  it("design_images / site_photos เป็น null → คืน [] ไม่ใช่ null", () => {
    const rows = parseBbpsWorkOrders({
      id: "job-1",
      workOrders: [{ id: "wo-1", seq: 1, design_images: null, site_photos: null } as never],
    });
    expect(rows[0].design_images).toEqual([]);
    expect(rows[0].site_photos).toEqual([]);
  });

  it("design_images เป็น array → คงค่าไว้", () => {
    const rows = parseBbpsWorkOrders({
      id: "job-1",
      workOrders: [{ id: "wo-1", seq: 1, design_images: ["a.jpg", "b.jpg"], site_photos: [] } as never],
    });
    expect(rows[0].design_images).toEqual(["a.jpg", "b.jpg"]);
  });

  // ใช้ isCEDate ตัวเดิมใน lib/bbps-sync.ts ซ้ำ — ห้ามเก็บปี พ.ศ. ที่แปลงเป็นวันที่ผิดเพี้ยนลงคอลัมน์ date
  it("install_start/install_end เป็นปี พ.ศ. (>2100) → คืน null ไม่ใช่ค่าเพี้ยน", () => {
    const rows = parseBbpsWorkOrders({
      id: "job-1",
      workOrders: [{ id: "wo-1", seq: 1, install_start: "2569-08-24", install_end: "2569-08-24" } as never],
    });
    expect(rows[0].install_start).toBeNull();
    expect(rows[0].install_end).toBeNull();
  });

  it("install_start/install_end ปี ค.ศ. ปกติ → เก็บค่าไว้", () => {
    const rows = parseBbpsWorkOrders({
      id: "job-1",
      workOrders: [{ id: "wo-1", seq: 1, install_start: "2026-09-01", install_end: "2026-09-02" } as never],
    });
    expect(rows[0].install_start).toBe("2026-09-01");
    expect(rows[0].install_end).toBe("2026-09-02");
  });

  it("work order ที่ไม่มี id → ข้ามรายการนั้น ไม่ทำให้ทั้งชุดพัง", () => {
    const rows = parseBbpsWorkOrders({
      id: "job-1",
      workOrders: [
        { seq: 1, install_start: "2026-09-01" } as never, // ไม่มี id
        { id: "wo-2", seq: 2, install_start: "2026-09-02" } as never,
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].external_work_order_id).toBe("wo-2");
  });

  it("หลายใบสั่งงานในงานเดียว → แปลงครบทุกใบ เรียงตามลำดับเดิม", () => {
    const rows = parseBbpsWorkOrders({
      id: "job-1",
      workOrders: [
        { id: "wo-1", seq: 1 } as never,
        { id: "wo-2", seq: 2 } as never,
      ],
    });
    expect(rows.map((r) => r.external_work_order_id)).toEqual(["wo-1", "wo-2"]);
  });
});

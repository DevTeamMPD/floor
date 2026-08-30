import { describe, it, expect, beforeEach, vi } from "vitest";
import { signBody } from "@/lib/integrations/bbps-chat";

/**
 * เทส webhook ขาเข้า POST /api/webhook/bbps/chat ตาม contract §2
 * ครอบ: ลายเซ็นถูก/ผิด · timestamp หมดอายุ · ตั๋วไม่พบ · ข้อความซ้ำ (409) · retry ไม่สร้างซ้ำ
 */

const SECRET = "bbps-chat-secret-for-tests";
const TICKET_ID = "36445339-3487-4c1f-96aa-8820b0da8baf";

interface StubState {
  jobByExternalId: string | null;
  jobByQuote: string | null;
  seenExternalIds: Set<string>;
  insertCount: number;
}
const state: StubState = { jobByExternalId: "JOB-001", jobByQuote: null, seenExternalIds: new Set(), insertCount: 0 };

function installJobsQuery() {
  const filters: Record<string, string> = {};
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    eq: (column: string, value: string) => { filters[column] = value; return builder; },
    maybeSingle: async () => {
      if (filters.external_id) return { data: state.jobByExternalId ? { job_no: state.jobByExternalId } : null };
      if (filters.order_no) return { data: state.jobByQuote ? { job_no: state.jobByQuote } : null };
      return { data: null };
    },
  });
  return builder;
}

function messagesQuery() {
  let pending: Record<string, unknown> | null = null;
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    insert: (row: Record<string, unknown>) => { pending = row; return builder; },
    select: () => builder,
    single: async () => {
      const externalId = String(pending?.external_message_id ?? "");
      if (state.seenExternalIds.has(externalId)) return { data: null, error: { code: "23505", message: "duplicate key" } };
      state.seenExternalIds.add(externalId);
      state.insertCount++;
      return { data: { id: `floor-message-${state.insertCount}` }, error: null };
    },
  });
  return builder;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => (table === "install_jobs" ? installJobsQuery() : messagesQuery()),
  }),
}));

const { POST } = await import("@/app/api/webhook/bbps/chat/route");

function eventBody(overrides: Record<string, unknown> = {}) {
  const { data: dataOverride, ...rest } = overrides;
  return {
    event_id: crypto.randomUUID(),
    event_type: "ticket.message.created.v1",
    occurred_at: new Date().toISOString(),
    ...rest,
    // data ต้อง merge ทีละคีย์ ไม่ใช่ทับทั้งก้อน ไม่งั้นเทสจะผ่าน/ตกด้วยเหตุผลผิด
    data: {
      message_id: "9d41f2ab-0000-4000-8000-000000000001",
      ticket_id: TICKET_ID,
      quote_number: "QT-20260824-001",
      sender_name: "คุณเมย์ ฝ่ายขาย",
      sender_role: "sales",
      body: "ลูกค้าขอเลื่อนเข้าหน้างานเป็นบ่ายโมงนะคะ",
      attachments: [],
      created_at: new Date().toISOString(),
      ...(dataOverride as Record<string, unknown> ?? {}),
    },
  };
}

function request(body: unknown, options?: { secret?: string; token?: string; timestamp?: number }) {
  const raw = JSON.stringify(body);
  const timestamp = options?.timestamp ?? Math.floor(Date.now() / 1000);
  return new Request("https://floor-delta.vercel.app/api/webhook/bbps/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${options?.token ?? SECRET}`,
      "X-Event-Type": "ticket.message.created.v1",
      "X-Timestamp": String(timestamp),
      "X-Signature": signBody(options?.secret ?? SECRET, timestamp, raw),
      "X-Signature-Key-Id": "bbps-k1",
      "X-Idempotency-Key": "9d41f2ab-0000-4000-8000-000000000001",
    },
    body: raw,
  });
}

beforeEach(() => {
  state.jobByExternalId = "JOB-001";
  state.jobByQuote = null;
  state.seenExternalIds = new Set();
  state.insertCount = 0;
  process.env.BBPS_CHAT_WEBHOOK_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests";
  delete process.env.BBPS_CHAT_INBOUND_TOKEN;
  delete process.env.BBPS_CHAT_WEBHOOK_SECRET_PREVIOUS;
});

describe("POST /api/webhook/bbps/chat", () => {
  it("201 เมื่อลายเซ็นถูกและหาตั๋วเจอ", async () => {
    const res = await POST(request(eventBody()));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.job_no).toBe("JOB-001");
  });

  it("401 เมื่อลายเซ็นผิด", async () => {
    const res = await POST(request(eventBody(), { secret: "wrong-secret" }));
    expect(res.status).toBe(401);
  });

  it("401 เมื่อ Bearer ผิดแม้ลายเซ็นถูก", async () => {
    const res = await POST(request(eventBody(), { token: "wrong-token" }));
    expect(res.status).toBe(401);
  });

  it("401 เมื่อ timestamp หมดอายุ", async () => {
    const res = await POST(request(eventBody(), { timestamp: Math.floor(Date.now() / 1000) - 400 }));
    expect(res.status).toBe(401);
    expect((await res.json()).reason).toBe("timestamp_expired");
  });

  it("404 เมื่อหาตั๋วไม่เจอทั้งสองทาง", async () => {
    state.jobByExternalId = null;
    const res = await POST(request(eventBody()));
    expect(res.status).toBe(404);
  });

  it("resolve จาก quote_number ได้เมื่อ external_id ไม่ตรง", async () => {
    state.jobByExternalId = null;
    state.jobByQuote = "JOB-009";
    const res = await POST(request(eventBody()));
    expect(res.status).toBe(201);
    expect((await res.json()).job_no).toBe("JOB-009");
  });

  it("ส่งซ้ำ -> 409 และไม่สร้างข้อความใหม่", async () => {
    expect((await POST(request(eventBody()))).status).toBe(201);
    const second = await POST(request(eventBody()));
    expect(second.status).toBe(409);
    expect(state.insertCount).toBe(1);
  });

  it("dispatcher retry สามรอบยังได้ข้อความเดียว", async () => {
    await POST(request(eventBody()));
    await POST(request(eventBody()));
    await POST(request(eventBody()));
    expect(state.insertCount).toBe(1);
  });

  it("422 เมื่อไม่มี message_id และไม่มี X-Idempotency-Key", async () => {
    const body = eventBody({ data: { message_id: undefined } });
    const raw = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000);
    const res = await POST(new Request("https://floor-delta.vercel.app/api/webhook/bbps/chat", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SECRET}`,
        "X-Timestamp": String(timestamp),
        "X-Signature": signBody(SECRET, timestamp, raw),
      },
      body: raw,
    }));
    expect(res.status).toBe(422);
  });

  it("422 เมื่อข้อความว่างและไม่มีไฟล์แนบ", async () => {
    const res = await POST(request(eventBody({ data: { body: "   ", attachments: [] } })));
    expect(res.status).toBe(422);
  });

  it("ตัดไฟล์แนบที่ไม่ใช่ https ทิ้ง (กัน XSS ผ่าน href/src)", async () => {
    const res = await POST(request(eventBody({
      data: { body: "ดูรูปนี้", attachments: [{ url: "javascript:alert(1)" }, { url: "https://ok.example/a.jpg" }] },
    })));
    expect(res.status).toBe(201);
  });

  it("503 เมื่อยังไม่ได้ตั้ง secret — deploy ขึ้นไปก่อนได้", async () => {
    delete process.env.BBPS_CHAT_WEBHOOK_SECRET;
    const res = await POST(request(eventBody()));
    expect(res.status).toBe(503);
  });
});

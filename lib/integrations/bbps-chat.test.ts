import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "crypto";
import {
  signBody, safeEqualUtf8, signAttachmentGrant, verifyAttachmentGrant,
  buildAttachmentUrl, mapSenderRole, attachmentKind, outboundConfig, sendMessageToBbps,
  type OutboundConfig,
} from "./bbps-chat";

const SECRET = "outbound-secret-for-tests";
const CONFIG: OutboundConfig = {
  url: "https://bbps.example/api/integrations/lendi/messages",
  token: "outbound-token-for-tests",
  secret: SECRET,
  keyId: "lendi-k1",
};

const message = {
  externalMessageId: "lendi-abc",
  ticketId: "36445339-3487-4c1f-96aa-8820b0da8baf",
  quoteNumber: "QT-20260824-001",
  senderName: "คุณเมย์",
  senderRole: "sales",
  body: "ลูกค้าขอเลื่อนเป็นบ่ายโมง",
  attachments: [],
  createdAt: "2026-08-29T07:00:00.000Z",
};

describe("signBody", () => {
  it("ตรงกับสูตร v1=hex(HMAC(secret, `${ts}.${rawBody}`)) ของฝั่ง BBPS", () => {
    const raw = '{"a":1}';
    const expected = "v1=" + createHmac("sha256", SECRET).update(`1700000000.${raw}`).digest("hex");
    expect(signBody(SECRET, 1_700_000_000, raw)).toBe(expected);
  });

  it("เปลี่ยน timestamp อย่างเดียวก็ได้ลายเซ็นคนละอัน (กัน replay)", () => {
    const raw = '{"a":1}';
    expect(signBody(SECRET, 1, raw)).not.toBe(signBody(SECRET, 2, raw));
  });
});

describe("safeEqualUtf8", () => {
  it("true เฉพาะเมื่อเท่ากันจริง", () => {
    expect(safeEqualUtf8("abc", "abc")).toBe(true);
    expect(safeEqualUtf8("abc", "abd")).toBe(false);
    expect(safeEqualUtf8("abc", "abcd")).toBe(false);
    expect(safeEqualUtf8("", "")).toBe(false);
  });
});

describe("capability URL ของไฟล์แนบ", () => {
  const secret = "file-secret-for-tests";

  it("ออกแล้วตรวจกลับได้", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = signAttachmentGrant({ path: "JOB-1/a.jpg", jobNo: "JOB-1", exp }, secret);
    const grant = verifyAttachmentGrant(token, secret);
    expect(grant?.path).toBe("JOB-1/a.jpg");
  });

  it("ปฏิเสธเมื่อลายเซ็นไม่ตรง (แก้ path แล้วเซ็นเดิม)", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = signAttachmentGrant({ path: "JOB-1/a.jpg", jobNo: "JOB-1", exp }, secret);
    const [data, sig] = token.split(".");
    const tamperedData = Buffer.from(JSON.stringify({ path: "OTHER-JOB/secret.pdf", jobNo: "JOB-1", exp }))
      .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(data).not.toBe(tamperedData);
    expect(verifyAttachmentGrant(`${tamperedData}.${sig}`, secret)).toBeNull();
  });

  it("ปฏิเสธเมื่อใช้ secret คนละตัว (หมุน secret = เพิกถอนลิงก์เก่าทั้งชุด)", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = signAttachmentGrant({ path: "JOB-1/a.jpg", jobNo: "JOB-1", exp }, secret);
    expect(verifyAttachmentGrant(token, "rotated-secret")).toBeNull();
  });

  it("ปฏิเสธเมื่อหมดอายุ", () => {
    const token = signAttachmentGrant({ path: "JOB-1/a.jpg", jobNo: "JOB-1", exp: Math.floor(Date.now() / 1000) - 1 }, secret);
    expect(verifyAttachmentGrant(token, secret)).toBeNull();
  });

  it("buildAttachmentUrl คืน null เมื่อยังไม่ได้ตั้ง env — ผู้เรียกต้องรายงานข้อจำกัดแทนที่จะส่งลิงก์เสีย", () => {
    delete process.env.BBPS_CHAT_FILE_SECRET;
    delete process.env.LENDI_PUBLIC_BASE_URL;
    expect(buildAttachmentUrl("JOB-1/a.jpg", "JOB-1")).toBeNull();
  });

  it("buildAttachmentUrl ได้ https URL ที่ตรวจกลับได้เมื่อ env ครบ", () => {
    process.env.BBPS_CHAT_FILE_SECRET = secret;
    process.env.LENDI_PUBLIC_BASE_URL = "https://floor-delta.vercel.app";
    const url = buildAttachmentUrl("JOB-1/a.jpg", "JOB-1");
    expect(url).toMatch(/^https:\/\/floor-delta\.vercel\.app\/api\/integrations\/bbps\/file\?t=/);
    const token = decodeURIComponent(new URL(url!).searchParams.get("t")!);
    expect(verifyAttachmentGrant(token, secret)?.path).toBe("JOB-1/a.jpg");
  });
});

describe("mapSenderRole / attachmentKind", () => {
  it("แปลงบทบาทตามที่ BBPS รับได้", () => {
    expect(mapSenderRole("technician")).toBe("technician");
    expect(mapSenderRole("head_technician")).toBe("foreman");
    expect(mapSenderRole("sales")).toBe("sales");
    expect(mapSenderRole("warehouse")).toBe("warehouse");
    expect(mapSenderRole("อะไรไม่รู้")).toBe("staff");
  });

  it("แยกรูปกับไฟล์จากนามสกุล", () => {
    expect(attachmentKind("a.JPG")).toBe("image");
    expect(attachmentKind("a.heic")).toBe("image");
    expect(attachmentKind("a.pdf")).toBe("file");
  });
});

describe("outboundConfig", () => {
  const keys = ["BBPS_CHAT_API_URL", "BBPS_CHAT_OUTBOUND_TOKEN", "BBPS_CHAT_OUTBOUND_SECRET", "BBPS_CHAT_OUTBOUND_KEY_ID"];
  beforeEach(() => { for (const key of keys) delete process.env[key]; });

  it("null เมื่อ env ไม่ครบ — endpoint จะตอบว่ายังไม่ได้ตั้งค่า แทนที่จะพัง", () => {
    expect(outboundConfig()).toBeNull();
    process.env.BBPS_CHAT_API_URL = CONFIG.url;
    expect(outboundConfig()).toBeNull();
  });

  it("คืนค่าครบพร้อม keyId ปริยายเมื่อ env ครบ", () => {
    process.env.BBPS_CHAT_API_URL = CONFIG.url;
    process.env.BBPS_CHAT_OUTBOUND_TOKEN = CONFIG.token;
    process.env.BBPS_CHAT_OUTBOUND_SECRET = CONFIG.secret;
    expect(outboundConfig()).toEqual({ ...CONFIG, keyId: "lendi-k1" });
  });
});

describe("sendMessageToBbps", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

  function mockFetch(status: number, body: unknown) {
    const spy = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
    globalThis.fetch = spy as unknown as typeof fetch;
    return spy;
  }

  it("201 -> delivered พร้อม message_id ของ BBPS", async () => {
    mockFetch(201, { message_id: "bbps-1", status: "delivered" });
    const outcome = await sendMessageToBbps(message, CONFIG);
    expect(outcome).toEqual({ kind: "delivered", providerMessageId: "bbps-1", duplicate: false });
  });

  it("200 duplicate -> delivered เหมือนเดิม (retry ไม่สร้างข้อความซ้ำ)", async () => {
    mockFetch(200, { message_id: "bbps-1", status: "duplicate" });
    const outcome = await sendMessageToBbps(message, CONFIG);
    expect(outcome).toEqual({ kind: "delivered", providerMessageId: "bbps-1", duplicate: true });
  });

  it("ส่งซ้ำใช้ external_message_id เดิมทุกครั้ง — กุญแจ idempotency คงที่", async () => {
    const spy = mockFetch(201, { message_id: "bbps-1", status: "delivered" });
    await sendMessageToBbps(message, CONFIG);
    await sendMessageToBbps(message, CONFIG);
    const bodies = spy.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string));
    expect(bodies[0].external_message_id).toBe("lendi-abc");
    expect(bodies[1].external_message_id).toBe("lendi-abc");
    const headers = spy.mock.calls.map((call) => (call[1] as RequestInit).headers as Record<string, string>);
    expect(headers[0]["X-Idempotency-Key"]).toBe("lendi-abc");
    expect(headers[1]["X-Idempotency-Key"]).toBe("lendi-abc");
  });

  it("ลายเซ็นที่แนบไปตรงกับ raw body ที่ส่งจริง", async () => {
    const spy = mockFetch(201, { message_id: "bbps-1" });
    await sendMessageToBbps(message, CONFIG);
    const init = spy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Signature"]).toBe(signBody(SECRET, Number(headers["X-Timestamp"]), init.body as string));
    expect(headers["Authorization"]).toBe(`Bearer ${CONFIG.token}`);
  });

  it("401/404/422 -> failed (อย่า retry) พร้อมข้อความที่ผู้ใช้อ่านรู้เรื่อง", async () => {
    for (const status of [401, 404, 422]) {
      mockFetch(status, { error: "nope" });
      const outcome = await sendMessageToBbps(message, CONFIG);
      expect(outcome.kind).toBe("failed");
      expect(outcome.kind === "failed" && outcome.message).toBeTruthy();
    }
  });

  it("429/500/503 -> retry", async () => {
    for (const status of [429, 500, 502, 503]) {
      mockFetch(status, { error: "later" });
      const outcome = await sendMessageToBbps(message, CONFIG);
      expect(outcome.kind).toBe("retry");
    }
  });

  it("network error -> retry ไม่ใช่ failed", async () => {
    globalThis.fetch = (async () => { throw new Error("connect ETIMEDOUT"); }) as unknown as typeof fetch;
    const outcome = await sendMessageToBbps(message, CONFIG);
    expect(outcome).toEqual({ kind: "retry", message: "connect ETIMEDOUT" });
  });

  it("2xx ที่ไม่มี message_id -> retry (ไม่ยอมบอกผู้ใช้ว่าส่งถึงแล้วทั้งที่ไม่รู้)", async () => {
    mockFetch(201, { status: "delivered" });
    const outcome = await sendMessageToBbps(message, CONFIG);
    expect(outcome.kind).toBe("retry");
  });
});

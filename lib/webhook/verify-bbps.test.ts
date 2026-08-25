import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { verifyBbpsSignature } from "./verify-bbps";

const SECRET = "s3cr3t";
const BODY = '{"event":"upsert","jobs":[{"id":"x"}]}';
const NOW = 1_700_000_000_000; // fixed clock
const TS = String(Math.floor(NOW / 1000));

function sign(ts: string, body: string, secret = SECRET) {
  return "sha256=" + createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
}

describe("verifyBbpsSignature", () => {
  it("ลายเซ็นถูกต้อง → ok", () => {
    expect(verifyBbpsSignature({ rawBody: BODY, signature: sign(TS, BODY), timestamp: TS, secret: SECRET, now: NOW }))
      .toEqual({ ok: true });
  });

  it("body ถูกแก้ (tamper) → invalid_signature", () => {
    const r = verifyBbpsSignature({ rawBody: BODY + " ", signature: sign(TS, BODY), timestamp: TS, secret: SECRET, now: NOW });
    expect(r.ok).toBe(false); expect(r.reason).toBe("invalid_signature");
  });

  it("secret ผิด → invalid_signature", () => {
    const r = verifyBbpsSignature({ rawBody: BODY, signature: sign(TS, BODY, "wrong"), timestamp: TS, secret: SECRET, now: NOW });
    expect(r.ok).toBe(false); expect(r.reason).toBe("invalid_signature");
  });

  it("timestamp เก่าเกิน tolerance (replay) → timestamp_expired", () => {
    const oldTs = String(Math.floor(NOW / 1000) - 600); // 10 นาทีก่อน (เกิน 5 นาที)
    const r = verifyBbpsSignature({ rawBody: BODY, signature: sign(oldTs, BODY), timestamp: oldTs, secret: SECRET, now: NOW });
    expect(r.ok).toBe(false); expect(r.reason).toBe("timestamp_expired");
  });

  it("ไม่มี header → missing_signature_headers", () => {
    const r = verifyBbpsSignature({ rawBody: BODY, signature: null, timestamp: null, secret: SECRET, now: NOW });
    expect(r.ok).toBe(false); expect(r.reason).toBe("missing_signature_headers");
  });

  it("รองรับ timestamp เป็น ms และ ISO", () => {
    const tsMs = String(NOW);
    expect(verifyBbpsSignature({ rawBody: BODY, signature: sign(tsMs, BODY), timestamp: tsMs, secret: SECRET, now: NOW }).ok).toBe(true);
    const iso = new Date(NOW).toISOString();
    expect(verifyBbpsSignature({ rawBody: BODY, signature: sign(iso, BODY), timestamp: iso, secret: SECRET, now: NOW }).ok).toBe(true);
  });

  it("รับลายเซ็นแบบไม่มี prefix sha256= ก็ได้", () => {
    const bare = sign(TS, BODY).slice("sha256=".length);
    expect(verifyBbpsSignature({ rawBody: BODY, signature: bare, timestamp: TS, secret: SECRET, now: NOW }).ok).toBe(true);
  });
});

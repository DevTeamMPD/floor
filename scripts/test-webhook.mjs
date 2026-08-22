#!/usr/bin/env node
// C6 -- manual test script for /api/webhook/bbps. Plain node, no new deps.
//
// Requires (in the same shell that started `npm run dev`, or exported here):
//   BBPS_WEBHOOK_SECRET_K1        -- must match the running server's value
// Optional (enables the DB-backed assertion in case 6):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional:
//   WEBHOOK_TEST_URL   (default http://localhost:3000/api/webhook/bbps)
//
// Usage: node scripts/test-webhook.mjs

import crypto from "node:crypto";

const BASE_URL = process.env.WEBHOOK_TEST_URL || "http://localhost:3000/api/webhook/bbps";
const SECRET = process.env.BBPS_WEBHOOK_SECRET_K1;

if (!SECRET) {
  console.error("FAIL - setup :: BBPS_WEBHOOK_SECRET_K1 not set, cannot sign test requests");
  process.exit(1);
}

function sign(secret, timestamp, rawBody) {
  const hex = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `v1=${hex}`;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function basePayload({ productionId, quotationNumber, eventId, installStart, installEnd }) {
  return {
    event: {
      event_id: eventId,
      event_type: "work_order.queued.v1",
      occurred_at: new Date().toISOString(),
      source_system: "bbps-crm",
    },
    production: {
      production_id: productionId,
      status: "ลงคิวงานแล้ว",
      status_code: "queued",
      supplier_name: null,
      assignee: null,
      tier: null,
      notes: null,
    },
    quotation: {
      quotation_number: quotationNumber,
      quotation_id: null,
      quote_date: "2026-08-20",
      currency: "THB",
      subtotal: 100000,
      vat: 7000,
      wht: 0,
      grand_total: 107000,
      line_items: [
        {
          description: "งาน playground ทดสอบ",
          qty: 1,
          unit: "ชุด",
          unitPrice: 100000,
          vatIncluded: false,
          imageUrl: null,
        },
      ],
    },
    customer: {
      customer_id: "cust-test-1",
      name: "ลูกค้าทดสอบ",
      tax_id: null,
      address: "123 ถนนทดสอบ",
      phone: "0812345678",
      email: null,
      line_id: null,
    },
    work_orders: [
      {
        seq: 1,
        install_start: installStart,
        install_end: installEnd,
        location_address: "หน้างานทดสอบ",
        location_map_link: "https://maps.app.goo.gl/test",
        contact_name: "ผู้ติดต่อทดสอบ",
        contact_phone: "0898765432",
        task_details: "ปูพื้นยาง",
        manpower: "3 คน",
        tasks: { ball_pit: null, workshop_set: null, gym: null, floor: "ปูพื้นยาง 50 ตร.ม.", other: null },
        constraints: {
          access_time: null,
          logistics: null,
          work_area: null,
          obstacles: null,
          ground: null,
          utilities: null,
          noise_dust: null,
          weather: null,
          site_authority: null,
        },
        design_images: [],
        site_photos: [],
        materials: null,
        acceptance_criteria: null,
      },
    ],
    summary: { install_start: installStart, install_end: installEnd, work_order_count: 1 },
  };
}

async function post(rawBody, headers) {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: rawBody,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body, leave json null */
  }
  return { status: res.status, json };
}

function headersFor({ eventId, timestamp, rawBody, secret, keyId, idempotencyKey }) {
  return {
    "x-event-id": eventId,
    "x-timestamp": String(timestamp),
    "x-signature": sign(secret ?? SECRET, timestamp, rawBody),
    "x-signature-key-id": keyId ?? "k1",
    "x-idempotency-key": idempotencyKey,
  };
}

let pass = 0;
let fail = 0;
function report(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`PASS - ${name}`);
  } else {
    fail++;
    console.log(`FAIL - ${name} :: ${detail}`);
  }
}

async function countInstallJobsByExternalId(externalId) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null; // skip the DB-backed assertion if not configured
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key);
  const { data, error } = await supabase.from("install_jobs").select("job_no").eq("external_id", externalId);
  if (error) throw error;
  return data.length;
}

async function main() {
  // Case 1: normal request -> 202
  const pid1 = crypto.randomUUID();
  const qn1 = `QT-TEST-${Date.now()}`;
  const eid1 = crypto.randomUUID();
  const body1 = JSON.stringify(
    basePayload({ productionId: pid1, quotationNumber: qn1, eventId: eid1, installStart: "2026-09-01", installEnd: "2026-09-03" })
  );
  const ts1 = nowSeconds();
  const r1 = await post(body1, headersFor({ eventId: eid1, timestamp: ts1, rawBody: body1, idempotencyKey: pid1 }));
  report("1 normal request -> 202", r1.status === 202, `status=${r1.status} body=${JSON.stringify(r1.json)}`);

  // Case 2: wrong signature -> 401
  const pid2 = crypto.randomUUID();
  const eid2 = crypto.randomUUID();
  const body2 = JSON.stringify(
    basePayload({ productionId: pid2, quotationNumber: `QT-TEST-${Date.now()}-2`, eventId: eid2, installStart: "2026-09-05", installEnd: "2026-09-06" })
  );
  const ts2 = nowSeconds();
  const r2 = await post(
    body2,
    headersFor({ eventId: eid2, timestamp: ts2, rawBody: body2, secret: "definitely-the-wrong-secret", idempotencyKey: pid2 })
  );
  report("2 wrong signature -> 401", r2.status === 401, `status=${r2.status} body=${JSON.stringify(r2.json)}`);

  // Case 3: stale timestamp (> 300s old) -> 401
  const pid3 = crypto.randomUUID();
  const eid3 = crypto.randomUUID();
  const body3 = JSON.stringify(
    basePayload({ productionId: pid3, quotationNumber: `QT-TEST-${Date.now()}-3`, eventId: eid3, installStart: "2026-09-07", installEnd: "2026-09-08" })
  );
  const ts3 = nowSeconds() - 400;
  const r3 = await post(body3, headersFor({ eventId: eid3, timestamp: ts3, rawBody: body3, idempotencyKey: pid3 }));
  report("3 stale timestamp (400s old) -> 401", r3.status === 401, `status=${r3.status} body=${JSON.stringify(r3.json)}`);

  // Case 4: schema-invalid payload (correct signature) -> 400
  const eid4 = crypto.randomUUID();
  const body4 = JSON.stringify({ event: { event_id: eid4 }, this_is: "not a valid work_order.queued.v1 payload" });
  const ts4 = nowSeconds();
  const r4 = await post(body4, headersFor({ eventId: eid4, timestamp: ts4, rawBody: body4, idempotencyKey: "n/a" }));
  report("4 schema-invalid payload -> 400", r4.status === 400, `status=${r4.status} body=${JSON.stringify(r4.json)}`);

  // Case 5: exact same event_id replayed -> 202 duplicate
  const ts5 = nowSeconds();
  const r5 = await post(body1, headersFor({ eventId: eid1, timestamp: ts5, rawBody: body1, idempotencyKey: pid1 }));
  report(
    "5 duplicate event_id -> 202 {duplicate:true}",
    r5.status === 202 && r5.json && r5.json.duplicate === true,
    `status=${r5.status} body=${JSON.stringify(r5.json)}`
  );

  // Case 6: same production_id, brand new event_id (simulated dispatcher retry)
  // -> 202, and install_jobs still has exactly one row for that production_id
  const eid6 = crypto.randomUUID();
  const body6 = JSON.stringify(
    basePayload({ productionId: pid1, quotationNumber: qn1, eventId: eid6, installStart: "2026-09-01", installEnd: "2026-09-04" })
  );
  const ts6 = nowSeconds();
  const r6 = await post(body6, headersFor({ eventId: eid6, timestamp: ts6, rawBody: body6, idempotencyKey: pid1 }));
  let case6Detail = `status=${r6.status} body=${JSON.stringify(r6.json)}`;
  let case6Ok = r6.status === 202;
  try {
    const count = await countInstallJobsByExternalId(pid1);
    if (count === null) {
      case6Detail += " (row-count check skipped: SUPABASE_SERVICE_ROLE_KEY not set)";
    } else {
      case6Detail += ` install_jobs rows for production_id=${count}`;
      case6Ok = case6Ok && count === 1;
    }
  } catch (e) {
    case6Ok = false;
    case6Detail += ` row-count check errored: ${e}`;
  }
  report("6 retry (same production_id, new event_id) -> 202, merged not duplicated", case6Ok, case6Detail);

  console.log(`\n${pass} passed, ${fail} failed (of ${pass + fail})`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FAIL - unhandled error ::", e);
  process.exit(1);
});

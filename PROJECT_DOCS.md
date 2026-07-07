# MPD Workspace — เอกสารโปรเจกต์ (Project Docs)

> ระบบงานติดตั้ง & เอกสาร ของ **บริษัท มีภูมิดี จำกัด**
> เว็บแอปไฟล์เดียว (`index.html`) + OCR Backend (FastAPI) เชื่อม Supabase สด
> ไฟล์นี้คือแหล่งบันทึกกลาง — โครงสร้างเว็บ, โครงสร้างฐานข้อมูล และ **บันทึกทุกการเปลี่ยนแปลง** (ดูหัวข้อ [Activity Log](#activity-log) ท้ายไฟล์)

_อัปเดตล่าสุด: 2026-07-06_

---

## สารบัญ
1. [ภาพรวมสถาปัตยกรรม](#1-ภาพรวมสถาปัตยกรรม)
2. [โครงสร้างไฟล์](#2-โครงสร้างไฟล์)
3. [โครงสร้างเว็บ (Frontend / SPA)](#3-โครงสร้างเว็บ-frontend--spa)
4. [โครงสร้างฐานข้อมูล](#4-โครงสร้างฐานข้อมูล)
5. [Flow การทำงานหลัก](#5-flow-การทำงานหลัก)
6. [OCR Backend](#6-ocr-backend)
7. [การตั้งค่า & Deploy](#7-การตั้งค่า--deploy)
8. [Activity Log](#activity-log)

---

## 1. ภาพรวมสถาปัตยกรรม

ระบบแบ่งเป็น 3 ส่วน:

| ส่วน | เทคโนโลยี | หน้าที่ |
|------|-----------|---------|
| **Frontend** | HTML/CSS/JS ไฟล์เดียว (`index.html`) + Supabase JS SDK | UI ทั้งหมด, logic, ข้อมูล seed — ไม่มี build step |
| **Live DB** | Supabase (Postgres) | งานติดตั้ง (`install_jobs`) + คิวช่าง (`tech_queue`) แบบเรียลไทม์ |
| **OCR Backend** | FastAPI (Python) + Vision-AI | อ่านลายมือจากฟอร์มงานติดตั้ง → คืน JSON |

```
ผู้ใช้ (เบราว์เซอร์)
      │
      ▼
Frontend SPA — index.html   ── router go(view) · 12 views
      │
      ├─► localStorage        (Docflow / เอกสาร — DOCS[])
      ├─► Supabase (สด)       (install_jobs · tech_queue)
      └─► OCR Backend (FastAPI)
                 │
                 └─► Vision-AI  (Gemini · OpenAI · Claude · OpenRouter)
```

**ข้อสังเกตสำคัญ:** ข้อมูลมี 2 domain แยกกันชัดเจน
- **Docflow (เอกสาร)** → เก็บใน `localStorage` ของเบราว์เซอร์ (ทำงานออฟไลน์ได้ ไม่ผูกกับ Supabase)
- **งานติดตั้งสด** → เก็บใน Supabase จริง (มี fallback เป็น snapshot เมื่อต่อไม่ได้)

---

## 2. โครงสร้างไฟล์

```
Floor/
├── index.html              # เว็บแอปทั้งหมด (SPA ไฟล์เดียว ~1,955 บรรทัด / 314 KB)
├── README.md               # คำอธิบายสั้น
├── PROJECT_DOCS.md         # ← ไฟล์นี้ (เอกสารกลาง + บันทึกการเปลี่ยนแปลง)
└── ocr-backend/            # บริการ OCR แยกต่างหาก
    ├── app.py              # FastAPI app — endpoints /ocr, /ocr/pdf
    ├── extractor.py        # เรียก Vision-AI 4 provider + PDF handling
    ├── prompts.py          # SCHEMAS ของฟอร์ม 3 แบบ + build_prompt()
    ├── requirements.txt
    ├── vercel.json         # config deploy บน Vercel
    ├── .env.example        # ตัวอย่าง env (API keys)
    └── api/index.py        # entrypoint สำหรับ Vercel serverless
```

---

## 3. โครงสร้างเว็บ (Frontend / SPA)

### 3.1 การนำทาง (Router)
- ฟังก์ชันกลาง **`go(view)`** (`index.html:407`) — SPA แบบ tab (ไม่มี URL routing)
- สลับ view โดยเพิ่ม/ลบ class `show` บน `<section class="view" id="v-...">`
- อัปเดต title/subtitle จาก object **`VIEWS`** และผูกปุ่มมุมขวาบน (`#topBtn`)
- เมื่อเปลี่ยน view จะเรียก render ที่เกี่ยวข้อง เช่น `renderOverview()`, `ipRenderBoard()+ipLoad()`, `ohLoad()`

### 3.2 มุมมองทั้งหมด (12 views)

| view id | เมนู | render function | แหล่งข้อมูล |
|---------|------|-----------------|-------------|
| `overview` | ภาพรวมธุรกิจ | `renderOverview()` | Supabase (`IP_T`) |
| `history` | Job / ออเดอร์ | `ohLoad()` | `install_jobs` |
| `install` | Pipeline (Stage Board) | `ipRenderBoard()` + `ipLoad()` | `install_jobs` |
| `queue` | นัดหมายช่าง | `ipRenderQueue()` + `ipLoadQueue()` | `tech_queue` |
| `scan` | เอกสารงาน / OCR | (batch OCR UI) | OCR Backend |
| `service` | บริการ & เคลม | `svcRender()` | localStorage |
| `eval` | ประเมินผล | (แทรก dynamic) | `install_jobs` |
| `dash` | แดชบอร์ดเอกสาร | `renderDash()` | `DOCS[]` |
| `register` | ทะเบียนเอกสาร | `renderRegister()` | `DOCS[]` |
| `search` | ค้นหา | `runSearch()` | `DOCS[]` |
| `approve` | รออนุมัติ | `renderApprove()` | `DOCS[]` |
| `cats` | หมวดหมู่ | `renderCats()` | `DOCS[]` |
| `docs` | คู่มือ / โครงสร้างระบบ | `renderDocs()` | `PROJECT_DOCS.md` (fetch) |

> หมายเหตุ: บาง view (`install`, `queue`, `eval`) ถูก **inject เข้า nav แบบ dynamic** ด้วย JS ตอนโหลด (โมดูลถูก append ต่อท้ายไฟล์) — โครงสร้างนี้สะท้อนว่าไฟล์โตขึ้นเป็น "โมดูล" ทีละส่วน

### 3.3 โมดูลหลักในโค้ด (แบ่งตาม comment block)
- **DOCFLOW** — จัดการเอกสาร: `CATS`, `STATUS`, `DOCS[]`, `renderRegister/Dash/Approve/Cats`, ค้นหา
- **SCAN / OCR** — อัปโหลดรูป/PDF, batch folder OCR, ต่อ backend, เติมฟอร์ม `TPL`
- **INSTALL PIPELINE** — Stage Board 8 ถัง (ตาม SOP): `IP_STAGES`, `IP_LAST`, `ipLoad/ipMap/ipRenderBoard/ipAdv/ipStageGate/ipSaveStage` · drawer = popup 3 แท็บ (`ipOpen`+`drTab`)
- **QUEUE (คิวช่าง)** — `ipLoadQueue`, insert `tech_queue`
- **ORDER HISTORY (OH)** — การ์ดออเดอร์ + drawer 4 แท็บ: `ohLoad`, `ohApplyAccept`, `ohFilter`
- **EVAL (ประเมินผล)** — ผูกคะแนนประเมินกับบิล: `evalBill`, `evalCardHtml`
- **OVERVIEW** — dashboard สรุป KPI + pipeline funnel

### 3.4 ฟอร์มเอกสาร (TPL)
- `const TPL = {...}` (`index.html:677`) — template ของ 3 ฟอร์ม: `receive`, `issue`, `sign`
- `curType` = ชนิดฟอร์มปัจจุบัน (ค่าเริ่มต้น `'receive'`)
- คีย์ของ TPL **ต้องตรงกับคีย์ JSON ที่ OCR คืนมาเป๊ะ** (ดู [prompts.py schema](#62-schema-ของฟอร์ม-prompspy))

---

## 4. โครงสร้างฐานข้อมูล

### 4.1 Supabase — connection
- URL: `https://nroyacasuchqniaiuirk.supabase.co` (`index.html:1146`)
- ใช้ **anon key** ฝังในหน้าเว็บ (client-side) — สร้าง client ผ่าน `window.supabase.createClient(SB_URL, SB_ANON)`
- ตัวแปร global: `SB` (client), `IP_T` (cache ของ jobs)

### 4.2 ตาราง `install_jobs`
ตารางหลักของ Pipeline ติดตั้ง — คอลัมน์ที่โค้ดอ้างถึง (map ผ่าน `ipMap`, `index.html:1150`):

| คอลัมน์ | ชนิด | ความหมาย |
|---------|------|----------|
| `order_no` | text | เลขออเดอร์ (คีย์อ้างอิงหลัก, ใช้ `.eq('order_no', ...)`) |
| `bill_no` | text | เลขบิล (แสดงเป็น chip ใน popup — ไม่มี logic ดัน stage อัตโนมัติแล้ว, เอาออกไปตั้งแต่ 2026-07-02) |
| `stage` | int | ถังใน Pipeline 1–8 (ดู `IP_STAGES` · `IP_LAST=8`=ปิดงาน) |
| `status` | text | สถานะย่อยในถัง |
| `due_date` | date | วันนัด/กำหนดส่ง |
| `shift` | text/int | รอบ/กะ |
| `order_date` | date | วันที่ออเดอร์ |
| `product_name` | text | ชื่อสินค้า |
| `product_skus` | array | รายการ SKU |
| `customer_name` / `customer_code` | text | ลูกค้า |
| `assignees` | array | ทีมช่างที่รับผิดชอบ |
| `address` / `location` | text | ที่อยู่ลูกค้า / พิกัด (แก้ได้ทุกถัง ผ่านการ์ด "ข้อมูลงาน") |
| `area_w` / `area_l` | numeric | ขนาดพื้นที่ (กว้าง×ยาว ตร.ม.) |
| `call_logs` | jsonb array | ประวัติการโทร `{by, at}` |
| `site_photos` | jsonb | ไฟล์แนบ/รูปที่อัปโหลดต่อถัง คีย์ตาม `key` ของ `ipUplBox` |
| `confirmations` | jsonb | **(เพิ่ม 2026-07-06)** สถานะปุ่มยืนยันหลักฐาน `.evi` คีย์ตามข้อความ data-evi → `{at: เวลา}` — ทำให้ติ๊กแล้วไม่หายเมื่อเปิดตั๋วใหม่ (ก่อนหน้านี้เก็บแค่ใน DOM class ไม่ persist) |
| `source` | text | ที่มา (`planner` / อื่นๆ) |
| `created_via` | text | (`manual` / `auto`) |
| `linked` | bool | เชื่อมข้อมูลแล้วหรือไม่ |
| `updated_at` | timestamp | เวลาแก้ล่าสุด (เขียนทุกครั้งที่อัปเดต stage) |

**การเขียนกลับ (write):**
- `ipSaveAll(t, extra)` **(เพิ่ม 2026-07-06, แทน `ipSaveStage`)** → เขียน `address/location/due_date/shift/area_w/area_l/updated_at` + `extra` (เช่น `{stage,status}`) **ในคำสั่งเดียว** — แก้บั๊กเดิมที่ `ipAdv()` (ปุ่ม "ทำขั้นนี้เสร็จ") เขียนแค่ `stage/status` ทำให้แก้ที่อยู่/พื้นที่แล้วกดไปต่อ **ข้อมูลหายเงียบๆ** เพราะไม่เคยถูกบันทึกจริง
- `ipToggleEvi()` → `update({confirmations, updated_at})` ทุกครั้งที่ติ๊ก/ถอนติ๊กหลักฐาน

### 4.3 ตาราง `tech_queue`
คิวนัดหมายช่าง — insert เมื่อจ่ายงานให้ทีม (`index.html:1157`):

| คอลัมน์ | ความหมาย |
|---------|----------|
| `job_no` | เลขงาน (= ticket เช่น `INST-<order_no>`) |
| `order_no` | เลขออเดอร์อ้างอิง |
| `product_name` | ชื่อสินค้า |
| `appointment_date` | วันนัด |
| `shift` | รอบ/กะ |
| `team` | array ทีมช่าง |
| `call_note` | โน้ตการโทรนัด |

### 4.4 localStorage (Docflow)
เอกสารไม่ได้อยู่ใน Supabase — เก็บฝั่ง client:

| key | เนื้อหา |
|-----|---------|
| `mpd_docs` | array `DOCS[]` (เอกสารทั้งหมด: SOP/NCR/Claim/Check/Form) |
| `mpd_next_id` | ตัวนับ id ถัดไป (เริ่ม 100) |

โครงสร้าง 1 เอกสาร (`DOCS[]`): `{id, code, title, cat, ver, status, owner, dept, loc:{cab,shelf,folder}, paper, scanned, created, updated, review, approver, hist:[[action,date,by],...]}`

- **หมวด (`CATS`)**: `SOP`, `NCR`, `CLAIM`, `CHECK`, `FORM`
- **สถานะ (`STATUS`)**: `active`, `pending`, `review`, `draft`, `expired`

> ไฟล์แนบ batch OCR ยังเก็บใน **IndexedDB** (เพื่อให้รอดการ refresh — ดู commit #20)

---

## 5. Flow การทำงานหลัก

### 5.1 Pipeline ติดตั้ง (8 ถัง — ตาม SOP การประสานงาน Sale & DC)
`IP_STAGES` = `[ชื่อ, สี, พื้นหลัง, ผู้รับผิดชอบ, หลักฐานที่ต้องมี]` (`const IP_LAST=8`)
```
1 จองคิว/รับออร์เดอร์ (เซล) → 2 ส่งเอกสาร–รับเซ็น + ขอรูปพื้นที่ 3 มุมจากลูกค้า (เซล) → 3 เบิกของ + อัปโหลดเอกสารเบิก (DC/คลัง)
→ 4 โทรยืนยันก่อนถึง (DC) → 5 วัดพื้นที่–ลองตัวอย่าง (DC)
→ 6 ยืนยันพื้นที่ + อนุญาตเริ่มติดตั้ง (คุณเต้ย+เซล) → 7 ติดตั้ง (DC) → 8 ตรวจ–ส่งมอบ–ปิดงาน
```
- ที่มา: ไฟล์ SOP `SOP การประสานงานระหว่าง Sale&DC.xlsx` (3 ชีต: ขั้นตอน 8 ข้อ · เหตุฉุกเฉิน · Checklist เซล/DC) — ปรับเพิ่มถัง "เบิกของ" (2026-07-04) แล้วรวมถัง "คุณเต้ยยืนยันพื้นที่" + "อนุญาตเริ่มติดตั้ง" กลับเป็นถังเดียว (2026-07-06) เพื่อลดจำนวนคอลัมน์บนบอร์ด · ย้ายรูปพื้นที่ 3 มุม จากถัง 5 (DC ถ่ายหน้างาน) → ถัง 2 (เซลขอจากลูกค้าล่วงหน้า) เมื่อ 2026-07-06
- แต่ละถังมี **ผู้รับผิดชอบ (role)** + **หลักฐานที่ต้องมี (evidence gate)** — ดูใน drawer หัวการ์ด "ขั้นตอนนี้ (SOP)"
- **Popup ลอยกลางจอ + 3 แท็บ**: ข้อมูล / เอกสาร / โทร (`ipOpen` + `drTab`)
- ปุ่ม **"ทำขั้นนี้เสร็จ ▶"** = `ipAdv()` → เช็ค `ipStageGate(t)` ก่อน (บล็อกถ้าหลักฐานไม่ครบ) → เพิ่ม stage → `ipSaveStage()` sync Supabase
- **Gate สำคัญ:** ถัง 5 (ที่อยู่+พิกัด+ตร.ม.+รูป 3 มุม) · ถัง 6 (คุณเต้ยยืนยันตร.ม. + เซลคอนเฟิร์ม + คุณเต้ยอนุญาต — ⛔ ห้ามเริ่มก่อน) · ถัง 8/`ipFinish` (ภาพหลัง+เก็บเงินครบ)
- หลักฐานแบบกดยืนยัน = ปุ่ม `.evi` (data-evi=ชื่อหลักฐาน) · `ipStageGate` เช็ค `.evi.set` ทุกตัว

### 5.2 OCR เอกสาร
```
อัปโหลดรูป/PDF ─► (ตั้ง URL "Backend OCR") ─► POST /ocr หรือ /ocr/pdf
   ─► Vision-AI อ่านลายมือตาม SCHEMA ─► JSON ─► เติมเข้าฟอร์ม TPL อัตโนมัติ
```
- รองรับ **batch folder OCR** (สแกนทั้งโฟลเดอร์ทีละไฟล์) + auto-save ต่อเนื่อง
- รองรับ PDF หลายหน้า → แยกเป็น 3 ฟอร์ม (`receive`/`issue`/`sign`)
- ถ้า OCR ล้มเหลว → มีปุ่ม retry + กรอกมือ

### 5.3 Docflow เอกสาร
`register` (ทะเบียน) · `dash` (แดชบอร์ด) · `approve` (รออนุมัติ pending) · `search` · `cats` — ทั้งหมดอ่าน/เขียน `DOCS[]` แล้ว persist ลง `localStorage`

---

## 6. OCR Backend

### 6.1 Endpoints (`app.py`)
| method | path | หน้าที่ |
|--------|------|---------|
| `GET` | `/` | health check — คืนรายการฟอร์ม, provider, สถานะ key |
| `POST` | `/ocr` | รับ 1 รูป + `form_type` → คืน fields |
| `POST` | `/ocr/pdf` | รับ PDF หลายหน้า → คืน `{receive, issue, sign}` |

### 6.2 Schema ของฟอร์ม (`prompts.py`)
`SCHEMAS` มี 3 ฟอร์ม — **คีย์ต้องตรงกับ TPL ในหน้าเว็บ**:
- **`receive`** — เอกสารรับงานติดตั้ง & ส่งมอบ: `docNo, docDate, custName, contact, phone, addr, svcDate, tStart, tEnd, room[], qtyOrder, qtyReal, diff, diffQty, note`
- **`issue`** — ฟอร์มเบิก-ใช้-คืนสินค้า: `bill, installer, team, date, area, tStart, tEnd, rows[]`
- **`sign`** — หน้าข้อกำหนด + ลายเซ็น: `custSign, custDate, techSign, techDate, inspSign, inspDate`

### 6.3 Provider (เลือกด้วย env `OCR_PROVIDER`)
| provider | หมายเหตุ |
|----------|----------|
| `gemini` | **ค่าเริ่มต้น** (ฟรี — Google AI Studio) |
| `openai` | เสียเงิน (`gpt-4o`) |
| `anthropic` | เสียเงิน (`claude-sonnet-*`) |
| `openrouter` | **fallback อัตโนมัติ** เมื่อ Gemini ติด quota/rate-limit |

API key อ่านจาก environment variable เท่านั้น (ไม่ฝังในโค้ด/หน้าเว็บ)

---

## 7. การตั้งค่า & Deploy

- **Frontend**: static `index.html` → deploy บน **Vercel** (production)
- **OCR Backend**: FastAPI → Vercel serverless (`ocr-backend/api/index.py`, `vercel.json`)
- **รัน backend local**: `uvicorn app:app --port 8000` แล้ววาง `http://localhost:8000` ในช่อง "Backend OCR" ของหน้าเว็บ
- **env ที่ต้องตั้ง** (ดู `.env.example`): `OCR_PROVIDER`, `GOOGLE_API_KEY`/`GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `OCR_MODEL`

---

## Activity Log

> **บันทึกทุกการเปลี่ยนแปลงตรงนี้** — เพิ่มรายการใหม่ไว้ **บนสุด** ของตาราง
> รูปแบบ: `วันที่ | สิ่งที่ทำ | ไฟล์/ส่วนที่แตะ | ผู้ทำ`

| วันที่ | สิ่งที่ทำ | ไฟล์/ส่วนที่แตะ | ผู้ทำ |
|--------|-----------|-----------------|-------|
| 2026-07-07 | **เตรียมสคริปต์ย้ายรูปเก่า (base64) ออกจากฐานข้อมูล → Storage** — สภาพแวดล้อมที่ Claude รันงานอยู่ **ถูกบล็อกโดยนโยบายองค์กรไม่ให้เชื่อมต่อ Supabase Storage REST API ตรงๆ** (ทดสอบผ่าน proxy ที่ตั้งไว้แล้ว ได้ 403 — เป็นการบล็อกถาวรตามนโยบาย ไม่ใช่ปัญหาเน็ตชั่วคราว) จึงทำเป็นสคริปต์ `scripts/migrate-photos-to-storage.mjs` (Node.js + `@supabase/supabase-js`) ให้ทีมรันเองจากเครื่องที่ต่อเน็ตปกติแทน — สแกน `install_jobs.site_photos` ทุกแถวหา record ที่ยังเป็น `data:` base64 (ทั้งแบบเดี่ยวและ array อย่าง `issue_docs`) อัปโหลดขึ้น bucket `job-files` แล้วแทนที่ `data` ด้วย `url` จริง · มี `--dry-run` ดูก่อนได้ก่อนรันจริง รันซ้ำได้ปลอดภัย (ข้ามของที่ย้ายแล้วอัตโนมัติ) · วิธีใช้อยู่ใน `scripts/README.md` · **ยังไม่ได้รัน** — รอคนที่มีเน็ตปกติ + service role key รันเอง | `scripts/migrate-photos-to-storage.mjs`, `scripts/package.json`, `scripts/README.md` | Claude |
| 2026-07-06 | **เริ่มระบบ login จริง (Phase A — ยังไม่ตัด anon)** — (1) สร้างตาราง `floor_users` (auth_user_id, email, name, role, is_active) + RLS ให้ผู้ใช้อ่านแถวตัวเองได้ (2) ลงทะเบียนแอป `floor` + 4 role (sales/dc/manager/admin) + 7 permission ใน Shared Permission Matrix (`perm_apps`/`perm_roles`/`perm_permissions`) — ยังเป็นแค่ metadata ไม่ได้ผูก RLS จริง (3) เพิ่มปุ่ม **"🔐 เข้าสู่ระบบ"** ในหน้า Pipeline — ใช้ Supabase Auth **magic link ทางอีเมล** (`signInWithOtp`), auto-detect session ตอนกลับมาจากลิงก์ (`onAuthStateChange`), ดึง role/ชื่อจริงจาก `floor_users` มาแทนที่ระบบ "ตั้งชื่อผู้ใช้" (self-report เดิม) — `ipWhoAmI()` จะคืนชื่อจริงจาก auth ก่อนเสมอถ้า login อยู่ ปุ่มตั้งชื่อเดิมซ่อนอัตโนมัติเมื่อ login แล้ว · **ยังไม่มีหน้าสร้างบัญชีพนักงานในแอป** — ตอนนี้ต้องสร้างผ่าน Supabase Dashboard (Authentication → Users) แล้ว insert แถวคู่กันใน `floor_users` เอง · **สำคัญ: RLS ของ `install_jobs`/`tech_queue` ยังเปิดโล่งเหมือนเดิม (`anon: true`) — login ตอนนี้เป็นแค่ทางเลือก ยังไม่บังคับ** ตามที่ตกลงว่าจะ "ตัดสินทันทีวันที่กำหนด" (Phase B) — ต้องนัดวันตัด anon ออก + ยืนยันว่ามีบัญชีพนักงานจริงพร้อมใช้ก่อน ไม่งั้นทีมจะเข้าแอปไม่ได้ทั้งหมด | `index.html` (`IP_AUTH_USER`,`ipRefreshAuthUser`,`ipOpenLogin`,`ipSendMagicLink`,`ipLogout`,`ipWhoAmI`,`ipRenderWhoAmI`), Supabase (`floor_users` table, `perm_apps`/`perm_roles`/`perm_permissions` สำหรับ `floor`) | Claude |
| 2026-07-06 | **ลดเช็คลิสต์รูปงานปูพื้นจาก 14 → 10 จุด** — ตัดกลุ่ม "การเชื่อม" เหลือแค่ "รอยต่อ" (เอา กรีดร่อง/ลงน้ำยา-เป่าเส้นเชื่อม/รีด&ปาด/เสร็จ ออก) กลุ่ม การตัด (5 จุด) กับ การจบงาน (4 จุด รวมภาพรวม) เหมือนเดิม ยังบังคับแค่ "ภาพรวม" จุดเดียว | `index.html` (`IP_INSTALL_CHECKLIST`) | Claude |
| 2026-07-06 | **เช็คลิสต์รูปงานปูพื้น 14 จุด ที่ถัง 7 (แทนที่ "ภาพเริ่มงาน" เดิม)** — จัดกลุ่ม การตัด/การเชื่อม/การจบงาน ตาม Checklist ของทีม แต่ละจุดถ่ายแค่ภาพเดียว (ไม่ต้องก่อน/หลัง) บังคับแค่จุดสุดท้าย **"ภาพรวม"** ที่เหลือ 13 จุดเป็นแค่ checklist ช่วยเตือน ไม่บังคับ (`IP_INSTALL_CHECKLIST`, `ipInstallChecklistHtml`) · ใช้ได้กับงานติดตั้งทุกประเภทเหมือนกันหมด ไม่แยกตาม SKU · ถัง 8 เปลี่ยนจาก "ถ่ายภาพหลังติดตั้ง + เอกสารส่งมอบ" (กล่องเดียวรวมกัน) → เหลือแค่ **"เอกสารส่งมอบ"** อย่างเดียว (คีย์ `site_photos.after` เดิม ไม่เปลี่ยน) · **เอกสารเบิก (ถัง 3) แนบได้หลายรูปแล้ว** — เปลี่ยนจาก `ipUplBox` (1 ไฟล์) เป็น `ipMultiUplBox`/`ipMultiAttach` แบบ gallery กด ＋ เพิ่มได้เรื่อยๆ เก็บเป็น array คีย์ใหม่ `site_photos.issue_docs` (ของเดิมคีย์ `issue_doc` เดี่ยวๆ เลิกใช้) · gate เดิม (`.upl[data-evi]` sweep) ขยายให้ครอบคลุม `.mupl[data-evi]` ด้วย ไม่ต้องเขียน logic แยก | `index.html` (`IP_INSTALL_CHECKLIST`,`ipInstallChecklistHtml`,`ipMultiUplBox`,`ipMultiAttach`,`ipStageGate`,`ipOpen`,`ipDCContent`,`IP_STAGES`, CSS) | Claude |
| 2026-07-06 | **เพิ่มภาพเริ่มงาน 1 ภาพที่ถัง 7 (ติดตั้ง)** — หลังผ่านการอนุญาตจากถัง 6 แล้ว DC ต้องถ่ายรูปหน้างานก่อนเริ่มลงมือ (คีย์ `site_photos.before`) ถึงจะกดปิดสเตจ 7→8 ได้ ใช้ gate เดิม (`.upl[data-evi]` generic sweep) ไม่ต้องเพิ่ม logic ใหม่ · ทำทั้ง popup แอดมินและหน้า DC แบบง่าย · หมายเหตุ: ลิงก์ DC (`?job=<order>&dc=1`) เป็นลิงก์เดียวต่อ 1 ตั๋วอยู่แล้ว ไม่ต้องเปลี่ยนลิงก์ก่อน/หลังอนุมัติ — เนื้อหาปรับตาม stage ปัจจุบันอัตโนมัติทุกครั้งที่เปิด | `index.html` (`IP_STAGES`,`ipOpen`,`ipDCContent`) | Claude |
| 2026-07-06 | **สร้าง Storage bucket `job-files` แล้ว** (public) + RLS policy 3 ตัวให้ role `anon`: insert/update/read scope `bucket_id='job-files'` (รูปแบบเดียวกับ bucket `bzone` ที่ใช้งานอยู่แล้วใน project เดียวกัน) — แก้ปัญหาที่ค้างมาตั้งแต่ 2026-07-05 (`sbUploadFile` เคยอัปโหลดไม่ผ่านเพราะไม่มี bucket จริง เลย fallback ไปเก็บเป็น base64 ฝังในคอลัมน์ `site_photos` ตรงๆ ทำให้ฐานข้อมูลบวม) ตอนนี้รูปใหม่ที่แนบจะได้ URL จริงจาก Storage แล้ว · **ยังไม่ได้ย้ายรูปเก่าที่เป็น base64 อยู่ในฐานข้อมูล** (เช่น order `275465`) — เป็นงานแยกถ้าต้องการเคลียร์ทีหลัง | Supabase Storage (`job-files` bucket + policies) | Claude |
| 2026-07-06 | **ย้ายรูปพื้นที่ 3 มุมจาก DC → เซล** — เดิมช่างต้องถ่ายรูปพื้นที่ (สูง/กว้าง/แปลน) ตอนไปวัดหน้างาน (ถัง 5) เปลี่ยนเป็น**เซลขอรูปจากลูกค้าโดยตรงตั้งแต่ถัง 2** (ส่งเอกสาร) แล้วอัปโหลดแทนลูกค้า — ถัง 5 เหลือแค่วัดขนาดจริง (กว้าง×ยาว) + ให้ลูกค้าลองตัวอย่าง ไม่ต้องถ่ายรูปซ้ำ · เปลี่ยนชื่อถัง 5 จาก "วัดพื้นที่–ลองตัวอย่าง–ถ่ายภาพ" → "วัดพื้นที่–ลองตัวอย่าง" · แก้ทั้ง popup แอดมินและหน้า DC แบบง่ายให้ตรงกัน · ย้าย gate เช็ครูป 3 มุมจากถัง 5 ไปถัง 2 (คีย์ข้อมูล `site_photos.ph_top/ph_wide/ph_plan` เดิม ไม่เปลี่ยน) | `index.html` (`IP_STAGES`,`ipOpen`,`ipStageGate`,`ipDCContent`) | Claude |
| 2026-07-06 | **หน้า DC แบบง่าย (ลิงก์แยก, `?job=<order>&dc=1`)** — เต็มจอ ไม่มี sidebar/เมนู เห็นแค่ตั๋วเดียว ตัดฟิลด์/ปุ่มที่ไม่ใช่หน้าที่ DC ออก (ที่อยู่/พิกัดเป็น read-only, ไม่มีปุ่ม "เก็บเงินครบ") · แสดงเฉพาะสิ่งที่ต้องทำ **ในสเตจปัจจุบัน** ตามสเตจที่ DC เป็นเจ้าของ (3 เบิกของ/4 โทรนัด/5 วัดพื้นที่/7 ติดตั้ง/8 ส่งมอบ) สเตจอื่น (1,2,6 ของเซล/คุณเต้ย) ขึ้นข้อความ "รอ...ดำเนินการ" เฉยๆ · ปุ่ม "🛠️ ลิงก์ DC" ใหม่คู่กับ "🔗 แชร์ตั๋ว" ใน popup เดิม · ใช้ `ipStageGate`/`ipAdv`/`ipBack`/`ipFinish`/`ipBook` **ร่วมกับหน้าแอดมิน** ผ่านตัวแปรโหมด `IP_ACTIVE_MODE` + `ipRefreshOpen()` (ไม่ fork โค้ด gate) · **เจอบั๊กระหว่างทำ 2 จุดและแก้แล้ว:** (ก) `ipToggleEvi` re-render ทั้งหน้าทำให้ค่าที่พิมพ์ค้างไว้ (ที่อยู่/พื้นที่) หายก่อนกดบันทึก → เพิ่ม `ipSyncFields(t)` ก่อน re-render ทุกครั้ง (ข) ซ่อนเช็คบ็อกซ์ "เก็บเงินครบ" จากหน้า DC ทำให้ gate (ที่สแกนจาก DOM) มองไม่เห็นเงื่อนไขนี้เลย → เพิ่มเช็คจากข้อมูลจริง `t.confirmations` แยกสำหรับเงื่อนไขนี้โดยเฉพาะ ป้องกัน DC ปิดงานได้โดยที่เซลยังไม่ยืนยันเก็บเงิน | `index.html` (`ipOpenDC`,`ipDCContent`,`ipShareDCLink`,`IP_ACTIVE_MODE`,`ipRefreshOpen`,`ipStageGate`,`ipSyncFields`,`ipToggleEvi`, CSS `#dcView`) | Claude |
| 2026-07-06 | **แก้ปัญหา UX/data-integrity ที่พบจากรีวิว pipeline** — (1) **แก้ข้อมูลหายเงียบๆ**: `ipAdv()`/`ipSaveData()` ใช้ `ipSaveAll()` ร่วมกัน เขียนที่อยู่/พิกัด/นัด/กะ/พื้นที่ครบทุกครั้งที่กด "ทำขั้นนี้เสร็จ" (เดิมกดปุ่มนี้แล้วข้อมูลที่แก้ไม่ถูกบันทึกเลย) (2) **หลักฐานยืนยัน `.evi` persist ลง Supabase** คอลัมน์ใหม่ `confirmations` (`ipEviBox`/`ipToggleEvi`) — เดิมติ๊กแล้วปิด popup โดยไม่กดไปต่อ ข้อมูลหายไม่มีร่องรอย (3) **เพิ่มปุ่ม "◀ ย้อนกลับ"** (`ipBack`) ย้อนสเตจได้ 1 ขั้น พร้อม confirm (เดิมกดผิดสเตจแก้เองไม่ได้เลย) (4) แก้คำแนะนำค้าง "Pipeline Stage 3 เพื่อโทรนัด" → **Stage 4** (5) เลข "8 สเตจ"/"X สเตจ" ในหัวข้อ/Overview KPI เปลี่ยนเป็น interpolate จาก `IP_LAST` กันข้อความค้างซ้ำอีกรอบ (6) ปุ่ม "⬇ จำลองออเดอร์เข้า" (dev tool) **ซ่อนใน production** แสดงเฉพาะ `?dev=1` (7) แก้หน้าจอกระพริบตอนเปิดลิงก์แชร์ตั๋ว (เช็ค `?job=` ก่อนเรียก `go('overview')`) (8) **Accessibility**: การ์ดบอร์ด/ปุ่มยืนยันหลักฐาน กด Enter/Space ได้ (`tabindex`,`role`,`onkeydown`), input อัปโหลดไฟล์ใช้ `.visually-hidden` แทน `hidden` (อยู่ใน tab order), เพิ่ม `alt` ให้รูปที่แนบ · **ยังไม่ทำ**: drag-and-drop บนบอร์ด และการจำกัดสิทธิ์ลิงก์แชร์ตั๋ว (ต้องมีระบบ auth ก่อน) — ทิ้งไว้เป็นงานแยก | `index.html` (`ipSaveAll`,`ipSyncFields`,`ipEviBox`,`ipToggleEvi`,`ipBack`,`ipAdv`,`ipSaveData`, CSS), Supabase `install_jobs` (คอลัมน์ `confirmations`) | Claude |
| 2026-07-06 | **รวมถัง 6+7 → เหลือ 8 ถัง** — รวม "คุณเต้ยสรุป/ยืนยันพื้นที่" (เดิมถัง 6) เข้ากับ "อนุญาตเริ่มติดตั้ง" (เดิมถัง 7) เป็นถังเดียว "ยืนยันพื้นที่ + อนุญาตเริ่มติดตั้ง" (หลักฐานครบ 3 อย่าง: คุณเต้ยยืนยันตร.ม./เซลคอนเฟิร์ม/คุณเต้ยอนุญาต ในการ์ดเดียว) เพื่อลด column บนบอร์ด (9→8) — ถัง "ติดตั้ง"/"ตรวจ–ส่งมอบ–ปิดงาน" เลื่อนเป็นถัง 7/8 · **⚠️ ต้อง migrate DB: `UPDATE install_jobs SET stage=stage-1 WHERE stage>=7` (25 แถว: stage8→7 ×6, stage9→8 ×19) — ยังไม่ได้รัน รอ confirm ก่อนรันกับข้อมูลจริง** | `index.html` (`IP_STAGES`, `ipOpen`), `PROJECT_DOCS.md` (§5.1), Supabase `install_jobs` | Claude |
| 2026-07-06 | **ลิงก์แชร์ตั๋ว (deep-link)** — ปุ่ม "🔗 แชร์ตั๋ว" ใน popup คัดลอกลิงก์ `?job=<order>` (ส่งให้ช่างเปิดเฉพาะตั๋วนั้น) · เปิดลิงก์ `?job=` หรือ `#job=` → โหลดแล้วเปิด popup ตั๋วนั้นอัตโนมัติ (`ipShareLink`, `__pendingJob` ใน init + ohLoad) | `index.html` (`ipShareLink`, ipOpen header, init, ohLoad, `.dr-share` CSS) | Claude |
| 2026-07-05 | **ปรับมือถือรอบใหม่ (หลังเพิ่มฟีเจอร์)** — popup กว้าง/สูงขึ้น (96vw/94vh) · แท็บ 4 อัน**ซ่อนไอคอนบนมือถือ** เหลือข้อความล้วน พอดีไม่โดนตัด · หน้า docs: inline `<code>` ยาว break ได้ (ไม่ล้น) · stepper เลข 9 อันเล็กลง · desktop ไม่กระทบ | `index.html` (mobile `<style>`, ipOpen tab markup) | Claude |
| 2026-07-05 | **รัน migration 9 ถังสำเร็จ** (ผ่าน Supabase MCP `execute_sql`) — `UPDATE install_jobs SET stage=stage+1 WHERE stage>=3` · dist ใหม่ `{2:33,4:1,6:1,8:6,9:19}=60` · ข้อมูล prod ตรงกับโค้ด 9 ถังแล้ว · **Storage bucket ยังไม่ได้สร้าง** (ถูกบล็อก — public/anon เขียนบน PII ต้องให้คนสร้างเองใน dashboard) | Supabase `install_jobs` | Claude |
| 2026-07-05 | **ย้าย gate ที่อยู่/พิกัด → ถัง 2 (เซล)** ออกจากถัง 5 (ช่างวัดแค่ ขนาด+รูป) · **อัปโหลดภาพขึ้น Supabase Storage** (`sbUploadFile`, bucket `job-files`) → เก็บ url ใน `site_photos` (persist ข้าม session) · มี **fallback เก็บในเครื่อง**ถ้ายังไม่มี bucket · **⚠️ ต้องสร้าง bucket `job-files` (public) + RLS ให้ upload ก่อน** (ถูกบล็อกในโหมด auto) | `index.html` (`ipStageGate`,`sbUploadFile`,`ipUplBox`,`ipAttach`) | Claude |
| 2026-07-04 | **เพิ่มถัง "เบิกของ + อัปโหลดเอกสารเบิก" → 9 ถัง** — แทรกก่อนถัง 3 (โทรยืนยัน) ให้ช่างอัปโหลดเอกสารการเบิกก่อนออกไป · เลื่อนเนื้อหา/gate ทุกถัง≥3 +1 · uploader `issue_doc` + gate หลักฐาน "เอกสารการเบิก" · อัปเดต overview funnel + KPI ranges (รอ≤4/ทำ 5–8/เสร็จ 9) · **⚠️ ต้อง migrate DB: `UPDATE install_jobs SET stage=stage+1 WHERE stage>=3` (ยังไม่ได้รัน — ถูกบล็อกในโหมด auto)** | `index.html` (IP_STAGES, ipOpen, ipStageGate, renderOverview, ohRenderKpis) | Claude |
| 2026-07-04 | **UX แจ้ง "ข้อมูลไม่ครบ" ชัดขึ้น** — จาก toast หายเร็ว → **กล่องแดงค้าง**เหนือปุ่ม ระบุของขาดเป็น chips · **เด้งไปแท็บที่ขาด**อัตโนมัติ + scroll ไปช่อง · **จุดแดงบนแท็บ** (`.dr-tab.gate-miss`) ที่มีของขาด · เคลียร์อัตโนมัติเมื่อครบ | `index.html` (`ipStageGate`,`ipShowGate`,`ipClearGate`,`ipTabOf`,`ipAdv`,`ipFinish`, foot, CSS) | Claude |
| 2026-07-04 | **ฟอร์มเบิก/คืน (issue) ง่ายขึ้น** — แถวม้วนไดนามิก (＋เพิ่ม/× ลบ ไม่ติด 3 แถว) เก็บรายละเอียด ขนาด/สี/กว้าง/ยาว ครบ · แถบสรุปอัตโนมัติ "เบิก X · คืน Y · ใช้จริง Z ม้วน" · เพิ่มช่อง **ผู้อนุมัติรับคืน** (บันทึกลง caps + `doc.approver`) · `ohSaveDoc` อ่านแถวแบบ query | `index.html` (`ohRollRowHtml`,`ohAddRoll`,`ohRollTotals`,`ohSaveDoc`, issue render) | Claude |
| 2026-07-04 | **popup + ข้อมูลชุดเดียวจริง** — (1) รวม loader: `IP_T===OH_DATA` array เดียว, ตัวเลข board=Job/ออเดอร์ตรงกัน (stage จริง), ลบ bump bill→เสร็จ/eval-auto-complete/accept-stage-bump, แก้ ipMap (phone/price/jobNo, แยก docs↔sitePhotos) (2) การ์ด Job/ออเดอร์ + board เปิด **ipOpen ตัวเดียวกัน** 4 แท็บ (ข้อมูล/นัดหมาย/เอกสาร/ประเมิน) + footer workflow + ปุ่มเปิด OCR editor | `index.html` (`ohLoad`,`ipLoad`,`ipMap`,`ipOpen`,`ohApplyAccept`,`ohRender`) | Claude |
| 2026-07-04 | **รวมสไตล์ popup 2 หน้าให้เหมือนกัน** — Pipeline drawer ใช้ดีไซน์เดียวกับ Job/ออเดอร์: stepper เลข 1-8 (`.stg-track`) · bill chip + ชื่อลูกค้าใน header · badge `X/8 · ชื่อ` · แท็บมีไอคอน (📋/📄/📞) · **แก้บั๊ก** badge `X/7` → `X/IP_LAST` (card + drawer หน้า Job/ออเดอร์) | `index.html` (`ipOpen`, `ohOpenDetail`, `ohRender`) | Claude |
| 2026-07-04 | แก้ข้อความค้าง "7 สเตจ"/"Stage 1→7" → **8 สเตจ**/"1→8" (หัวข้อหน้า Pipeline + overview 4 จุด) | `index.html` (VIEWS.install ×2, renderOverview) | Claude |
| 2026-07-04 | **ย้ายปุ่มสแกน/แนบไฟล์ขึ้นบนสุด** (แท็บแก้เอกสารใน drawer Order History `ohP-docs`) — จากล่างสุดหลังกรอกช่อง → บนสุดของทุกฟอร์ม (receive/issue/sign) ให้ช่างสแกนก่อน + เพิ่ม `capture="environment"` เปิดกล้องบนมือถือ | `index.html` (pane3 build) | Claude |
| 2026-07-04 | **แท็บ "ข้อมูล" = การ์ดข้อมูลงาน แก้ได้ทุกถัง** — รวมช่องทุกขั้น (ที่อยู่/พิกัด/นัดหมาย/กะ/ขนาด+AI) ไว้ในการ์ด `ipDataCard` ที่โผล่ทุกถัง + แถบความคืบหน้า ✓/○ · ปุ่ม 💾 `ipSaveData` บันทึกลง Supabase (`address,location,due_date,shift,area_w,area_l`) · เอาช่องซ้ำออกจากถัง 3/4 · แก้ `ipMap` อ่าน `area_w/area_l`+`docs` จาก DB (เดิมอ่าน `area` ผิด) | `index.html` (`ipDataCard`,`ipSaveData`,`ipMap`,`ipOpen`) | Claude |
| 2026-07-04 | **เอกสาร/รูปในถัง = แนบไฟล์ได้จริง** — เปลี่ยนวิดเจ็ตเอกสาร (ถัง 2 เซ็นกลับ · ถัง 4 รูป 3 มุม · ถัง 8 ภาพหลัง) จากปุ่มติ๊กเป็น uploader จริง (`ipUplBox`/`ipAttach`) เลือกไฟล์/ถ่ายรูป → preview → เก็บใน `t.docs[key]` (data URL, ต่อ session) · gate เช็ค `.upl[data-evi]` · ส่วนยืนยัน (ลองตัวอย่าง/อนุญาต/เก็บเงิน) ยังเป็นปุ่มติ๊ก `.evi` | `index.html` (`ipUplBox`,`ipAttach`,`ipStageGate`, `.upl` CSS) | Claude |
| 2026-07-04 | **จัด Pipeline ใหม่ 8 ถังตาม SOP (Sale & DC)** — เปลี่ยน `IP_STAGES` เป็น 8 ถัง + role + หลักฐาน · เพิ่ม `IP_LAST` แทนเลข 7 ทั้งไฟล์ · gate ทั่วไป `ipStageGate` (บล็อกตามหลักฐานแต่ละถัง: ถัง4 พื้นที่+รูป, ถัง6 อนุญาต 2 ฝ่าย, ถัง8 ภาพหลัง+เก็บเงิน) · อัปเดต overview funnel เป็น 8 | `index.html` (IP_STAGES, ipOpen, ipStageGate, ipAdv, ipFinish, renderOverview) | Claude |
| 2026-07-04 | **Migrate Supabase `install_jobs` → 8 ถัง** — remap stage เก่า→ใหม่ `7→8` (18 แถว) + `4→7` (6 แถว) · ยืนยัน distribution ใหม่ `{2:35,3:1,7:6,8:18}=60` · backup ไว้ที่ scratchpad/backup_stages.json | Supabase `install_jobs` (60 แถว) | Claude |
| 2026-07-04 | **Drawer → popup ลอยกลางจอ + 3 แท็บ** (ข้อมูล/เอกสาร/โทร) — `ipOpen` แยกเนื้อหาเป็น pane + `drTab` · ปุ่มไปต่ออยู่ footer sticky | `index.html` (`.drawer` CSS, `ipOpen`, `drTab`) | Claude |
| 2026-07-02 | **มือถือแบบพอดีจอ ไม่เลื่อนแนวนอน:** ตาราง (register/search/service) → **การ์ดแนวตั้ง** (ใส่ `data-label` อัตโนมัติจาก `<thead>` ผ่าน `applyTableLabels()`) · Pipeline board → เรียงถังแนวตั้ง · docs → ตาราง/โค้ด wrap พอดีจอ · ทดสอบ 12 หน้าที่ 375px ไม่มี horizontal scroll · desktop ไม่กระทบ | `index.html` (mobile `<style>`, `applyTableLabels()`, render 3 ตาราง) | Claude |
| 2026-07-02 | **รองรับมือถือ (responsive):** แก้ `.grid3` ที่โมดูล Pipeline inject ทับ global (ทำให้ overview/dashboard ล้นจอมือถือ) → จำกัด scope เป็น `#drawer .grid3` · ตาราง (`.tbl`) + ตาราง/code ในหน้า docs เลื่อนภายในตัวเอง ไม่ดันทั้งหน้า (`@media ≤760px`) · sidebar ปิดอัตโนมัติเมื่อเลือกเมนู (ใน `go()`) · ทดสอบครบ 12 หน้าที่ 375px ไม่มี horizontal scroll | `index.html` (main `<style>`, injected `.grid3`, `go()`) | Claude |
| 2026-07-02 | **กู้ข้อมูล DB:** ระหว่างเทสต์เผลอเลื่อน `install_jobs` order `263835` จาก stage 7 → 3 · กู้กลับเป็น 7 แล้ว (ยืนยัน distribution ตรง pristine: 2=35, 3=1, 4=6, 7=18) | Supabase `install_jobs` (order 263835) | Claude |
| 2026-07-02 | **แก้บอร์ดเพี้ยน:** เอา logic `bill→ถัง 7` ออก (ที่เผลอกู้มาก่อนหน้า) — งานถัง 2 ที่มีบิล 35 งานถูกดันไปแสดงเป็น "เสร็จงาน" ผิด · ตอนนี้บอร์ดแสดง stage จริงตาม DB | `index.html` (`ipMap` ×2) | Claude |
| 2026-07-02 | **Validate ถัง 2 ก่อนไปต่อ** — ปุ่ม "ทำขั้นนี้เสร็จ" บล็อกถ้าข้อมูลไม่ครบ (ที่อยู่ · พิกัด · กว้าง · ยาว · รูป 3 มุม), ขึ้นขอบแดง + toast · บันทึก `t.area` ตอนไปต่อ · **fix bug:** `ipMap` (ตัว override) ขาด `callLogs`→crash ตอนไปถัง 3 + กู้ logic `bill→ถัง 7` | `index.html` (`ipAdv`, `ipCheckStage2`, `ipMap` ×2, ถัง 2 card) | Claude |
| 2026-07-02 | เพิ่มหน้า **"คู่มือ / โครงสร้างระบบ"** (`docs`) ในเว็บแอป — เมนูล่างสุด, ดึง `PROJECT_DOCS.md` มาแสดงด้วย `marked` + สร้าง TOC อัตโนมัติ | `index.html` (nav, VIEWS, go(), `renderDocs()`, section `v-docs`, marked CDN) | Claude |
| 2026-07-02 | สร้างเอกสารกลาง `PROJECT_DOCS.md` (โครงสร้างเว็บ + ฐานข้อมูล + activity log) | `PROJECT_DOCS.md` | Claude |

### ประวัติ Git ที่ผ่านมา (สรุปจาก commit log)

| วันที่ | commit | สิ่งที่ทำ |
|--------|--------|-----------|
| 2026-07-02 | `de2e2b8` | trigger Vercel production deploy |
| 2026-07-01 | `a5febab` (#23) | auto-advance stage → 7 สำหรับ job ที่มีเลขบิล |
| 2026-07-01 | `968fb6f` (#22) | map ข้อมูล Hosttail acceptance sheet (43 jobs) เข้า CRM |
| 2026-07-01 | `b46d248` | เพิ่มฟิลด์ "มูลค่าสินค้า" ใน job detail panel |
| 2026-07-01 | `23653df` (#20) | ใช้ IndexedDB เก็บไฟล์ batch PDF ให้รอด page refresh |
| 2026-07-01 | `115a77c` (#19) | แก้ blob URL ของ batch imgSrc + file picker |
| 2026-07-01 | `76d4b65` (#18) | แสดงปุ่มแก้ไขสำหรับ batch OCR doc ทุกตัว |
| 2026-07-01 | `980dd5a` (#17) | persist `DOCS` ลง localStorage ให้รอด refresh |
| 2026-07-01 | `181bcd7` (#16) | เพิ่ม retry OCR + กรอกมือสำหรับ batch ที่ fail |
| 2026-07-01 | `16aefdd` (#15) | เปิด file preview เป็น split-pane ใน drawer |
| 2026-07-01 | `f4dba61` (#14) | ทำปุ่ม "เปิดไฟล์" ให้ใช้งานได้ (เก็บ blob URL) |
| 2026-07-01 | `48fb6d1` (#13) | batch OCR auto-save ต่อเนื่องไม่ต้องยืนยัน |
| 2026-07-01 | `6218415` (#12) | รองรับไฟล์ PDF ใน batch folder OCR |
| 2026-07-01 | `a29a789` (#11) | batch folder OCR — สแกนทั้งโฟลเดอร์ทีละไฟล์ |
| 2026-07-01 | `8a0866d` (#10) | บันทึกไฟล์แนบพร้อมฟอร์มเอกสาร |
| 2026-07-01 | `ccbc74c` (#9) | แสดงฟิลด์เอกสารแก้ไขได้ inline ใน job drawer |
| 2026-07-01 | `cbbbd2f` (#8) | แสดงฟิลด์/รูปเอกสารที่สแกนใน job drawer |
| 2026-07-01 | `3da05b3` (#7) | auto-complete stage → 7 เมื่อมีคะแนนประเมิน |
| 2026-07-01 | `420c952` (#6) | เปลี่ยน OH module เป็น card-grid + drawer 4 แท็บ |
| 2026-07-01 | `135deca` (#5) | จัด nav ใหม่ให้ตรงกับ install flow |
| 2026-06-30 | `c7fd10f` (#4) | เพิ่มหน้า Order History |
| 2026-06-30 | `65dafea` (#3) | แก้ TDZ error ของ `IP_T` ใน renderOverview |
| 2026-06-30 | `4d3186d` | OCR รองรับอัปโหลด PDF หลายฟอร์ม |
| 2026-06-30 | `ab0a162` | overview dashboard + OpenRouter fallback |

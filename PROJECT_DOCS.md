# MPD Workspace — เอกสารโปรเจกต์ (Project Docs)

> ระบบงานติดตั้ง & เอกสาร ของ **บริษัท มีภูมิดี จำกัด**
> เว็บแอปไฟล์เดียว (`index.html`) + OCR Backend (FastAPI) เชื่อม Supabase สด
> ไฟล์นี้คือแหล่งบันทึกกลาง — โครงสร้างเว็บ, โครงสร้างฐานข้อมูล และ **บันทึกทุกการเปลี่ยนแปลง** (ดูหัวข้อ [Activity Log](#activity-log) ท้ายไฟล์)

_อัปเดตล่าสุด: 2026-07-02_

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
| `bill_no` | text | เลขบิล — **ถ้ามีบิลและ stage < 7 จะถูกดันเป็น stage 7 อัตโนมัติ** |
| `stage` | int | ถังใน Pipeline 1–8 (ดู `IP_STAGES` · `IP_LAST=8`=ปิดงาน) |
| `status` | text | สถานะย่อยในถัง |
| `due_date` | date | วันนัด/กำหนดส่ง |
| `shift` | text/int | รอบ/กะ |
| `order_date` | date | วันที่ออเดอร์ |
| `product_name` | text | ชื่อสินค้า |
| `product_skus` | array | รายการ SKU |
| `customer_name` / `customer_code` | text | ลูกค้า |
| `assignees` | array | ทีมช่างที่รับผิดชอบ |
| `source` | text | ที่มา (`planner` / อื่นๆ) |
| `created_via` | text | (`manual` / `auto`) |
| `linked` | bool | เชื่อมข้อมูลแล้วหรือไม่ |
| `updated_at` | timestamp | เวลาแก้ล่าสุด (เขียนทุกครั้งที่อัปเดต stage) |

**การเขียนกลับ (write):**
- `ipSaveStage()` → `update({stage, status, updated_at}).eq('order_no', ...)`
- อัปเดตรายละเอียด → `update({stage, status, due_date, shift, updated_at})`

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
1 จองคิว/รับออร์เดอร์ (เซล) → 2 ส่งเอกสาร–รับเซ็น (เซล) → 3 โทรยืนยันก่อนถึง (DC)
→ 4 วัดพื้นที่–ลองตัวอย่าง–ถ่ายภาพ (DC) → 5 คุณเต้ยสรุป/ยืนยันพื้นที่ (คุณเต้ย)
→ 6 อนุญาตเริ่มติดตั้ง (เซล+คุณเต้ย) → 7 ติดตั้ง (DC) → 8 ตรวจ–ส่งมอบ–ปิดงาน
```
- ที่มา: ไฟล์ SOP `SOP การประสานงานระหว่าง Sale&DC.xlsx` (3 ชีต: ขั้นตอน 8 ข้อ · เหตุฉุกเฉิน · Checklist เซล/DC)
- แต่ละถังมี **ผู้รับผิดชอบ (role)** + **หลักฐานที่ต้องมี (evidence gate)** — ดูใน drawer หัวการ์ด "ขั้นตอนนี้ (SOP)"
- **Popup ลอยกลางจอ + 3 แท็บ**: ข้อมูล / เอกสาร / โทร (`ipOpen` + `drTab`)
- ปุ่ม **"ทำขั้นนี้เสร็จ ▶"** = `ipAdv()` → เช็ค `ipStageGate(t)` ก่อน (บล็อกถ้าหลักฐานไม่ครบ) → เพิ่ม stage → `ipSaveStage()` sync Supabase
- **Gate สำคัญ:** ถัง 4 (ที่อยู่+พิกัด+ตร.ม.+รูป 3 มุม) · ถัง 6 (เซลคอนเฟิร์ม+คุณเต้ยอนุญาต — ⛔ ห้ามเริ่มก่อน) · ถัง 8/`ipFinish` (ภาพหลัง+เก็บเงินครบ)
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

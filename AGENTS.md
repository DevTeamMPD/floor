# คู่มือ Agent — LENDI Engineering (repo `floor`)

เอกสารนี้เก็บ "สิ่งที่ต้องรู้ก่อนแตะโค้ด" ที่เสียเวลาไปมากกว่าจะรู้
อ่านให้จบก่อนเริ่มงาน โดยเฉพาะหัวข้อ **ก่อนแตะ production** และ **กับดักที่เจอมาแล้ว**

---

## 0. ภาพรวมระบบ

FloorNow / LENDI Engineering — ระบบคิวติดตั้งและใบสั่งงานหน้างาน
งานเข้ามาสองทาง: สร้างเองในระบบ (`install_jobs.source = 'sales_txn' | 'floor_direct'`)
และรับมาจาก **BBPS CRM** ผ่าน webhook (`source = 'bbps'`, `external_id` = uuid ของตั๋วฝั่ง BBPS)

**เรื่องที่คนมักเข้าใจผิด: สองระบบนี้ใช้ Supabase project เดียวกัน** (`nroyacasuchqniaiuirk`)
webhook ที่ยิงหากันจึงออกจาก Vercel แล้ววิ่งกลับเข้าฐานข้อมูลตัวเดิม
อย่าไปคิดว่ามีสอง DB แล้วออกแบบ sync ข้อมูลซ้ำซ้อน

---

## 1. ⚠️ ก่อนแตะ production — อ่านก่อน

### production ต้องมาจาก Git `main` ทางเดียว

`floor-delta.vercel.app` ต้องชี้ไป deployment ที่มี `source: git` และ branch `main` เท่านั้น
ห้ามใช้ `vercel --prod`, `vercel deploy --prod` หรือ relink `.work-shared-visibility`
เข้ากับ Vercel project `floor` เพราะ CLI deployment จะแย่ง production alias และอาจนำไฟล์ที่ยังไม่ commit ขึ้นจริง

ก่อนปล่อย production ให้ทำตามลำดับนี้เสมอ:

1. สร้าง branch และเปิด PR
2. รัน test, type-check และ production build
3. merge PR เข้า `main`
4. รอ Vercel Git deployment จาก `main`
5. ตรวจ deployment metadata ว่า source เป็น Git, branch เป็น `main` และ commit ตรงกับ `origin/main`

ถ้าพบไฟล์ใหม่ใน `.work-shared-visibility` ให้ย้ายเข้าผ่าน branch/PR ห้าม deploy จาก worktree โดยตรง

### env var ถูกผูกกับ deployment ตอน build

ตั้ง env บน Vercel เฉยๆ **ไม่มีผลกับ deployment ที่ build ไปแล้ว** ต้องสร้าง deployment ใหม่
จาก Git `main` หรือ redeploy ผ่าน Dashboard เฉพาะ deployment ที่ยืนยันแล้วว่ามาจาก Git `main`
ห้ามใช้ CLI redeploy สำหรับ production

---

## 2. Ticket Chat Sync (BBPS ⇄ LENDI) — เฟส 1

อ้างอิงสัญญา: `API_CONTRACT_TICKET_CHAT_SYNC.md` (อยู่ใน repo bbps-crm)

### ตารางฝั่งนี้

`public.floor_ticket_messages` — แชทในตั๋ว ผูกกับ `install_jobs.job_no`
คอลัมน์ที่เกี่ยวกับการซิงก์:

| คอลัมน์ | ความหมาย |
|---|---|
| `external_source` | `null` = พิมพ์ในระบบนี้ · `'bbps'` = รับมาจาก BBPS |
| `external_message_id` | กุญแจ idempotency **คงที่ตลอดอายุข้อความ** (`lendi-<uuid>` สำหรับขาออก) |
| `external_ticket_id` | uuid ตั๋วฝั่ง BBPS |
| `external_provider_message_id` | id ที่ BBPS ตอบกลับหลังรับสำเร็จ |
| `external_sender_role` | บทบาทจริงฝั่ง BBPS (`sender_kind` เก็บได้แค่ 5 ค่าเดิม) |
| `external_attachments` | `[{url,type,name}]` ไฟล์แนบจากภายนอก (ไม่ mirror ไฟล์) |
| `sync_status` | `local` \| `pending` \| `delivered` \| `failed` |

- unique index `(external_source, external_message_id) WHERE external_message_id IS NOT NULL` — กันรับซ้ำ
- trigger `trg_floor_ticket_message_sync_target` (BEFORE INSERT) ตัดสินให้เองว่าต้องส่งต่อไหม
  โดยดูจาก `install_jobs.source` — **ตั๋วที่ไม่ใช่ BBPS ได้ `local` เสมอ พฤติกรรมเดิมไม่เปลี่ยน**
- ข้อความที่ **รับมา** จาก BBPS ก็ตั้งเป็น `local` เพื่อ **กัน echo วนไม่จบ** — ห้ามแก้จุดนี้เป็นอย่างอื่น

### Endpoint

| path | ทิศทาง | หมายเหตุ |
|---|---|---|
| `POST /api/webhook/bbps/chat` | ขาเข้า | อ่าน raw body ก่อน parse → Bearer → timestamp 300 วิ → HMAC constant-time |
| `POST /api/tickets/chat/sync` | ขาออก | บันทึกลง DB ก่อนเสมอ แล้วค่อยผลักออก · เรียกจาก UI ตอนเปิดแชทและปุ่มลองใหม่ |
| `GET /api/integrations/bbps/file?t=` | ไฟล์แนบ | capability URL — ดูหัวข้อไฟล์แนบ |

ทุกตัวตอบ `503 integration_not_configured` เมื่อ env ยังไม่ครบ → deploy ขึ้นไปก่อนได้อย่างปลอดภัย

### ลายเซ็น

```
signed_payload = "{X-Timestamp}.{raw body}"
X-Signature    = "v1=" + hex(HMAC_SHA256(secret, signed_payload))
```

ต้องเทียบแบบ constant-time (`crypto.timingSafeEqual`) และตรวจ timestamp **สองทาง** (±300 วิ)
timestamp ถูกผูกเข้าไปในสิ่งที่เซ็นด้วย ถ้าเซ็นแค่ body คนที่ดัก request ได้จะเปลี่ยน
timestamp แล้วส่งซ้ำได้ทันที การกัน replay จะไม่มีผลเลย

`lib/webhook/verify-bbps.ts` เคยตัดเฉพาะคำนำหน้า `sha256=` แต่ BBPS ส่ง `v1=`
ถ้าเปิด `BBPS_WEBHOOK_SECRET` เมื่อไหร่ webhook เดิมจะถูกปฏิเสธทุก request — แก้แล้วให้รับทั้งสองแบบ

### ไฟล์แนบ — ทำไมถึงไม่เปิด bucket เป็น public

bucket `ticket-chat-files` เป็น private และ signed URL ที่หน้าเว็บใช้มีอายุ **300 วินาที**
ซึ่งสั้นกว่าที่ contract ขอ (≥90 วัน) มาก แต่การเปิด bucket เป็น public
จะเปิดไฟล์ของ **ทุกงาน** ให้ใครก็ตามที่เดา path เจอ — **ห้ามทำ**

ทางที่ใช้คือ capability URL: เซ็นด้วย `BBPS_CHAT_FILE_SECRET` ผูกกับไฟล์เดียว มีวันหมดอายุในตัว
route เป็นตัวกลาง proxy ไบต์ออกมา ไม่ redirect ไป signed URL ของ storage
(กัน URL ภายในหลุดไปอยู่ใน history/referrer ปลายทาง)
`inline` เฉพาะรูปกับ PDF ชนิดอื่นบังคับดาวน์โหลด + `nosniff` กัน stored XSS
**หมุน `BBPS_CHAT_FILE_SECRET` ครั้งเดียว = เพิกถอนลิงก์เก่าทั้งชุด** ซึ่ง signed URL ธรรมดาทำไม่ได้

### ทางเข้ากล่องแชทใน UI

`components/tickets/ticket-chat.tsx` ถูกใช้ที่:
`app/(admin)/operations` · `app/(admin)/warehouse` (ผ่าน `ticket-chat-mock.tsx` ซึ่งเป็น wrapper บางๆ)
· `app/share/queue` · `app/work/[token]`

**กติกา:** ปุ่มเปิดแชทต้องแสดง **ทุกแหล่งที่มาของงาน** เคยมีบั๊กที่หน้า operations เขียนปุ่ม
"↩ ส่งกลับ BBPS" กับ "💬 ขอข้อมูลจากฝ่ายขาย" เป็นเงื่อนไขสลับกัน ทำให้งาน BBPS ซึ่งเป็น
กลุ่มเดียวที่แชทวิ่งข้ามระบบจริง กลับเป็นกลุ่มเดียวที่เปิดแชทไม่ได้
ตอนนี้แยกการตัดสินใจไว้ที่ `lib/ticket-chat-entry.ts` พร้อมเทสกันถอยหลัง — ใช้ helper นั้น อย่าเขียนเงื่อนไขเอง

### ชื่อ env (ค่าอยู่บน Vercel เท่านั้น ห้ามเขียนลงไฟล์ ห้ามใช้คำนำหน้า `NEXT_PUBLIC_`)

`BBPS_CHAT_API_URL` · `BBPS_CHAT_OUTBOUND_TOKEN` · `BBPS_CHAT_OUTBOUND_SECRET` ·
`BBPS_CHAT_OUTBOUND_KEY_ID` · `BBPS_CHAT_WEBHOOK_SECRET` · `BBPS_CHAT_FILE_SECRET` ·
`BBPS_CHAT_FILE_TTL_DAYS` · `LENDI_PUBLIC_BASE_URL`
(ไม่บังคับ: `BBPS_CHAT_INBOUND_TOKEN` · `*_PREVIOUS` สำหรับหมุนกุญแจ)

`NEXT_PUBLIC_*` ถูกฝังลง bundle ของเบราว์เซอร์เสมอโดยนิยาม — ห้ามเอา secret ไปใส่เด็ดขาด

---

## 3. กับดักที่เจอมาแล้ว

**Windows + OneDrive ทำให้ git diff บวม** — ไฟล์ในเครื่องเป็น CRLF และ mode 755
ถ้า commit ตรงๆ จะได้ diff 140+ ไฟล์ทั้งที่เนื้อหาไม่เปลี่ยน
วิธีตรวจว่าไฟล์ไหนต่างจริง: `git diff --ignore-cr-at-eol` (แต่ `--name-only` **ไม่** สนใจ flag นี้)
และตั้ง `git config core.fileMode false` ก่อน add

**ไฟล์ `.lock` ของ git ลบไม่ได้จาก Cowork Linux VM** (`Operation not permitted`)
ทุกคำสั่ง git ที่เขียน index จะทิ้ง lock ไว้แล้วคำสั่งถัดไปพัง
ทางออก: `mv` lock ไปไว้ที่ `_to_delete/` ก่อนทุกครั้ง หรือ `git clone --shared` ออกมาทำงานนอก mount แล้ว fetch branch กลับเข้าไป

**`.work-shared-visibility` เป็น git worktree ที่ชี้ไป path แบบ Windows** — สั่ง git ในนั้นจากฝั่ง Linux ไม่ได้เลย

**ไฟล์ `.bat` ที่ซับซ้อนพังเงียบ** — ถ้าต้องให้ผู้ใช้กดสคริปต์บน Windows ให้ทำ `.bat` เป็น
**ASCII ล้วน ไม่มี BOM** ทำหน้าที่แค่เรียก PowerShell แล้วให้ `.ps1` ทำงานจริงพร้อมเขียน log ลงไฟล์
`.bat` ที่มี BOM + ข้อความไทย + `setlocal`/`call :label` เคยปิดตัวเองทันทีโดยไม่มี error ให้เห็น

---

## 4. ตรวจงาน

```bash
npx vitest run     # 57/57 ณ ตอนเขียน
npx tsc --noEmit
npm run build
```

ทดสอบ integration ของจริงโดยไม่ต้องพึ่ง UI: insert แถวลง `ticket_messages_bbps`
(direction `outbound`) แล้วตามดู `outbox_events.status` → ควรเป็น `delivered` + `response_code 201`
ภายใน ~2 นาที (dispatcher เดินด้วย cron ภายนอกทุก 1 นาที) แล้วเช็คว่าแถวโผล่ใน
`floor_ticket_messages` พร้อม `external_source='bbps'`

ทิศ LENDI → BBPS ต้องทดสอบผ่าน UI เพราะ route ต้องมี session พนักงานจริง

---

## 5. ยังค้างอยู่

- read receipts ข้ามระบบ (contract เฟส 2) ยังไม่ได้ทำ
- อัปโหลดไฟล์จากฝั่ง BBPS ยังไม่ได้ทำ (ฝั่งนั้นพิมพ์ได้เฉพาะข้อความ แต่เห็นไฟล์ที่ LENDI ส่งไป)
- `.env.production` ถูก commit ไว้ใน repo (มีแค่ `NEXT_PUBLIC_*` ซึ่งเป็นค่าสาธารณะโดยนิยาม
  แต่ repo นี้เป็น public บน GitHub — ควรทบทวน)

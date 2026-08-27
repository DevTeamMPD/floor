# หน้าที่ไม่มีทางเข้าถึง (เก็บเมื่อ 2026-08-26)

หน้าทั้ง 4 หน้านี้ไม่มีลิงก์เชื่อมจากที่ใดในระบบ ไม่อยู่ใน sidebar
(`components/layout/sidebar.tsx`) และไม่อยู่ใน route map ของ
`middleware.ts` — ตรวจสอบด้วย `git grep` ทั่วทั้ง repo แล้วไม่พบการอ้างอิงถึง
path เหล่านี้เลยในไฟล์ `.tsx`/`.ts` ใด ๆ (นอกจากไฟล์ของหน้าเอง) แต่ยังคง
build และแสดงข้อมูลจากตาราง `install_jobs` อยู่ ทำให้คนสับสนว่าหน้าไหนคือ
หน้าจริงที่ใช้งาน

ย้ายมาเก็บไว้ที่นี่แทนการลบทิ้ง เผื่อมีข้อมูล/ตรรกะที่อยากดึงกลับไปใช้ภายหลัง

---

## queue/ (เดิม `app/(admin)/queue/`)

**แสดงอะไร:** รายการงานติดตั้งที่ยัง active (ยังไม่ปิดงาน) จัดกลุ่มตามวันครบกำหนด
(due date) ดึงข้อมูลจาก `install_jobs` แล้ว map เป็น `InstallJob` ผ่าน
`IP_STAGES`

**หน้าที่ใช้งานจริงแทน:** `/operations` (`app/(admin)/operations/page.tsx`)
หรือ `/orders` (`app/(admin)/orders/`) สำหรับดูคิวงานและสถานะใบสั่งงาน

**คำสั่งกู้คืน:**
```bash
git mv _archive/2026-08-26-dead-routes/queue "app/(admin)/queue"
```

---

## jobs/ (เดิม `app/(admin)/jobs/`)

**แสดงอะไร:** รายการงานติดตั้งทั้งหมด (ทุกสถานะ) พร้อมช่องค้นหา ดึงข้อมูลจาก
`install_jobs` เช่นเดียวกับ `queue/` แต่ไม่กรองเฉพาะงาน active

**หน้าที่ใช้งานจริงแทน:** `/operations` หรือ `/orders` เช่นเดียวกับ `queue/`

**คำสั่งกู้คืน:**
```bash
git mv _archive/2026-08-26-dead-routes/jobs "app/(admin)/jobs"
```

---

## overview/ (เดิม `app/(admin)/overview/`)

**แสดงอะไร:** สรุป KPI และ breakdown ตาม stage ของงานติดตั้งทั้งหมด
(จำนวนงาน, eval score, วันครบกำหนด ฯลฯ) จาก `install_jobs`

**หน้าที่ใช้งานจริงแทน:** `/dashboard` (`app/(admin)/dashboard/page.tsx`)
หรือ `/exec` (`app/(admin)/exec/page.tsx`) สำหรับภาพรวม KPI

**คำสั่งกู้คืน:**
```bash
git mv _archive/2026-08-26-dead-routes/overview "app/(admin)/overview"
```

---

## job-order/[jobNo]/ (เดิม `app/job-order/[jobNo]/`)

**แสดงอะไร:** หน้าใบสั่งงานฝั่งลูกค้า (customer-facing) รุ่นเก่า แสดงข้อมูล
สำรวจหน้างาน (survey data), รายการวัสดุ, ขนาดพื้นที่ ของ `install_jobs`
รายตัว ตาม `jobNo`

**หน้าที่ใช้งานจริงแทน:** `/orders/[jobNo]`
(`app/(admin)/orders/[jobNo]/page.tsx`)

**คำสั่งกู้คืน:**
```bash
git mv "_archive/2026-08-26-dead-routes/job-order" "app/job-order"
```

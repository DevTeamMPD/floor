# Deployment Log

## รอรวม deploy รอบถัดไป

บันทึกวันที่ 30 สิงหาคม 2569

- ฝ่ายขาย: หลังเข้าสู่ระบบ ให้เปิดหน้า `sales-queue` เพื่อเห็นตารางคิวงานทันที
- หน้ารายละเอียดคิวบนมือถือ: ย้ายแชตในตั๋วขึ้นเป็นส่วนแรกใต้หัวข้อมูลใบงาน
- ปุ่มท้ายหน้า: จัดปุ่ม `ส่งกลับแก้ไข`, `แก้ไข` และ `ยกเลิกคิว` ไว้ใต้หัวข้อ “การดำเนินการเพิ่มเติม” บนมือถือ เพื่อลดความสับสนกับปุ่มยืนยันสถานะคิว

สถานะ: ทดสอบ TypeScript แล้วผ่าน (`npx tsc --noEmit`) และ **ยังไม่ได้ deploy** ตามคำขอ

## รอรวม deploy รอบถัดไป — Workload หน้าจัดคิวช่าง

- เพิ่มการ์ดภาพรวม Workload รายทีมในหน้า `/appointments`
- แสดงจำนวนงาน, ชั่วโมงนัดหมาย, สัดส่วนเทียบกำลังทีม, จำนวนช่าง Active และจำนวนช่างที่ถูกจ่ายงาน
- ทำเครื่องหมายทีมที่ยังไม่มีช่าง, งานรอจ่ายช่าง และคิวชน เพื่อให้เริ่มแก้จากจุดเสี่ยงได้ทันที
- คงตารางรายบุคคลเดิมไว้สำหรับเจาะช่วงเวลาละเอียด

สถานะ: ตรวจ TypeScript และ production build ผ่านแล้ว และ **ยังไม่ได้ deploy**

## Deploy แล้ว — 30 สิงหาคม 2569

- แก้ BBPS webhook ให้ใช้ `SUPABASE_SERVICE_ROLE_KEY` ฝั่ง server แทน anon key เพื่อให้ sync ตาราง `install_jobs` และคิวทีม B ได้ภายใต้ RLS โดยไม่ต้องเปิดสิทธิ์ public
- Production deployment: `dpl_CTce54GEkeEKW4HgGyhgcbPnmkq8` (Ready)

## Deploy แล้ว — 30 สิงหาคม 2569 (Realtime queue)

- เพิ่ม Realtime listener บนหน้าจองคิวสำหรับ `appointments`, `install_jobs` และ `tech_teams`
- เปิด publication ของทั้งสามตารางใน Supabase Realtime (migration `20260830000000_sales_queue_realtime.sql`)
- ซ่อนป้าย “ทีม B ยังไม่พร้อมจอง” เฉพาะวันที่มีคิว BBPS ของทีม B แล้ว
- Production deployment: `dpl_D3mLn4yQHrFmjTCh6Ebi668CW899` (Ready)

## Deploy แล้ว — 30 สิงหาคม 2569 (Realtime refresh UX)

- Realtime refresh ของหน้าตารางคิวจะคงตารางเดิมไว้ ไม่สลับเป็น skeleton ทุกครั้งที่มีข้อมูลจาก BBPS หรือผู้ใช้คนอื่นเปลี่ยนแปลง
- แสดงสถานะเล็ก ๆ ว่า “กำลังอัปเดตคิว…” ระหว่างดึงข้อมูล และเปลี่ยนเป็นเวลาอัปเดตล่าสุดเมื่อเสร็จ
- Production deployment: `dpl_tc2uj3YocDyLG3Rcr1s6rtQsWz3X` (Ready)

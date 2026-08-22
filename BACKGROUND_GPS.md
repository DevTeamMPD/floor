# FloorNow Background GPS

สถานะ: โค้ดเว็บ, schema/RPC และแอปพนักงาน Android/iPhone พร้อมสำหรับรอบทดสอบเครื่องจริง แต่ยังไม่ใช่ Store build จนกว่าจะตั้ง SMS, Google Routes และ EAS credentials

## Flow ที่ระบบบังคับ

1. พนักงานเข้าแอปด้วย OTP เบอร์โทร และผูกบัญชีกับลิงก์พนักงานเดิมครั้งแรกครั้งเดียว
2. แอปขอสิทธิ์ตำแหน่งแบบ Always และบันทึกว่าเครื่องใดได้รับอนุญาต
3. เมื่อเปิดใบงาน ระบบบันทึกหลักฐาน `opened`; พนักงานต้องกด `รับทราบงาน`
4. หัวหน้าช่างต้องกำหนดจำนวนแผ่นก่อน พนักงานจึงเห็นค่าเริ่มต้นและกรอกจำนวนที่หยิบจริง
5. พนักงานถ่ายรูปแล้วกดเริ่มเดินทาง ระบบจึงเปิด Background GPS
6. แอปเก็บพิกัดทุกประมาณ 60 วินาทีหรือ 250 เมตร และพักข้อมูลใน outbox บนเครื่องเมื่อเน็ตขาด
7. พนักงานอัปเดตตามลำดับเท่านั้น: `กำลังเดินทาง → ถึงบ้านลูกค้า → กำลังติดตั้ง → เสร็จสมบูรณ์` โดยแต่ละขั้นต้องถ่ายรูป
8. ลูกค้าเซ็นรับงานในแอป จากนั้น session และ Background GPS หยุดทันที
9. ลูกค้าเปิด `/track/{customerToken}` เพื่อดูเฉพาะสถานะ, ETA, ระยะทาง, เวลาอัปเดต และรูปหลักฐาน โดยไม่มีพิกัดจริง

## Security

- RPC พนักงานใช้ได้เฉพาะ role `authenticated` และตรวจทั้ง `auth.uid()`, device token และ assignment ของช่าง
- anon ใช้ได้เฉพาะ `get_floor_customer_tracking(customerToken)`
- ตาราง GPS เปิด RLS และไม่มี direct grants สำหรับ anon/authenticated; อ่านและเขียนผ่าน RPC ที่จำกัดขอบเขตเท่านั้น
- Raw latitude/longitude ไม่ถูกส่งให้หน้าลูกค้า
- Google Routes ถูกตรวจ ownership และ throttle ก่อนเรียก API แบบเสียค่าใช้จ่าย
- พิกัดที่เก่ากว่า 24 ชั่วโมงหรืออยู่ในอนาคตเกิน 10 นาทีถูกปฏิเสธ

## Environment ที่ต้องตั้ง

Vercel (`floor`, Production และ Preview):

```text
GOOGLE_MAPS_ROUTES_API_KEY=...
```

Mobile/EAS:

```text
EXPO_PUBLIC_SUPABASE_URL=https://nroyacasuchqniaiuirk.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
EXPO_PUBLIC_FLOORNOW_API_URL=https://floor-delta.vercel.app
EXPO_PUBLIC_CUSTOMER_TRACKING_BASE_URL=https://floor-delta.vercel.app/track
```

Supabase Auth:

- เปิด Phone provider
- ตั้ง SMS provider และ sender ที่ใช้จริง
- OTP เป็น Auth หลัก; session ถูกเก็บใน SecureStore ของเครื่อง

Google Cloud:

- เปิด Routes API
- จำกัด key ให้เรียก Routes API เท่านั้น และตั้ง budget/alert

## ข้อจำกัดของระบบปฏิบัติการ

- ต้องติดตั้ง development/preview/production build; Expo Go ทดสอบ Background Location จริงไม่ได้
- Android แสดง foreground-service notification ตลอดการเดินทาง และบางยี่ห้อต้องยกเว้น battery optimization
- iPhone ทำงานขณะล็อกจอ/สลับแอปได้ แต่ระบบปฏิบัติการจะหยุดติดตามเมื่อผู้ใช้ force-quit แอป
- ETA ต้องมี Google Maps URL ที่มี latitude/longitude; short link ที่ไม่มีพิกัดใน URL ต้องปักหมุดใหม่ก่อน

## Verification

```powershell
# Web
npx tsc --noEmit -p tsconfig.json --incremental false
npm run build

# Mobile
cd mobile
npx tsc --noEmit -p tsconfig.json
npx expo-doctor
npx expo config --type public
```

Production build ในโฟลเดอร์ OneDrive อาจเกิด manifest race แบบเดิมของโปรเจกต์; ให้ตรวจ clean copy นอก OneDriveหรืออาศัย Vercel clean build


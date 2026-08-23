# FloorNow Worker

แอป Expo SDK 57 สำหรับช่าง Android และ iPhone ใช้ Background Location, ลิงก์หน้างาน + PIN, กล้อง, ลายเซ็นลูกค้า และ offline GPS outbox

## เริ่มพัฒนา

1. คัดลอก `.env.example` เป็น `.env.local` แล้วใส่ Supabase publishable key และ URL ของเว็บหลัก
2. ใช้ development build บนเครื่องจริง ไม่ใช้ Expo Go สำหรับ Background Location
3. ตรวจ config และ type ก่อน build

```powershell
npm install
npx tsc --noEmit -p tsconfig.json
npx expo-doctor
npx expo config --type public
```

จากนั้นล็อกอิน EAS และสร้าง build:

```powershell
npx eas-cli login
npx eas-cli build --profile preview --platform android
npx eas-cli build --profile preview --platform ios
```

ไฟล์ `.env.local`, signing keys และ service credentials ห้าม commit

ดู flow, security, environment และ test checklist เพิ่มเติมที่ `../BACKGROUND_GPS.md`

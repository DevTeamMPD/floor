# นโยบาย Build และ Deployment

เอกสารนี้เป็นข้อบังคับสำหรับ repository `floor` เพื่อควบคุมการใช้โควตา Vercel และลด deployment ที่ไม่จำเป็น

## หลักการบังคับ

1. ให้ตรวจงานบนเครื่องก่อนเสมอ โดยเลือกใช้ test, type-check, lint และ local production build ตามความเสี่ยงของงาน
2. สร้าง Vercel Preview เฉพาะเมื่อผลตรวจบนเครื่องผ่าน และต้องมีเหตุผลที่ต้องตรวจบน environment จริง
3. หนึ่งชุดการเปลี่ยนแปลงควรมี Preview เท่าที่จำเป็น ห้าม push commit ย่อยเพื่อใช้ Vercel เป็นที่ลองผิดลองถูก
4. รวมการแก้ไขที่เกี่ยวข้องและตรวจให้ครบก่อน push เพื่อลดจำนวน Build
5. ห้าม Redeploy หรือ Force Build หาก artifact เดิมยังใช้ตรวจสอบได้
6. ก่อน push ให้ตรวจว่า repository เชื่อม Auto Deploy เฉพาะ Vercel project ที่ตั้งใจให้ Build
7. Repository `DevTeamMPD/floor` ต้อง Auto Deploy ไปที่ project `floor` เท่านั้น ห้ามเชื่อม `floor-ocr`, `.work-shared-visibility` หรือ project ชั่วคราวกลับเข้ามาโดยไม่มีเหตุผลและการอนุมัติชัดเจน
8. Production ต้องมาจาก Git branch `main` ตามกระบวนการใน `AGENTS.md` ห้ามใช้ Preview เป็น Production หรือย้าย production alias เพื่อเลี่ยงโควตา
9. การ Build หรือ Deploy Production ทุกครั้งต้องได้รับอนุญาตแบบครั้งต่อครั้ง โดยระบุ project, environment, branch/commit และวิธี deploy
10. หากติดโควตา ให้หยุดและเลือกอย่างใดอย่างหนึ่ง: รอโควตารีเซ็ต, ลด Build ซ้ำ, หรืออัปเกรดแผน ห้ามสร้าง project/alias ชั่วคราวเพื่อหลบข้อจำกัด

## เกณฑ์ตัดสินใจก่อน Build

ให้ Build เมื่อมีอย่างน้อยหนึ่งเงื่อนไขต่อไปนี้:

- เปลี่ยน dependency, build configuration, framework configuration หรือ environment contract
- เปลี่ยน Server Component, API route, middleware หรือโค้ดที่ local test อย่างเดียวพิสูจน์ไม่ได้
- เตรียม Preview สำหรับผู้ใช้ตรวจรับ
- เตรียม Production release หลังผ่าน test และได้รับอนุญาตแล้ว

ไม่ต้อง Build ซ้ำเมื่อ:

- แก้เฉพาะเอกสารหรือ comment ที่ไม่กระทบ runtime
- commit ใหม่ไม่มีการเปลี่ยนแปลงต่อ output จาก Build ที่ผ่านแล้ว
- มี Preview จาก commit เดียวกันที่สถานะ `READY` และตรวจใช้งานได้อยู่
- ต้องการเพียงตรวจข้อมูล, log หรือสถานะระบบแบบ read-only

## Checklist ก่อน Push

- [ ] ตรวจ diff และยืนยันว่าไม่มีไฟล์อื่นปะปน
- [ ] test/type-check/lint/local build ผ่านตามความเหมาะสม
- [ ] ยืนยันว่า commit พร้อมตรวจจริง ไม่ใช่ commit ทดลอง
- [ ] ตรวจว่า Vercel จะ Build เฉพาะ project `floor`
- [ ] หาก branch เชื่อม Auto Deploy ให้ถือว่าการ push จะใช้โควตา Preview
- [ ] หากเป็น `main` หรือ Production ต้องมีคำอนุญาต deploy ครั้งนี้แล้ว

## Checklist หลัง Deploy

- [ ] ตรวจ project, environment, branch และ commit ให้ตรงกับที่อนุมัติ
- [ ] รอ deployment จนได้สถานะสุดท้าย
- [ ] ทำ smoke test เฉพาะเส้นทางสำคัญ
- [ ] ตรวจ runtime errors ตามระดับความเสี่ยง
- [ ] รายงาน URL, deployment ID, commit และผลตรวจ


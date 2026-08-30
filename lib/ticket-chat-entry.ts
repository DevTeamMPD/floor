/**
 * ทางเข้ากล่องแชทในตั๋ว และปลายทางของคำขอแก้ไข
 *
 * เดิมหน้า "ต้องตัดสินใจ" เขียนปุ่มสองแบบเป็นเงื่อนไขสลับกัน: งานที่มาจาก BBPS
 * จะได้ปุ่ม "ส่งกลับ BBPS" แทนที่ปุ่มเปิดแชท ผลคืองาน BBPS ซึ่งเป็นกลุ่มเดียว
 * ที่แชทวิ่งข้ามไปถึงอีกระบบ กลับเป็นกลุ่มเดียวที่กดเปิดแชทจากหน้านั้นไม่ได้เลย
 *
 * แยกการตัดสินใจออกมาไว้ที่นี่เพื่อให้เทสจับได้ถ้ามีใครทำให้แชทหายไปอีก
 */

export type JobSource = string | null | undefined;

export function isBbpsJob(source: JobSource): boolean {
  return source === "bbps";
}

/** ทุกงานต้องมีปุ่มเปิดแชทเสมอ ต่างกันแค่ป้ายว่าปลายทางคือใคร */
export function chatButtonLabel(source: JobSource): string {
  return isBbpsJob(source) ? "💬 แชทกับ BBPS" : "💬 ขอข้อมูลจากฝ่ายขาย";
}

export function chatDialogTitle(source: JobSource): string {
  return isBbpsJob(source) ? "แชทกับทีม BBPS" : "ขอข้อมูลจากฝ่ายขาย";
}

export function requestActionLabel(source: JobSource): string {
  return isBbpsJob(source) ? "ส่งคำขอให้ BBPS แก้ไข" : "ส่งคำขอให้ฝ่ายขายแก้ไข";
}

/** คำขอแก้ไขต้องย้อนกลับไปหาต้นทางของงาน ไม่ใช่ฝ่ายขายเสมอ */
export function requestTarget(source: JobSource): "bbps" | "direct" {
  return isBbpsJob(source) ? "bbps" : "direct";
}

/** ปุ่มลัด "ส่งกลับ BBPS" มีเฉพาะงาน BBPS — เป็นปุ่มเสริม ไม่ใช่ตัวแทนปุ่มแชท */
export function showsReturnToBbpsButton(source: JobSource): boolean {
  return isBbpsJob(source);
}

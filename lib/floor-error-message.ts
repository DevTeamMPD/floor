type ErrorShape = { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };

function rawError(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as ErrorShape;
    return [value.message, value.details, value.hint]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .map((part) => part.trim())
      .join(" · ");
  }
  return error instanceof Error ? error.message.trim() : "";
}

/** Converts common Supabase and Postgres failures into an actionable Thai message. */
export function floorErrorMessage(error: unknown, fallback = "ไม่ทราบสาเหตุ กรุณาลองใหม่ หรือติดต่อผู้ดูแลระบบ"): string {
  const message = rawError(error);
  const lower = message.toLowerCase();
  const code = error && typeof error === "object" ? (error as ErrorShape).code : undefined;
  // 23P01 = exclusion constraint กันคิวชนที่ฐานข้อมูล (appointments_no_overlap_per_team)
  // เป็นด่านสุดท้ายที่ทำงานแม้การเช็คฝั่งหน้าจอจะผ่านไปแล้ว เช่น สองคนกดบันทึกพร้อมกัน
  // ต้องบอกให้ชัดว่าชนคิว ไม่ใช่ตกไปที่ข้อความ "รูปแบบข้อมูลไม่ถูกต้อง"
  if (code === "23P01" || lower.includes("exclusion constraint")) {
    return "ทีมนี้มีคิวอยู่ในช่วงเวลาที่เลือกแล้ว อาจมีคนจองแทรกเข้ามาพอดี กรุณารีเฟรชแล้วเลือกเวลาหรือทีมอื่น";
  }
  if (!message) return fallback;
  if (lower.includes("row-level security") || lower.includes("permission denied")) return "บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้ กรุณาเข้าสู่ระบบใหม่ หรือติดต่อผู้ดูแลระบบ";
  if (lower.includes("jwt expired") || lower.includes("not authenticated")) return "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง";
  if (lower.includes("duplicate key") || lower.includes("unique constraint")) return "พบข้อมูลซ้ำในระบบ กรุณาตรวจเลขบิลหรือรายการเดิมก่อนบันทึก";
  if (lower.includes("violates not-null") || lower.includes("null value")) return "ข้อมูลสำคัญยังไม่ครบ กรุณาตรวจช่องที่มีเครื่องหมาย *";
  if (lower.includes("violates check constraint") || lower.includes("invalid input syntax")) return "รูปแบบข้อมูลไม่ถูกต้อง กรุณาตรวจจำนวน วันที่ และข้อมูลที่กรอก";
  if (lower.includes("network") || lower.includes("failed to fetch")) return "เชื่อมต่อระบบไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง";
  if (lower.includes("bucket not found") || lower.includes("storage")) return "อัปโหลดไฟล์ไม่สำเร็จ กรุณาลองเลือกรูปใหม่หรือติดต่อผู้ดูแลระบบ";
  return message;
}

export function floorActionError(action: string, error: unknown): string {
  return `${action}ไม่สำเร็จ: ${floorErrorMessage(error)}`;
}

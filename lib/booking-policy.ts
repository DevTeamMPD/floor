const HOLIDAY_BOOKING_PATTERN = /วันหยุด|หยุด|ลาพัก|ไม่รับงาน/;

export const UNRESTRICTED_BOOKING_EMAIL = "supakrit.k@mpdgroup.co";
export const UNRESTRICTED_HOLIDAY_BOOKING_EMAIL = "pisittorn.p@mpdgroup.co";

export interface HolidayBookingDraft {
  notes: string;
  bill_no: string;
  customer_name: string;
}

function normalizeEmail(email: string | null | undefined) {
  return (email ?? "").trim().toLowerCase();
}

export function isHolidayBooking(form: HolidayBookingDraft) {
  return HOLIDAY_BOOKING_PATTERN.test(form.notes) && !form.bill_no.trim() && !form.customer_name.trim();
}

export function enableHolidayBooking<T extends HolidayBookingDraft>(form: T): T {
  return { ...form, notes: "วันหยุด", bill_no: "", customer_name: "" };
}

export function hasUnrestrictedHolidayBookingPrivilege(email: string | null | undefined) {
  return normalizeEmail(email) === UNRESTRICTED_HOLIDAY_BOOKING_EMAIL;
}

export function canBypassBookingPolicy(email: string | null | undefined, form?: HolidayBookingDraft | null) {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail === UNRESTRICTED_BOOKING_EMAIL) return true;
  return Boolean(form && hasUnrestrictedHolidayBookingPrivilege(normalizedEmail) && isHolidayBooking(form));
}

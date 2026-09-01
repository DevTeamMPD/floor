import { describe, expect, it } from "vitest";
import {
  canBypassBookingPolicy,
  hasUnrestrictedHolidayBookingPrivilege,
  isHolidayBooking,
} from "./booking-policy";

const holiday = { notes: "วันหยุด", bill_no: "", customer_name: "" };

describe("booking policy", () => {
  it("allows Pisittorn to book holidays without the normal date limit", () => {
    expect(canBypassBookingPolicy("Pisittorn.P@mpdgroup.co", holiday)).toBe(true);
  });

  it("keeps normal jobs for Pisittorn under the standard rules", () => {
    expect(canBypassBookingPolicy("pisittorn.p@mpdgroup.co", { ...holiday, customer_name: "ลูกค้า" })).toBe(false);
  });

  it("does not treat a normal note as a holiday", () => {
    expect(isHolidayBooking({ ...holiday, notes: "เข้าติดตั้ง" })).toBe(false);
  });

  it("keeps the existing global exception for Supakrit", () => {
    expect(canBypassBookingPolicy("supakrit.k@mpdgroup.co", null)).toBe(true);
  });

  it("identifies only the configured holiday account", () => {
    expect(hasUnrestrictedHolidayBookingPrivilege("pisittorn.p@mpdgroup.co")).toBe(true);
    expect(hasUnrestrictedHolidayBookingPrivilege("staff@mpdgroup.co")).toBe(false);
  });
});

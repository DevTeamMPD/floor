import { describe, it, expect } from "vitest";
import {
  chatButtonLabel, chatDialogTitle, requestActionLabel, requestTarget,
  showsReturnToBbpsButton, isBbpsJob,
} from "./ticket-chat-entry";

const SOURCES = ["bbps", "sales_txn", "floor_direct", "manual", null, undefined];

describe("ทางเข้ากล่องแชทในตั๋ว", () => {
  it("ทุกแหล่งที่มาของงานต้องมีป้ายปุ่มเปิดแชท — ห้ามมีกรณีที่ไม่มีทางเข้า", () => {
    for (const source of SOURCES) {
      expect(chatButtonLabel(source)).toBeTruthy();
      expect(chatDialogTitle(source)).toBeTruthy();
    }
  });

  it("งาน BBPS ได้ป้ายที่บอกว่าคุยข้ามระบบ", () => {
    expect(chatButtonLabel("bbps")).toContain("BBPS");
    expect(chatDialogTitle("bbps")).toContain("BBPS");
  });

  it("งานอื่นยังเป็นการขอข้อมูลจากฝ่ายขายเหมือนเดิม", () => {
    for (const source of ["sales_txn", "floor_direct", null, undefined]) {
      expect(chatButtonLabel(source)).toContain("ฝ่ายขาย");
      expect(requestTarget(source)).toBe("direct");
    }
  });

  it("คำขอแก้ไขย้อนกลับไปหาต้นทางของงาน ไม่ใช่ฝ่ายขายเสมอ", () => {
    expect(requestTarget("bbps")).toBe("bbps");
    expect(requestActionLabel("bbps")).toContain("BBPS");
  });

  it("ปุ่มลัดส่งกลับ BBPS เป็นของงาน BBPS เท่านั้น และไม่ได้มาแทนปุ่มแชท", () => {
    expect(showsReturnToBbpsButton("bbps")).toBe(true);
    for (const source of ["sales_txn", "floor_direct", null, undefined]) {
      expect(showsReturnToBbpsButton(source)).toBe(false);
    }
    // จุดสำคัญ: มีปุ่มส่งกลับ ไม่ได้แปลว่าปุ่มแชทหายไป
    expect(showsReturnToBbpsButton("bbps") && Boolean(chatButtonLabel("bbps"))).toBe(true);
  });

  it("isBbpsJob รับเฉพาะค่าที่ตรงจริง", () => {
    expect(isBbpsJob("bbps")).toBe(true);
    expect(isBbpsJob("BBPS")).toBe(false);
    expect(isBbpsJob("bbps_legacy")).toBe(false);
  });
});

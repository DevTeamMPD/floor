import { describe, expect, it } from "vitest";
import { evaluateCsat } from "./policy";

describe("evaluateCsat", () => {
  it("opens an urgent case for one star", () => {
    expect(evaluateCsat(1)).toEqual({ action: "open_case", priority: "urgent", dueHours: 4 });
  });

  it("opens a high-priority case for two stars", () => {
    expect(evaluateCsat(2)).toEqual({ action: "open_case", priority: "high", dueHours: 24 });
  });

  it("keeps three stars in the CS follow-up flow", () => {
    expect(evaluateCsat(3).action).toBe("follow_up");
  });

  it("passes four, five, and missing scores without a case", () => {
    expect(evaluateCsat(4).action).toBe("pass");
    expect(evaluateCsat(5).action).toBe("pass");
    expect(evaluateCsat(null).action).toBe("pass");
  });
});

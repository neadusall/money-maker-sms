import { describe, it, expect } from "vitest";
import { isWithinSendWindow } from "../send-window";

function at(hour: number, minute: number = 0): Date {
  const d = new Date(2026, 4, 21, hour, minute, 0, 0);
  return d;
}

describe("isWithinSendWindow", () => {
  it("returns ok inside the window", () => {
    expect(isWithinSendWindow("09:00", "19:00", "UTC", at(12)).ok).toBe(true);
    expect(isWithinSendWindow("09:00", "19:00", "UTC", at(9, 0)).ok).toBe(true);
  });

  it("returns not ok before window start", () => {
    const r = isWithinSendWindow("09:00", "19:00", "UTC", at(7));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.openAt.getHours()).toBe(9);
  });

  it("returns not ok after window end", () => {
    const r = isWithinSendWindow("09:00", "19:00", "UTC", at(20));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.openAt.getDate()).toBe(22);
  });

  it("at end-time-minute is outside (exclusive end)", () => {
    expect(isWithinSendWindow("09:00", "19:00", "UTC", at(19, 0)).ok).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { normalizePhone, formatPhone } from "../phone";

describe("normalizePhone", () => {
  it("normalizes US 10-digit numbers to E.164", () => {
    expect(normalizePhone("4155552671")).toBe("+14155552671");
    expect(normalizePhone("(415) 555-2671")).toBe("+14155552671");
    expect(normalizePhone("415.555.2671")).toBe("+14155552671");
    expect(normalizePhone("415-555-2671")).toBe("+14155552671");
  });

  it("preserves already-E.164 numbers", () => {
    expect(normalizePhone("+14155552671")).toBe("+14155552671");
  });

  it("returns null for invalid input", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("not-a-phone")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
  });

  it("strips whitespace around input", () => {
    expect(normalizePhone("  +1 415 555 2671  ")).toBe("+14155552671");
  });
});

describe("formatPhone", () => {
  it("renders E.164 in national-friendly form", () => {
    expect(formatPhone("+14155552671")).toContain("415");
  });
});

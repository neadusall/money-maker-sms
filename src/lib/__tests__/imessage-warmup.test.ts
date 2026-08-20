import { afterEach, describe, expect, it, vi } from "vitest";

// The pure ramp math is what's under test; the DB-bound counting is exercised
// through the router in production and needs a live schema to mean anything.
vi.mock("@/db/client", () => ({ db: {} }));

import {
  warmupDailyCap,
  hourlyCap,
  IMESSAGE_HARD_DAILY_CEILING,
  IMESSAGE_HARD_HOURLY_CEILING,
} from "../imessage-warmup";

/**
 * The ramp is the compliance story for the personal Apple line: a fresh line
 * earns volume over ~3 weeks and NOTHING may exceed the hard-coded per-line
 * ceilings (Sendblue's published 50/day + 15/hour new-contact limits).
 */

describe("warmupDailyCap", () => {
  afterEach(() => {
    delete process.env.OSTEXT_IMESSAGE_WARMUP;
  });

  it("ramps a fresh line over three weeks to the ceiling", () => {
    expect(warmupDailyCap(1)).toBe(5);
    expect(warmupDailyCap(3)).toBe(5);
    expect(warmupDailyCap(4)).toBe(10);
    expect(warmupDailyCap(7)).toBe(10);
    expect(warmupDailyCap(8)).toBe(20);
    expect(warmupDailyCap(14)).toBe(20);
    expect(warmupDailyCap(15)).toBe(35);
    expect(warmupDailyCap(21)).toBe(35);
    expect(warmupDailyCap(22)).toBe(IMESSAGE_HARD_DAILY_CEILING);
    expect(warmupDailyCap(365)).toBe(IMESSAGE_HARD_DAILY_CEILING);
  });

  it("never exceeds the hard ceiling, even fully warm", () => {
    for (let day = 1; day <= 60; day++) {
      expect(warmupDailyCap(day)).toBeLessThanOrEqual(IMESSAGE_HARD_DAILY_CEILING);
    }
  });

  it("OSTEXT_IMESSAGE_WARMUP=off skips the ramp but not the ceiling", () => {
    process.env.OSTEXT_IMESSAGE_WARMUP = "off";
    expect(warmupDailyCap(1)).toBe(IMESSAGE_HARD_DAILY_CEILING);
  });
});

describe("hourlyCap", () => {
  it("scales to ~30% of the daily budget (Sendblue's 15-against-50 ratio)", () => {
    expect(hourlyCap(50)).toBe(15);
    expect(hourlyCap(35)).toBe(11);
    expect(hourlyCap(20)).toBe(6);
    expect(hourlyCap(10)).toBe(3);
  });

  it("keeps a floor of 2 so a cold line can still trickle", () => {
    expect(hourlyCap(5)).toBe(2);
    expect(hourlyCap(1)).toBe(2);
  });

  it("never exceeds the hard hourly ceiling regardless of input", () => {
    expect(hourlyCap(1000)).toBe(IMESSAGE_HARD_HOURLY_CEILING);
  });
});

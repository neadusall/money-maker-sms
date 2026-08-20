import { describe, expect, it } from "vitest";
import { allowanceForDay } from "../daily-cap";
import { laneOf } from "@/components/LaneBadge";
import type { Campaign } from "@/db/schema";

/**
 * The two pure decisions that protect a $100/mo line and keep the blue-vs-green comparison
 * honest: how much volume a given day is allowed, and what a message actually delivered as.
 */

const campaign = (over: Partial<Campaign>): Campaign =>
  ({ dailyCap: null, rampStart: null, rampStep: null, ...over }) as Campaign;

describe("allowanceForDay (warm-up ramp)", () => {
  it("opens cold and climbs to the cap", () => {
    const c = campaign({ dailyCap: 200, rampStart: 20, rampStep: 20 });
    expect(allowanceForDay(c, 0)).toBe(20); // day one
    expect(allowanceForDay(c, 1)).toBe(40);
    expect(allowanceForDay(c, 4)).toBe(100);
    expect(allowanceForDay(c, 9)).toBe(200); // day ten reaches full volume
  });

  it("never exceeds the cap once the ramp tops out", () => {
    const c = campaign({ dailyCap: 200, rampStart: 20, rampStep: 20 });
    expect(allowanceForDay(c, 30)).toBe(200);
    expect(allowanceForDay(c, 365)).toBe(200);
  });

  it("uses the cap directly when no ramp is configured", () => {
    // Only correct for an already-warm number, but it must not silently behave as a ramp.
    expect(allowanceForDay(campaign({ dailyCap: 200 }), 0)).toBe(200);
  });

  it("treats a missing cap as zero so callers must check `dailyCap` first", () => {
    expect(allowanceForDay(campaign({}), 0)).toBe(0);
  });

  it("clamps a negative day index rather than shrinking the allowance", () => {
    expect(allowanceForDay(campaign({ dailyCap: 200, rampStart: 20, rampStep: 20 }), -5)).toBe(20);
  });
});

describe("laneOf", () => {
  it("labels a Telnyx send as SMS", () => {
    expect(laneOf({ provider: "telnyx" })).toBe("sms");
  });

  it("labels a bridge send as iMessage", () => {
    // One column is enough BECAUSE we own the sender: the router only ever hands the Mac
    // handles it reports as iMessage-capable, so there is no silent SMS downgrade to
    // detect. A hosted iMessage API would need a second field here to stay honest.
    expect(laneOf({ provider: "imessage" })).toBe("imessage");
  });

  it("treats a row with no provider as legacy SMS", () => {
    // Every message written before the lane existed IS a Telnyx SMS; the column default
    // is what keeps years of history correctly labeled without a backfill.
    expect(laneOf({})).toBe("sms");
    expect(laneOf({ provider: null })).toBe("sms");
  });
});

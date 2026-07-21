import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * Pins the send-gate contract (user mandates 2026-07-20 + 2026-07-21) against
 * both sender paths. The queries are inline drizzle so this asserts the SOURCE,
 * same approach as the nightqueue guardrail-ordering checks in the parent repo:
 *
 *  KEEP (2026-07-20 fail-safe): no human-set send date & time = nothing sends;
 *  a future schedule waits; a non-active campaign never texts.
 *
 *  KEEP OUT (2026-07-21 standing approval): the created_at <= scheduledAt
 *  approval cutoff must NOT come back. A fired schedule on an active campaign
 *  covers late-pushed contacts (enrichment top-ups, Boost phones) too - they
 *  send hands-free with the campaign's existing setup. Re-adding the cutoff
 *  would silently strand every top-up again.
 */

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");

describe("standing approval send-gate contract", () => {
  const drains = read("drains.ts");
  const actions = read("actions.ts");

  it("runSendBatch keeps the fail-safe gates", () => {
    expect(drains).toMatch(/state:\s*"unscheduled"/);
    expect(drains).toMatch(/state:\s*"waiting_schedule"/);
    expect(drains).toMatch(/state:\s*"stopped"/);
  });

  it("runSendBatch has no created-at approval cutoff (standing approval)", () => {
    expect(drains).not.toMatch(/lte\(\s*contacts\.createdAt\s*,\s*campaign\.scheduledAt\s*\)/);
  });

  it("sendCampaignBatch keeps the fail-safe gate", () => {
    expect(actions).toMatch(/no send date & time due; refusing to send/);
  });

  it("sendCampaignBatch has no created-at approval cutoff (standing approval)", () => {
    expect(actions).not.toMatch(/lte\(\s*contacts\.createdAt\s*,\s*campaign\.scheduledAt\s*\)/);
  });
});

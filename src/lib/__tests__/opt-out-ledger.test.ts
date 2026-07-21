import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * Pins the opt-out ledger contract (stats audit 2026-07-21). Source tripwires,
 * same approach as standing-approval.test.ts:
 *
 *  KEEP: every stop path (STOP keyword, AI-classified stop, backlog triage)
 *  records the opt-out through recordOptOut, whose suppression write is an
 *  UPSERT to reason 'opted_out'. A plain insert with onConflictDoNothing
 *  always collides with the sender's earlier reason-'sent' row for the same
 *  (campaign, phone), so the opt-out silently never reaches the ledger - the
 *  KPI tab then reads 0 opt-outs and the import screen (reason='opted_out')
 *  stops filtering the number.
 *
 *  KEEP: with OSTEXT_RECONTACT_COOLDOWN_DAYS set, an aged 'opted_out' row must
 *  still block in the cross-campaign guard. Opt-out is a legal instruction,
 *  not a pacing rule.
 */

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");

describe("opt-out ledger contract", () => {
  const actions = read("actions.ts");
  const record = read("opt-out-record.ts");
  const backlog = read("classify-backlog.ts");
  const send = read("send.ts");

  it("recordOptOut upserts the suppression row (never onConflictDoNothing)", () => {
    expect(record).toMatch(/\.onConflictDoUpdate\(/);
    expect(record).not.toMatch(/\.onConflictDoNothing\(/);
    expect(record).toMatch(/reason:\s*"opted_out"/);
  });

  it("both live stop paths go through recordOptOut", () => {
    // STOP keyword path + AI-classified stop path in actions.ts.
    const calls = actions.match(/await recordOptOut\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    // Neither path writes suppressedNumbers directly anymore.
    expect(actions).not.toMatch(/insert\(suppressedNumbers\)[\s\S]{0,200}reason:\s*"opted_out"/);
  });

  it("backlog triage records stops through recordOptOut too", () => {
    expect(backlog).toMatch(/recordOptOut\(/);
  });

  it("the recontact cooldown never expires an opted_out suppression", () => {
    const guard = send.slice(send.indexOf("alreadyContactedElsewhere"));
    const cooldown = guard.slice(guard.indexOf("cooldownDays > 0"), guard.indexOf("const [prior]"));
    expect(cooldown).toMatch(/eq\(suppressedNumbers\.reason,\s*"opted_out"\)/);
  });

  it("kpi-stats counts opt-outs from the ledger reason the stop paths write", () => {
    const kpi = read("kpi-stats.ts");
    expect(kpi).toMatch(/reason = 'opted_out'/);
  });
});

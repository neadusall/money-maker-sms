import { afterEach, describe, expect, it } from "vitest";
import { alertRecipients, parseCellMap } from "../reply-alerts";

const ENV_KEYS = ["OSTEXT_ALERT_ALWAYS_CELL", "OSTEXT_ALERT_CELLS"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("parseCellMap", () => {
  it("parses email=cell pairs and normalizes numbers", () => {
    const map = parseCellMap("noah@lumesp.com=915.555.0100, Josh@Lumesp.com = +1 915 555 0101");
    expect(map["noah@lumesp.com"]).toBe("+19155550100");
    expect(map["josh@lumesp.com"]).toBe("+19155550101");
  });

  it("ignores malformed entries", () => {
    expect(parseCellMap("garbage,also-garbage=notaphone,=+19155550100")).toEqual({});
    expect(parseCellMap(undefined)).toEqual({});
  });
});

describe("alertRecipients", () => {
  it("defaults to the always-on cell when nothing is configured", () => {
    delete process.env.OSTEXT_ALERT_ALWAYS_CELL;
    delete process.env.OSTEXT_ALERT_CELLS;
    expect(alertRecipients(null)).toEqual(["+19153737987"]);
  });

  it("adds the campaign owner's mapped cell", () => {
    delete process.env.OSTEXT_ALERT_ALWAYS_CELL;
    process.env.OSTEXT_ALERT_CELLS = "noah@lumesp.com=+19155550100";
    expect(alertRecipients("Noah@lumesp.com")).toEqual(["+19153737987", "+19155550100"]);
  });

  it("dedupes when the owner's cell is the always-on cell", () => {
    process.env.OSTEXT_ALERT_ALWAYS_CELL = "+19155550100";
    process.env.OSTEXT_ALERT_CELLS = "noah@lumesp.com=+19155550100";
    expect(alertRecipients("noah@lumesp.com")).toEqual(["+19155550100"]);
  });

  it("can be switched off", () => {
    process.env.OSTEXT_ALERT_ALWAYS_CELL = "off";
    delete process.env.OSTEXT_ALERT_CELLS;
    expect(alertRecipients("nobody@lumesp.com")).toEqual([]);
  });
});

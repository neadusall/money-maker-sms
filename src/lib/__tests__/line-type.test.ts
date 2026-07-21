import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookupLineType } from "../telnyx";

/**
 * The validation drain deletes every non-mobile verdict, so the difference
 * between "Telnyx said unknown" (a verdict, deletable) and "Telnyx could not
 * be asked" (an outage, must throw so the contact is HELD) protects real cell
 * numbers from being dropped during a Telnyx blip.
 */

const okBody = (type: string) =>
  ({ ok: true, status: 200, json: async () => ({ data: { carrier: { type } } }) }) as Response;
const failStatus = (status: number) =>
  ({ ok: false, status, json: async () => ({}) }) as Response;

describe("lookupLineType", () => {
  beforeEach(() => {
    process.env.TELNYX_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TELNYX_API_KEY;
  });

  it("maps carrier types to verdicts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okBody("mobile")));
    expect(await lookupLineType("+15551230001")).toBe("mobile");
    vi.stubGlobal("fetch", vi.fn(async () => okBody("fixed line")));
    expect(await lookupLineType("+15551230002")).toBe("landline");
    vi.stubGlobal("fetch", vi.fn(async () => okBody("voip")));
    expect(await lookupLineType("+15551230003")).toBe("voip");
  });

  it("treats an unclassifiable answer as a verdict, not an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okBody("")));
    expect(await lookupLineType("+15551230004")).toBe("unknown");
  });

  it("treats a plain 4xx as Telnyx's answer for the number", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => failStatus(404)));
    expect(await lookupLineType("+15551230005")).toBe("unknown");
  });

  it("throws on persistent rate limiting so the contact is held, not deleted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => failStatus(429)));
    await expect(lookupLineType("+15551230006")).rejects.toThrow(/unavailable/);
  });

  it("throws on persistent network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    await expect(lookupLineType("+15551230007")).rejects.toThrow(/unavailable/);
  });

  it("recovers when the retry succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(failStatus(500))
      .mockResolvedValueOnce(okBody("mobile"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await lookupLineType("+15551230008")).toBe("mobile");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when no key is configured (drain guards this earlier)", async () => {
    delete process.env.TELNYX_API_KEY;
    await expect(lookupLineType("+15551230009")).rejects.toThrow(/TELNYX_API_KEY/);
  });
});

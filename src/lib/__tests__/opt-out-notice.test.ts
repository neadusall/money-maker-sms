import { describe, it, expect } from "vitest";
import { hasOptOut, withOptOut, OPT_OUT_LINE } from "../opt-out";

/**
 * The opt-out footer is a carrier requirement (AT&T's mnoMetadata for the live
 * 10DLC campaigns sets reqSubscriberOptout: true), so these tests pin the two
 * properties that make it trustworthy: it is ALWAYS added to a candidate-facing
 * body, and it is never added twice.
 */
describe("withOptOut", () => {
  it("appends the notice to a plain recruiting message", () => {
    const out = withOptOut("Hi Farah, this is Noah reaching out about a Senior Property Accountant role.");
    expect(out.endsWith(OPT_OUT_LINE)).toBe(true);
    expect(out).toContain("STOP");
  });

  it("appends to an empty body rather than sending a bare message", () => {
    expect(withOptOut("")).toContain(OPT_OUT_LINE);
  });

  it("is idempotent - running it twice adds one notice", () => {
    const once = withOptOut("Open to a quick text about it?");
    expect(withOptOut(once)).toBe(once);
    expect(once.match(/STOP/g)).toHaveLength(1);
  });

  it("trims trailing whitespace before appending", () => {
    expect(withOptOut("Hello there   \n\n")).toBe(`Hello there\n\n${OPT_OUT_LINE}`);
  });
});

describe("hasOptOut recognizes the phrasings carriers accept", () => {
  const already = [
    "Reply STOP to opt out.",
    "reply stop to opt-out",
    "Text STOP to unsubscribe",
    "Send STOP to cancel",
    "Txt STOP to end",
    "STOP to quit",
    "Questions? Reply HELP. Reply STOP to opt out.",
  ];
  for (const body of already) {
    it(`does not double up on: ${body}`, () => {
      expect(hasOptOut(body)).toBe(true);
      expect(withOptOut(body)).toBe(body);
    });
  }

  const needsOne = [
    "Hi Ariel, open to a quick chat about a tax role?",
    // "stop" as prose must NOT be mistaken for an opt-out instruction
    "Feel free to stop by the office any time this week.",
    "We had to stop the search, but a new one just opened.",
    // A HELP line alone is not an opt-out notice
    "Reply HELP for support.",
  ];
  for (const body of needsOne) {
    it(`still adds the notice to: ${body}`, () => {
      expect(hasOptOut(body)).toBe(false);
      expect(withOptOut(body).endsWith(OPT_OUT_LINE)).toBe(true);
    });
  }
});

import { describe, expect, it } from "vitest";
import { expandSpintax, variantCount, checkSpin, minVariantsFor } from "../spintax";
import { withOptOut, hasOptOut } from "../opt-out";

/**
 * Spintax is what stops 200 identical bodies a day from being fingerprinted by carriers,
 * so the properties that matter are: it actually varies, it varies DETERMINISTICALLY (a
 * retry must not deliver differently-worded second copy), and it never touches a merge
 * field or the opt-out footer.
 */

describe("expandSpintax", () => {
  it("picks a branch and removes the braces", () => {
    const out = expandSpintax("{Hi|Hey} there", "contact-1");
    expect(["Hi there", "Hey there"]).toContain(out);
  });

  it("is deterministic for the same seed", () => {
    // The retry guarantee: processContactSend re-renders from the contact id, so a network
    // blip followed by a resend must produce the byte-identical message.
    const a = expandSpintax("{Hi|Hey|Hello} {{firstName}}, {saw|noticed} this", "contact-42");
    const b = expandSpintax("{Hi|Hey|Hello} {{firstName}}, {saw|noticed} this", "contact-42");
    expect(a).toBe(b);
  });

  it("diverges across contacts", () => {
    const template = "{a|b|c|d}{w|x|y|z}";
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(expandSpintax(template, `contact-${i}`));
    // With 16 possible renderings over 200 contacts, a working spinner produces many
    // distinct bodies. A broken one (always first branch) would produce exactly 1.
    expect(seen.size).toBeGreaterThan(8);
  });

  it("leaves merge fields alone, including inside a chosen branch", () => {
    const out = expandSpintax("{Hi {{firstName}}|Hey {{firstName}}}, at {{company}}", "c1");
    expect(out).toContain("{{firstName}}");
    expect(out).toContain("{{company}}");
    expect(out).not.toContain("|");
  });

  it("handles nested groups", () => {
    const out = expandSpintax("{x {a|b} one|two} tail", "c1");
    expect(out).not.toContain("|");
    expect(["x a one tail", "x b one tail", "two tail"]).toContain(out);
  });

  it("picks independently across groups whose branches share low bits", () => {
    // Regression: raw FNV-1a's low bits depend only on the low bits of the input, so
    // "{a..h}" and "{1..8}" chose the SAME index every time and this template rendered 8
    // bodies instead of 64. On a 200/day line that is the whole diversity budget gone.
    const template = "{a|b|c|d|e|f|g|h}{1|2|3|4|5|6|7|8}";
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(expandSpintax(template, `contact-${i}`));
    expect(seen.size).toBe(64);
  });

  it("lets two identical groups in one template diverge", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(expandSpintax("{Hi|Hey} x {Hi|Hey}", `c${i}`));
    // All four combinations should appear, not just the two matched pairs.
    expect(seen.size).toBe(4);
  });

  it("returns the text unchanged when there is nothing to spin", () => {
    expect(expandSpintax("Hi {{firstName}}, plain text", "c1")).toBe("Hi {{firstName}}, plain text");
  });

  it("inserts a branch containing $ literally", () => {
    // slice-splice rather than String.replace: "$&" in a branch must not be treated as a
    // replacement pattern and duplicate the match.
    const out = expandSpintax("{$120k|$130k} base", "c1");
    expect(out).toMatch(/^\$1[23]0k base$/);
  });

  it("never varies or removes the opt-out footer", () => {
    // The footer is applied AFTER expansion at the send chokepoint, so no branch can reach
    // it. This asserts the composition the send path actually performs.
    const body = expandSpintax("{Hi|Hey} {{firstName}}, {a|b}", "c1");
    const final = withOptOut(body);
    expect(hasOptOut(final)).toBe(true);
    expect(final.endsWith("Reply STOP to opt out.")).toBe(true);
  });
});

describe("variantCount", () => {
  it("multiplies branch counts", () => {
    expect(variantCount("{a|b} {c|d|e}")).toBe(6);
  });

  it("counts 1 for a template with no spin", () => {
    expect(variantCount("plain {{firstName}}")).toBe(1);
  });

  it("ignores merge fields", () => {
    expect(variantCount("{a|b} {{firstName}}")).toBe(2);
  });
});

describe("checkSpin", () => {
  it("fails a template with too little diversity for the daily volume", () => {
    // Two renderings against 200 sends a day means ~100 identical copies of each. That is
    // the exact repetition carriers fingerprint.
    const c = checkSpin("{Hi|Hey} {{firstName}}", 200);
    expect(c.variants).toBe(2);
    expect(c.required).toBe(minVariantsFor(200));
    expect(c.ok).toBe(false);
  });

  it("passes a template that clears the floor", () => {
    const wide = "{a|b|c|d}{e|f|g|h}{i|j|k|l}{m|n|o|p}{q|r|s|t}{u|v|w|x}";
    expect(checkSpin(wide, 200).ok).toBe(true);
  });

  it("flags unbalanced braces before they ship to a candidate", () => {
    expect(checkSpin("{Hi|Hey {{firstName}}", 50).malformed).toBe(true);
    expect(checkSpin("{Hi|Hey} {{firstName}}", 50).malformed).toBe(false);
  });
});

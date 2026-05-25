import { describe, it, expect } from "vitest";
import { isStopKeyword, isHelpKeyword } from "../opt-out";

describe("isStopKeyword", () => {
  it.each([
    ["STOP", true],
    ["stop", true],
    ["Stop.", true],
    ["unsubscribe", true],
    ["Remove me", true],
    ["opt out", true],
    ["opt-out", true],
    ["cancel!", true],
    ["END", true],
    ["stop please remove me from this list", true],
    ["Possibly, send me details", false],
    ["No thanks", false],
    ["", false],
    ["   ", false],
    ["I will stop by tomorrow", false],
  ])("isStopKeyword(%j) === %s", (input, expected) => {
    expect(isStopKeyword(input)).toBe(expected);
  });
});

describe("isHelpKeyword", () => {
  it.each([
    ["HELP", true],
    ["help", true],
    ["info", true],
    ["help me", false],
    ["", false],
  ])("isHelpKeyword(%j) === %s", (input, expected) => {
    expect(isHelpKeyword(input)).toBe(expected);
  });
});

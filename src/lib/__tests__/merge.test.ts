import { describe, it, expect } from "vitest";
import { renderTemplate, findUnmergedTokens, extractTokens } from "../merge";
import type { Contact } from "@/db/schema";

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "c1",
    campaignId: "x",
    firstName: "Alex",
    lastName: "Doe",
    company: "Acme",
    jobTitle: "Engineer",
    phone: "+15555550123",
    email: "alex@acme.test",
    linkedinUrl: null,
    location: "NYC",
    customFields: { team: "platform" },
    status: "pending",
    optedOut: false,
    lastError: null,
    createdAt: new Date(),
    ...overrides,
  } as Contact;
}

describe("renderTemplate", () => {
  it("substitutes standard fields", () => {
    const out = renderTemplate("Hi {first_name}, role at {company}", contact());
    expect(out).toBe("Hi Alex, role at Acme");
  });

  it("substitutes custom field from customFields", () => {
    const out = renderTemplate("On the {team} team", contact());
    expect(out).toBe("On the platform team");
  });

  it("renders empty for missing fields without throwing", () => {
    const out = renderTemplate("Hello {first_name} {missing}", contact());
    expect(out).toBe("Hello Alex ");
  });

  it("is case-insensitive for standard tokens", () => {
    const out = renderTemplate("{First_Name} {COMPANY}", contact());
    expect(out).toBe("Alex Acme");
  });

  it("accepts both {x} and {{x}} forms", () => {
    expect(renderTemplate("{first_name} {{company}}", contact())).toBe("Alex Acme");
  });
});

describe("findUnmergedTokens", () => {
  it("flags missing standard and custom tokens", () => {
    const unmerged = findUnmergedTokens("{first_name} {nonexistent}", contact({ firstName: null }));
    expect(unmerged).toContain("first_name");
    expect(unmerged).toContain("nonexistent");
  });

  it("returns empty when all tokens resolve", () => {
    expect(findUnmergedTokens("{first_name}", contact())).toEqual([]);
  });
});

describe("extractTokens", () => {
  it("returns unique tokens in template", () => {
    const tokens = extractTokens("{first_name} {company} {first_name}");
    expect(tokens.sort()).toEqual(["company", "first_name"]);
  });
});

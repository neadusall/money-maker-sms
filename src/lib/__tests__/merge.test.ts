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

  // 2026-07-31 regression: {FirstName} resolved to nothing because lowercasing
  // gave "firstname" and the field map is keyed "first_name".
  it("ignores underscores as well as case in standard tokens", () => {
    expect(renderTemplate("{FirstName}", contact())).toBe("Alex");
    expect(renderTemplate("{firstname}", contact())).toBe("Alex");
    expect(renderTemplate("{lastName} {JobTitle}", contact())).toBe("Doe Engineer");
    expect(renderTemplate("{CompanyName}", contact())).toBe("Acme");
  });

  it("matches custom fields on the same loose key", () => {
    const c = contact({ customFields: { phone_source: "koldinfo" } as Contact["customFields"] });
    expect(renderTemplate("{PhoneSource}", c)).toBe("koldinfo");
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

  // The send path fails a contact on any unmerged token, so this shape decided
  // whether a whole campaign went out or died at 0 sent.
  it("does not flag CamelCase standard tokens that have a value", () => {
    expect(findUnmergedTokens("Hi {FirstName}, this is Noah", contact())).toEqual([]);
  });

  it("still flags a CamelCase token whose value is genuinely missing", () => {
    expect(findUnmergedTokens("{FirstName}", contact({ firstName: null }))).toEqual(["FirstName"]);
  });

  it("treats an empty-string field as missing, not as a merged blank", () => {
    expect(findUnmergedTokens("{first_name}", contact({ firstName: "" }))).toEqual(["first_name"]);
  });
});

describe("extractTokens", () => {
  it("returns unique tokens in template", () => {
    const tokens = extractTokens("{first_name} {company} {first_name}");
    expect(tokens.sort()).toEqual(["company", "first_name"]);
  });
});

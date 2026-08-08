import { describe, it, expect } from "vitest";
import {
  renderTemplate,
  findUnmergedTokens,
  extractTokens,
  canonicalizeTemplate,
  canonicalFieldFor,
  auditTemplate,
  describeAudit,
} from "../merge";
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

describe("canonicalizeTemplate", () => {
  it("rewrites the token that caused the Hill Valley outage", () => {
    expect(canonicalizeTemplate("Hi {FirstName}, this is Noah")).toBe("Hi {first_name}, this is Noah");
  });

  it("normalizes case and underscore variants to one stored form", () => {
    expect(canonicalizeTemplate("{firstname} {First_Name} {FIRSTNAME}")).toBe(
      "{first_name} {first_name} {first_name}",
    );
  });

  it("maps the words recruiters actually type onto real fields", () => {
    expect(canonicalizeTemplate("{name} at {employer}, {title}")).toBe(
      "{first_name} at {company}, {job_title}",
    );
  });

  it("corrects a single-character typo", () => {
    expect(canonicalizeTemplate("{frist_name}")).toBe("{first_name}");
  });

  it("leaves genuine custom columns alone", () => {
    expect(canonicalizeTemplate("On the {team} team, {req_id}")).toBe("On the {team} team, {req_id}");
  });

  it("preserves the brace style that was typed", () => {
    expect(canonicalizeTemplate("{{FirstName}} and {FirstName}")).toBe("{{first_name}} and {first_name}");
  });

  it("is idempotent", () => {
    const once = canonicalizeTemplate("Hi {FirstName} at {employer}");
    expect(canonicalizeTemplate(once)).toBe(once);
  });

  it("does not invent a field for something unrelated", () => {
    expect(canonicalFieldFor("compensation_band")).toBeNull();
  });
});

describe("auditTemplate", () => {
  it("reports the whole audience as blocked when a token resolves for nobody", () => {
    const people = [contact({ company: null }), contact({ company: null })];
    const audit = auditTemplate("Hi {first_name} at {company}", people);
    expect(audit.sendable).toBe(0);
    expect(audit.blocksEveryone).toBe(true);
    expect(audit.problems[0]).toMatchObject({ token: "company", missing: 2, knownField: true });
  });

  it("counts partial coverage without calling it a block", () => {
    const audit = auditTemplate("Hi {first_name} at {company}", [contact(), contact({ company: null })]);
    expect(audit.sendable).toBe(1);
    expect(audit.blocksEveryone).toBe(false);
  });

  it("is clean for a template every contact can take", () => {
    const audit = auditTemplate("Hi {first_name}", [contact(), contact()]);
    expect(audit.sendable).toBe(2);
    expect(audit.problems).toEqual([]);
    expect(describeAudit(audit)).toBeNull();
  });

  it("flags an unknown token as not-a-field rather than as missing data", () => {
    const audit = auditTemplate("Hi {salary_band}", [contact()]);
    expect(audit.problems[0].knownField).toBe(false);
    expect(describeAudit(audit)).toContain("isn't a field");
  });
});

describe("extractTokens", () => {
  it("returns unique tokens in template", () => {
    const tokens = extractTokens("{first_name} {company} {first_name}");
    expect(tokens.sort()).toEqual(["company", "first_name"]);
  });
});

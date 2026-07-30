import { describe, it, expect, afterEach } from "vitest";
import { viewerCanSeeCampaign, viewerOwnsCampaign, type Viewer } from "../tenant-core";

const recruiter = (over: Partial<Viewer> = {}): Viewer => ({
  tenant: "house",
  email: "noah@lumesp.com",
  name: "noah",
  isAdmin: false,
  ...over,
});

const camp = (over: Partial<{ tenant: string | null; recruiterEmail: string | null; recruiterName: string | null }> = {}) => ({
  tenant: "house",
  recruiterEmail: "noah@lumesp.com",
  recruiterName: "Noah",
  ...over,
});

/** Opt into the old private-per-recruiter board for one test. */
const withPrivateBoards = (fn: () => void) => {
  process.env.OSTEXT_PRIVATE_CAMPAIGNS = "1";
  try {
    fn();
  } finally {
    delete process.env.OSTEXT_PRIVATE_CAMPAIGNS;
  }
};

afterEach(() => {
  delete process.env.OSTEXT_PRIVATE_CAMPAIGNS;
});

describe("viewerCanSeeCampaign (shared board is the default)", () => {
  it("lets a recruiter see a campaign assigned to them", () => {
    expect(viewerCanSeeCampaign(recruiter(), camp())).toBe(true);
  });

  it("lets a recruiter see a TEAMMATE's campaign in the same workspace", () => {
    expect(viewerCanSeeCampaign(recruiter(), camp({ recruiterEmail: "ariel@lumesp.com", recruiterName: "Ariel" }))).toBe(true);
  });

  it("lets a recruiter see an unassigned campaign in their workspace", () => {
    expect(viewerCanSeeCampaign(recruiter(), camp({ recruiterEmail: null, recruiterName: null }))).toBe(true);
  });

  it("admins see every campaign in their tenant", () => {
    expect(viewerCanSeeCampaign(recruiter({ isAdmin: true }), camp({ recruiterEmail: "someoneelse@lumesp.com", recruiterName: "Someone" }))).toBe(true);
  });

  it("NEVER crosses the tenant wall, even for an admin", () => {
    expect(viewerCanSeeCampaign(recruiter({ isAdmin: true }), camp({ tenant: "acme" }))).toBe(false);
  });

  it("never crosses the tenant wall for a plain recruiter either", () => {
    expect(viewerCanSeeCampaign(recruiter(), camp({ tenant: "acme" }))).toBe(false);
  });

  it("treats a legacy NULL-tenant row as house", () => {
    expect(viewerCanSeeCampaign(recruiter({ tenant: "house" }), camp({ tenant: null }))).toBe(true);
    expect(viewerCanSeeCampaign(recruiter({ tenant: "lumesp.com" }), camp({ tenant: null }))).toBe(false);
  });
});

describe("viewerCanSeeCampaign with OSTEXT_PRIVATE_CAMPAIGNS=1", () => {
  it("hides a teammate's campaign from a non-admin recruiter", () => {
    withPrivateBoards(() => {
      expect(viewerCanSeeCampaign(recruiter(), camp({ recruiterEmail: "ariel@lumesp.com", recruiterName: "Ariel" }))).toBe(false);
    });
  });

  it("still shows a recruiter their own campaign", () => {
    withPrivateBoards(() => {
      expect(viewerCanSeeCampaign(recruiter(), camp())).toBe(true);
    });
  });

  it("still gives an admin the whole tenant", () => {
    withPrivateBoards(() => {
      expect(viewerCanSeeCampaign(recruiter({ isAdmin: true }), camp({ recruiterEmail: "someoneelse@lumesp.com" }))).toBe(true);
    });
  });

  it("hides an unassigned campaign from a non-admin recruiter", () => {
    withPrivateBoards(() => {
      expect(viewerCanSeeCampaign(recruiter(), camp({ recruiterEmail: null, recruiterName: null }))).toBe(false);
    });
  });
});

describe("viewerOwnsCampaign (the Mine filter)", () => {
  it("matches by email", () => {
    expect(viewerOwnsCampaign(recruiter(), camp())).toBe(true);
  });

  it("email match is case/space-insensitive", () => {
    expect(viewerOwnsCampaign(recruiter({ email: "noah@lumesp.com" }), camp({ recruiterEmail: "  Noah@Lumesp.com " }))).toBe(true);
  });

  it("a teammate's campaign is not mine", () => {
    expect(viewerOwnsCampaign(recruiter(), camp({ recruiterEmail: "ariel@lumesp.com", recruiterName: "Ariel" }))).toBe(false);
  });

  it("falls back to name match ONLY when the campaign has no email", () => {
    expect(viewerOwnsCampaign(recruiter({ email: null, name: "noah" }), camp({ recruiterEmail: null, recruiterName: "Noah" }))).toBe(true);
  });

  it("does NOT name-match when the campaign carries a (different) email", () => {
    // email present but not theirs -> the name coincidence must not claim it
    expect(viewerOwnsCampaign(recruiter({ email: "noah@lumesp.com", name: "noah" }), camp({ recruiterEmail: "other@lumesp.com", recruiterName: "Noah" }))).toBe(false);
  });

  it("an unassigned campaign belongs to nobody", () => {
    expect(viewerOwnsCampaign(recruiter(), camp({ recruiterEmail: null, recruiterName: null }))).toBe(false);
  });
});

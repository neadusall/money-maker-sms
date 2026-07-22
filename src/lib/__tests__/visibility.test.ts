import { describe, it, expect } from "vitest";
import { viewerCanSeeCampaign, type Viewer } from "../tenant-core";

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

describe("viewerCanSeeCampaign", () => {
  it("lets a recruiter see a campaign assigned to them by email", () => {
    expect(viewerCanSeeCampaign(recruiter(), camp())).toBe(true);
  });

  it("hides a teammate's campaign from a non-admin recruiter", () => {
    expect(viewerCanSeeCampaign(recruiter(), camp({ recruiterEmail: "ariel@lumesp.com", recruiterName: "Ariel" }))).toBe(false);
  });

  it("email match is case/space-insensitive", () => {
    expect(viewerCanSeeCampaign(recruiter({ email: "noah@lumesp.com" }), camp({ recruiterEmail: "  Noah@Lumesp.com " }))).toBe(true);
  });

  it("admins see every campaign in their tenant", () => {
    expect(viewerCanSeeCampaign(recruiter({ isAdmin: true }), camp({ recruiterEmail: "someoneelse@lumesp.com", recruiterName: "Someone" }))).toBe(true);
  });

  it("never crosses the tenant wall, even for an admin", () => {
    expect(viewerCanSeeCampaign(recruiter({ isAdmin: true }), camp({ tenant: "acme" }))).toBe(false);
  });

  it("falls back to name match ONLY when the campaign has no email", () => {
    expect(viewerCanSeeCampaign(recruiter({ email: null, name: "noah" }), camp({ recruiterEmail: null, recruiterName: "Noah" }))).toBe(true);
  });

  it("does NOT name-match when the campaign carries a (different) email", () => {
    // email present but not theirs -> the name coincidence must not leak it in
    expect(viewerCanSeeCampaign(recruiter({ email: "noah@lumesp.com", name: "noah" }), camp({ recruiterEmail: "other@lumesp.com", recruiterName: "Noah" }))).toBe(false);
  });

  it("an unassigned campaign is invisible to a non-admin recruiter", () => {
    expect(viewerCanSeeCampaign(recruiter(), camp({ recruiterEmail: null, recruiterName: null }))).toBe(false);
  });

  it("but an unassigned campaign is still visible to an admin", () => {
    expect(viewerCanSeeCampaign(recruiter({ isAdmin: true }), camp({ recruiterEmail: null, recruiterName: null }))).toBe(true);
  });
});

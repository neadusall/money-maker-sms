import { sql, type SQL } from "drizzle-orm";
import { campaigns } from "@/db/schema";

/**
 * Pure tenant + per-recruiter visibility predicates.
 *
 * This module deliberately imports NOTHING from next-auth or the db client, so
 * the visibility rules can be unit-tested in isolation (and reused from routes
 * without dragging the auth runtime in). The session-backed resolvers live in
 * ./tenant, which re-exports everything here.
 */

export const HOUSE_TENANT = "house";

/** Normalize a tenant label: NULL/blank (legacy) = house. */
export function normalizeTenant(t: string | null | undefined): string {
  const v = (t ?? "").trim().toLowerCase();
  return v || HOUSE_TENANT;
}

/** SQL predicate: this campaign row belongs to `tenant` (legacy NULL = house). */
export function campaignTenantIs(tenant: string): SQL {
  return sql`coalesce(nullif(trim(${campaigns.tenant}), ''), ${HOUSE_TENANT}) = ${tenant}`;
}

/** Row-level tenant check for an already-loaded row. */
export function tenantCanSee(tenant: string, rowTenant: string | null | undefined): boolean {
  return normalizeTenant(rowTenant) === tenant;
}

/**
 * Per-recruiter visibility on top of the tenant wall.
 *
 * The tenant wall keeps one customer's campaigns out of another's portal. This
 * second layer keeps one RECRUITER's campaigns out of a teammate's board inside
 * the SAME tenant: a regular recruiter sees only the campaigns assigned to them
 * (owner chip = their email), while a workspace ADMIN (owner) still sees the
 * whole tenant's portfolio. Admin is decided by email allowlist so it needs no
 * schema/role migration and no per-tenant config beyond one env line.
 */
function adminEmails(): Set<string> {
  const s = new Set<string>();
  // Operator floor: the house owner is ALWAYS an admin, so a missing/empty env
  // can never lock the operator out of their own portfolio view.
  s.add("neadusall@gmail.com");
  for (const e of (process.env.OSTEXT_ADMIN_EMAILS ?? "").split(",")) {
    const v = e.trim().toLowerCase();
    if (v) s.add(v);
  }
  return s;
}

/** True when this email is a workspace admin/owner (sees the whole tenant). */
export function isAdminEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  return !!e && adminEmails().has(e);
}

/** Who is looking: their tenant, identity (for owner matching), and whether
 *  they are an admin. One resolve per request, reused by every list + guard. */
export interface Viewer {
  tenant: string;
  email: string | null;
  name: string | null;
  isAdmin: boolean;
}

/**
 * SQL predicate for list views: which campaigns this viewer may see. Admins get
 * the whole tenant; a recruiter gets ONLY campaigns whose owner is them. The
 * match is by recruiter EMAIL (the reliable, unique key); a name match is a
 * narrow fallback used ONLY for campaigns that carry no email at all (legacy /
 * free-text owner). A recruiter with no assigned campaigns sees an empty board,
 * never the team's - the visibility half of "no two recruiters touch one list".
 */
export function campaignVisibleTo(v: Viewer): SQL {
  const tenantPred = campaignTenantIs(v.tenant);
  if (v.isAdmin) return tenantPred;
  const clauses: SQL[] = [];
  if (v.email) {
    clauses.push(sql`lower(trim(coalesce(${campaigns.recruiterEmail}, ''))) = ${v.email}`);
  }
  if (v.name) {
    clauses.push(sql`(coalesce(nullif(trim(${campaigns.recruiterEmail}), ''), '') = ''
      AND lower(trim(coalesce(${campaigns.recruiterName}, ''))) = ${v.name})`);
  }
  const own = clauses.length ? sql`(${sql.join(clauses, sql` OR `)})` : sql`false`;
  return sql`(${tenantPred}) AND ${own}`;
}

/** Row-level version of campaignVisibleTo for an already-loaded campaign. */
export function viewerCanSeeCampaign(
  v: Viewer,
  c: { tenant: string | null; recruiterEmail: string | null; recruiterName: string | null },
): boolean {
  if (normalizeTenant(c.tenant) !== v.tenant) return false;
  if (v.isAdmin) return true;
  const cEmail = (c.recruiterEmail ?? "").trim().toLowerCase();
  if (cEmail) return !!v.email && cEmail === v.email;
  const cName = (c.recruiterName ?? "").trim().toLowerCase();
  return !!cName && !!v.name && cName === v.name;
}

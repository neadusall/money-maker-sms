import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns, users } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
  HOUSE_TENANT,
  type Viewer,
  campaignVisibleTo,
  isAdminEmail,
  normalizeTenant,
  viewerCanSeeCampaign,
} from "./tenant-core";

/**
 * Tenant isolation for the shared engine.
 *
 * One engine container can serve more than one portal tenant (the operator's
 * house workspace plus any white-label customer the operator has granted OS
 * Text to, all same-origin under /ostext-app on their own domains). Before
 * tenants existed, every signed-in user saw every campaign - a house campaign
 * showed up inside a customer's portal. The tenant column is the wall:
 *
 *   - campaigns.tenant / campaign_templates.tenant: which tenant owns the row.
 *   - user.tenant: which tenant the signed-in person belongs to, stamped by the
 *     portal on every SSO entry (/api/enter?ws=...), so it heals itself each
 *     time they open OS Text.
 *
 * A SECOND wall sits on top: per-recruiter visibility (see tenant-core). Inside
 * one tenant, a non-admin recruiter sees only the campaigns assigned to them;
 * an admin/owner still sees the whole tenant. The pure predicates live in
 * ./tenant-core (unit-tested, auth-free) and are re-exported here so existing
 * `@/lib/tenant` imports keep working unchanged.
 *
 * LEGACY ROWS ARE HOUSE: a NULL/blank tenant means the row predates isolation
 * and is treated as the operator's ("house"). That is fail-closed in the
 * privacy direction - an untagged row can never appear in a customer's view.
 * A customer's own legacy rows are adopted into their tenant by owner-email
 * domain the first time their tenant shows up (SSO entry or push), so their
 * history follows them without any manual backfill.
 */

export {
  HOUSE_TENANT,
  normalizeTenant,
  campaignTenantIs,
  tenantCanSee,
  isAdminEmail,
  campaignVisibleTo,
  viewerCanSeeCampaign,
  type Viewer,
} from "./tenant-core";

/** The signed-in user's tenant (house when unstamped, e.g. legacy sessions). */
export async function sessionTenant(): Promise<string> {
  const session = await auth();
  const uid = session?.user?.id;
  if (!uid) return HOUSE_TENANT; // middleware already gates sign-in
  const [u] = await db.select({ tenant: users.tenant }).from(users).where(eq(users.id, uid));
  return normalizeTenant(u?.tenant);
}

/** Resolve who is looking: tenant + identity (for owner matching) + admin flag.
 *  One DB read per request; feeds campaignVisibleTo / viewerCanSeeCampaign. */
export async function sessionViewer(): Promise<Viewer> {
  const session = await auth();
  const uid = session?.user?.id;
  const email = ((session?.user?.email ?? "") as string).trim().toLowerCase() || null;
  const name = ((session?.user?.name ?? "") as string).trim().toLowerCase() || null;
  let tenant = HOUSE_TENANT;
  if (uid) {
    const [u] = await db.select({ tenant: users.tenant }).from(users).where(eq(users.id, uid));
    tenant = normalizeTenant(u?.tenant);
  }
  return { tenant, email, name, isAdmin: isAdminEmail(email) };
}

/** Load a campaign ONLY if the signed-in viewer may see it: same tenant AND
 *  (admin OR the campaign is assigned to them). The pages' drop-in replacement
 *  for `db.select().from(campaigns).where(id)`, so opening another recruiter's
 *  campaign by URL 404s just like it never existed. */
export async function tenantCampaign(id: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!campaign) return null;
  const viewer = await sessionViewer();
  return viewerCanSeeCampaign(viewer, campaign) ? campaign : null;
}

/** Guard for mutations: throws unless the viewer may see (own/admin) the campaign. */
export async function assertTenantCampaign(id: string) {
  const campaign = await tenantCampaign(id);
  if (!campaign) throw new Error("Campaign not found");
  return campaign;
}

/**
 * Self-healing adoption of legacy (pre-isolation) rows. When a non-house
 * tenant appears (a customer's SSO entry or push), every untagged campaign,
 * template, and user whose owner email is on that tenant's domain moves into
 * the tenant. Idempotent; only ever claims NULL-tenant rows, so it can never
 * steal a row already assigned to anyone (house rows get stamped 'house' at
 * creation from now on, and legacy house rows have gmail/house-domain owners).
 */
export async function adoptLegacyTenantRows(tenant: string, email: string | null | undefined): Promise<void> {
  if (normalizeTenant(tenant) === HOUSE_TENANT) return;
  const domain = (email ?? "").split("@")[1]?.trim().toLowerCase();
  if (!domain) return;
  await db.execute(sql`
    UPDATE campaigns SET tenant = ${tenant}
    WHERE (tenant IS NULL OR trim(tenant) = '')
      AND lower(split_part(coalesce(recruiter_email, ''), '@', 2)) = ${domain}`);
  await db.execute(sql`
    UPDATE campaign_templates SET tenant = ${tenant}
    WHERE (tenant IS NULL OR trim(tenant) = '')
      AND lower(split_part(coalesce(recruiter_email, ''), '@', 2)) = ${domain}`);
  await db.execute(sql`
    UPDATE "user" SET tenant = ${tenant}
    WHERE (tenant IS NULL OR trim(tenant) = '')
      AND lower(split_part(coalesce(email, ''), '@', 2)) = ${domain}`);
}

/**
 * Boot-time DDL (idempotent, called from instrumentation): adds the tenant
 * columns and re-scopes the template-name uniqueness per tenant, so a customer
 * saving a template named "Default" can never overwrite the house's "Default".
 */
export async function ensureTenantSchema(): Promise<void> {
  await db.execute(sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS tenant text`);
  await db.execute(sql`ALTER TABLE campaign_templates ADD COLUMN IF NOT EXISTS tenant text`);
  await db.execute(sql`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS tenant text`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS campaigns_tenant_idx ON campaigns (tenant)`);
  // The global unique(name) predates tenants; both historical constraint names
  // are dropped (raw-SQL installs used _key, drizzle-kit installs _unique).
  await db.execute(sql`ALTER TABLE campaign_templates DROP CONSTRAINT IF EXISTS campaign_templates_name_key`);
  await db.execute(sql`ALTER TABLE campaign_templates DROP CONSTRAINT IF EXISTS campaign_templates_name_unique`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS campaign_templates_tenant_name_uniq
    ON campaign_templates ((coalesce(nullif(trim(tenant), ''), 'house')), name)`);
}

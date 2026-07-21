import { eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns, users } from "@/db/schema";
import { auth } from "@/lib/auth";

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
 * LEGACY ROWS ARE HOUSE: a NULL/blank tenant means the row predates isolation
 * and is treated as the operator's ("house"). That is fail-closed in the
 * privacy direction - an untagged row can never appear in a customer's view.
 * A customer's own legacy rows are adopted into their tenant by owner-email
 * domain the first time their tenant shows up (SSO entry or push), so their
 * history follows them without any manual backfill.
 */

export const HOUSE_TENANT = "house";

/** Normalize a tenant label: NULL/blank (legacy) = house. */
export function normalizeTenant(t: string | null | undefined): string {
  const v = (t ?? "").trim().toLowerCase();
  return v || HOUSE_TENANT;
}

/** The signed-in user's tenant (house when unstamped, e.g. legacy sessions). */
export async function sessionTenant(): Promise<string> {
  const session = await auth();
  const uid = session?.user?.id;
  if (!uid) return HOUSE_TENANT; // middleware already gates sign-in
  const [u] = await db.select({ tenant: users.tenant }).from(users).where(eq(users.id, uid));
  return normalizeTenant(u?.tenant);
}

/** SQL predicate: this campaign row belongs to `tenant` (legacy NULL = house). */
export function campaignTenantIs(tenant: string): SQL {
  return sql`coalesce(nullif(trim(${campaigns.tenant}), ''), ${HOUSE_TENANT}) = ${tenant}`;
}

/** Row-level visibility check for an already-loaded row. */
export function tenantCanSee(tenant: string, rowTenant: string | null | undefined): boolean {
  return normalizeTenant(rowTenant) === tenant;
}

/** Load a campaign ONLY if the signed-in user's tenant may see it. The pages'
 *  drop-in replacement for `db.select().from(campaigns).where(id)`. */
export async function tenantCampaign(id: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!campaign) return null;
  const tenant = await sessionTenant();
  return tenantCanSee(tenant, campaign.tenant) ? campaign : null;
}

/** Guard for mutations: throws unless the campaign is in the caller's tenant. */
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

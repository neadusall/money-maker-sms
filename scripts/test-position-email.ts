import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { campaigns, contacts } from "../src/db/schema";
import {
  buildPositionEmail,
  sendPositionEmail,
  isPositionEmailConfigured,
} from "../src/lib/position-email";

/**
 * Usage:
 *   npx tsx scripts/test-position-email.ts                  # preview only (no send)
 *   npx tsx scripts/test-position-email.ts you@example.com  # actually send a test
 *
 * Uses the first campaign that has a position summary, and a representative
 * contact from it (falls back to a stub) to render the email.
 */
async function main() {
  const sendTo = process.argv[2] || null;

  const allCampaigns = await db.select().from(campaigns);
  const campaign = allCampaigns.find((c) => c.positionSummary?.trim());
  if (!campaign) {
    console.error("No campaign has a position summary — nothing to preview.");
    process.exit(1);
  }

  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.campaignId, campaign.id))
    .limit(1);

  const sample =
    contact ??
    ({
      firstName: "Ryan",
      lastName: null,
      company: null,
      jobTitle: null,
    } as never);

  const { subject, text, html } = buildPositionEmail(campaign, sample);

  console.log("Campaign:", campaign.name);
  console.log("From:", process.env.POSITION_EMAIL_FROM || process.env.POSITION_EMAIL_USER || "(not configured)");
  console.log("Subject:", subject);
  console.log("\n----- TEXT BODY -----\n");
  console.log(text);
  console.log("\n----- HTML LENGTH -----", html.length, "chars\n");

  if (!sendTo) {
    console.log("Preview only. Pass an email address as an argument to send a real test.");
    process.exit(0);
  }

  if (!isPositionEmailConfigured()) {
    console.error("POSITION_EMAIL_USER/PASS not set — cannot send. Add them to .env first.");
    process.exit(1);
  }

  console.log(`Sending test to ${sendTo} ...`);
  const result = await sendPositionEmail({ to: sendTo, subject, text, html });
  console.log("Result:", JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

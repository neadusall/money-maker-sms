import "dotenv/config";
import { db } from "../src/db/client";
import { campaigns, contacts } from "../src/db/schema";
import { eq, and } from "drizzle-orm";
import { renderTemplate, findUnmergedTokens } from "../src/lib/merge";

const CAMPAIGN_ID = "125efa88-fe0d-41ab-bbc1-cbdaec45e9da";
const PHONE = "+19153737987";

async function main() {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, CAMPAIGN_ID));
  if (!campaign) {
    console.error("Campaign not found");
    process.exit(1);
  }
  console.log(`Campaign: ${campaign.name}`);
  console.log(`Template: ${campaign.smsTemplate}`);

  const contact = {
    campaignId: CAMPAIGN_ID,
    firstName: "Ryan",
    lastName: "Nead",
    company: "Test Co",
    jobTitle: "Software Developer",
    phone: PHONE,
    email: null,
    linkedinUrl: null,
    location: "El Paso, TX",
    customFields: {},
    status: "pending" as const,
    optedOut: false,
    lastError: null,
  };

  // Verify the template will render cleanly for this contact
  const rendered = renderTemplate(campaign.smsTemplate, contact as never);
  const missing = findUnmergedTokens(campaign.smsTemplate, contact as never);
  console.log(`\nRendered preview: ${rendered}`);
  if (missing.length > 0) {
    console.log(`WARNING - unresolved merge tokens: ${missing.join(", ")} (send would be skipped)`);
  } else {
    console.log("All merge tokens resolve. Send will proceed.");
  }

  const inserted = await db
    .insert(contacts)
    .values(contact)
    .onConflictDoUpdate({
      target: [contacts.campaignId, contacts.phone],
      set: { status: "pending", optedOut: false, lastError: null },
    })
    .returning({ id: contacts.id, status: contacts.status });

  console.log(`\nInserted/updated contact:`, inserted);

  const pending = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.campaignId, CAMPAIGN_ID), eq(contacts.status, "pending")));
  console.log(`Pending contacts in campaign: ${pending.length}`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import "dotenv/config";
import { db } from "../src/db/client";
import { campaigns } from "../src/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, "d883a847-b8e8-4f1a-af61-fc2658e7a8a0"));
  console.log("TEMPLATE:", JSON.stringify(c?.smsTemplate));
  console.log("WINDOW:", c?.sendWindowStart, "-", c?.sendWindowEnd);
  console.log("STATUS:", c?.status, "MODE:", c?.llmMode);
  process.exit(0);
}
main();

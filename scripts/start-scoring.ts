import "dotenv/config";
import { Client } from "@upstash/qstash";
import { eq, isNull, and, sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { campaigns, contacts } from "../src/db/schema";

const BASE = process.env.PUBLIC_APP_URL || "https://money-maker.87.99.144.161.sslip.io";

async function main() {
  const camps = await db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns);
  const client = new Client({
    token: process.env.QSTASH_TOKEN!,
    ...(process.env.QSTASH_URL ? { baseUrl: process.env.QSTASH_URL } : {}),
  });
  for (const c of camps) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(contacts)
      .where(and(eq(contacts.campaignId, c.id), isNull(contacts.qualificationScore), eq(contacts.optedOut, false)));
    if (n > 0) {
      await client.publishJSON({ url: `${BASE}/api/qstash/score-drain`, body: { campaignId: c.id } });
      console.log(`Enqueued scoring for "${c.name}": ${n} unscored contacts`);
    } else {
      console.log(`"${c.name}": all scored`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

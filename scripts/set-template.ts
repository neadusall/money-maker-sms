import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";

const TEMPLATE =
  "Hi {first_name}, Ryan with Exc Search reaching out about a VP of Sales opportunity that looks aligned with your background. Open to a quick chat or to learn more?";

async function main() {
  // Show current template(s) first.
  const before = await db.execute(sql`SELECT id, name, sms_template FROM campaigns`);
  for (const c of before.rows as { name: string; sms_template: string }[]) {
    console.log(`BEFORE [${c.name}]: ${c.sms_template}`);
  }
  const res = await db.execute(
    sql`UPDATE campaigns SET sms_template = ${TEMPLATE}, updated_at = now() WHERE name ILIKE '%VP of Sales%'`,
  );
  console.log(`\nupdated ${res.rowCount ?? "?"} campaign(s)`);
  console.log(`AFTER: ${TEMPLATE}`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

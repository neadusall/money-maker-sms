import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  // Anyone who actually replied (their conversation has an inbound) but isn't
  // opted-out and got downgraded to delivered/sent → restore 'replied'.
  const r = await db.execute(sql`
    UPDATE contacts c SET status='replied'
    WHERE c.opted_out=false AND c.status IN ('delivered','sent')
      AND EXISTS (SELECT 1 FROM conversations cv JOIN messages m ON m.conversation_id=cv.id
                  WHERE cv.contact_id=c.id AND m.direction='inbound')`);
  console.log(`restored 'replied' on ${r.rowCount ?? 0} contacts`);
  const chk = await db.execute(sql`SELECT count(*) filter (where status='replied')::int replied FROM contacts`);
  console.log("contacts now status='replied':", (chk.rows[0] as any).replied);
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});

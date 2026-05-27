import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  const r = await db.execute(sql`UPDATE campaigns SET status='paused', updated_at=now() WHERE status='active' RETURNING name`);
  console.log(`paused ${r.rowCount ?? 0} campaign(s):`, (r.rows as any[]).map(x=>x.name).join(", "));
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});

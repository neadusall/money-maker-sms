import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  const m = await db.execute(sql`UPDATE campaigns SET llm_mode='manual', status='paused', updated_at=now() RETURNING name`);
  console.log(`set ${m.rowCount ?? 0} campaign(s) to manual + paused`);
  const s = await db.execute(sql`UPDATE scheduled_messages SET status='canceled' WHERE status='pending' RETURNING id`);
  console.log(`cancelled ${s.rowCount ?? 0} pending scheduled replies`);
  // how many scheduled replies were pending (the backlog driving the loop)
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});

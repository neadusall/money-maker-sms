import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  const r = await db.execute(sql`
    SELECT
      count(*)::int total_convos,
      count(*) filter (where exists (select 1 from messages m where m.conversation_id=c.id and m.direction='inbound'))::int with_reply,
      count(*) filter (where status='needs_attention')::int needs_attention,
      count(*) filter (where status='active')::int active,
      count(*) filter (where status='opted_out')::int opted_out,
      count(*) filter (where status='closed')::int closed
    FROM conversations c`);
  console.log(r.rows[0]);
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});

import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
async function main() {
  const [c] = (await db.execute(sql`SELECT id FROM campaigns LIMIT 1`)).rows as any[];
  const id = c.id;
  for (const q of ["OTE", "Oracle", "tomorrow"]) {
    const like = "%" + q + "%";
    const rows = await db.execute(sql`
      SELECT DISTINCT ON (cv.id) cv.id, ct.first_name, mm.body match_body
      FROM conversations cv JOIN contacts ct ON ct.id=cv.contact_id
      LEFT JOIN LATERAL (SELECT body, created_at FROM messages m WHERE m.conversation_id=cv.id AND m.body ILIKE ${like} ORDER BY m.created_at DESC LIMIT 1) mm ON true
      WHERE cv.campaign_id=${id} AND (mm.body IS NOT NULL OR ct.first_name ILIKE ${like} OR ct.last_name ILIKE ${like} OR ct.company ILIKE ${like} OR ct.phone ILIKE ${like})
      ORDER BY cv.id, mm.created_at DESC NULLS LAST LIMIT 200`);
    console.log(`"${q}" -> ${rows.rows.length} matches; sample:`, (rows.rows[0] as any)?.match_body?.slice(0,50) ?? (rows.rows[0] as any)?.first_name ?? "—");
  }
  process.exit(0);
}
main().catch((e)=>{console.error("ERR:", e.message);process.exit(1);});

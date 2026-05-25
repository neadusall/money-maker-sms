import "dotenv/config"; import { sql } from "drizzle-orm"; import { db } from "../src/db/client";
async function main(){
  const CID="ad981e17-ee13-489e-8ad3-ff6534d660d2";
  const c=await db.execute(sql`SELECT count(*)::int total, count(*) FILTER (WHERE opted_out=false)::int active, count(*) FILTER (WHERE status='pending')::int pending FROM contacts WHERE campaign_id=${CID}`);
  console.log("CONTACTS:", JSON.stringify(((c as {rows?:unknown[]}).rows??[])[0]));
  const cam=await db.execute(sql`SELECT min_score_to_send, target_region FROM campaigns WHERE id=${CID}`);
  console.log("CAMPAIGN FILTERS:", JSON.stringify(((cam as {rows?:unknown[]}).rows??[])[0]));
  const conv=await db.execute(sql`SELECT count(*)::int convos, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=conversations.id AND m.direction='inbound'))::int with_reply FROM conversations WHERE campaign_id=${CID}`);
  console.log("CONVERSATIONS:", JSON.stringify(((conv as {rows?:unknown[]}).rows??[])[0]));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

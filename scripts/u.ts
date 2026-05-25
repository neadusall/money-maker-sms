import "dotenv/config"; import { sql } from "drizzle-orm"; import { db } from "../src/db/client";
async function main(){const r=await db.execute(sql`SELECT count(*)::int n, coalesce(sum(cost_usd),0)::float cost FROM usage_events`);console.log(JSON.stringify(((r as {rows?:unknown[]}).rows??[])[0]));process.exit(0);}
main().catch(e=>{console.error(e);process.exit(1);});

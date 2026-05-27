import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
const OPT_OUT_LEN = 24, SMS_OUT = 0.0079;
const OUTBOUND_SEGMENTS = sql`CASE WHEN char_length(body) + ${OPT_OUT_LEN} <= 160 THEN 1 ELSE ceil((char_length(body) + ${OPT_OUT_LEN})::numeric / 153) END`;
async function main() {
  const r = await db.execute(sql`
    SELECT count(*) FILTER (WHERE direction='outbound')::int outb,
           coalesce(sum(${OUTBOUND_SEGMENTS}) FILTER (WHERE direction='outbound'),0)::int outb_seg
    FROM messages`);
  const row = (r as unknown as { rows: Record<string, unknown>[] }).rows[0];
  const outb = Number(row.outb), seg = Number(row.outb_seg);
  console.log(`outbound msgs=${outb} segments=${seg}  -> per-msg $${(outb*SMS_OUT).toFixed(2)} vs per-seg $${(seg*SMS_OUT).toFixed(2)}`);
  process.exit(0);
}
main().catch((e) => { console.error("SQL ERROR:", e.message); process.exit(1); });

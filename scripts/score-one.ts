import "dotenv/config";
import { anthropic } from "../src/lib/anthropic";

async function main() {
  console.log("KEY set:", Boolean(process.env.ANTHROPIC_API_KEY), "len:", (process.env.ANTHROPIC_API_KEY||"").length);
  for (const model of ["claude-sonnet-4-6", "claude-opus-4-7"]) {
    try {
      const r = await anthropic().messages.create({
        model,
        max_tokens: 50,
        messages: [{ role: "user", content: 'Reply with JSON only: {"score": 72, "reason": "test"}' }],
      });
      const t = r.content.filter((b:any)=>b.type==="text").map((b:any)=>b.text).join("");
      console.log(`OK ${model}:`, t.slice(0,80), "| usage", JSON.stringify(r.usage));
    } catch (e:any) {
      console.log(`FAIL ${model}:`, e?.status, e?.name, "-", (e?.message||String(e)).slice(0,300));
    }
  }
  process.exit(0);
}
main().catch((e)=>{console.error("outer",e);process.exit(1);});

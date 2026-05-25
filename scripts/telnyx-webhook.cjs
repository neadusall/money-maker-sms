const fs = require("fs");
const dotenv = require("dotenv");
const env = dotenv.parse(fs.readFileSync(".env"));
const KEY = env.TELNYX_API_KEY;
const PROFILE = env.TELNYX_MESSAGING_PROFILE_ID;
const URL = "https://money-maker.87.99.144.161.sslip.io/api/webhooks/telnyx";

(async () => {
  if (!KEY || !PROFILE) {
    console.log("Missing TELNYX_API_KEY or TELNYX_MESSAGING_PROFILE_ID");
    process.exit(1);
  }
  const base = `https://api.telnyx.com/v2/messaging_profiles/${PROFILE}`;
  const g = await (await fetch(base, { headers: { Authorization: `Bearer ${KEY}` } })).json();
  console.log("current webhook_url:", g.data?.webhook_url);
  const p = await (
    await fetch(base, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ webhook_url: URL, webhook_api_version: "2" }),
    })
  ).json();
  console.log("new webhook_url:", p.data ? p.data.webhook_url : JSON.stringify(p).slice(0, 300));
})();

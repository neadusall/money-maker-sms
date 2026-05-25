const fs = require("fs");
const dotenv = require("dotenv");

const APP = "ganonk1bhfmvfw3n1offeb65";
const CB = "http://87.99.144.161:8000/api/v1";
const CT = fs.readFileSync(process.env.HOME + "/.coolify_token", "utf8").trim();
const HOST = "https://money-maker.87.99.144.161.sslip.io";

const parsed = dotenv.parse(fs.readFileSync(".env"));
// Point the app at its new public URL; trust the proxy host for Auth.js.
parsed.AUTH_URL = HOST;
parsed.PUBLIC_APP_URL = HOST;
parsed.AUTH_TRUST_HOST = "true";
delete parsed.VERCEL_URL;

const data = Object.entries(parsed).map(([key, value]) => ({
  key,
  value,
  is_preview: false,
  is_build_time: false,
}));

(async () => {
  // Set the public domain (Traefik routing + Let's Encrypt TLS).
  const dom = await fetch(`${CB}/applications/${APP}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${CT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ domains: HOST }),
  });
  console.log("set domain:", dom.status);

  const res = await fetch(`${CB}/applications/${APP}/envs/bulk`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${CT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  });
  console.log("bulk env status:", res.status, (await res.text()).slice(0, 200));
  console.log("keys pushed:", Object.keys(parsed).join(", "));
})();

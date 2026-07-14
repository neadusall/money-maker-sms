import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, sessions } from "@/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Instant-access link. Visiting /api/enter?token=ACCESS_TOKEN signs you in (as
 * the configured access email) by creating a real Auth.js database session and
 * setting the session cookie — so you can open the app in any browser with one
 * click, no magic-link email. The token is an unguessable shared secret.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const expected = process.env.ACCESS_TOKEN;

  if (!expected) {
    return NextResponse.json({ error: "ACCESS_TOKEN not configured" }, { status: 500 });
  }
  if (!token || token !== expected) {
    return NextResponse.json({ error: "invalid or missing token" }, { status: 403 });
  }

  const email = (process.env.ACCESS_EMAIL || (process.env.ALLOWED_EMAILS ?? "").split(",")[0] || "")
    .trim()
    .toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "no access email configured" }, { status: 500 });
  }

  // Get or create the user this link signs in as.
  let [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) {
    [user] = await db
      .insert(users)
      .values({ email, name: email.split("@")[0], emailVerified: new Date() })
      .returning();
  }

  // Create a long-lived database session and set the Auth.js session cookie.
  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + ONE_YEAR_MS);
  await db.insert(sessions).values({ sessionToken, userId: user.id, expires });

  const secure = (process.env.AUTH_URL ?? "").startsWith("https");
  const cookieName = secure ? "__Secure-authjs.session-token" : "authjs.session-token";
  const jar = await cookies();
  jar.set(cookieName, sessionToken, {
    httpOnly: true,
    secure,
    // SameSite=None (+ Partitioned for Chrome's third-party-cookie rules): the
    // portal embeds this app in an iframe, and on a white-label portal domain
    // (e.g. app.lumesp.com) that iframe is CROSS-SITE. A Lax cookie is never
    // sent there, so the SSO sign-in silently fails and users see the email
    // login form instead. None requires Secure, so keep Lax on plain-http dev.
    sameSite: secure ? "none" : "lax",
    ...(secure ? { partitioned: true } : {}),
    path: "/",
    expires,
  });

  const dest = process.env.AUTH_URL || new URL("/", req.url).toString();
  return NextResponse.redirect(dest);
}

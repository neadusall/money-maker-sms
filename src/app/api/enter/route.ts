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

  // Served same-origin under the portal's domain (basePath /ostext-app), so
  // the iframe embed is first-party everywhere and Lax is right on any host.
  const proto = req.headers.get("x-forwarded-proto") ?? "";
  const secure = proto === "https" || (process.env.AUTH_URL ?? "").startsWith("https");
  const cookieName = secure ? "__Secure-authjs.session-token" : "authjs.session-token";
  const jar = await cookies();
  jar.set(cookieName, sessionToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires,
  });

  // Land in the app ON THE SAME HOST the user entered from (recruitersos.co or
  // a white-label domain), forwarding the portal's theme + accent so the UI
  // paints in the matching skin immediately.
  const dest = new URL("/ostext-app/", req.url);
  const theme = url.searchParams.get("theme");
  const accent = url.searchParams.get("accent");
  if (theme === "dark" || theme === "light") dest.searchParams.set("theme", theme);
  if (accent && /^#[0-9a-fA-F]{3,8}$/.test(accent)) dest.searchParams.set("accent", accent);
  return NextResponse.redirect(dest);
}

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/verify-request", "/api/auth", "/api/webhooks", "/api/qstash", "/api/enter"];

// Must mirror next.config.ts basePath. The auth()-wrapped request reaches this
// proxy with the basePath still on nextUrl.pathname (observed in production:
// the login bounce carried callbackUrl=/ostext-app/api/enter), so match against
// the stripped path or every PUBLIC_PATH silently stops matching — which broke
// the /api/enter instant-access entry and showed the login form instead.
const BASE = "/ostext-app";

export default auth((req) => {
  const raw = req.nextUrl.pathname;
  const pathname = raw.startsWith(BASE) ? raw.slice(BASE.length) || "/" : raw;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  if (!req.auth) {
    // Build the login URL on the HOST THE REQUEST CAME IN ON. The app is served
    // same-origin under every portal domain (house and white-label); deriving
    // the redirect from AUTH_URL/nextUrl sent white-label visitors to the house
    // taltxt subdomain, leaking a URL they should never see.
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host;
    const proto = req.headers.get("x-forwarded-proto") || "https";
    const login = new URL(proto + "://" + host + BASE + "/login");
    login.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

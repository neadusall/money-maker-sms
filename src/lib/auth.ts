import NextAuth from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/db/client";

function allowedEmails(): Set<string> {
  return new Set(
    (process.env.ALLOWED_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

// OS Text is embedded in an iframe inside the RecruitersOS portal. On
// recruitersos.co that iframe is same-site with taltxt.recruitersos.co, so a
// SameSite=Lax cookie works. But the portal is also served on OTHER registrable
// domains (app.lumesp.com and every white-label custom domain), where the
// iframe is CROSS-site — a Lax cookie is dropped and the user sees a login
// screen inside the frame. SameSite=None; Secure lets the session cookie ride
// in a cross-site iframe from any portal domain. Only valid over HTTPS, so we
// fall back to Lax in local http dev.
const useSecureCookies = (process.env.AUTH_URL ?? "").startsWith("https");
export const SESSION_COOKIE = {
  name: useSecureCookies ? "__Secure-authjs.session-token" : "authjs.session-token",
  secure: useSecureCookies,
  sameSite: (useSecureCookies ? "none" : "lax") as "none" | "lax",
};

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: DrizzleAdapter(db),
  trustHost: true,
  // Long-lived database sessions so the instant-access link (and normal logins)
  // keep you signed in for a year without re-authenticating.
  session: { strategy: "database", maxAge: 60 * 60 * 24 * 365, updateAge: 60 * 60 * 24 },
  // Keep Auth.js in lock-step with the instant-access link (/api/enter): both
  // must write the SAME cookie name + SameSite, or a session-rotation on the
  // updateAge boundary would silently downgrade it back to Lax and re-break the
  // cross-site iframe embed.
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE.name,
      options: {
        httpOnly: true,
        sameSite: SESSION_COOKIE.sameSite,
        path: "/",
        secure: SESSION_COOKIE.secure,
      },
    },
  },
  providers: [
    Nodemailer({
      server: {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      },
      from: process.env.SMTP_FROM,
    }),
  ],
  pages: {
    signIn: "/login",
    verifyRequest: "/verify-request",
  },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      const allowed = allowedEmails();
      if (allowed.size === 0) {
        console.warn("[auth] ALLOWED_EMAILS is empty; denying sign-in. Set ALLOWED_EMAILS in .env.");
        return false;
      }
      return allowed.has(user.email.toLowerCase());
    },
    session({ session, user }) {
      if (user?.id) session.user.id = user.id;
      return session;
    },
  },
});

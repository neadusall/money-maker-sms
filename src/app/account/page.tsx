import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { ProfileImageUploader } from "@/components/ProfileImageUploader";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [user] = await db.select().from(users).where(eq(users.id, session.user.id));
  const email = user?.email ?? session.user.email ?? "";
  const image = user?.image ?? null;

  return (
    <section className="mx-auto max-w-2xl">
      <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-700">
        ← Back
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Account</h1>
      <p className="mt-1 text-sm text-zinc-600">Your profile photo and sign-in details.</p>

      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-zinc-900">Profile photo</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Shown as your avatar in the top-right menu.
        </p>
        <div className="mt-4">
          <ProfileImageUploader email={email} initialImage={image} />
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-zinc-900">Sign-in email</h2>
        <p className="mt-1 text-sm text-zinc-700">{email}</p>
        <p className="mt-2 text-xs text-zinc-500">
          Access is limited to approved emails. To add a teammate, the operator updates the
          allowlist.
        </p>
      </div>
    </section>
  );
}

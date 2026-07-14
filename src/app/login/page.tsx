import { signIn } from "@/lib/auth";
import { Logo } from "@/components/Logo";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center">
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="flex justify-center">
          <Logo />
        </div>
        <h1 className="mt-6 text-center text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-center text-sm text-zinc-600">
          Enter your email and we&apos;ll send you a secure sign-in link.
        </p>

        {error ? (
          <div className="mt-4 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
            {decodeURIComponent(error)}
          </div>
        ) : null}

        <form
          className="mt-6 grid gap-3"
          action={async (formData) => {
            "use server";
            await signIn("nodemailer", {
              email: formData.get("email"),
              redirectTo: callbackUrl || "/",
            });
          }}
        >
          <input
            type="email"
            name="email"
            required
            autoFocus
            placeholder="you@example.com"
            className="rounded-lg border border-zinc-300 px-3.5 py-2.5 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
          />
          <button
            type="submit"
            className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand/90"
          >
            Email me a sign-in link
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-zinc-400">
          Access is limited to approved team members.
        </p>
      </div>
    </div>
  );
}

export default function VerifyRequestPage() {
  return (
    <div className="mx-auto mt-20 max-w-sm text-center">
      <h1 className="text-2xl font-semibold">Check your email</h1>
      <p className="mt-2 text-sm text-zinc-600">
        We sent you a sign-in link. Open it from the same browser to continue. The link is valid for 24 hours.
      </p>
      <p className="mt-4 text-xs text-zinc-500">
        Didn&apos;t arrive? Check spam, or confirm your email is in <code>ALLOWED_EMAILS</code>.
      </p>
    </div>
  );
}

import { simulateInbound } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function InboxIndex({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const simulate = simulateInbound.bind(null, id);

  return (
    <div className="flex h-full flex-col items-center justify-center bg-zinc-50/40 p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 text-zinc-400">
          <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.068.157 2.148.279 3.238.364.466.037.893.281 1.153.671L12 21l2.652-3.978c.26-.39.687-.634 1.153-.67 1.09-.086 2.17-.208 3.238-.365 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
          </svg>
        </div>
        <h1 className="mt-4 text-lg font-semibold">No conversation selected</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Pick a conversation from the list to view the thread.
        </p>

        <details className="mt-8 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-left">
          <summary className="cursor-pointer font-medium text-amber-900">
            Dev: simulate inbound reply
          </summary>
          <form action={simulate} className="mt-3 grid gap-3">
            <input
              name="fromPhone"
              placeholder="+15555550123"
              required
              className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm"
            />
            <input
              name="body"
              placeholder="Possibly, send me details."
              required
              className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm"
            />
            <button className="rounded-md bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800">
              Simulate inbound
            </button>
          </form>
        </details>
      </div>
    </div>
  );
}

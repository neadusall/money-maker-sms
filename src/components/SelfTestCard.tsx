"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Sender = { recruiter: string; fromNumber: string };

type Status = {
  sent: boolean;
  outboundStatus: string | null;
  delivered: boolean;
  failed: boolean;
  error: string | null;
  replyReceived: boolean;
  replyBody: string | null;
  replyAt: string | null;
};

type Run =
  | { ok: true; conversationId: string; telnyxId: string; to: string; from: string | null; sentAt: string }
  | { ok: false; error: string };

/**
 * One-button, two-way SMS round-trip test. Sends a real text from a recruiter's
 * number, then polls until Telnyx confirms delivery and the reply comes back.
 */
export function SelfTestCard({ senders }: { senders: Sender[] }) {
  const [to, setTo] = useState("");
  const [from, setFrom] = useState(senders[0]?.fromNumber ?? "");
  const [sending, setSending] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const recruiterFor = (num: string) => senders.find((s) => s.fromNumber === num)?.recruiter;

  const stopPolling = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const poll = useCallback(
    async (conversationId: string, since: string) => {
      try {
        const r = await fetch(
          `/api/health/test-sms?conversationId=${encodeURIComponent(conversationId)}&since=${encodeURIComponent(since)}`,
          { credentials: "same-origin", cache: "no-store" },
        );
        if (!r.ok) return;
        const s: Status = await r.json();
        setStatus(s);
        if (s.replyReceived || s.failed) stopPolling();
      } catch {
        /* transient, keep polling */
      }
    },
    [stopPolling],
  );

  async function start() {
    if (!to.trim() || sending) return;
    setSending(true);
    setStatus(null);
    setRun(null);
    stopPolling();
    try {
      const r = await fetch("/api/health/test-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ to, fromNumber: from || undefined, recruiter: recruiterFor(from) }),
      });
      const data: Run = await r.json();
      setRun(data);
      if (data.ok) {
        setStatus({ sent: true, outboundStatus: "sent", delivered: false, failed: false, error: null, replyReceived: false, replyBody: null, replyAt: null });
        poll(data.conversationId, data.sentAt);
        timer.current = setInterval(() => poll(data.conversationId, data.sentAt), 3000);
      }
    } catch {
      setRun({ ok: false, error: "Could not reach the server. Try again." });
    } finally {
      setSending(false);
    }
  }

  const steps = [
    { key: "sent", label: "We sent it", done: !!status?.sent, detail: run && run.ok ? `Telnyx id ${run.telnyxId.slice(0, 10)}...` : "" },
    { key: "delivered", label: "Telnyx confirmed delivery", done: !!status?.delivered, detail: status?.failed ? "delivery failed" : status?.delivered ? "delivered" : "waiting for receipt..." },
    { key: "replied", label: "Your reply came back (two-way)", done: !!status?.replyReceived, detail: status?.replyReceived ? `"${(status.replyBody ?? "").slice(0, 40)}"` : "reply to the text on your phone..." },
  ];

  const allGreen = status?.sent && status?.delivered && status?.replyReceived;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-zinc-700">Two-way SMS test</h3>
        <span className="text-[10px] uppercase tracking-wide text-zinc-400">send + delivery + reply</span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Send a real text from a recruiter number to your phone, then reply to it. This confirms sending, that Telnyx is
        delivering, and that replies come back into OS Text.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <label className="text-xs text-zinc-500">
          Send as
          {senders.length > 0 ? (
            <select
              className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm text-zinc-900"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            >
              {senders.map((s) => (
                <option key={s.fromNumber} value={s.fromNumber}>
                  {s.recruiter} ({s.fromNumber})
                </option>
              ))}
            </select>
          ) : (
            <input
              className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm text-zinc-900"
              placeholder="From number (blank = default)"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          )}
        </label>
        <label className="text-xs text-zinc-500">
          Your phone
          <input
            className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm text-zinc-900"
            placeholder="+15125550123"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            inputMode="tel"
          />
        </label>
        <button
          onClick={start}
          disabled={sending || !to.trim()}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {sending ? "Sending..." : "Send test"}
        </button>
      </div>

      {run && !run.ok ? (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Could not send: {run.error}
        </div>
      ) : null}

      {run && run.ok ? (
        <div className="mt-4 space-y-2">
          {steps.map((s) => (
            <div key={s.key} className="flex items-center gap-3">
              <span
                className={
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold " +
                  (s.done
                    ? "bg-emerald-100 text-emerald-700"
                    : s.key === "delivered" && status?.failed
                      ? "bg-rose-100 text-rose-700"
                      : "bg-zinc-100 text-zinc-400")
                }
              >
                {s.done ? "✓" : s.key === "delivered" && status?.failed ? "✗" : "•"}
              </span>
              <span className={"text-sm font-medium " + (s.done ? "text-zinc-800" : "text-zinc-500")}>{s.label}</span>
              <span className="ml-auto text-xs text-zinc-400">{s.detail}</span>
            </div>
          ))}
          {allGreen ? (
            <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
              Two-way texting works end to end for {recruiterFor(from) ?? "this number"}.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

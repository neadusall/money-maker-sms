import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AutoRefresh } from "@/components/AutoRefresh";
import { LiveBadge } from "@/components/LiveBadge";
import { KpiCard, MiniStat } from "@/components/Stats";
import { SelfTestCard } from "@/components/SelfTestCard";
import { getHealthReport, type OverallStatus } from "@/lib/health";

export const dynamic = "force-dynamic";

function ago(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const BANNER: Record<OverallStatus, { ring: string; bg: string; text: string; dot: string; title: string }> = {
  ok: { ring: "border-emerald-200", bg: "bg-emerald-50", text: "text-emerald-900", dot: "bg-emerald-500", title: "All systems operational" },
  degraded: { ring: "border-amber-200", bg: "bg-amber-50", text: "text-amber-900", dot: "bg-amber-500", title: "Needs attention" },
  down: { ring: "border-rose-200", bg: "bg-rose-50", text: "text-rose-900", dot: "bg-rose-500", title: "Receiving is broken" },
};

export default async function HealthPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const report = await getHealthReport();
  const { telnyx, imessage, sms, recruiters } = report;
  const b = BANNER[report.status];

  return (
    <section className="grid gap-6">
      <AutoRefresh intervalMs={60000} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Status</h1>
            <LiveBadge />
          </div>
          <p className="mt-1 text-sm text-zinc-600">
            Live checks against the Telnyx API and this app, so you can confirm sending and receiving are both working.
          </p>
        </div>
      </div>

      {/* Overall banner */}
      <div className={`flex items-start gap-3 rounded-2xl border ${b.ring} ${b.bg} p-5`}>
        <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${b.dot}`} />
        <div className="flex-1">
          <div className={`text-lg font-semibold ${b.text}`}>{b.title}</div>
          {report.issues.length === 0 ? (
            <p className={`mt-1 text-sm ${b.text}/90`}>Sending and receiving both look healthy across all recruiters.</p>
          ) : (
            <ul className={`mt-2 list-disc space-y-1 pl-4 text-sm ${b.text}/90`}>
              {report.issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Two-way SMS self-test */}
      <SelfTestCard senders={report.senders} />

      {/* iMessage bridge (our own Mac) */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-zinc-700">iMessage bridge</h3>
          <span className="text-[10px] uppercase tracking-wide text-zinc-400">our Mac, no third party</span>
        </div>

        {!imessage.configured ? (
          <p className="mt-3 text-sm text-zinc-500">
            The iMessage lane is off. Campaigns set to <code className="rounded bg-zinc-100 px-1">auto</code> send
            on SMS and <code className="rounded bg-zinc-100 px-1">iMessage only</code> campaigns hold their
            contacts rather than sending green. Set BLUEBUBBLES_URL, BLUEBUBBLES_PASSWORD and
            OSTEXT_IMESSAGE_TENANT to turn it on.
          </p>
        ) : (
          <div className="mt-3 divide-y divide-zinc-100">
            <Check
              ok={imessage.reachable}
              label="Mac reachable"
              detail={
                imessage.reachable
                  ? "BlueBubbles answered just now"
                  : (imessage.error ?? "not answering - the Mac may be asleep or off the tunnel")
              }
            />
            <Check
              ok={imessage.laneHealthy}
              label="Apple line behavior"
              detail={imessage.laneNote}
            />
            <Check
              ok={imessage.uncertain === 0}
              label="Unconfirmed sends"
              detail={
                imessage.uncertain === 0
                  ? "none pending"
                  : `${imessage.uncertain} awaiting reconcile - NOT resent, on purpose (double-text guard)`
              }
              warnOnly
            />
            <div className="flex items-center gap-3 py-2">
              <span className="h-5 w-5 shrink-0" />
              <span className="w-52 shrink-0 font-medium text-zinc-800">Last 24 hours</span>
              <span className="text-sm text-zinc-500">
                {imessage.sent24h} sent on the blue lane
                {imessage.sent24h > 0
                  ? ` · ${imessage.replyRatePct}% reply rate · ${imessage.failureRatePct}% failed`
                  : ""}
                {" · "}
                {imessage.imessageCampaigns} active campaign(s) routed here
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Telnyx connection */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-zinc-700">Telnyx connection</h3>
          <span className="text-[10px] uppercase tracking-wide text-zinc-400">live from api.telnyx.com</span>
        </div>
        <div className="mt-3 divide-y divide-zinc-100">
          <Check
            ok={telnyx.apiKeySet && telnyx.reachable}
            label="API reachable"
            detail={telnyx.reachable ? "Telnyx API responded" : telnyx.error ?? "not reachable"}
          />
          <Check
            ok={telnyx.profileFound && telnyx.profileEnabled}
            label="Messaging profile"
            detail={telnyx.profileFound ? `${telnyx.profileName ?? "profile"}${telnyx.profileEnabled ? "" : " (disabled)"}` : "not found"}
          />
          <Check
            ok={telnyx.webhookUrlOk}
            label="Inbound webhook (receiving)"
            detail={
              telnyx.webhookUrlOk
                ? "Telnyx is delivering replies to OS Text"
                : telnyx.webhookUrlActual
                  ? `points at ${telnyx.webhookUrlActual}`
                  : "NOT set on the profile"
            }
          />
          {!telnyx.webhookUrlOk ? (
            <div className="py-2 pl-7 text-xs text-rose-700">
              Should be: <code className="rounded bg-rose-50 px-1 py-0.5">{telnyx.webhookUrlExpected || "(PUBLIC_APP_URL not set)"}</code>
              <div className="mt-1 text-zinc-500">
                Fix in the Telnyx portal: Messaging &rarr; Messaging Profiles &rarr; your profile &rarr; Inbound Settings &rarr; Webhook URL. Set API version to 2.
              </div>
            </div>
          ) : null}
          <Check
            ok={telnyx.publicKeySet}
            label="Webhook signature key"
            detail={telnyx.publicKeySet ? "inbound signatures verified" : "TELNYX_PUBLIC_KEY not set (accepting unverified)"}
            warnOnly
          />
          <Check
            ok={telnyx.numbers.length > 0 || telnyx.fromNumberSet}
            label="Sending number"
            detail={
              telnyx.numbers.length > 0
                ? telnyx.numbers.map((n) => `${n.phoneNumber} (${n.status})`).join(", ")
                : telnyx.fromNumberSet
                  ? "TELNYX_FROM_NUMBER set"
                  : "no number on profile"
            }
          />
        </div>
      </div>

      {/* Activity KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Sent (24h)" value={sms.outbound24h} accent="sky" hint={`${sms.outbound7d} in last 7 days`} />
        <KpiCard
          label="Delivery rate"
          value={sms.deliveredAll + sms.failedAll ? `${sms.deliveryRate}%` : "—"}
          accent={sms.deliveryRate >= 85 || sms.deliveredAll + sms.failedAll < 20 ? "emerald" : "amber"}
          hint={`${sms.deliveredAll} delivered, ${sms.failedAll} failed`}
        />
        <KpiCard
          label="Replies received (7d)"
          value={sms.inbound7d}
          accent={sms.inbound7d > 0 ? "violet" : sms.outbound7d >= 25 ? "rose" : "zinc"}
          hint={`${sms.inboundAll} all time`}
        />
        <KpiCard
          label="Last reply"
          value={ago(sms.lastInbound)}
          accent={sms.inboundAll === 0 && sms.outboundAll >= 25 ? "rose" : "zinc"}
          hint={sms.lastInbound ? "most recent inbound" : "none recorded yet"}
        />
      </div>

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <MiniStat label="Outbound (all)" value={sms.outboundAll} accent="sky" />
        <MiniStat label="Inbound (all)" value={sms.inboundAll} accent="violet" />
        <MiniStat label="Pending / no receipt" value={sms.pendingAll} accent={sms.pendingAll > 0 ? "amber" : "zinc"} />
        <MiniStat label="Last send" value={ago(sms.lastOutbound)} />
      </div>

      {/* Per recruiter */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-zinc-700">By recruiter</h3>
          <span className="text-[10px] uppercase tracking-wide text-zinc-400">send + receive health</span>
        </div>
        <div className="mt-3 overflow-x-auto">
          {recruiters.length === 0 ? (
            <div className="text-xs text-zinc-400">No campaigns yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400">
                  <th className="pb-2 pr-3 font-medium">Recruiter</th>
                  <th className="pb-2 pr-3 font-medium">Campaigns</th>
                  <th className="pb-2 pr-3 font-medium">Sent (7d)</th>
                  <th className="pb-2 pr-3 font-medium">Replies (7d)</th>
                  <th className="pb-2 pr-3 font-medium">Last reply</th>
                  <th className="pb-2 font-medium">Receive</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {recruiters.map((r) => (
                  <tr key={r.recruiter}>
                    <td className="py-2 pr-3 font-medium text-zinc-800">{r.recruiter}</td>
                    <td className="py-2 pr-3 tabular-nums text-zinc-600">{r.campaigns}</td>
                    <td className="py-2 pr-3 tabular-nums text-zinc-600">{r.outbound7d}</td>
                    <td className="py-2 pr-3 tabular-nums text-zinc-600">{r.inbound7d}</td>
                    <td className="py-2 pr-3 text-zinc-500">{ago(r.lastInbound)}</td>
                    <td className="py-2">
                      {r.receiveOk ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> ok
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> no replies
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* How to monitor */}
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500">
        <p className="font-medium text-zinc-700">How to monitor this automatically</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-4">
          <li>
            This page checks the Telnyx API live every 60 seconds. A red &quot;Inbound webhook&quot; check is the exact reason
            replies stop arriving while sending still works.
          </li>
          <li>
            Point an uptime monitor at <code className="rounded bg-white px-1 py-0.5">/api/health?token=YOUR_TOKEN</code> (set
            <code className="mx-1 rounded bg-white px-1 py-0.5">HEALTH_TOKEN</code> in the environment). It returns HTTP 503 when
            receiving is down, so you get alerted without opening the app.
          </li>
        </ul>
        <p className="mt-2 text-[11px] text-zinc-400">Checked at {report.checkedAt}.</p>
      </div>
    </section>
  );
}

function Check({ ok, label, detail, warnOnly }: { ok: boolean; label: string; detail: string; warnOnly?: boolean }) {
  const dot = ok ? "bg-emerald-500" : warnOnly ? "bg-amber-500" : "bg-rose-500";
  const mark = ok ? "text-emerald-600" : warnOnly ? "text-amber-600" : "text-rose-600";
  return (
    <div className="flex items-center gap-3 py-2">
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${dot}/15`}>
        <span className={`text-xs font-bold ${mark}`}>{ok ? "✓" : "✗"}</span>
      </span>
      <span className="w-52 shrink-0 font-medium text-zinc-800">{label}</span>
      <span className="text-sm text-zinc-500">{detail}</span>
    </div>
  );
}

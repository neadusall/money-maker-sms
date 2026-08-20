/**
 * Which lane a message went out on, at a glance.
 *
 * Colors are Apple's own bubble colors on purpose: a recruiter scanning a thread should be
 * able to tell blue from green the same way the candidate does on their phone, without
 * reading a label. The badge is the explicit version for anywhere a bubble is not shown.
 *
 * Two states, because we own the sender: the router only routes iMessage-capable handles to
 * our Mac bridge, so a message is blue or it is carrier SMS, with nothing in between. (A
 * hosted iMessage API would need a third state for its silent SMS downgrades.)
 */

export type MsgLane = "imessage" | "sms";

/** iMessage blue (#0b84ff) and SMS green (#34c759) — the colors the candidate sees. */
export const LANE_BUBBLE: Record<MsgLane, string> = {
  imessage: "bg-[#0b84ff] text-white",
  sms: "bg-[#34c759] text-white",
};

const LANE_CHIP: Record<MsgLane, { dot: string; bg: string; text: string; label: string; title: string }> = {
  imessage: {
    dot: "bg-[#0b84ff]",
    bg: "bg-sky-50",
    text: "text-sky-700",
    label: "iMessage",
    title: "Blue bubble, sent from our own Mac bridge",
  },
  sms: {
    dot: "bg-[#34c759]",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    label: "SMS",
    title: "Green-bubble SMS through Telnyx",
  },
};

/**
 * Classify one message row. Mirrors the CASE in lib/lane-stats.ts exactly — if these two
 * ever disagree, the thread and the comparison chart would tell a recruiter different
 * stories about the same message.
 *
 * One column is enough BECAUSE we own the sender. The router only hands the bridge handles
 * the Mac reports as iMessage-capable, so provider='imessage' is a blue bubble. A hosted
 * iMessage API would silently downgrade to carrier SMS and this would need a second field
 * to stay honest.
 */
export function laneOf(m: { provider?: string | null }): MsgLane {
  return m.provider === "imessage" ? "imessage" : "sms";
}

export function LaneBadge({ lane, className = "" }: { lane: MsgLane; className?: string }) {
  const c = LANE_CHIP[lane];
  return (
    <span
      title={c.title}
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${c.bg} ${c.text} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

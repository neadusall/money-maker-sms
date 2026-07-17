"use client";

/**
 * Click-to-call: opens the RecruitersOS popup dialer (/phone-widget, served by
 * the portal on this same origin, OUTSIDE the /ostext-app basePath: a raw
 * window.open path is deliberately not basePath-prefixed). The call goes out
 * on the recruiter's assigned phone line (the same number this campaign texts
 * from) and lands in the portal's call history with recording + AI notes.
 * Theme/accent ride along via the same ros_theme/ros_accent handoff the portal
 * uses when embedding this app.
 */
export function CallButton({
  phone,
  name,
  company,
  variant = "icon",
}: {
  phone: string | null | undefined;
  name?: string | null;
  company?: string | null;
  /** icon = tight list rows; header = thread header cluster; pill = action rows */
  variant?: "icon" | "header" | "pill";
}) {
  if (!phone) return null;
  const to = phone;

  function handleClick(e: React.MouseEvent) {
    // Rows wrap their action cluster over a navigating <Link>; a call click
    // must never also open the thread.
    e.preventDefault();
    e.stopPropagation();
    const p = new URLSearchParams({ to });
    if (name) p.set("name", name);
    if (company) p.set("company", company);
    try {
      const theme = localStorage.getItem("ros_theme");
      const accent = localStorage.getItem("ros_accent");
      if (theme) p.set("theme", theme);
      if (accent) p.set("accent", accent);
    } catch {
      // Storage can be blocked; the dialer just uses its own defaults.
    }
    window.open(`/phone-widget?${p.toString()}`, "ros-phone-widget", "width=380,height=620,popup=yes");
  }

  const icon = (
    <svg
      className={variant === "pill" ? "h-3.5 w-3.5" : "h-4 w-4"}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"
      />
    </svg>
  );

  if (variant === "pill") {
    return (
      <button
        onClick={handleClick}
        title={`Call${name ? ` ${name}` : ""} from your assigned number`}
        className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
      >
        {icon}
        Call
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      title={`Call${name ? ` ${name}` : ""} from your assigned number`}
      className={
        variant === "header"
          ? "rounded-md p-2 text-zinc-500 hover:bg-emerald-50 hover:text-emerald-600"
          : "rounded-md p-1.5 text-zinc-400 hover:bg-emerald-50 hover:text-emerald-600"
      }
    >
      {icon}
    </button>
  );
}

"use client";

import { useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { updateCampaignOwner } from "@/lib/owner-actions";

export type KnownOwner = { name: string; email: string };

// Stable chip colors per owner so the same recruiter always scans the same at a glance.
const OWNER_COLORS = [
  "bg-sky-100 text-sky-800",
  "bg-violet-100 text-violet-800",
  "bg-emerald-100 text-emerald-800",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-800",
  "bg-teal-100 text-teal-800",
  "bg-indigo-100 text-indigo-800",
];

function ownerLabel(name: string | null, email: string | null): string {
  return (name ?? "").trim() || (email ?? "").trim().split("@")[0];
}

function initialsOf(label: string): string {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function colorOf(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  return OWNER_COLORS[hash % OWNER_COLORS.length];
}

export function OwnerChip({
  campaignId,
  name,
  email,
  knownOwners,
}: {
  campaignId: string;
  name: string | null;
  email: string | null;
  knownOwners: KnownOwner[];
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [draftName, setDraftName] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const btnRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  const label = ownerLabel(name, email);
  const cleanEmail = (email ?? "").trim();

  function toggle() {
    if (!open) {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) {
        const panelW = 288;
        // Worst-case panel height (quick-pick list + form); clamp so the panel
        // never opens below the fold on cards near the bottom of the screen.
        const panelH = 350;
        setPos({
          top: Math.max(8, Math.min(r.bottom + 6, window.innerHeight - panelH - 8)),
          left: Math.max(8, Math.min(r.left, window.innerWidth - panelW - 8)),
        });
      }
      setDraftName((name ?? "").trim());
      setDraftEmail(cleanEmail);
      setError("");
    }
    setOpen(!open);
  }

  function save(n: string, e: string) {
    startTransition(async () => {
      try {
        await updateCampaignOwner(campaignId, n, e);
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save");
      }
    });
  }

  // Owners already on other campaigns, minus this campaign's current owner.
  const quickPicks = knownOwners.filter(
    (o) => ownerLabel(o.name, o.email).toLowerCase() !== label.toLowerCase(),
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        title={label ? `Owner: ${cleanEmail || label}. Click to reassign.` : "No owner. Click to assign."}
        className={
          label
            ? `pointer-events-auto inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 text-[11px] font-medium hover:ring-2 hover:ring-zinc-300 ${colorOf(label)}`
            : "pointer-events-auto inline-flex shrink-0 cursor-pointer items-center rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-[11px] font-medium text-zinc-400 hover:border-zinc-400 hover:text-zinc-600"
        }
      >
        {label ? (
          <>
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/80 text-[9px] font-bold">
              {initialsOf(label)}
            </span>
            {label}
          </>
        ) : (
          "Unassigned"
        )}
      </button>

      {open
        ? createPortal(
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
              <div
                className="fixed z-50 w-72 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg"
                style={{ top: pos.top, left: pos.left }}
              >
                <div className="text-xs font-semibold text-zinc-700">Campaign owner</div>

                {quickPicks.length > 0 ? (
                  <div className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
                    {quickPicks.map((o) => {
                      const l = ownerLabel(o.name, o.email);
                      return (
                        <button
                          key={`${o.name}|${o.email}`}
                          type="button"
                          disabled={pending}
                          onClick={() => save(o.name, o.email)}
                          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-zinc-50 disabled:opacity-50"
                        >
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${colorOf(l)}`}
                          >
                            {initialsOf(l)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-zinc-800">{l}</span>
                            {o.email ? <span className="block truncate text-[10px] text-zinc-400">{o.email}</span> : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                <div className="mt-2 border-t border-zinc-100 pt-2">
                  <input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder="Recruiter name"
                    className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs outline-none focus:border-zinc-400"
                  />
                  <input
                    value={draftEmail}
                    onChange={(e) => setDraftEmail(e.target.value)}
                    placeholder="Email (optional)"
                    className="mt-1.5 w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs outline-none focus:border-zinc-400"
                  />
                  {error ? <div className="mt-1.5 text-[11px] text-rose-600">{error}</div> : null}
                  <div className="mt-2 flex items-center justify-between">
                    {label ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => save("", "")}
                        className="text-[11px] text-zinc-400 hover:text-zinc-600 disabled:opacity-50"
                      >
                        Clear owner
                      </button>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      disabled={pending || (!draftName.trim() && !draftEmail.trim())}
                      onClick={() => save(draftName, draftEmail)}
                      className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-soft disabled:opacity-50"
                    >
                      {pending ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}

"use client";

type Row = Record<string, string | number | null>;

/** Client-side CSV export of the current To-dos board (no server round-trip). */
export function DownloadListButton({ rows, filename }: { rows: Row[]; filename: string }) {
  function download() {
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const esc = (v: string | number | null) => {
      const s = v == null ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [
      headers.join(","),
      ...rows.map((r) => headers.map((h) => esc(r[h])).join(",")),
    ].join("\r\n");
    // BOM so Excel reads UTF-8 correctly.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={download}
      disabled={rows.length === 0}
      title="Download this list (name, company, title, LinkedIn URL, phone, email, fit score) as a CSV"
      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-surface px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <svg className="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-6 4.5 4.5m0 0 4.5-4.5m-4.5 4.5V3" />
      </svg>
      Download current list ({rows.length})
    </button>
  );
}

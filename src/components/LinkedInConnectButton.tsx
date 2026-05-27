"use client";

import { useState } from "react";

/**
 * Connect button for the To-dos board. Copies a personalized connection note to
 * the clipboard, then opens the candidate's LinkedIn profile in a new tab — so
 * you just paste the note into LinkedIn's "Add a note" box and click Send. No
 * LinkedIn automation (which would risk the account); just one paste.
 */
export function LinkedInConnectButton({ url, note }: { url: string; note: string }) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(note);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // Clipboard can be blocked; the profile still opens so the action isn't lost.
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <button
      onClick={handleClick}
      title={`Copies this note and opens their LinkedIn — paste it into the Connect box:\n\n"${note}"`}
      className={
        "inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-white transition " +
        (copied ? "bg-emerald-600" : "bg-blue-600 hover:bg-blue-700")
      }
    >
      {copied ? (
        <>
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
          Note copied — paste it
        </>
      ) : (
        <>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v6m3-3h-6m-3.75-1.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 8.625 21c-2.331 0-4.512-.645-6.374-1.766Z" />
          </svg>
          Connect
        </>
      )}
    </button>
  );
}

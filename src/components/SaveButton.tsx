"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * Submit button with real feedback for a server-action form.
 *
 * The campaign settings form (and the new-campaign form) post to a server
 * action that revalidates in place with no redirect, so a successful save
 * changed nothing the eye could catch: recruiters clicked "Save changes",
 * saw the identical page, and reported that saving "does nothing". This button
 * closes that gap without pulling the whole form into the client (the form
 * still renders on the server so APP_TIMEZONE stays available):
 *
 *  - while the action runs it shows "Saving…" and is disabled, so the click
 *    has an immediate, unmistakable response;
 *  - when the action finishes it flashes "✓ Changes saved" for a few seconds.
 *
 * useFormStatus reports the enclosing form's pending state from a client
 * descendant, so the surrounding <form> can stay a server component.
 */
export function SaveButton({
  label = "Save changes",
  className,
}: {
  label?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    // A pending → idle transition means the submit we just started has
    // resolved. (If the action had thrown, Next renders the error boundary
    // instead of returning here, so this only fires on a completed save.)
    if (wasPending.current && !pending) {
      setJustSaved(true);
      const t = setTimeout(() => setJustSaved(false), 4000);
      wasPending.current = pending;
      return () => clearTimeout(t);
    }
    wasPending.current = pending;
  }, [pending]);

  return (
    <div className="flex items-center gap-3">
      {justSaved && !pending ? (
        <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
          Changes saved
        </span>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className={
          className ??
          "inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {pending ? (
          <>
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
            </svg>
            Saving…
          </>
        ) : (
          label
        )}
      </button>
    </div>
  );
}

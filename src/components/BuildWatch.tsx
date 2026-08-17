"use client";

import { useEffect } from "react";

/** Reloads the page when the server is running a newer build than the one this
 *  document was rendered from. Recruiters keep the app open (often inside the
 *  portal iframe, where a portal-level refresh does NOT reload this document),
 *  so without this a deploy leaves stale copies of the UI alive for days.
 *  The document's own build is stamped on <html data-build> by the layout. */
export function BuildWatch() {
  useEffect(() => {
    const mine = document.documentElement.getAttribute("data-build");
    if (!mine || mine === "dev") return;
    const id = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        // Absolute path including the app's basePath: a relative fetch would
        // resolve against the current route, not the app root.
        const r = await fetch("/ostext-app/api/build", { cache: "no-store" });
        if (!r.ok) return;
        const live = (await r.text()).trim();
        // A signed-out tab gets the login PAGE here (auth middleware redirect),
        // not a build id; only trust something shaped like an id.
        if (!/^[A-Za-z0-9_-]{5,40}$/.test(live)) return;
        if (live === "dev" || live === mine) return;
        // Loop guard: if a reload somehow still yields a mismatched build
        // (an upstream cache pinning old HTML), stop after 2 tries per hour
        // rather than reloading forever.
        const key = "buildwatch:" + live;
        const tries = Number(sessionStorage.getItem(key) || "0");
        if (tries >= 2) return;
        sessionStorage.setItem(key, String(tries + 1));
        location.reload();
      } catch {
        // Offline or mid-deploy; try again next tick.
      }
    }, 30000);
    return () => clearInterval(id);
  }, []);
  return null;
}

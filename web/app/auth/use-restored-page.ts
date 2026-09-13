"use client";

import { useEffect } from "react";

/**
 * Clear a "busy" state when the browser restores this page from the back/forward cache.
 *
 * The bug this exists for: pressing "Continue with Google" sets pending to "google" and
 * then navigates away. If the visitor changes their mind at Google's screen and hits
 * back, Chrome restores this page from the bfcache with its React state exactly as it
 * was -- pending still "google" -- so every button on the form stays disabled and the
 * page looks frozen. Nothing is broken; the component simply never learned it had come
 * back, because a bfcache restore does not remount, does not re-run effects, and fires
 * no navigation event a React app would normally notice.
 *
 * `pageshow` with `persisted` is the one signal that specifically means "restored from
 * the cache rather than loaded". Reloading is what a visitor had to do instead, and
 * asking someone to reload to log in is not a login page.
 */
export function useClearOnRestore(clear: () => void): void {
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) clear();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [clear]);
}

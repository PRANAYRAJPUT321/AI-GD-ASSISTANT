"use client";

import { useEffect, useSyncExternalStore } from "react";
import { INSTALL_CHANGE_EVENT } from "@/lib/install-script";

// Installing GD Arena as an app. Chromium browsers (Chrome, Edge, Samsung Internet, Android)
// fire `beforeinstallprompt`; an inline script in the root layout catches it before React
// loads and keeps it on `window.__gdInstallPrompt`, so the app's own Install button can open
// the browser's install dialog. Safari on iPhone and iPad has no such prompt: there the
// button explains Share → Add to Home Screen instead.

/** The event Chromium fires when the app can be installed (not in the DOM typings yet). */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    __gdInstallPrompt?: BeforeInstallPromptEvent | null;
    __gdInstalled?: boolean;
  }
}

export type InstallState = "installed" | "available" | "ios" | "unavailable";

/** What the Install button should offer, from what the browser reports. */
export function installStateFrom(facts: { standalone: boolean; hasPrompt: boolean; ios: boolean }): InstallState {
  if (facts.standalone) return "installed";
  if (facts.hasPrompt) return "available";
  if (facts.ios) return "ios";
  return "unavailable";
}

const STANDALONE_QUERY = "(display-mode: standalone)";

function readState(): InstallState {
  const nav = navigator as Navigator & { standalone?: boolean };
  return installStateFrom({
    standalone: window.__gdInstalled === true || window.matchMedia(STANDALONE_QUERY).matches || nav.standalone === true,
    hasPrompt: Boolean(window.__gdInstallPrompt),
    // iPadOS reports itself as a Mac; touch support gives it away.
    ios: /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1),
  });
}

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(STANDALONE_QUERY);
  window.addEventListener(INSTALL_CHANGE_EVENT, onChange);
  query.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(INSTALL_CHANGE_EVENT, onChange);
    query.removeEventListener("change", onChange);
  };
}

/** The install state, live; "unavailable" on the server and during hydration. */
export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, readState, () => "unavailable");
}

/** Opens the browser's install dialog. The prompt can be used once; the browser may offer a new one later. */
export async function promptInstall(): Promise<void> {
  const event = window.__gdInstallPrompt;
  if (!event) return;
  window.__gdInstallPrompt = null;
  try {
    await event.prompt();
    await event.userChoice;
  } finally {
    window.dispatchEvent(new Event(INSTALL_CHANGE_EVENT));
  }
}

/** Registers the service worker (production only): it shows a friendly page when opened offline. */
export function useServiceWorker(): void {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Installing still works without it; there is just no offline page.
    });
  }, []);
}

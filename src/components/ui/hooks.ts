"use client";

import { useSyncExternalStore } from "react";

// Browser-only values read without setState-in-effect: useSyncExternalStore renders the
// server value during SSR and hydration, then re-renders with the real browser value.

function subscribeNever(): () => void {
  return () => {};
}

/**
 * A value that only exists in the browser (feature detection and the like). Returns
 * `serverValue` while rendering on the server and during hydration, then `read()`.
 * `read` must return a primitive (or otherwise stable) value.
 */
export function useClientValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(subscribeNever, read, () => serverValue);
}

/**
 * False during server rendering and hydration, true afterwards. For markup that must match
 * the server's on first paint but may differ (or animate in) once the page is interactive.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

function subscribeStorage(onChange: () => void): () => void {
  // Fires for writes from other tabs; this tab's own writes go through local state.
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** localStorage read that never throws (private mode, blocked storage, SSR). */
export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** localStorage write that never throws; remembering a preference is best-effort. */
export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage full or blocked: the preference just isn't remembered.
  }
}

/** A remembered string from localStorage; null on the server, during hydration and when unset. */
export function useStoredString(key: string): string | null {
  return useSyncExternalStore(
    subscribeStorage,
    () => readStored(key),
    () => null,
  );
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * The OS "reduce motion" setting, kept live. Unlike motion's useReducedMotion it is
 * hydration-safe (false on the server and during hydration), so server-rendered markup that
 * depends on it never mismatches.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

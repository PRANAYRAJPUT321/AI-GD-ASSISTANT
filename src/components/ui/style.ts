import type { CSSProperties } from "react";

/**
 * Inline style that sets the `--ring` custom property read by `.speaking-ring` (globals.css),
 * plus any extra properties. Persona colours come from personas.ts, so they are inline styles.
 */
export function ringStyle(color: string, extra?: CSSProperties): CSSProperties {
  return { ...extra, ["--ring" as string]: color } as CSSProperties;
}

/** A translucent wash of `color` over the panel, for avatar and badge backgrounds. */
export function tint(color: string, percent = 16): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

/** Shared look for text inputs, selects and textareas. */
export const fieldClass =
  "w-full rounded-xl border border-line bg-panel px-3.5 text-base text-ink placeholder:text-ink-3 " +
  "shadow-[inset_0_1px_0_rgb(0_0_0/0.02)] transition-[border-color,box-shadow] duration-150 " +
  "outline-none hover:border-ink-3/60 focus-visible:border-accent focus-visible:ring-4 focus-visible:ring-accent/20";

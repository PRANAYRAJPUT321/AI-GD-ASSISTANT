"use client";

import { useClientValue, usePrefersReducedMotion } from "@/components/ui/hooks";

let webgl: boolean | null = null;

/** Whether this browser can draw WebGL (checked once; the test context is released at once). */
function hasWebGL(): boolean {
  if (webgl === null) {
    try {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      webgl = context !== null;
      context?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      webgl = false;
    }
  }
  return webgl;
}

/**
 * Whether to show the WebGL arena: the browser supports WebGL and the user hasn't asked for
 * reduced motion. False on the server and during hydration, so the 2D version renders first.
 */
export function useArena3D(): boolean {
  const supported = useClientValue(hasWebGL, false);
  const reduced = usePrefersReducedMotion();
  return supported && !reduced;
}

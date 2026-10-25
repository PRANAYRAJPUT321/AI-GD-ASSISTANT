"use client";

import { motion, useMotionTemplate, useMotionValue, useSpring, type MotionStyle } from "motion/react";
import type { PointerEvent, ReactNode } from "react";
import { usePrefersReducedMotion } from "./hooks";

const SPRING = { stiffness: 260, damping: 22, mass: 0.6 } as const;

export interface Tilt {
  /** Spread onto a motion element (merge `style` with its own). */
  bind: {
    style: MotionStyle;
    onPointerMove(event: PointerEvent<HTMLElement>): void;
    onPointerLeave(): void;
  };
  /** A soft highlight that follows the pointer; render it last inside the element (which must be `relative`). */
  glare: ReactNode;
}

/**
 * Tilts an element in 3D towards the mouse pointer, up to `max` degrees, with a glare that
 * follows it. Touch and pen get no tilt (there is no hover to follow), nor does reduced motion.
 */
export function useTilt(max = 6): Tilt {
  const reduced = usePrefersReducedMotion();
  const rotateX = useSpring(0, SPRING);
  const rotateY = useSpring(0, SPRING);
  const glareX = useMotionValue(50);
  const glareY = useMotionValue(50);
  const glareOpacity = useSpring(0, SPRING);
  const background = useMotionTemplate`radial-gradient(circle at ${glareX}% ${glareY}%, rgb(255 255 255 / 0.3), transparent 60%)`;

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (reduced || event.pointerType !== "mouse") return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    rotateY.set((x - 0.5) * 2 * max);
    rotateX.set((0.5 - y) * 2 * max);
    glareX.set(x * 100);
    glareY.set(y * 100);
    glareOpacity.set(1);
  }

  function onPointerLeave() {
    rotateX.set(0);
    rotateY.set(0);
    glareOpacity.set(0);
  }

  return {
    bind: { style: { rotateX, rotateY, transformPerspective: 900 }, onPointerMove, onPointerLeave },
    glare: (
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] mix-blend-soft-light print:hidden"
        style={{ background, opacity: glareOpacity }}
      />
    ),
  };
}

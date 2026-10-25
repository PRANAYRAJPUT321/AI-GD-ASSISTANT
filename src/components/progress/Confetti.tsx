"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useHydrated, usePrefersReducedMotion } from "@/components/ui/hooks";
import { BADGE_COLORS } from "./BadgeIcon";

const DURATION_MS = 2800;
const PIECES = 150;
const GRAVITY = 0.0009; // px per ms²

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  angle: number;
  size: number;
  color: string;
  round: boolean;
}

/**
 * One burst of confetti from both sides of the screen when it mounts (decorative, drawn on a
 * canvas that ignores the pointer). Nothing at all with reduced motion. Portalled to <body>,
 * since a transformed ancestor (the animated screen wrapper) would pin a fixed canvas to
 * itself instead of the viewport.
 */
export function Confetti() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();
  const hydrated = useHydrated();

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || reduced) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.scale(ratio, ratio);

    // Two cannons low on the left and right edges, firing up and inwards. Each piece is aimed
    // to peak inside the top half of the screen, whatever its height.
    const pieces: Piece[] = Array.from({ length: PIECES }, (_, index) => {
      const fromLeft = index % 2 === 0;
      const startY = height * (0.55 + Math.random() * 0.2);
      const peakY = height * (0.05 + Math.random() * 0.35);
      const rise = Math.sqrt(2 * GRAVITY * (startY - peakY)); // px per ms
      const tilt = 0.25 + Math.random() * 0.5; // radians from vertical, towards the middle
      return {
        x: fromLeft ? -10 : width + 10,
        y: startY,
        vx: rise * Math.tan(tilt) * (fromLeft ? 1 : -1),
        vy: -rise,
        spin: (Math.random() - 0.5) * 0.02,
        angle: Math.random() * Math.PI,
        size: 6 + Math.random() * 6,
        color: BADGE_COLORS[index % BADGE_COLORS.length],
        round: Math.random() < 0.3,
      };
    });

    let frame = 0;
    const start = performance.now();
    let previous = start;
    const draw = (now: number) => {
      const elapsed = now - start;
      const dt = Math.min(now - previous, 32);
      previous = now;
      context.clearRect(0, 0, width, height);
      // Fade the whole burst out over its last third.
      context.globalAlpha = Math.min(1, Math.max(0, (DURATION_MS - elapsed) / (DURATION_MS / 3)));
      for (const piece of pieces) {
        piece.vy += GRAVITY * dt;
        piece.vx *= Math.pow(0.9997, dt); // air drag
        piece.x += piece.vx * dt;
        piece.y += piece.vy * dt;
        piece.angle += piece.spin * dt;
        context.save();
        context.translate(piece.x, piece.y);
        context.rotate(piece.angle);
        context.fillStyle = piece.color;
        if (piece.round) {
          context.beginPath();
          context.arc(0, 0, piece.size / 2.6, 0, Math.PI * 2);
          context.fill();
        } else {
          // A strip that flutters: its height follows the spin.
          const flutter = (piece.size / 2) * Math.abs(Math.cos(piece.angle * 3)) + 1;
          context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, flutter);
        }
        context.restore();
      }
      if (elapsed < DURATION_MS) frame = requestAnimationFrame(draw);
      else context.clearRect(0, 0, width, height);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [reduced, hydrated]);

  if (!hydrated) return null;
  return createPortal(
    <canvas ref={canvasRef} aria-hidden className="pointer-events-none fixed inset-0 z-50 h-dvh w-screen print:hidden" />,
    document.body,
  );
}

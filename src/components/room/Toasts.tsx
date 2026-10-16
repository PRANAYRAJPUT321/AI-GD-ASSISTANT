"use client";

import { Hand, Info, Keyboard, Megaphone, Scissors, ShieldCheck, Sparkles, X, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { createPortal } from "react-dom";
import { useHydrated } from "@/components/ui/hooks";
import type { RoomToast, ToastKind, ToastTone } from "./roomStore";

const ICONS: Record<ToastKind, LucideIcon> = {
  "cut-in": Megaphone,
  held: ShieldCheck,
  yielded: Hand,
  "you-cut": Scissors,
  opened: Sparkles,
  notice: Info,
  "text-mode": Keyboard,
};

const TONE_ACCENT: Record<ToastTone, string> = {
  info: "var(--accent)",
  good: "var(--good)",
  warn: "var(--warn)",
};

/**
 * Event toasts (interruptions and their outcome, cut-offs, notices, the switch to typing).
 * Portalled to <body> so they stay put during the phase transition; the container is a polite
 * live region that exists before any toast arrives, so each one is announced.
 */
export function Toasts({ toasts, onDismiss }: { toasts: readonly RoomToast[]; onDismiss(id: string): void }) {
  const hydrated = useHydrated();
  if (!hydrated) return null;
  return createPortal(
    <div
      aria-live="polite"
      aria-relevant="additions text"
      className="pointer-events-none fixed inset-x-3 top-3 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:top-4 sm:w-[23rem]"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const Icon = ICONS[toast.kind];
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: -14, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className="pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-xl border border-line bg-panel py-3 pl-4 pr-2 shadow-card"
            >
              <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: TONE_ACCENT[toast.tone] }} />
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={toast.kind}
                  aria-hidden
                  initial={{ scale: 0.4, rotate: -20, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 500, damping: 20 }}
                  className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg"
                  style={{ background: `color-mix(in srgb, ${TONE_ACCENT[toast.tone]} 16%, transparent)` }}
                >
                  <Icon className="size-4 text-ink" />
                </motion.span>
              </AnimatePresence>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-sm font-semibold leading-snug text-ink">{toast.title}</p>
                {toast.body && <p className="mt-0.5 text-sm leading-snug text-ink-2">{toast.body}</p>}
              </div>
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-2 outline-none hover:bg-panel-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X aria-hidden className="size-4" />
                <span className="sr-only">Dismiss</span>
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

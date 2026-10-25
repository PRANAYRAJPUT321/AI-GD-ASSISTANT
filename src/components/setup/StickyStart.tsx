"use client";

import { ArrowRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { createPortal } from "react-dom";
import type { Topic } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { useHydrated } from "@/components/ui/hooks";

interface StickyStartProps {
  /** Show the bar (the main start card is scrolled out of view and setup has begun). */
  show: boolean;
  /** The setup form's id: the bar's button submits it from outside the form. */
  formId: string;
  topic: Topic | null;
  minutes: number;
  canStart: boolean;
  busy: boolean;
  /** What is still missing, e.g. "your name"; empty when ready. */
  missing: string;
}

/**
 * A start bar pinned to the bottom of the screen while the main "Start my GD" card is out of
 * view, so the next step is always one tap away on long phone screens. Portalled to <body>
 * so no transformed ancestor can break its fixed position.
 */
export function StickyStart({ show, formId, topic, minutes, canStart, busy, missing }: StickyStartProps) {
  const hydrated = useHydrated();
  if (!hydrated) return null;
  return createPortal(
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 96, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 96, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 34 }}
          className="fixed inset-x-0 bottom-0 z-40 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 print:hidden"
        >
          <div className="mx-auto flex max-w-2xl items-center gap-3 rounded-2xl border border-line bg-panel/90 p-2 pl-4 shadow-[0_16px_40px_-16px_rgb(16_24_40/0.45)] backdrop-blur-md">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{topic ? topic.title : "Pick a topic"}</p>
              <p className="truncate text-xs text-ink-2">
                {missing ? `Add ${missing} to start` : `${minutes}-minute GD · 2 minutes to prep first`}
              </p>
            </div>
            <Button
              type="submit"
              form={formId}
              variant="primary"
              busy={busy}
              disabled={!canStart}
              iconEnd={!busy && <ArrowRight aria-hidden className="size-4" />}
              className="shrink-0"
            >
              {busy ? "Starting…" : "Start"}
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

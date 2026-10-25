"use client";

import { Download, Share, SquarePlus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { promptInstall, useInstallState } from "./install";

/**
 * "Install app": opens the browser's install dialog where there is one, or explains Add to
 * Home Screen on iPhone and iPad. Hidden once installed, and where installing isn't possible.
 */
export function InstallButton({ compact = false, className }: { compact?: boolean; className?: string }) {
  const state = useInstallState();
  const [showSteps, setShowSteps] = useState(false);
  if (state === "installed" || state === "unavailable") return null;

  return (
    <>
      <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className={className}>
        <Button
          size="sm"
          variant={compact ? "secondary" : "primary"}
          icon={<Download aria-hidden className="size-4" />}
          onClick={() => (state === "ios" ? setShowSteps(true) : void promptInstall())}
        >
          {compact ? "Install" : "Install the app"}
        </Button>
      </motion.span>
      <AnimatePresence>{showSteps && <IosSteps onClose={() => setShowSteps(false)} />}</AnimatePresence>
    </>
  );
}

const STEPS = [
  { icon: Share, text: "Tap the Share button in the browser's toolbar." },
  { icon: SquarePlus, text: "Choose “Add to Home Screen”." },
  { icon: Download, text: "Tap Add. GD Arena opens from your home screen like an app." },
] as const;

/** Add to Home Screen, step by step (Safari has no install prompt). A modal <dialog>. */
function IosSteps({ onClose }: { onClose(): void }) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    close.current?.focus();
    return () => element.close();
  }, []);

  return (
    <motion.dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      initial={{ opacity: 0, scale: 0.95, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: 6 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-line bg-panel p-0 text-ink shadow-card backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
    >
      <div className="p-5 sm:p-6">
        <h2 id={`${id}-title`} className="text-lg font-semibold text-ink">
          Install GD Arena
        </h2>
        <ol className="mt-3 flex flex-col gap-3">
          {STEPS.map((step, index) => (
            <li key={step.text} className="flex items-start gap-3 text-sm text-ink-2">
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-lg text-accent",
                  index === 0 ? "bg-accent-soft" : "bg-panel-2",
                )}
              >
                <step.icon aria-hidden className="size-4" />
              </span>
              <span className="pt-1.5">{step.text}</span>
            </li>
          ))}
        </ol>
        <Button ref={close} variant="secondary" className="mt-5 w-full" onClick={onClose}>
          Got it
        </Button>
      </div>
    </motion.dialog>
  );
}

"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  confirmIcon?: ReactNode;
  onConfirm(): void;
  onClose(): void;
}

/**
 * A modal confirmation built on <dialog>.showModal(): the browser traps focus, makes the rest
 * of the page inert and puts the dialog in the top layer (so the phase transition's transform
 * can't displace it). Focus starts on Cancel, Escape and the backdrop close it, and closing
 * returns focus to the button that opened it.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  return <AnimatePresence>{props.open && <DialogBody key="dialog" {...props} />}</AnimatePresence>;
}

function DialogBody({ title, children, confirmLabel, confirmIcon, onConfirm, onClose }: ConfirmDialogProps) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  // Open as a modal on mount and close on unmount (after the exit animation), which also
  // restores focus to whatever opened it.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    cancel.current?.focus();
    return () => element.close();
  }, []);

  return (
    <motion.dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      onCancel={(event) => {
        // Escape: animate out through React instead of the browser closing it at once.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // Only a click on the backdrop targets the <dialog> itself (the content fills it).
        if (event.target === event.currentTarget) onClose();
      }}
      initial={{ opacity: 0, scale: 0.95, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: 6 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-line bg-panel p-0 text-ink shadow-card backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
    >
      <div className="p-5 sm:p-6">
        <h2 id={`${id}-title`} className="text-lg font-semibold text-ink">
          {title}
        </h2>
        <div id={`${id}-body`} className="mt-2 text-sm leading-relaxed text-ink-2">
          {children}
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={cancel} variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={confirmIcon} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </motion.dialog>
  );
}

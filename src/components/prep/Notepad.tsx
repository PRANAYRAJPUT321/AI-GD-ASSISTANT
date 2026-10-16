"use client";

import { Lock } from "lucide-react";
import { useId } from "react";
import { cn } from "@/components/ui/cn";

interface NotepadProps {
  value: string;
  onChange(value: string): void;
  /** Smaller variant for the room's side panel (no heading; fills its container). */
  compact?: boolean;
  autoFocus?: boolean;
}

const PLACEHOLDER = [
  "Jot down quickly, in your own shorthand:",
  "• What the topic means (or how you'll interpret it)",
  "• 2–3 angles: economic, social, ethical, stakeholders…",
  "• One example or number you can quote",
  "• Your stance, and the opening line you'll say first",
].join("\n");

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Private scratchpad for the candidate's points. Used in prep and in the room (compact). */
export function Notepad({ value, onChange, compact = false, autoFocus = false }: NotepadProps) {
  const id = useId();
  const words = countWords(value);
  const wordLabel = `${words} word${words === 1 ? "" : "s"}`;

  return (
    <div className={cn("flex h-full min-h-0 flex-col", compact ? "gap-2" : "gap-3")}>
      {!compact && (
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={id} className="text-lg font-semibold text-ink">
            Your notes
          </label>
          <span className="text-xs tabular-nums text-ink-2">{wordLabel}</span>
        </div>
      )}
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoFocus={autoFocus}
        aria-label={compact ? "Your notes" : undefined}
        aria-describedby={`${id}-privacy`}
        placeholder={PLACEHOLDER}
        spellCheck
        className={cn(
          "w-full flex-1 resize-y rounded-xl border border-line bg-panel-2/60 text-ink placeholder:text-ink-2",
          "leading-relaxed outline-none transition-[border-color,box-shadow,background-color] duration-150",
          "focus-visible:border-accent focus-visible:bg-panel focus-visible:ring-4 focus-visible:ring-accent/20",
          compact ? "min-h-40 p-3 text-sm" : "min-h-64 p-4 text-base sm:min-h-72",
        )}
      />
      <div className="flex items-center justify-between gap-3 text-xs text-ink-2">
        <span id={`${id}-privacy`} className="inline-flex items-center gap-1.5">
          <Lock aria-hidden className="size-3.5" />
          Private: never sent to the AI.
        </span>
        {compact && <span className="tabular-nums">{wordLabel}</span>}
      </div>
    </div>
  );
}

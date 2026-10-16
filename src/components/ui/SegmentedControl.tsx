"use client";

import { motion } from "motion/react";
import { useId } from "react";
import { cn } from "./cn";

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
  /** Optional second line, e.g. "Quick round". */
  description?: string;
}

interface SegmentedControlProps<T extends string | number> {
  /** Visible group label (rendered as the fieldset legend). */
  label: string;
  options: readonly SegmentOption<T>[];
  value: NoInfer<T>;
  onChange(value: NoInfer<T>): void;
}

/**
 * A single-choice control drawn as segments with a sliding highlight. Built on native radio
 * inputs, so arrow keys, form semantics and screen-reader announcements come for free.
 */
export function SegmentedControl<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const id = useId();
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-semibold text-ink">{label}</legend>
      <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-panel-2 p-1">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={String(option.value)}
              className={cn(
                "relative flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-lg px-2 py-1.5 text-center",
                "transition-colors duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                selected ? "text-ink" : "text-ink-2 hover:text-ink",
              )}
            >
              <input
                type="radio"
                className="sr-only"
                name={id}
                value={String(option.value)}
                checked={selected}
                onChange={() => onChange(option.value)}
              />
              {selected && (
                <motion.span
                  aria-hidden
                  layoutId={`${id}-thumb`}
                  className="absolute inset-0 rounded-lg border border-line bg-panel shadow-card"
                  transition={{ type: "spring", stiffness: 520, damping: 40 }}
                />
              )}
              <span className="relative text-sm font-semibold">{option.label}</span>
              {option.description && <span className="relative text-xs text-ink-2">{option.description}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

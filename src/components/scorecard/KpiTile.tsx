import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { Reveal } from "./Reveal";

export type KpiTone = "good" | "warn";

const TONE_CLASS: Record<KpiTone, string> = {
  good: "text-good",
  warn: "text-warn",
};

export interface KpiTileProps {
  icon: LucideIcon;
  /** Sentence case, no trailing colon. */
  label: string;
  value: ReactNode;
  /** Small unit after the value, e.g. "wpm". */
  unit?: string;
  /** A yes/no style value: an icon in a status colour beside the value (never colour alone). */
  status?: { icon: LucideIcon; tone: KpiTone };
  /** One line of context under the value. */
  detail?: ReactNode;
  /** A caveat, set apart at the bottom of the tile. */
  footnote?: ReactNode;
  /** A small visual under the value (e.g. a meter). */
  children?: ReactNode;
  /** Entrance delay in seconds, to stagger a row of tiles. */
  delay?: number;
}

/**
 * One headline number. Its root is the <div> grouping a term/definition pair, so tiles must
 * sit directly inside a <dl> (screen readers hear "Entries: 4, including 1 cut-in").
 */
export function KpiTile({
  icon: Icon,
  label,
  value,
  unit,
  status,
  detail,
  footnote,
  children,
  delay,
}: KpiTileProps) {
  const StatusIcon = status?.icon;
  return (
    <Reveal
      delay={delay}
      className="flex h-full flex-col gap-2 rounded-2xl border border-line bg-panel p-3.5 shadow-card sm:p-4 print:break-inside-avoid print:shadow-none"
    >
      <dt className="flex items-center gap-2 text-xs font-semibold leading-tight text-ink-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          <Icon aria-hidden className="size-3.5" />
        </span>
        {label}
      </dt>
      <dd className="flex flex-1 flex-col gap-2">
        <span className="flex flex-wrap items-center gap-x-1.5 text-2xl font-semibold tracking-tight text-ink sm:text-[1.75rem]">
          {StatusIcon && status && (
            <StatusIcon aria-hidden className={cn("size-6 shrink-0", TONE_CLASS[status.tone])} />
          )}
          {value}
          {unit && <span className="text-sm font-medium tracking-normal text-ink-2">{unit}</span>}
        </span>
        {children}
        {detail && <span className="text-xs leading-snug text-ink-2">{detail}</span>}
        {footnote && (
          <span className="mt-auto border-t border-line pt-2 text-[0.6875rem] leading-snug text-ink-2">
            {footnote}
          </span>
        )}
      </dd>
    </Reveal>
  );
}

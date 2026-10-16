"use client";

import { CircleCheck, Headphones, Keyboard, TriangleAlert, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";

type Tone = "good" | "warn" | "info";

const TONE_CLASS: Record<Tone, string> = {
  good: "bg-good/12 text-good",
  warn: "bg-warn/14 text-warn",
  info: "bg-accent-soft text-accent",
};

function CheckRow({
  icon: Icon,
  tone,
  title,
  index,
  children,
}: {
  icon: LucideIcon;
  tone: Tone;
  title: string;
  index: number;
  children: ReactNode;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.08 }}
      className="flex gap-3"
    >
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", TONE_CLASS[tone])}>
        <Icon aria-hidden className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="text-sm leading-snug text-ink-2">{children}</p>
      </div>
    </motion.li>
  );
}

/**
 * Browser readiness for a spoken GD. `recognition` / `speech` are null until checked in the
 * browser (they cannot be known during server rendering).
 */
export function EnvironmentCheck({ recognition, speech }: { recognition: boolean | null; speech: boolean | null }) {
  const checking = recognition === null || speech === null;
  return (
    <Card as="section" aria-labelledby="env-check-title" aria-busy={checking || undefined} className="p-4 sm:p-5">
      <h2 id="env-check-title" className="mb-3 text-sm font-semibold text-ink">
        Your setup
      </h2>
      {checking ? (
        <div className="flex flex-col gap-3">
          <p className="sr-only">Checking your browser…</p>
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex animate-pulse gap-3 motion-reduce:animate-none">
              <span className="size-8 rounded-lg bg-panel-2" />
              <span className="flex flex-1 flex-col gap-1.5 pt-1">
                <span className="h-3 w-2/5 rounded bg-panel-2" />
                <span className="h-3 w-4/5 rounded bg-panel-2" />
              </span>
            </div>
          ))}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {recognition ? (
            <CheckRow icon={CircleCheck} tone="good" title="Voice input ready" index={0}>
              Your browser can turn your speech into text, so you speak your turns.
            </CheckRow>
          ) : (
            <CheckRow icon={Keyboard} tone="warn" title="Text mode: you'll type your turns" index={0}>
              This browser can&apos;t recognise speech. For the full spoken GD, use Chrome or Edge on a desktop.
            </CheckRow>
          )}
          {speech ? (
            <CheckRow icon={CircleCheck} tone="good" title="AI voices ready" index={1}>
              The participants speak out loud, with live captions.
            </CheckRow>
          ) : (
            <CheckRow icon={TriangleAlert} tone="warn" title="No AI voices in this browser" index={1}>
              You&apos;ll follow the participants through live captions instead.
            </CheckRow>
          )}
          <CheckRow icon={Headphones} tone="info" title="Wear headphones" index={2}>
            So your mic doesn&apos;t pick up the AI voices and mistake them for you.
          </CheckRow>
        </ul>
      )}
    </Card>
  );
}

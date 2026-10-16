"use client";

import { useId } from "react";
import { castFor, speakerColor, speakerName } from "@/lib/personas";
import type { GDMetrics } from "@/lib/scoring";
import { PERSONA_IDS, type GDRecord, type PersonaId } from "@/lib/types";
import { cn } from "@/components/ui/cn";
import { tint } from "@/components/ui/style";
import { formatPercent, formatSeconds, plural } from "./format";
import { GrowBar } from "./Reveal";

/** Six people at the table: an even split of the airtime. */
export const FAIR_SHARE = 1 / 6;

type Participant = PersonaId | "user";

interface Row {
  id: Participant;
  name: string;
  role: string;
  color: string;
  seconds: number;
  share: number;
  /** Times this person took the floor in the discussion (continuations excluded). */
  turns: number;
}

function buildRows(metrics: GDMetrics, record: GDRecord): Row[] {
  const { userName } = record.config;
  const cast = castFor(userName);
  const turns = new Map<Participant, number>();
  for (const turn of record.transcript) {
    if (turn.phase !== "discussion" || turn.speaker === "moderator" || turn.continuation) continue;
    turns.set(turn.speaker, (turns.get(turn.speaker) ?? 0) + 1);
  }
  const total = metrics.totalAirtimeSec;
  const ids: Participant[] = ["user", ...PERSONA_IDS];
  return (
    ids
      .map((id) => {
        const seconds = metrics.airtimeBySpeaker[id] ?? 0;
        return {
          id,
          name: speakerName(id, cast, userName),
          role: id === "user" ? "You" : cast[id].role,
          color: speakerColor(id, cast),
          seconds,
          share: total > 0 ? seconds / total : 0,
          turns: turns.get(id) ?? 0,
        };
      })
      // Most airtime first; Array.prototype.sort is stable, so ties keep the table order.
      .sort((a, b) => b.seconds - a.seconds)
  );
}

/** The axis runs to the next 10% above both the largest share and the fair share. */
function scaleMax(rows: Row[]): number {
  const largest = Math.max(FAIR_SHARE, ...rows.map((row) => row.share));
  return Math.min(1, Math.ceil(largest * 10 + 1e-9) / 10);
}

/**
 * Who held the floor: one horizontal bar per participant, longest first, in each persona's
 * colour, with the name, speaking time and share written beside every bar (so nothing relies
 * on colour), the candidate's row highlighted, and a fair-share mark on every track.
 */
export function AirtimeChart({ metrics, record }: { metrics: GDMetrics; record: GDRecord }) {
  const id = useId();
  const rows = buildRows(metrics, record);
  const max = scaleMax(rows);
  const fairLeft = `${(FAIR_SHARE / max) * 100}%`;

  if (metrics.totalAirtimeSec <= 0) {
    return <p className="text-sm text-ink-2">No speaking time was recorded in the discussion.</p>;
  }

  return (
    <figure aria-labelledby={`${id}-caption`} className="flex flex-col gap-4 [print-color-adjust:exact]">
      <figcaption id={`${id}-caption`} className="sr-only">
        Speaking time in the discussion by participant, longest first.
      </figcaption>
      <ol className="flex flex-col gap-1">
        {rows.map((row, index) => {
          const isUser = row.id === "user";
          return (
            <li
              key={row.id}
              className={cn("rounded-xl px-3 py-2", isUser && "border border-line")}
              style={isUser ? { background: tint(row.color, 9) } : undefined}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: row.color }} />
                  <span className={cn("truncate text-sm text-ink", isUser ? "font-bold" : "font-semibold")}>
                    {row.name}
                  </span>
                  {isUser ? (
                    <span className="rounded-full bg-panel px-1.5 py-px text-[0.6875rem] font-bold text-ink shadow-card">
                      You
                    </span>
                  ) : (
                    <span className="hidden truncate text-xs text-ink-2 min-[26rem]:inline">{row.role}</span>
                  )}
                </span>
                <span className="text-sm tabular-nums text-ink-2">
                  <span className="text-xs">{plural(row.turns, "turn")}</span> · {formatSeconds(row.seconds)} ·{" "}
                  <span className="font-semibold text-ink">{formatPercent(row.share)}</span>
                </span>
              </div>
              <div aria-hidden className="relative mt-1.5 h-3 border-l border-line">
                {row.seconds > 0 && (
                  <GrowBar
                    delay={0.1 + index * 0.07}
                    className="h-full rounded-r-[4px]"
                    style={{ width: `max(2px, ${(row.share / max) * 100}%)`, background: row.color }}
                  />
                )}
                <span className="absolute -inset-y-1 w-px bg-ink-2" style={{ left: fairLeft }} />
              </div>
            </li>
          );
        })}
      </ol>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-3.5 w-px bg-ink-2" />
          Fair share: one sixth of the airtime (about 17%)
        </span>
        <span>Total {formatSeconds(metrics.totalAirtimeSec)} of speaking, moderator excluded</span>
      </p>
    </figure>
  );
}

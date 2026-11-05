"use client";

import { Box, LayoutGrid, Scissors } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type CSSProperties } from "react";
import type { Cast } from "@/lib/personas";
import type { EngineState } from "@/lib/types";
import { cn } from "@/components/ui/cn";
import { useStoredString, writeStored } from "@/components/ui/hooks";
import { ringStyle, tint } from "@/components/ui/style";
import { ArenaSlot, type ArenaSeat } from "@/components/three/ArenaSlot";
import { useArena3D } from "@/components/three/support";
import { Equalizer, ThinkingDots } from "./bits";
import {
  formatAirtime,
  recentlyCutOff,
  SEAT_ORDER,
  seatInfo,
  seatReactions,
  stageStatus,
  type ByParticipant,
  type SeatInfo,
  type SeatReaction,
  type StageStatus,
} from "./model";

/**
 * Where each seat sits on the oval (md and up), as CSS lengths for the seat's centre. Seats are
 * spaced evenly around an ellipse starting at the head of the table, inside a box inset by
 * half a seat so no seat leaves the stage.
 */
function seatPosition(index: number): CSSProperties {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / SEAT_ORDER.length;
  const fx = (0.5 + 0.5 * Math.cos(angle)).toFixed(4);
  const fy = (0.5 + 0.5 * Math.sin(angle)).toFixed(4);
  return {
    ["--seat-x" as string]: `calc(4.75rem + (100% - 9.5rem) * ${fx})`,
    ["--seat-y" as string]: `calc(4rem + (100% - 8rem) * ${fy})`,
  } as CSSProperties;
}

const SEAT_POSITIONS = SEAT_ORDER.map((_, index) => seatPosition(index));

interface StageProps {
  state: EngineState;
  cast: Cast;
  airtime: ByParticipant;
  turns: ByParticipant;
  /** A live mic level is available, so the candidate's equalizer can follow their voice. */
  hasMicMeter: boolean;
}

/** Remembers whether the candidate prefers the flat table to the 3D one. */
const STAGE_VIEW_KEY = "gd-arena:stage-view";

function seatDetail(turnCount: number | undefined, airtimeMs: number | undefined): string {
  return turnCount ? `${turnCount} turn${turnCount === 1 ? "" : "s"} · ${formatAirtime(airtimeMs ?? 0)}` : "Yet to speak";
}

/**
 * The table. Where the browser can draw WebGL, a 3D arena: the speaker bobs and sends out sound
 * rings, whoever is about to speak shows dots, a speaker who was cut off flashes red, and
 * listeners react (a toggle switches to the flat table, which also shows while it loads).
 * The flat table: an oval with the moderator at the head and everyone else around it on
 * tablets and desktops, a compact grid on phones. Either way the seat list below stays in the
 * page for screen readers.
 */
export function Stage({ state, cast, airtime, turns, hasMicMeter }: StageProps) {
  const status = stageStatus(state, cast);
  const cutOff = recentlyCutOff(state);
  const reactions = seatReactions(state);

  const canShow3D = useArena3D();
  const storedView = useStoredString(STAGE_VIEW_KEY);
  const [viewDraft, setViewDraft] = useState<"3d" | "flat" | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const view = viewDraft ?? (storedView === "flat" ? "flat" : "3d");
  const want3D = canShow3D && !failed && view === "3d";
  const show3D = want3D && ready;

  function toggleView() {
    const next = view === "3d" ? "flat" : "3d";
    setViewDraft(next);
    setReady(false);
    writeStored(STAGE_VIEW_KEY, next);
  }

  const speakerSeat = status.speaker ? seatInfo(status.speaker, cast) : null;
  const userVoice = seatVoice("user", state, hasMicMeter);
  const arenaSeats: ArenaSeat[] = SEAT_ORDER.map((id) => {
    const info = seatInfo(id, cast);
    return {
      id,
      name: info.name,
      emoji: info.emoji,
      color: info.color,
      detail: id === "moderator" ? null : seatDetail(turns[id], airtime[id]),
    };
  });

  return (
    <section
      aria-label="The table"
      className={cn(
        "relative overflow-hidden rounded-3xl border border-line bg-panel shadow-card md:h-[27rem]",
        show3D ? "h-80" : "p-3 sm:p-4 md:p-0",
      )}
    >
      {want3D && (
        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-500",
            show3D ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <ArenaSlot
            seats={arenaSeats}
            speaking={state.activeSpeaker}
            preparing={state.preparing}
            cutOff={cutOff}
            reactions={reactions}
            level={state.activeSpeaker === "user" && typeof userVoice === "number" ? userVoice : null}
            caption={status.text}
            captionDetail={statusDetail(status)}
            captionColor={speakerSeat && status.tone !== "waiting" ? speakerSeat.color : undefined}
            details
            onReady={() => setReady(true)}
            onFail={() => setFailed(true)}
            className="size-full"
          />
        </div>
      )}
      {canShow3D && !failed && (
        <button
          type="button"
          onClick={toggleView}
          aria-pressed={view === "3d"}
          className="absolute right-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-full border border-line bg-panel/85 px-2.5 py-1 text-xs font-semibold text-ink-2 shadow-card backdrop-blur transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
        >
          {view === "3d" ? <LayoutGrid aria-hidden className="size-3.5" /> : <Box aria-hidden className="size-3.5" />}
          {view === "3d" ? "Flat view" : "3D view"}
        </button>
      )}

      {/* Soft spotlight in the speaker's colour behind the table (decorative). */}
      <SpeakerGlow speaker={status.speaker && status.tone !== "waiting" ? seatInfo(status.speaker, cast) : null} />

      {!show3D && (
        <FlatTable status={status} cast={cast} />
      )}

      <ul
        aria-label="Participants"
        className={cn("relative grid grid-cols-3 gap-2 md:absolute md:inset-0 md:block", show3D && "sr-only")}
      >
        {SEAT_ORDER.map((id, index) => (
          <Seat
            key={id}
            seat={seatInfo(id, cast)}
            style={SEAT_POSITIONS[index]}
            speaking={state.activeSpeaker === id}
            preparing={state.preparing === id}
            cutOff={cutOff.has(id)}
            reaction={reactions.get(id) ?? null}
            turns={id === "moderator" ? null : turns[id]}
            airtimeMs={id === "moderator" ? null : airtime[id]}
            voice={seatVoice(id, state, hasMicMeter)}
            interjecting={state.floor === "user" && state.activeSpeaker === id && id !== "user"}
          />
        ))}
      </ul>
    </section>
  );
}

/** The flat table's oval, its centre line, and the phone's status line above the seat grid. */
function FlatTable({ status, cast }: { status: StageStatus; cast: Cast }) {
  return (
    <>
      {/* The table, drawn as a solid slab: a glossy top over a darker edge, casting a shadow. */}
      <div
        aria-hidden
        className="absolute inset-x-[25%] inset-y-[27%] hidden rounded-[50%] md:block"
        style={{
          background: "color-mix(in srgb, var(--accent) 45%, black)",
          transform: "translateY(10px)",
          boxShadow: "0 26px 40px -18px rgb(0 0 0 / 0.45)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-x-[25%] inset-y-[27%] hidden rounded-[50%] border border-white/15 md:block"
        style={{
          background:
            "radial-gradient(ellipse at 35% 25%, color-mix(in srgb, white 45%, transparent), transparent 45%)," +
            "radial-gradient(ellipse at 50% 50%, color-mix(in srgb, var(--accent) 14%, var(--panel)), color-mix(in srgb, var(--accent-2) 20%, var(--panel-2)))",
          boxShadow: "inset 0 -6px 18px rgb(0 0 0 / 0.12), inset 0 2px 0 rgb(255 255 255 / 0.25)",
        }}
      />
      <TableCentre status={status} cast={cast} className="absolute inset-x-[25%] inset-y-[27%] hidden md:flex" />
      <StatusLine status={status} cast={cast} className="mb-3 md:hidden" />
    </>
  );
}

/**
 * How a speaking seat's equalizer moves: AI voices loop, the candidate's follows their mic
 * level (or loops when there is no meter), and typed turns show none.
 */
function seatVoice(id: SeatInfo["id"], state: EngineState, hasMicMeter: boolean): SeatVoice {
  if (id !== "user") return "loop";
  if (state.inputMode === "text") return null;
  return hasMicMeter ? state.micLevel : "loop";
}

function SpeakerGlow({ speaker }: { speaker: SeatInfo | null }) {
  return (
    <AnimatePresence>
      {speaker && (
        <motion.div
          key={speaker.id}
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(ellipse 60% 55% at 50% 50%, ${tint(speaker.color, 12)}, transparent 70%)`,
          }}
        />
      )}
    </AnimatePresence>
  );
}

function statusDetail(status: StageStatus): string | null {
  switch (status.tone) {
    case "open":
      return "Jump in now";
    case "you":
      return "Everyone is listening";
    case "alert":
      return status.speaker ? "Hold your ground" : null;
    case "speaking":
    case "waiting":
      return null;
  }
}

/** The line in the middle of the table: who is speaking, or that the floor is open. */
function TableCentre({ status, cast, className }: { status: StageStatus; cast: Cast; className?: string }) {
  const seat = status.speaker ? seatInfo(status.speaker, cast) : null;
  const detail = statusDetail(status);
  return (
    <div className={cn("items-center justify-center px-6 text-center", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={status.text}
          initial={{ opacity: 0, y: 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          className="flex flex-col items-center gap-1.5"
        >
          {seat && (
            <span
              aria-hidden
              className="grid size-9 place-items-center rounded-full text-lg"
              style={{ background: tint(seat.color, 20) }}
            >
              {seat.emoji}
            </span>
          )}
          {status.tone === "open" && <OpenFloorMark />}
          <p className="text-balance text-sm font-semibold text-ink lg:text-base">{status.text}</p>
          {detail && <p className="text-xs text-ink-2">{detail}</p>}
          {status.tone === "waiting" && seat && <ThinkingDots color={seat.color} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** A small "open mic" mark for the empty floor. */
function OpenFloorMark() {
  return (
    <span aria-hidden className="relative grid size-9 place-items-center">
      <span className="speaking-ring absolute inset-1 rounded-full" style={ringStyle("var(--accent)")} />
      <span className="size-3 rounded-full bg-accent" />
    </span>
  );
}

/** Phone layout: the table's status as one line above the seat grid. */
function StatusLine({ status, cast, className }: { status: StageStatus; cast: Cast; className?: string }) {
  const seat = status.speaker ? seatInfo(status.speaker, cast) : null;
  return (
    <div className={cn("flex min-h-7 items-center gap-2", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.p
          key={status.text}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink"
        >
          {seat ? (
            <span aria-hidden className="text-base">
              {seat.emoji}
            </span>
          ) : (
            <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-accent" />
          )}
          <span className="truncate">{status.text}</span>
          {status.tone === "waiting" && seat && <ThinkingDots color={seat.color} className="shrink-0" />}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

/** A live 0..1 level, a looping animation, or no equalizer. */
type SeatVoice = number | "loop" | null;

interface SeatProps {
  seat: SeatInfo;
  style: CSSProperties;
  speaking: boolean;
  preparing: boolean;
  cutOff: boolean;
  /** A listener's emoji reaction to the turn that just ended. */
  reaction: SeatReaction | null;
  /** null for the moderator, who has no stats. */
  turns: number | null;
  airtimeMs: number | null;
  /** What the equalizer shows while this seat speaks. */
  voice: SeatVoice;
  /** This AI is talking over the candidate. */
  interjecting: boolean;
}

function seatStatusText({ seat, speaking, preparing, cutOff, interjecting }: SeatProps): string {
  const parts: string[] = [];
  if (interjecting) parts.push("cutting in");
  else if (speaking) parts.push(seat.id === "user" ? "has the floor" : "speaking");
  if (preparing) parts.push("about to speak");
  if (cutOff) parts.push("just cut off");
  return parts.length ? `, ${parts.join(", ")}` : "";
}

function Seat(props: SeatProps) {
  const { seat, style, speaking, preparing, cutOff, reaction, turns, airtimeMs, voice } = props;
  const moderator = seat.id === "moderator";
  const stats =
    turns === null || airtimeMs === null
      ? null
      : turns === 0
        ? "Yet to speak"
        : `${turns} turn${turns === 1 ? "" : "s"} · ${formatAirtime(airtimeMs)}`;

  return (
    <li
      style={{ ...style, ...(speaking ? { borderColor: seat.color, background: tint(seat.color, 9) } : null) }}
      className={cn(
        "relative flex min-w-0 items-center gap-2 rounded-xl border border-line bg-panel-2/40 p-2 transition-[background-color,border-color] duration-300",
        moderator ? "col-span-3 flex-row" : "flex-col text-center",
        // On the oval: a borderless seat centred on its position.
        "md:absolute md:left-(--seat-x) md:top-(--seat-y) md:w-[8.5rem] md:-translate-x-1/2 md:-translate-y-1/2",
        "md:flex-col md:rounded-2xl md:border-transparent md:bg-transparent md:text-center",
      )}
    >
      <motion.div
        className="relative shrink-0"
        animate={{ scale: speaking ? 1.07 : 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 22 }}
      >
        <span
          aria-hidden
          className={cn(
            "grid place-items-center rounded-full border-2 transition-[border-color,background-color] duration-300",
            moderator ? "size-9 text-lg md:size-14 md:text-2xl" : "size-11 text-xl md:size-14 md:text-2xl",
            speaking && "speaking-ring",
          )}
          style={ringStyle(seat.color, {
            background: tint(seat.color, speaking ? 30 : 15),
            borderColor: speaking ? seat.color : "transparent",
          })}
        >
          {seat.emoji}
        </span>
        <AnimatePresence>
          {speaking && voice !== null && (
            <motion.span
              aria-hidden
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-line bg-panel px-1.5 py-1 shadow-card"
            >
              <Equalizer color={seat.color} level={voice === "loop" ? undefined : voice} />
            </motion.span>
          )}
        </AnimatePresence>
        <AnimatePresence>{cutOff && <CutOffTag />}</AnimatePresence>
        <AnimatePresence>{reaction && <ReactionBubble key={reaction.key} emoji={reaction.emoji} />}</AnimatePresence>
      </motion.div>

      <div className={cn("flex min-w-0 max-w-full flex-col", moderator ? "md:items-center" : "items-center")}>
        <p className={cn("max-w-full truncate text-sm font-semibold text-ink", speaking && "md:text-base")}>
          {seat.name}
        </p>
        <p className="max-w-full truncate text-[11px] leading-tight text-ink-2">{seat.role}</p>
        {preparing ? (
          <ThinkingDots color={seat.color} className="mt-1 h-4" />
        ) : (
          stats && <p className="mt-0.5 max-w-full truncate text-[11px] tabular-nums leading-4 text-ink-2">{stats}</p>
        )}
      </div>
      <span className="sr-only">{seatStatusText(props)}</span>
    </li>
  );
}

/** A listener's emoji, popping up beside their avatar and floating off (decorative). */
function ReactionBubble({ emoji }: { emoji: string }) {
  return (
    <motion.span
      aria-hidden
      initial={{ opacity: 0, scale: 0.3, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.85, y: -16 }}
      transition={{ type: "spring", stiffness: 460, damping: 17 }}
      className="absolute -left-4 -top-3 z-10 grid size-8 place-items-center rounded-full border border-line bg-panel text-base shadow-card"
    >
      {emoji}
    </motion.span>
  );
}

function CutOffTag() {
  return (
    <motion.span
      aria-hidden
      initial={{ opacity: 0, scale: 0.5, rotate: -8 }}
      animate={{ opacity: [0, 1, 0.55, 1], scale: 1, rotate: 0 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ duration: 0.6 }}
      className="absolute -right-5 -top-2 z-10 inline-flex items-center gap-0.5 whitespace-nowrap rounded-full bg-bad px-1.5 py-0.5 text-[10px] font-bold text-panel shadow-card"
    >
      <Scissors className="size-2.5" />
      Cut off
    </motion.span>
  );
}

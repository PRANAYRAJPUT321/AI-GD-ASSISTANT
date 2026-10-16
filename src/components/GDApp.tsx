"use client";

import { LoaderCircle } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiCallError, startSession } from "@/lib/api";
import type { Scorecard } from "@/lib/scoring";
import type { GDConfig, GDRecord } from "@/lib/types";
import { PrepScreen } from "./prep/PrepScreen";
import { SetupScreen, type SetupChoice } from "./setup/SetupScreen";
import { cn } from "./ui/cn";
import { ErrorBoundary } from "./ui/ErrorBoundary";

// The room and the scorecard are only needed after setup, so they load on demand (and are
// warmed up one phase early) to keep the first screen light on phones.
const loadRoom = () => import("./room/Room");
const loadScoringScreen = () => import("./scorecard/ScoringScreen");
const loadScorecardView = () => import("./scorecard/ScorecardView");
const Room = lazy(() => loadRoom().then((module) => ({ default: module.Room })));
const ScoringScreen = lazy(() => loadScoringScreen().then((module) => ({ default: module.ScoringScreen })));
const ScorecardView = lazy(() => loadScorecardView().then((module) => ({ default: module.ScorecardView })));

/** Starts downloading a screen's code without waiting; a failure resurfaces when it renders. */
function warm(load: () => Promise<unknown>): void {
  load().catch(() => undefined);
}

type Phase =
  | { name: "setup"; initial?: Partial<SetupChoice> }
  | { name: "prep"; choice: SetupChoice; token: string; issuedAt: number }
  | { name: "room"; config: GDConfig }
  | { name: "scoring"; record: GDRecord; token: string }
  | { name: "scorecard"; card: Scorecard };

type PhaseName = Phase["name"];

/**
 * A session token from a GD that never started (the candidate went back from prep). Starting
 * again soon reuses it instead of spending another of today's GDs.
 */
interface SpareSession {
  token: string;
  issuedAt: number;
  topicId: string;
}

/**
 * Tokens expire 45 minutes after issue. Reuse one only while it can still cover prep, the
 * longest GD with its summaries, and scoring.
 */
const SPARE_SESSION_MAX_AGE_MS = 20 * 60_000;

const START_ERROR = "Couldn't start the GD. Check your connection and try again.";

/** Setup pre-fill carried over from a finished or abandoned GD. */
function prefillFrom(config: GDRecord["config"], keepTopic: boolean): Partial<SetupChoice> {
  return {
    userName: config.userName,
    minutes: config.minutes,
    sttLang: config.sttLang,
    ...(keepTopic ? { topic: config.topic } : {}),
  };
}

/** What setup should pre-fill when leaving `phase` abruptly (e.g. after a crash). */
function prefillForPhase(phase: Phase): Partial<SetupChoice> {
  switch (phase.name) {
    case "setup":
      return phase.initial ?? {};
    case "prep":
      return phase.choice;
    case "room":
      return prefillFrom(phase.config, true);
    case "scoring":
      return prefillFrom(phase.record.config, true);
    case "scorecard":
      return prefillFrom(phase.card.record.config, false);
  }
}

/**
 * The whole app: setup → prep → room → scoring → scorecard. Owns the phase, the prep notes
 * and the session token; each screen gets only what it needs through its props.
 */
export function GDApp({ dailyLimit }: { dailyLimit: number | null }) {
  const [phase, setPhase] = useState<Phase>({ name: "setup" });
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** GDs left today after the current one, from the last startSession; null = unknown/unlimited. */
  const [remainingToday, setRemainingToday] = useState<number | null>(null);
  /** False until the first phase change: the landing screen must not steal focus or scroll. */
  const [navigated, setNavigated] = useState(false);
  const spare = useRef<SpareSession | null>(null);

  // Leaving the page mid-prep or mid-GD loses the session: ask the browser to confirm.
  const guardUnload = phase.name === "prep" || phase.name === "room";
  useEffect(() => {
    if (!guardUnload) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers only show the prompt when returnValue is set.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [guardUnload]);

  function go(next: Phase) {
    setNavigated(true);
    setPhase(next);
  }

  function enterPrep(choice: SetupChoice, token: string, issuedAt: number) {
    warm(loadRoom);
    go({ name: "prep", choice, token, issuedAt });
  }

  async function handleStart(choice: SetupChoice) {
    if (busy) return;
    setError(null);

    const reusable = spare.current;
    spare.current = null;
    if (reusable && Date.now() - reusable.issuedAt < SPARE_SESSION_MAX_AGE_MS) {
      // Same topic: keep the notes they had started; a new topic starts a clean page.
      if (reusable.topicId !== choice.topic.id) setNotes("");
      enterPrep(choice, reusable.token, reusable.issuedAt);
      return;
    }

    setBusy(true);
    try {
      const session = await startSession();
      setRemainingToday(session.remainingToday);
      setNotes("");
      enterPrep(choice, session.token, Date.now());
    } catch (err) {
      setError(err instanceof ApiCallError ? err.message : START_ERROR);
    } finally {
      setBusy(false);
    }
  }

  function handlePrepBack() {
    if (phase.name !== "prep") return;
    spare.current = { token: phase.token, issuedAt: phase.issuedAt, topicId: phase.choice.topic.id };
    go({ name: "setup", initial: phase.choice });
  }

  function handleReady() {
    warm(loadScoringScreen);
    warm(loadScorecardView);
    // Functional update: a late second call (timer and button racing during the exit
    // animation) must not rebuild the config and restart the room.
    setNavigated(true);
    setPhase((current) => {
      if (current.name !== "prep") return current;
      const { topic, userName, minutes, sttLang, inputMode } = current.choice;
      return {
        name: "room",
        config: { topic, userName, minutes, sttLang, inputMode, token: current.token, notes },
      };
    });
  }

  function handleFinished(record: GDRecord) {
    setNavigated(true);
    setPhase((current) =>
      current.name === "room" ? { name: "scoring", record, token: current.config.token } : current,
    );
  }

  function backToSetup(initial: Partial<SetupChoice>) {
    setError(null);
    go({ name: "setup", initial });
  }

  function renderPhase(): ReactNode {
    switch (phase.name) {
      case "setup":
        return (
          <SetupScreen
            dailyLimit={dailyLimit}
            initial={phase.initial}
            onStart={(choice) => void handleStart(choice)}
            busy={busy}
            error={error}
          />
        );
      case "prep":
        return (
          <PrepScreen
            topic={phase.choice.topic}
            userName={phase.choice.userName}
            minutes={phase.choice.minutes}
            notes={notes}
            onNotesChange={setNotes}
            onReady={handleReady}
            onBack={handlePrepBack}
          />
        );
      case "room":
        return (
          <Room
            config={phase.config}
            onNotesChange={setNotes}
            onFinished={handleFinished}
            onLeave={() => backToSetup(prefillForPhase(phase))}
          />
        );
      case "scoring":
        return (
          <ScoringScreen
            record={phase.record}
            token={phase.token}
            onScored={(card: Scorecard) => go({ name: "scorecard", card })}
            onBack={() => backToSetup(prefillForPhase(phase))}
          />
        );
      case "scorecard":
        return <ScorecardView card={phase.card} onRestart={() => backToSetup(prefillForPhase(phase))} />;
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-full flex-1 flex-col overflow-x-clip">
        <AppHeader phase={phase.name} remainingToday={remainingToday} />
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
          <AnimatePresence mode="wait" initial={false}>
            <PhaseFrame key={phase.name} manageFocus={navigated}>
              <ErrorBoundary onReset={() => backToSetup(prefillForPhase(phase))}>
                <Suspense fallback={<ScreenLoading />}>{renderPhase()}</Suspense>
              </ErrorBoundary>
            </PhaseFrame>
          </AnimatePresence>
        </main>
      </div>
    </MotionConfig>
  );
}

/**
 * Animated wrapper for one phase. On entering a new phase it scrolls to the top and moves
 * focus to the new screen (unless the screen already focused something, like the notepad),
 * so keyboard and screen-reader users land at the start of what changed.
 */
function PhaseFrame({ manageFocus, children }: { manageFocus: boolean; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);

  // Keyed by phase name, so this runs when a phase is entered (manageFocus never flips
  // while one phase is showing).
  useEffect(() => {
    if (!manageFocus) return;
    window.scrollTo({ top: 0 });
    const element = frame.current;
    if (element && !element.contains(document.activeElement)) element.focus({ preventScroll: true });
  }, [manageFocus]);

  // MotionConfig reducedMotion="user" drops the slide (keeps the fade) for reduced motion.
  return (
    <motion.div
      ref={frame}
      tabIndex={-1}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -14 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-1 flex-col outline-none"
    >
      {children}
    </motion.div>
  );
}

function ScreenLoading() {
  return (
    <div role="status" className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-ink-2">
      <LoaderCircle aria-hidden className="size-7 animate-spin text-accent motion-reduce:animate-none" />
      <span className="text-sm">Loading…</span>
    </div>
  );
}

const STEPS: readonly { label: string; phases: readonly PhaseName[] }[] = [
  { label: "Topic", phases: ["setup"] },
  { label: "Prep", phases: ["prep"] },
  { label: "Discussion", phases: ["room"] },
  { label: "Scorecard", phases: ["scoring", "scorecard"] },
];

function AppHeader({ phase, remainingToday }: { phase: PhaseName; remainingToday: number | null }) {
  const current = STEPS.findIndex((step) => step.phases.includes(phase));
  return (
    <header className="border-b border-line bg-panel/60">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <LogoMark />
          <span className="text-base font-bold tracking-tight text-ink">GD Arena</span>
        </div>

        <ol aria-label="Progress" className="hidden items-center gap-1 rounded-full bg-panel-2 p-1 sm:flex">
          {STEPS.map((step, index) => {
            const active = index === current;
            const done = index < current;
            return (
              <li
                key={step.label}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "relative rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                  active ? "text-accent-ink" : done ? "text-ink" : "text-ink-2",
                )}
              >
                {active && (
                  <motion.span
                    aria-hidden
                    layoutId="phase-step"
                    className="absolute inset-0 rounded-full bg-accent"
                    transition={{ type: "spring", stiffness: 420, damping: 36 }}
                  />
                )}
                <span className="relative">
                  {done && <span className="sr-only">Done: </span>}
                  {step.label}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-ink-2 sm:hidden">
            {current + 1}/{STEPS.length} · {STEPS[current]?.label}
          </span>
          {remainingToday !== null && (
            <motion.span
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="hidden rounded-full border border-line bg-panel px-2.5 py-1 text-xs font-semibold text-ink-2 sm:inline"
            >
              {remainingToday === 0
                ? "No free GDs left today"
                : `${remainingToday} free GD${remainingToday === 1 ? "" : "s"} left today`}
            </motion.span>
          )}
        </div>
      </div>
    </header>
  );
}

/** The app mark: a round table with six seats, one of them (you) highlighted. */
function LogoMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className="size-8 shrink-0">
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      <circle cx="16" cy="16" r="5.5" fill="none" stroke="var(--accent-ink)" strokeWidth="2" opacity="0.9" />
      {[0, 1, 2, 3, 4, 5].map((seat) => {
        const angle = -Math.PI / 2 + (seat * Math.PI) / 3;
        return (
          <circle
            key={seat}
            cx={16 + 10 * Math.cos(angle)}
            cy={16 + 10 * Math.sin(angle)}
            r={seat === 3 ? 2.6 : 2}
            fill={seat === 3 ? "#f0b13c" : "var(--accent-ink)"}
          />
        );
      })}
    </svg>
  );
}

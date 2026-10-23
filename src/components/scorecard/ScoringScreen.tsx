"use client";

import { ArrowLeft, Check, CircleAlert, ClipboardCheck, LoaderCircle, RotateCcw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useEffectEvent, useRef, useState, type Ref } from "react";
import { ApiCallError, requestScore } from "@/lib/api";
import { castFor, USER_COLOR } from "@/lib/personas";
import type { Scorecard } from "@/lib/scoring";
import { PERSONA_IDS, type GDRecord } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";
import { ringStyle } from "@/components/ui/style";
import { DownloadTranscriptButton } from "./DownloadTranscriptButton";
import { EASE_OUT } from "./Reveal";

/** What the evaluator is doing, shown in turn while the score request runs (20–60 s). */
const STEPS = [
  { label: "Reading the transcript", fromSec: 0 },
  { label: "Counting entries and airtime", fromSec: 4 },
  { label: "Weighing your points", fromSec: 10 },
  { label: "Checking your summary", fromSec: 18 },
  { label: "Writing your scorecard", fromSec: 28 },
] as const;

/** After this long, say that it is taking longer than usual. */
const SLOW_AFTER_SEC = 60;
/** Pause on "Scorecard ready" (all steps ticked, bar full) before showing it. */
const READY_BEAT_MS = 650;
const TICK_MS = 250;

/** Codes for which trying again cannot help (expired session, scoring cap, bad input, setup). */
const FINAL_CODES: ReadonlySet<string> = new Set(["bad_token", "score_limit", "bad_request", "too_large", "config", "billing"]);

const GENERIC_ERROR = "Something went wrong while scoring your GD. Try again.";

type Status =
  | { kind: "working" }
  | { kind: "ready" }
  | { kind: "error"; message: string; retryable: boolean };

/**
 * Ref callback that focuses a heading as it mounts. Module-level, so React calls it once per
 * mount rather than on every render. Focusing on mount (not from an effect) matters because
 * AnimatePresence mounts the next state only after the previous one has animated out.
 */
function focusOnMount(node: HTMLElement | null): void {
  node?.focus();
}

function errorStatus(err: unknown): Status {
  if (err instanceof ApiCallError) {
    return { kind: "error", message: err.message, retryable: !FINAL_CODES.has(err.code ?? "") };
  }
  return { kind: "error", message: GENERIC_ERROR, retryable: true };
}

interface ScoringScreenProps {
  record: GDRecord;
  token: string;
  onScored(card: Scorecard): void;
  /** After an error: back to setup. */
  onBack(): void;
}

/** Sends the finished GD for scoring and keeps the candidate company while it runs. */
export function ScoringScreen({ record, token, onScored, onBack }: ScoringScreenProps) {
  const [status, setStatus] = useState<Status>({ kind: "working" });
  /** Bumped on every retry: restarts the progress clock and moves focus to the new heading. */
  const [attempt, setAttempt] = useState(0);
  // The GD ended moments ago; this dates the transcript if it has to be downloaded from here.
  const [date] = useState(() => new Date());
  const started = useRef(false);
  const mounted = useRef(false);
  /** A score request is running: a second click on the fading "Try again" must not send another. */
  const inFlight = useRef(false);
  const readyTimer = useRef<number | undefined>(undefined);
  // After a retry or an error, focus moves to the new heading so keyboard and screen-reader
  // users land on what changed (on first entry the app frame takes focus instead).
  const headingRef = attempt > 0 || status.kind === "error" ? focusOnMount : undefined;

  async function score() {
    inFlight.current = true;
    try {
      const response = await requestScore({ token, record });
      if (!mounted.current) return;
      setStatus({ kind: "ready" });
      readyTimer.current = window.setTimeout(() => onScored({ ...response, record }), READY_BEAT_MS);
    } catch (err) {
      inFlight.current = false;
      if (mounted.current) setStatus(errorStatus(err));
    }
  }

  const startScoring = useEffectEvent(() => void score());

  // Score once on mount. The ref keeps StrictMode's mount → unmount → mount from sending a
  // second request (each one counts against the session's scoring cap); results that land
  // after a real unmount are ignored.
  useEffect(() => {
    mounted.current = true;
    if (!started.current) {
      started.current = true;
      startScoring();
    }
    return () => {
      mounted.current = false;
      window.clearTimeout(readyTimer.current);
    };
  }, []);

  function retry() {
    if (inFlight.current) return;
    setAttempt((n) => n + 1);
    setStatus({ kind: "working" });
    void score();
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-5 py-4 sm:py-10">
      <Card className="overflow-hidden p-6 sm:p-8">
        <AnimatePresence mode="wait" initial={false}>
          {status.kind === "error" ? (
            <motion.div
              key={`error-${attempt}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: EASE_OUT }}
              className="flex flex-col items-center gap-5 text-center"
            >
              <span className="grid size-14 place-items-center rounded-full bg-bad/12 text-bad">
                <CircleAlert aria-hidden className="size-7" />
              </span>
              <div>
                <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-ink outline-none sm:text-2xl">
                  Couldn&apos;t score this GD
                </h1>
                <div role="alert">
                  <p className="mt-2 text-sm text-ink-2">{status.message}</p>
                  <p className="mt-2 text-sm text-ink-2">
                    {status.retryable
                      ? "Your transcript is safe here. Try again, or download it to keep a copy."
                      : "Download your transcript so this GD isn't lost."}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {status.retryable && (
                  <Button variant="primary" icon={<RotateCcw aria-hidden className="size-4" />} onClick={retry}>
                    Try again
                  </Button>
                )}
                <DownloadTranscriptButton record={record} date={date} />
                <Button variant="ghost" icon={<ArrowLeft aria-hidden className="size-4" />} onClick={onBack}>
                  Back to setup
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key={`working-${attempt}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: EASE_OUT }}
            >
              <ScoringProgress record={record} ready={status.kind === "ready"} headingRef={headingRef} />
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </div>
  );
}

/**
 * The working state: the round table "thinking", the step list, a progress bar that eases
 * towards the end without claiming to know it, and the elapsed time. Mounted fresh per
 * attempt, so its clock starts at zero.
 */
function ScoringProgress({
  record,
  ready,
  headingRef,
}: {
  record: GDRecord;
  ready: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (ready) return;
    const startedAt = performance.now();
    const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), TICK_MS);
    return () => window.clearInterval(timer);
  }, [ready]);

  const elapsedSec = elapsedMs / 1000;
  const current = ready
    ? STEPS.length
    : STEPS.reduce((at, step, index) => (elapsedSec >= step.fromSec ? index : at), 0);
  // Asymptotic: about half way at 20 s, never full until the score is actually back.
  const fraction = ready ? 1 : 0.94 * (1 - Math.exp(-elapsedSec / 26));
  const slow = !ready && elapsedSec >= SLOW_AFTER_SEC;

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <ThinkingTable userName={record.config.userName} ready={ready} />
      <div>
        <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-ink outline-none sm:text-2xl">
          {ready ? "Your scorecard is ready" : "Scoring your GD"}
        </h1>
        <p className="mt-1 line-clamp-2 text-sm text-ink-2">{record.config.topic.title}</p>
      </div>

      <div className="w-full">
        <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-panel-2">
          <div
            className="h-full origin-left rounded-full bg-accent transition-transform duration-300 ease-out motion-reduce:transition-none"
            style={{ transform: `scaleX(${fraction})` }}
          />
        </div>
        <p className="mt-2 flex justify-between gap-3 text-xs text-ink-2">
          <span className="tabular-nums">{Math.floor(elapsedSec)} s elapsed</span>
          <span>Usually 20–60 seconds</span>
        </p>
      </div>

      <ol className="flex w-full flex-col gap-2.5 text-left">
        {STEPS.map((step, index) => {
          const state = index < current ? "done" : index === current ? "active" : "pending";
          return (
            <li key={step.label} className="flex items-center gap-3">
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full transition-colors duration-300",
                  state === "done" && "bg-good/14 text-good",
                  state === "active" && "bg-accent-soft text-accent",
                  state === "pending" && "border border-line text-ink-3",
                )}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={state}
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.4, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 500, damping: 28 }}
                    className="grid place-items-center"
                  >
                    {state === "done" ? (
                      <Check aria-hidden className="size-3.5" strokeWidth={3} />
                    ) : state === "active" ? (
                      <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
                    ) : (
                      <span aria-hidden className="size-1.5 rounded-full bg-current" />
                    )}
                  </motion.span>
                </AnimatePresence>
              </span>
              <span className={cn("text-sm", state === "pending" ? "text-ink-2" : "font-medium text-ink")}>
                {step.label}
                <span className="sr-only">
                  {state === "done" ? " (done)" : state === "active" ? " (in progress)" : ""}
                </span>
              </span>
            </li>
          );
        })}
      </ol>

      {/* Step changes and the outcome, announced politely (the clock itself is not). */}
      <p className="sr-only" aria-live="polite">
        {ready ? "Scorecard ready." : `${STEPS[current]?.label ?? ""}…`}
      </p>

      <AnimatePresence>
        {slow && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="text-sm text-ink-2"
            role="status"
          >
            Taking a little longer than usual. Hang tight: the evaluator is still writing.
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Six seats around a table (the five participants in their colours, and you), lighting up
 * one after another while the evaluator reads the GD back. Still with reduced motion
 * (the app's MotionConfig skips transform animations).
 */
function ThinkingTable({ userName, ready }: { userName: string; ready: boolean }) {
  const cast = castFor(userName);
  const seats = [...PERSONA_IDS.map((id) => cast[id].color), USER_COLOR];
  return (
    <div aria-hidden className="relative size-28">
      <motion.div
        className="absolute inset-0"
        animate={ready ? { rotate: 0 } : { rotate: 360 }}
        transition={ready ? { duration: 0.4 } : { duration: 14, ease: "linear", repeat: Infinity }}
      >
        {seats.map((color, index) => {
          const angle = -Math.PI / 2 + (index * 2 * Math.PI) / seats.length;
          return (
            <motion.span
              key={index}
              className="absolute size-4 rounded-full"
              style={{
                left: `calc(50% + ${Math.cos(angle) * 46}% - 0.5rem)`,
                top: `calc(50% + ${Math.sin(angle) * 46}% - 0.5rem)`,
                background: color,
              }}
              animate={ready ? { scale: 1, opacity: 1 } : { scale: [1, 1.45, 1], opacity: [0.55, 1, 0.55] }}
              transition={
                ready
                  ? { duration: 0.3 }
                  : { duration: 1.2, repeat: Infinity, repeatDelay: 0.6, delay: index * 0.3, ease: "easeInOut" }
              }
            />
          );
        })}
      </motion.div>
      <span
        className={cn(
          "absolute inset-6 grid place-items-center rounded-full transition-colors duration-300",
          ready ? "bg-good/14 text-good" : "speaking-ring bg-accent-soft text-accent",
        )}
        style={ringStyle("var(--accent)")}
      >
        <ClipboardCheck className="size-7" />
      </span>
    </div>
  );
}

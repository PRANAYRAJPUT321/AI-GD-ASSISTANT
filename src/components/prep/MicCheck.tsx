"use client";

import { CircleCheck, Keyboard, Mic, MicOff, RotateCcw } from "lucide-react";
import { motion, useMotionValue, useTransform, type MotionValue } from "motion/react";
import { useEffect, useState } from "react";
import { createMicMeter, requestMicPermission } from "@/lib/speech/mic";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";

type MicStatus = "checking" | "live" | "denied" | "unavailable";

const BAR_COUNT = 18;
const BARS = Array.from({ length: BAR_COUNT }, (_, index) => index);
/** Level that counts as "we heard you" (0..1 meter scale; normal speech reads ~0.4–0.85). */
const HEARD_LEVEL = 0.32;

/**
 * Mic check for the prep screen: asks for microphone access now (so the browser prompt
 * doesn't interrupt the GD) and shows a live level meter. In browsers without speech
 * recognition the GD runs in text mode, so it explains that instead.
 */
export function MicCheck({ recognition }: { recognition: boolean | null }) {
  if (recognition === null) return null;
  if (!recognition) {
    return (
      <Card as="section" aria-labelledby="mic-check-title" className="flex gap-3 p-4 sm:p-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-warn/14 text-warn">
          <Keyboard aria-hidden className="size-4" />
        </span>
        <div>
          <h2 id="mic-check-title" className="text-sm font-semibold text-ink">
            Text mode
          </h2>
          <p className="text-sm leading-snug text-ink-2">
            This browser can&apos;t turn speech into text, so you&apos;ll type your turns. The participants still speak.
            For the spoken GD, use Chrome or Edge on a desktop.
          </p>
        </div>
      </Card>
    );
  }
  return <LiveMicCheck />;
}

function LiveMicCheck() {
  const [status, setStatus] = useState<MicStatus>("checking");
  const [heard, setHeard] = useState(false);
  /** Bumped by "Check again" to rerun the permission request. */
  const [attempt, setAttempt] = useState(0);
  // The level lives in a motion value: the meter animates at frame rate without re-rendering.
  const level = useMotionValue(0);

  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let heardOnce = false;
    const meter = createMicMeter();

    void (async () => {
      const permission = await requestMicPermission();
      if (cancelled) return;
      if (permission !== "granted") {
        setStatus(permission);
        return;
      }
      await meter.start();
      if (cancelled) return;
      setStatus("live");
      const sample = () => {
        const value = meter.level();
        level.set(value);
        if (!heardOnce && value >= HEARD_LEVEL) {
          heardOnce = true;
          setHeard(true);
        }
        frame = requestAnimationFrame(sample);
      };
      frame = requestAnimationFrame(sample);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      meter.stop();
      level.set(0);
    };
  }, [attempt, level]);

  function retry() {
    setStatus("checking");
    setHeard(false);
    setAttempt((count) => count + 1);
  }

  const problem = status === "denied" || status === "unavailable";

  return (
    <Card as="section" aria-labelledby="mic-check-title" className="flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-lg transition-colors",
            problem ? "bg-bad/12 text-bad" : heard ? "bg-good/12 text-good" : "bg-accent-soft text-accent",
          )}
        >
          {problem ? (
            <MicOff aria-hidden className="size-4" />
          ) : heard ? (
            <CircleCheck aria-hidden className="size-4" />
          ) : (
            <Mic aria-hidden className="size-4" />
          )}
        </span>
        <div className="min-w-0" aria-live="polite">
          <h2 id="mic-check-title" className="text-sm font-semibold text-ink">
            Mic check
          </h2>
          <p className="text-sm leading-snug text-ink-2">{statusMessage(status, heard)}</p>
        </div>
      </div>

      {(status === "live" || status === "checking") && <LevelMeter level={level} active={status === "live"} />}

      {problem && (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          icon={<RotateCcw aria-hidden className="size-4" />}
          onClick={retry}
        >
          Check again
        </Button>
      )}
    </Card>
  );
}

function statusMessage(status: MicStatus, heard: boolean): string {
  switch (status) {
    case "checking":
      return "Allow microphone access when your browser asks, so the GD can hear you.";
    case "live":
      return heard ? "We can hear you. You're all set." : "Say a few words: the bars should jump.";
    case "denied":
      return "Microphone access is blocked. Allow it from the address bar (the lock or mic icon), then check again. Otherwise you'll type your turns.";
    case "unavailable":
      return "No microphone found, or this page isn't on a secure (https) connection. Plug in a mic and check again, or you'll type your turns.";
  }
}

/** Audio-reactive bars: each lights up once the level passes its share of the scale. */
function LevelMeter({ level, active }: { level: MotionValue<number>; active: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex h-10 items-end gap-1 rounded-xl bg-panel-2 px-3 py-2",
        !active && "animate-pulse motion-reduce:animate-none",
      )}
    >
      {BARS.map((index) => (
        <MeterBar key={index} index={index} level={level} />
      ))}
    </div>
  );
}

function MeterBar({ index, level }: { index: number; level: MotionValue<number> }) {
  const threshold = (index + 1) / (BAR_COUNT + 1);
  // A gentle arch so the meter reads as a voice, not a progress bar.
  const peak = 0.45 + 0.55 * Math.sin(((index + 1) / (BAR_COUNT + 1)) * Math.PI);
  const scaleY = useTransform(level, (value) => (value >= threshold ? peak : 0.18));
  const opacity = useTransform(level, (value) => (value >= threshold ? 1 : 0.35));
  return (
    <motion.span
      className={cn("h-full flex-1 origin-bottom rounded-full", index < BAR_COUNT * 0.75 ? "bg-good" : "bg-warn")}
      style={{ scaleY, opacity }}
    />
  );
}

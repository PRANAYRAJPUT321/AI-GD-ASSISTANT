"use client";

import { ArrowRight, CircleAlert, Info, Keyboard, Mic } from "lucide-react";
import { AnimatePresence, motion, useInView } from "motion/react";
import { useId, useRef, useState, type FormEvent } from "react";
import { castFor } from "@/lib/personas";
import { isRecognitionSupported } from "@/lib/speech/stt";
import { isSpeechSynthesisSupported } from "@/lib/speech/tts";
import type { InputMode, Topic, VoiceSpeed } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Card, Eyebrow } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";
import { useClientValue, useStoredString, writeStored } from "@/components/ui/hooks";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { fieldClass } from "@/components/ui/style";
import { ProgressCard } from "@/components/progress/ProgressCard";
import { EnvironmentCheck } from "./EnvironmentCheck";
import { Hero } from "./Hero";
import { MeetTheRoom } from "./MeetTheRoom";
import { StickyStart } from "./StickyStart";
import { VoiceSettings } from "./VoiceSettings";
import {
  ACCENT_OPTIONS,
  DEFAULT_ACCENT,
  DEFAULT_MINUTES,
  DEFAULT_VOICE_SPEED,
  DURATION_OPTIONS,
  MAX_NAME_LENGTH,
  STORAGE_KEYS,
  accentLabel,
  isKnownAccent,
  isKnownDuration,
  isKnownVoiceSpeed,
} from "./options";
import { TopicPicker, useTopicChoice } from "./TopicPicker";

export interface SetupChoice {
  topic: Topic;
  userName: string;
  minutes: number;
  sttLang: string;
  inputMode: InputMode;
  voiceSpeed: VoiceSpeed;
}

interface SetupScreenProps {
  /** GDs per device per day; null = unlimited. */
  dailyLimit: number | null;
  /** Pre-fill after "practise again" (or after leaving a GD). */
  initial?: Partial<SetupChoice>;
  /** GDApp then calls startSession(). */
  onStart(choice: SetupChoice): void;
  /** startSession in flight. */
  busy: boolean;
  /** e.g. the daily limit was reached. */
  error: string | null;
}

function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

export function SetupScreen({ dailyLimit, initial, onStart, busy, error }: SetupScreenProps) {
  const id = useId();

  // Name and accent: an explicit pre-fill wins, then what was typed here, then what was
  // remembered on this device (read after hydration, so server and client markup match).
  const storedName = useStoredString(STORAGE_KEYS.name);
  const storedAccent = useStoredString(STORAGE_KEYS.accent);
  const storedVoiceSpeed = useStoredString(STORAGE_KEYS.voiceSpeed);
  const [nameDraft, setNameDraft] = useState<string | null>(initial?.userName ?? null);
  const [accentDraft, setAccentDraft] = useState<string | null>(
    isKnownAccent(initial?.sttLang) ? initial.sttLang : null,
  );
  const [minutes, setMinutes] = useState(isKnownDuration(initial?.minutes) ? initial.minutes : DEFAULT_MINUTES);
  const [voiceSpeedDraft, setVoiceSpeedDraft] = useState<VoiceSpeed | null>(
    isKnownVoiceSpeed(initial?.voiceSpeed) ? initial.voiceSpeed : null,
  );
  const name = nameDraft ?? storedName ?? "";
  const sttLang = accentDraft ?? (isKnownAccent(storedAccent) ? storedAccent : DEFAULT_ACCENT);
  const voiceSpeed = voiceSpeedDraft ?? (isKnownVoiceSpeed(storedVoiceSpeed) ? storedVoiceSpeed : DEFAULT_VOICE_SPEED);

  const topicChoice = useTopicChoice(initial?.topic);
  const { topic } = topicChoice;

  // Feature detection only means something in the browser: null until hydrated.
  const recognition = useClientValue(isRecognitionSupported, null);
  const speech = useClientValue(isSpeechSynthesisSupported, null);

  const userName = cleanName(name);
  const cast = castFor(userName);
  const missing = [!userName && "your name", !topic && "a topic"].filter(Boolean).join(" and ");
  const canStart = !missing && !topicChoice.shuffling;

  // The floating start bar takes over while the start card is off screen, once setup has begun.
  const startArea = useRef<HTMLDivElement>(null);
  const startVisible = useInView(startArea, { amount: 0.5 });
  const showStickyStart = !startVisible && Boolean(userName || topic);

  function handleNameChange(value: string) {
    setNameDraft(value);
    writeStored(STORAGE_KEYS.name, cleanName(value));
  }

  function handleAccentChange(value: string) {
    setAccentDraft(value);
    writeStored(STORAGE_KEYS.accent, value);
  }

  function handleVoiceSpeedChange(value: VoiceSpeed) {
    setVoiceSpeedDraft(value);
    writeStored(STORAGE_KEYS.voiceSpeed, value);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canStart || busy || !topic) return;
    onStart({
      topic,
      userName,
      minutes,
      sttLang,
      inputMode: recognition ? "voice" : "text",
      voiceSpeed,
    });
  }

  return (
    <form id={`${id}-form`} onSubmit={handleSubmit} noValidate className="flex flex-col gap-8 sm:gap-10">
      <Hero cast={cast} userName={userName} />

      <ProgressCard />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <Card as="section" aria-labelledby={`${id}-name-title`} className="p-4 sm:p-6">
            <h2 id={`${id}-name-title`} className="text-lg font-semibold text-ink">
              <label htmlFor={`${id}-name`}>Your name</label>
            </h2>
            <p id={`${id}-name-hint`} className="text-sm text-ink-2">
              The participants address you by name, just like a real panel.
            </p>
            <input
              id={`${id}-name`}
              type="text"
              value={name}
              onChange={(event) => handleNameChange(event.target.value)}
              maxLength={MAX_NAME_LENGTH}
              autoComplete="given-name"
              placeholder="e.g. Priya"
              aria-describedby={`${id}-name-hint`}
              className={cn(fieldClass, "mt-3 h-12 text-lg font-medium")}
            />
          </Card>

          <TopicPicker choice={topicChoice} />

          <MeetTheRoom cast={cast} userName={userName} />
        </div>

        <aside aria-label="Session settings" className="flex flex-col gap-4 lg:sticky lg:top-6">
          <Card className="flex flex-col gap-5 p-4 sm:p-5">
            <SegmentedControl
              label="Discussion length"
              options={DURATION_OPTIONS}
              value={minutes}
              onChange={setMinutes}
            />
            <div>
              <label htmlFor={`${id}-accent`} className="text-sm font-semibold text-ink">
                Your accent
              </label>
              <p id={`${id}-accent-hint`} className="text-xs text-ink-2">
                So your browser understands what you say.
              </p>
              <select
                id={`${id}-accent`}
                value={sttLang}
                onChange={(event) => handleAccentChange(event.target.value)}
                aria-describedby={`${id}-accent-hint`}
                className={cn(fieldClass, "mt-2 h-11 cursor-pointer")}
              >
                {ACCENT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <VoiceSettings cast={cast} speed={voiceSpeed} onSpeedChange={handleVoiceSpeedChange} />
          </Card>

          <EnvironmentCheck recognition={recognition} speech={speech} />

          <Card className="flex flex-col gap-4 p-4 sm:p-5">
            <div ref={startArea}>
              <Eyebrow>Ready when you are</Eyebrow>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.p
                  key={topic?.id ?? "none"}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className={cn("mt-1 line-clamp-2 font-semibold", topic ? "text-ink" : "text-ink-2")}
                >
                  {topic ? topic.title : "No topic chosen yet"}
                </motion.p>
              </AnimatePresence>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
                <span>{minutes} min</span>
                <span aria-hidden>·</span>
                <span>{accentLabel(sttLang)}</span>
                {recognition !== null && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1">
                      {recognition ? (
                        <Mic aria-hidden className="size-3.5" />
                      ) : (
                        <Keyboard aria-hidden className="size-3.5" />
                      )}
                      {recognition ? "Voice" : "Typing"}
                    </span>
                  </>
                )}
              </p>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              busy={busy}
              disabled={!canStart}
              aria-describedby={`${id}-start-hint`}
              iconEnd={
                !busy && (
                  <ArrowRight
                    aria-hidden
                    className="size-5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                  />
                )
              }
              className="group w-full"
            >
              {busy ? "Starting…" : "Start my GD"}
            </Button>
            <p id={`${id}-start-hint`} className="-mt-1 text-center text-xs text-ink-2">
              {missing ? `Add ${missing} to start.` : "Next: 2 minutes to prepare your points."}
            </p>

            <AnimatePresence initial={false}>
              {error && (
                <motion.div
                  key={error}
                  role="alert"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex gap-2 rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm text-ink">
                    <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-bad" />
                    <p>{error}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {dailyLimit !== null && (
              <p className="flex items-center justify-center gap-1.5 text-xs text-ink-2">
                <Info aria-hidden className="size-3.5" />
                {dailyLimit} free GD{dailyLimit === 1 ? "" : "s"} a day on this device.
              </p>
            )}
          </Card>
        </aside>
      </div>

      <StickyStart
        show={showStickyStart}
        formId={`${id}-form`}
        topic={topic}
        minutes={minutes}
        canStart={canStart}
        busy={busy}
        missing={missing}
      />
    </form>
  );
}

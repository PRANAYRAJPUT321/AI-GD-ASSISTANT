"use client";

import { CircleAlert, Flag, LoaderCircle, LogOut } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type Ref } from "react";
import { castFor } from "@/lib/personas";
import type { EngineState, GDConfig, GDRecord } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { AirtimeBar } from "./AirtimeBar";
import { CaptionPanel } from "./CaptionPanel";
import { ConfirmDialog } from "./ConfirmDialog";
import { FloorButton } from "./FloorButton";
import { airtimeMs, floorControl, turnCounts, type FloorControl, type Participant } from "./model";
import { SidePanel } from "./SidePanel";
import { Stage } from "./Stage";
import { StartOverlay } from "./StartOverlay";
import { SummaryPrompt } from "./SummaryPrompt";
import { Toasts } from "./Toasts";
import { TopBar } from "./TopBar";
import { useEngine } from "./useEngine";

export interface RoomProps {
  config: GDConfig;
  onNotesChange(notes: string): void;
  onFinished(record: GDRecord): void;
  /** Abandon the GD (already confirmed here). */
  onLeave(): void;
}

/** Elements that handle Space themselves: typing, buttons and other widgets. */
const OWNS_SPACE =
  "input, textarea, select, button, summary, [role='button'], [role='tab'], [role='checkbox'], [role='radio'], [role='switch']";

function ownsSpace(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest(OWNS_SPACE) !== null;
}

type Confirming = "end" | "leave" | null;

/**
 * The live GD room: the round table, the live caption, the Jump in control, airtime, notes
 * and transcript. It owns one GDEngine (see useEngine) and renders its state.
 */
export function Room({ config, onNotesChange, onFinished, onLeave }: RoomProps) {
  const cast = useMemo(() => castFor(config.userName), [config.userName]);
  const { engine, state, speakerSinceMs, toasts, hasMicMeter, dismissToast } = useEngine(config, cast, onFinished);
  // Local copy so typing stays smooth; every change is also reported up to GDApp.
  const [notes, setNotes] = useState(config.notes);
  // Text mode: the turn being typed (kept across turns if a time cap cut one short).
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<Confirming>(null);
  const floorButton = useRef<HTMLButtonElement>(null);

  const control = floorControl(state, cast);
  const started = state.status !== "idle";
  const airtime = airtimeMs(state, speakerSinceMs);
  const turns = turnCounts(state);
  const liveSpeaker: Participant | null =
    state.phase === "discussion" && state.activeSpeaker && state.activeSpeaker !== "moderator" ? state.activeSpeaker : null;

  function changeNotes(next: string) {
    setNotes(next);
    onNotesChange(next);
  }

  function startDiscussion() {
    if (!engine) return;
    // Synchronous on purpose: the moderator's first words must be spoken inside this click.
    engine.start();
    // The room stops being inert on this render; hand focus to the floor button.
    requestAnimationFrame(() => floorButton.current?.focus({ preventScroll: true }));
  }

  function sendDraft() {
    if (!engine) return;
    engine.submitTyped(draft);
    setDraft("");
  }

  /** The floor button (and Space): jump in, or end the candidate's turn. */
  function act() {
    if (!engine) return;
    if (control.kind === "jump") engine.jumpIn();
    else if (control.kind === "hold" && control.action === "send") sendDraft();
    else if (control.kind === "hold") engine.doneSpeaking();
  }

  function endAndScore() {
    setConfirming(null);
    engine?.endNow();
  }

  function leave() {
    setConfirming(null);
    engine?.stop();
    onLeave();
  }

  // Space is the floor key anywhere in the room, except where it types or presses a control.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== " " || event.ctrlKey || event.metaKey || event.altKey) return;
    if (confirming !== null || !started || control.kind === "none" || ownsSpace(event.target)) return;
    event.preventDefault(); // no page scroll
    if (!event.repeat) act();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <TopBar
        topic={config.topic}
        state={state}
        onEnd={() => setConfirming("end")}
        onLeave={() => setConfirming("leave")}
      />

      <div className="relative">
        <div
          inert={!started}
          className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]"
        >
          {/* On phones this wrapper dissolves (display: contents), so the sticky floor control
              stays pinned through the whole room rather than only this column. */}
          <div className="contents lg:col-start-1 lg:row-start-1 lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
            <Stage state={state} cast={cast} airtime={airtime} turns={turns} hasMicMeter={hasMicMeter} />
            <AnimatePresence initial={false}>
              {state.userPrompt && (
                <SummaryPrompt key="summary" prompt={state.userPrompt} secondsLeft={state.userTurnSecondsLeft} />
              )}
            </AnimatePresence>
            <CaptionPanel
              state={state}
              cast={cast}
              draft={draft}
              onDraftChange={setDraft}
              onSubmitDraft={sendDraft}
              onComposerClosed={() => floorButton.current?.focus({ preventScroll: true })}
            />
            <Controls
              state={state}
              control={control}
              hasMicMeter={hasMicMeter}
              onAct={act}
              buttonRef={floorButton}
              onEndNow={() => engine?.endNow()}
              onLeave={() => setConfirming("leave")}
            />
          </div>
          <SidePanel
            state={state}
            cast={cast}
            notes={notes}
            onNotesChange={changeNotes}
            className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-stretch"
          />
          <AirtimeBar airtime={airtime} cast={cast} live={liveSpeaker} className="lg:col-start-1 lg:row-start-2" />
        </div>

        <AnimatePresence>
          {!started && (
            <StartOverlay
              key="take-your-seat"
              topic={config.topic}
              cast={cast}
              minutes={config.minutes}
              inputMode={state.inputMode}
              onStart={startDiscussion}
            />
          )}
        </AnimatePresence>
      </div>

      <Toasts toasts={toasts} onDismiss={dismissToast} />

      <ConfirmDialog
        open={confirming === "end"}
        title="End the GD and get your score?"
        confirmLabel="End & score"
        confirmIcon={<Flag aria-hidden className="size-4" />}
        onConfirm={endAndScore}
        onClose={() => setConfirming(null)}
      >
        {state.phase === "summary"
          ? "The discussion stops here and everything said so far is scored."
          : "The discussion stops here and everything said so far is scored. There will be no closing summaries, so that part of your score will be low."}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirming === "leave"}
        title="Leave this GD?"
        confirmLabel="Leave"
        confirmIcon={<LogOut aria-hidden className="size-4" />}
        onConfirm={leave}
        onClose={() => setConfirming(null)}
      >
        The discussion stops and nothing from it is scored.
      </ConfirmDialog>
    </div>
  );
}

interface ControlsProps {
  state: EngineState;
  control: FloorControl;
  hasMicMeter: boolean;
  onAct(): void;
  buttonRef: Ref<HTMLButtonElement>;
  onEndNow(): void;
  onLeave(): void;
}

/** The floor button (sticky at the bottom on phones), or what replaces it once the GD stops. */
function Controls({ state, control, hasMicMeter, onAct, buttonRef, onEndNow, onLeave }: ControlsProps) {
  if (state.status === "error") {
    return (
      <Card role="alert" className="flex flex-col items-center gap-3 p-5 text-center sm:p-6">
        <CircleAlert aria-hidden className="size-8 text-bad" />
        <div>
          <h2 className="text-lg font-semibold text-ink">The discussion stopped</h2>
          <p className="mt-1 text-sm text-ink-2">{state.error ?? "Something went wrong in the discussion."}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" icon={<Flag aria-hidden className="size-4" />} onClick={onEndNow}>
            End &amp; score what we have
          </Button>
          <Button variant="secondary" icon={<LogOut aria-hidden className="size-4" />} onClick={onLeave}>
            Leave
          </Button>
        </div>
      </Card>
    );
  }

  if (state.status === "done" || control.kind === "none") {
    return (
      <div role="status" className="flex items-center justify-center gap-2 py-6 text-sm font-semibold text-ink-2">
        <LoaderCircle aria-hidden className="size-5 animate-spin text-accent motion-reduce:animate-none" />
        Wrapping up…
      </div>
    );
  }

  return (
    <div className="sticky bottom-0 z-20 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:static md:pb-0">
      <div className="rounded-2xl bg-bg/85 pt-3 backdrop-blur-md md:bg-transparent md:pt-1 md:backdrop-blur-none">
        <FloorButton
          control={control}
          micLevel={state.micLevel}
          hasMicMeter={hasMicMeter}
          onAct={onAct}
          buttonRef={buttonRef}
        />
      </div>
    </div>
  );
}

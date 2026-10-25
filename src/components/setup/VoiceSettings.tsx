"use client";

import { CircleAlert, CircleCheck, Square, Volume2 } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Cast } from "@/lib/personas";
import { createVoice, isSpeechSynthesisSupported, panelAccent, type Voice, type VoiceInfo } from "@/lib/speech";
import type { PersonaId, VoiceSpeed } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { VOICE_SPEED_OPTIONS } from "./options";

/** Two short lines, one per voice gender, with a number and an amount to hear how they're read. */
const SAMPLES: readonly { who: PersonaId; text: string }[] = [
  { who: "dominator", text: "Let me start. Quick commerce is convenient, but it is hurting our kirana stores." },
  { who: "data", text: "Roughly 40% of city shoppers now order groceries online, and an average order is about ₹500." },
];

const NO_VOICES: readonly VoiceInfo[] = [];
let cachedKey = "";
let cachedVoices: readonly VoiceInfo[] = NO_VOICES;

/** The browser's voices; a stable array until the list changes (useSyncExternalStore needs that). */
function readVoices(): readonly VoiceInfo[] {
  if (!isSpeechSynthesisSupported()) return NO_VOICES;
  const list = window.speechSynthesis.getVoices();
  const key = list.map((voice) => `${voice.name}|${voice.lang}`).join(";");
  if (key !== cachedKey) {
    cachedKey = key;
    cachedVoices = list.map(({ name, lang, localService, default: isDefault }) => ({
      name,
      lang,
      localService,
      default: isDefault,
    }));
  }
  return cachedVoices;
}

function subscribeVoices(onChange: () => void): () => void {
  if (!isSpeechSynthesisSupported()) return () => {};
  const synth = window.speechSynthesis;
  synth.addEventListener("voiceschanged", onChange);
  return () => synth.removeEventListener("voiceschanged", onChange);
}

/** The system voices, loaded asynchronously by most browsers; null on the server and during hydration. */
function useSystemVoices(): readonly VoiceInfo[] | null {
  return useSyncExternalStore(subscribeVoices, readVoices, () => null);
}

/** "Microsoft Neerja Online (Natural) - English (India)" → "Microsoft Neerja Online (Natural)". */
function shortName(name: string): string {
  return name.replace(/\s+-\s+.*$/, "").trim() || name;
}

/** The panel's voice speed, a preview of two participants, and which accent this browser gives them. */
export function VoiceSettings({
  cast,
  speed,
  onSpeedChange,
}: {
  cast: Cast;
  speed: VoiceSpeed;
  onSpeedChange(speed: VoiceSpeed): void;
}) {
  const voices = useSystemVoices();
  const supported = voices !== null && isSpeechSynthesisSupported();
  const preview = usePreview(cast, speed);

  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl label="Panel voice speed" options={VOICE_SPEED_OPTIONS} value={speed} onChange={onSpeedChange} />
      {supported && (
        <>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="self-start"
            icon={
              preview.speaking ? <Square aria-hidden className="size-3.5" /> : <Volume2 aria-hidden className="size-4" />
            }
            onClick={preview.speaking ? preview.stop : preview.play}
          >
            {preview.speaking ? `Stop (${cast[preview.speaking].name} speaking)` : "Hear the panel"}
          </Button>
          <AccentNote voices={voices} />
        </>
      )}
    </div>
  );
}

function AccentNote({ voices }: { voices: readonly VoiceInfo[] }) {
  const { accent, voices: names } = panelAccent(voices);
  if (accent === null) return null;
  const first = names[0] ? shortName(names[0]) : "";
  if (accent === "indian" || accent === "indian-hindi") {
    return (
      <p className="flex gap-2 text-xs text-ink-2">
        <CircleCheck aria-hidden className="mt-px size-4 shrink-0 text-good" />
        <span>
          {accent === "indian"
            ? `Indian English voice${names.length > 1 ? "s" : ""}: ${names.slice(0, 2).map(shortName).join(", ")}.`
            : `Indian accent from ${first}, since this browser has no English (India) voice.`}
        </span>
      </p>
    );
  }
  const sound = accent === "british" ? "British" : accent === "american" ? "American" : "non-Indian";
  return (
    <p className="flex gap-2 text-xs text-ink-2">
      <CircleAlert aria-hidden className="mt-px size-4 shrink-0 text-warn" />
      <span>
        No Indian voice in this browser, so the panel will sound {sound}. For Indian voices, use Microsoft Edge, or
        add &ldquo;English (India)&rdquo; in your phone&apos;s text-to-speech settings.
      </span>
    </p>
  );
}

/** Plays the sample lines with this cast and speed; stops on unmount or when asked. */
function usePreview(cast: Cast, speed: VoiceSpeed) {
  const [speaking, setSpeaking] = useState<PersonaId | null>(null);
  const current = useRef<Voice | null>(null);

  useEffect(() => () => current.current?.cancelAll(), []);

  async function play() {
    current.current?.cancelAll();
    const voice = createVoice(cast, { speed });
    current.current = voice;
    await voice.ready();
    for (const sample of SAMPLES) {
      if (current.current !== voice) return;
      setSpeaking(sample.who);
      const { completed } = await voice.speak(sample.text, sample.who).done;
      if (!completed) break;
    }
    if (current.current === voice) {
      current.current = null;
      setSpeaking(null);
    }
  }

  function stop() {
    current.current?.cancelAll();
    current.current = null;
    setSpeaking(null);
  }

  return { speaking, play: () => void play(), stop };
}

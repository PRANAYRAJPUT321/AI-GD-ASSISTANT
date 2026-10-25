"use client";

import { useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import { requestTurn } from "@/lib/api";
import { GDEngine } from "@/lib/engine";
import type { Cast } from "@/lib/personas";
import { createListener, createMicMeter, createVoice } from "@/lib/speech";
import type { GDConfig, GDRecord } from "@/lib/types";
import { RoomStore, type RoomSnapshot } from "./roomStore";

/**
 * Chrome on Android can't run the level meter's getUserMedia stream alongside speech
 * recognition (recognition stops hearing), so the meter is skipped there and the room shows
 * a "listening" animation instead of live levels.
 */
function meterConflictsWithRecognition(): boolean {
  return /Android/i.test(navigator.userAgent);
}

export interface RoomEngine extends RoomSnapshot {
  dismissToast(id: string): void;
}

/**
 * Creates this room's GDEngine (browser voices, speech recognition in the GD's language, the
 * mic meter and /api/turn) and follows its state.
 *
 * The engine is created in an effect, so React StrictMode's mount → unmount → mount stops the
 * first engine before creating the second, and only ever one engine is started per mount
 * (start() comes from the candidate's click). The engine is created idle: the room calls
 * engine.start() from a user gesture, which the browser requires for the first speech.
 */
export function useEngine(config: GDConfig, cast: Cast, onFinished: (record: GDRecord) => void): RoomEngine {
  const [store] = useState(() => new RoomStore(config, cast));
  const finished = useEffectEvent((record: GDRecord) => onFinished(record));

  useEffect(() => {
    const voice = createVoice(cast, { speed: config.voiceSpeed });
    // Voices load asynchronously; start loading now so the moderator has one at start().
    void voice.ready();
    const micMeter = config.inputMode === "voice" && !meterConflictsWithRecognition() ? createMicMeter() : undefined;
    const engine = new GDEngine(config, {
      voice,
      micMeter,
      createListener: (callbacks) => createListener(config.sttLang, callbacks),
      requestTurn,
    });
    const offDone = engine.onDone((record) => finished(record));
    store.attach(engine, { hasMicMeter: micMeter !== undefined });
    return () => {
      offDone();
      store.detach(engine);
      engine.stop();
    };
  }, [config, cast, store]);

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...snapshot, dismissToast: store.dismissToast };
}

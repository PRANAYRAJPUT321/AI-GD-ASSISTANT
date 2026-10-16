// Browser speech for GD Arena: voices for the AI participants, speech-to-text for the
// candidate and a live mic level. Every export is safe to import during server rendering.

export type {
  Listener,
  ListenerCallbacks,
  ListenerErrorKind,
  MicMeter,
  SpeechHandle,
  Voice,
} from "./types";

export {
  createVoice,
  estimateDurationMs,
  isSpeechSynthesisSupported,
  pickVoices,
  prosodyFor,
  splitSentences,
  voiceGender,
} from "./tts";
export type { Prosody, TextChunk, VoiceInfo } from "./tts";

export { createListener, isRecognitionSupported } from "./stt";

export { createMicMeter, levelFromRms, requestMicPermission, smoothLevel } from "./mic";
export type { MicPermission } from "./mic";

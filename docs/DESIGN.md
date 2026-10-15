# GD Arena: design spec (v1)

GD Arena lets a student practise a **group discussion (GD)** out loud against five AI participants, then get a scorecard and the full transcript. v1 is a Next.js web app on Vercel. Speech-to-text and voices come free from the browser (Web Speech API); the Claude API runs the participants and the scoring.

## 1. The flow

1. **Choose a topic.** Business, current affairs, or abstract (e.g. "Red vs Blue"), a random one, or a custom one. Enter your name, pick 10 or 12 minutes (plus a 5-minute quick round), and choose the speech-recognition accent (English: India / US / UK).
2. **Prepare for 2 minutes** with an on-screen notepad. Countdown, "Start now" to skip ahead. The notes stay visible during the GD (side panel) and are never sent to the AI.
3. **The GD starts.** The moderator reads the topic and says "you may begin". The candidate gets a ~6 s window to open; otherwise the Dominator opens. Five AI participants speak out loud (browser TTS) and the candidate speaks through the mic.
4. **Jump in.** Pressing the big button (or Space) cuts off the current AI speaker immediately, like a real GD. While the candidate holds the floor, the button becomes "Done". The turn also ends after ~3.5 s of silence. If the candidate waits too long, the AIs keep taking the space; there is no waiting for them.
5. **Summarise.** After the chosen time, the moderator calls time and asks the candidate for a closing summary (90 s cap), then the Silent Smart One gives theirs and the moderator closes.
6. **Scorecard** with the full transcript.

## 2. The five participants (src/lib/personas.ts)

| id | default name | behaviour |
|---|---|---|
| dominator | Arjun | talks a lot (long turns), pushes back, **interrupts the candidate** mid-turn |
| data | Meera | stats, cases, examples (hedged, broadly accurate) |
| agreer | Rohit | "I agree with {user}…" and adds nothing |
| drifter | Kabir | goes off-topic; tests whether the candidate pulls the group back |
| smart | Ananya | silent until late (≥ 55% of time), then one strong point; gives the AI closing summary |

`castFor(userName)` renames a persona if it collides with the candidate's first name. The browser and server both call it, so names always match.

They must react to **what was actually said** (the live transcript), never a script.

## 3. Architecture and file ownership

```
src/lib/types.ts            CONTRACT  shared types (Turn, EngineState, TurnRequest, …)
src/lib/personas.ts         CONTRACT  personas, castFor, colours, voice profiles
src/lib/topics.ts           CONTRACT  topic bank
src/lib/scoring.ts          CONTRACT  GDMetrics type, AssessmentSchema (zod), Scorecard type
src/lib/speech/types.ts     CONTRACT  Voice / Listener / MicMeter interfaces
src/lib/api.ts              CONTRACT  browser fetch helpers: startSession, requestTurn, requestScore
src/app/globals.css         CONTRACT  design tokens + keyframes

src/lib/server/*            server: Claude client, prompts, session tokens, limits, counter store
src/lib/metrics.ts          server+client: computeMetrics(record) (deterministic)
src/app/api/session/route.ts
src/app/api/turn/route.ts
src/app/api/score/route.ts

src/lib/speech/tts.ts       createVoice(cast): Voice
src/lib/speech/stt.ts       createListener(lang, callbacks): Listener; isRecognitionSupported()
src/lib/speech/mic.ts       createMicMeter(): MicMeter

src/lib/director.ts         chooseNext(transcript, ctx) → { speaker, cue }
src/lib/engine.ts           class GDEngine: the live GD state machine

src/app/layout.tsx, src/app/page.tsx
src/components/GDApp.tsx            phase machine: setup → prep → room → scoring → scorecard
src/components/setup/*              SetupScreen
src/components/prep/*               PrepScreen, Notepad
src/components/room/*               Room (GD + summaries)
src/components/scorecard/*          ScoringScreen, ScorecardView, TranscriptView
```

**Do not edit CONTRACT files.** If a contract is genuinely wrong, note it in your final report instead; the integrator decides.

### Component contracts (props)

```ts
// src/components/setup/SetupScreen.tsx
export function SetupScreen(props: {
  dailyLimit: number | null;            // null = unlimited
  initial?: Partial<SetupChoice>;       // pre-fill after "practise again"
  onStart(choice: SetupChoice): void;   // GDApp then calls startSession()
  busy: boolean;                        // startSession in flight
  error: string | null;                 // e.g. daily limit reached
}): JSX.Element;
export interface SetupChoice { topic: Topic; userName: string; minutes: number; sttLang: string; inputMode: InputMode }

// src/components/prep/PrepScreen.tsx
export function PrepScreen(props: {
  topic: Topic; userName: string; minutes: number;
  notes: string; onNotesChange(notes: string): void;
  onReady(): void;                      // timer hit 0 or "Start now"
  onBack(): void;
}): JSX.Element;
// src/components/prep/Notepad.tsx (reused in the room)
export function Notepad(props: { value: string; onChange(v: string): void; compact?: boolean; autoFocus?: boolean }): JSX.Element;

// src/components/room/Room.tsx
export function Room(props: {
  config: GDConfig;
  onNotesChange(notes: string): void;
  onFinished(record: GDRecord): void;
  onLeave(): void;                      // abandon (confirm first)
}): JSX.Element;

// src/components/scorecard/ScoringScreen.tsx
export function ScoringScreen(props: {
  record: GDRecord; token: string;
  onScored(card: Scorecard): void;
  onBack(): void;                       // after an error, back to setup
}): JSX.Element;                        // calls requestScore, shows progress, retry on error

// src/components/scorecard/ScorecardView.tsx
export function ScorecardView(props: { card: Scorecard; onRestart(): void }): JSX.Element;
```

`GDApp` owns the phase state and the notes string. `src/app/page.tsx` is a server component that renders `<GDApp dailyLimit={…} />` with the limit read from `DAILY_GD_LIMIT` (default 3; `0` = unlimited → pass `null`).

## 4. The engine (src/lib/engine.ts, src/lib/director.ts)

`GDEngine` is a framework-agnostic class. The Room creates it with injected dependencies and subscribes to snapshots.

```ts
export interface EngineDeps {
  voice: Voice;
  createListener(callbacks: ListenerCallbacks): Listener; // Room binds the language
  micMeter?: MicMeter;
  requestTurn(req: TurnRequest, signal?: AbortSignal): Promise<TurnResponse>;
  now?(): number;          // default performance.now()
  random?(): number;       // default Math.random (injectable for tests)
  timings?: Partial<EngineTimings>; // test override of the constants below (opening window, gaps, silence, caps…)
}
export class GDEngine {
  constructor(config: GDConfig, deps: EngineDeps);
  subscribe(fn: (s: EngineState) => void): () => void; // calls fn immediately with the current state
  getState(): EngineState;
  start(): void;           // must be called from a user gesture (TTS/mic need it)
  jumpIn(): void;          // candidate takes the floor (cuts off a speaking AI)
  doneSpeaking(): void;    // candidate ends their turn
  submitTyped(text: string): void; // text mode: the typed turn
  endNow(): void;          // "End & score now": stop speech/mic, close the record immediately, fire onDone (works from error status too)
  stop(): void;            // tear down everything (timers, speech, mic, fetches) without firing onDone
  onDone(fn: (record: GDRecord) => void): () => void;
}
```

Publish a fresh **immutable** `EngineState` object on every change and on a 250 ms tick (React reads it with `useSyncExternalStore` or a subscription, so never mutate a published object or array in place).

### Timeline

1. `intro`: moderator speaks (scripted, no API): "Good {morning|afternoon|evening}, everyone. Today's topic is: {title}. You have {minutes} minutes. Whoever is ready may begin." Jump-in disabled. When it ends, `discussionStartMs = now`.
2. `discussion`: **opening window** of 6 s with the floor open. If the candidate jumps in, they opened. Otherwise the director picks the opener (`dominator`, cue `open`).
3. Main loop until `now - discussionStartMs >= discussionMs`:
   - If the candidate holds the floor, wait for their turn to end.
   - Get the next line: use the **prefetched** line if it was generated for the current last turn; otherwise `chooseNext` and request it (state `preparing = speaker`).
   - While waiting for the line, a jump-in wins: abort the fetch and go to the candidate.
   - Gap of 700–1300 ms before speaking (2500 ms after a drifter turn, so the candidate has a window to pull it back). A jump-in during the gap wins.
   - Speak the line (state `activeSpeaker`, `caption`, `captionSpokenChars` updated on the tick from `handle.spokenChars()`). **While it is being spoken, prefetch the next line** (transcript including this full line). Abort and drop the prefetch whenever the transcript changes in a way it did not assume (jump-in, cut-off).
   - On a refusal/empty/failed line (`text: null` or error), set a short `notice`, wait 1 s, pick another speaker. After 3 consecutive failures set `status: "error"` with a helpful message (keep the transcript).
   - On HTTP 401/403/429 codes `bad_token`/`turn_limit`/`daily_limit`, stop with that error.
4. Time up: let the current AI finish its line; if the candidate holds the floor, give them up to 12 s more, then end their turn. Abort prefetches.
5. `closing` (phase `summary`): moderator: "Thank you, everyone, that's time. Let's close with summaries. {name}, would you summarise the discussion for us?" Then the candidate's summary turn starts automatically: mic on, `userPrompt` = "Summarise the discussion: main points from both sides, then a conclusion.", 90 s cap (`userTurnSecondsLeft` counts down), ends on Done, 4.5 s silence, or the cap. If they say nothing for 10 s, the moderator says "Alright, let's move on." Then the Smart One's summary (`mode: "summary"`), then the moderator: "Thank you all. That brings us to the end of the discussion." → `status: "done"`, call `onDone(record)`.

### Candidate turns (voice)

- `jumpIn()` (only when `canJumpIn`): if an AI is speaking, `handle.cancel()`; record that AI turn with only the spoken part (`spokenChars`, cut back to a word boundary, append "—"), `interrupted: true`, `interruptedBy: "user"`. Abort any prefetch/in-flight request. Floor → `user`, start the listener and the mic meter.
- Collect final chunks + current interim. `caption` shows the live text. Track `lastActivityMs` (any result).
- The turn ends on `doneSpeaking()`, on 3.5 s without activity once at least one word was heard, or after 8 s with no words at all (then nothing is recorded and the floor reopens; show notice "Didn't catch that. Check your mic."). Hard cap 150 s.
- The recorded turn: `startMs` = jump-in time, `endMs` = last activity time (not the silence timeout), `text` = final + interim text, trimmed.
- Listener errors: `not-allowed` / `no-mic` → switch this GD to text mode (`notice` explains) instead of failing.

### The Dominator interrupting the candidate

- At most 2 per GD, only in the discussion phase, only in voice mode. When the candidate takes the floor, schedule a check at a random 16–26 s. If they still hold the floor and have said ≥ 20 words, request an interjection (`mode: "interject"`, `partialUserText`). If they have said fewer, re-check in 5 s.
- When the line arrives and the candidate still holds the floor: **split** the candidate's turn: record what they said so far as a turn with `interrupted: true, interruptedBy: "dominator"`; record the interjection as a dominator turn (`kind: "interjection"`) spoken over them; the candidate's continuing speech becomes a new turn with `continuation: true`.
- While the interjection plays, **ignore recognition results** (speaker echo) and suspend the silence timer. Afterwards watch 4 s: speech activity → outcome `held`; none → `yielded`, the candidate's turn ends, and the next speaker is forced to `dominator` with cue `continue-after-interjection`. Record an `InterruptionEvent`.

### Text mode (no SpeechRecognition, or mic denied)

Same flow, but while the candidate holds the floor the Room shows a text box; `submitTyped(text)` ends the turn (empty → treated like no speech). No silence timer, no interjections. AI speech and jump-in cut-offs work the same. Mark turns `typed: true`.

### Director rules (src/lib/director.ts)

`chooseNext(transcript: Turn[], ctx: { elapsedFrac: number; forced?: {speaker, cue} ; random(): number }): { speaker: PersonaId; cue: Cue }`

Look only at discussion-phase turns, ignoring the moderator.
- Forced (after a yielded interjection) wins.
- No AI or candidate turn yet → `dominator`/`open`.
- Last turn by the drifter (a drift) → 60% `agreer`/`follow-drift`, 15% `data`/`follow-drift`, 25% `dominator`/`bring-back`.
- Last turn was a `follow-drift` by an AI → `dominator`/`bring-back` (or `data`/`bring-back` if the dominator just spoke).
- Otherwise weighted random, never the previous speaker:
  - dominator 3.0 (3.5 if the candidate just spoke)
  - data 2.2
  - agreer 1.2 (3.0 if the candidate just spoke)
  - drifter: 0 unless fewer than 3 drifts so far, `0.15 ≤ elapsedFrac ≤ 0.85` and ≥ 4 discussion turns since its last turn; then 1.3 (2.5 if it has not drifted yet and `elapsedFrac > 0.3`)
  - smart: 0 before `elapsedFrac 0.55`; 5.0 if it has not spoken; 0.8 for a second turn after 0.82; never more than 2
- Cue: drifter → `drift`; smart's first turn → `late-strong`; agreer → `agree-user` if the candidate has ever spoken, else `agree-last`; anyone after a candidate turn → `respond-user`; `elapsedFrac ≥ 0.9` → `wrap-up` (unless one of the above applies); else `normal`.

Keep `chooseNext` pure. Tests live in `tests/*.test.ts` and run with `npm test` (node:test via tsx; `@/` aliases resolve).

## 5. Speech (src/lib/speech/*)

**TTS (`createVoice(cast)`)**
- `speechSynthesis` with per-speaker voices: prefer English voices with `lang` `en-IN`, then `en-GB`, then `en-US`, then any `en`. Match gender by voice-name keywords where possible (female: female, woman, heera, veena, zira, samantha, victoria, karen, moira, tessa, fiona, susan, hazel, neerja, aria, jenny, libby, sonia, "google us english", "google uk english female"; male: male, ravi, rishi, prabhat, david, mark, daniel, alex, fred, george, guy, ryan, "google uk english male"). Give each speaker a different voice when enough exist; otherwise vary pitch/rate (from the persona's `voice` profile).
- Chrome cuts long utterances (~15 s) on some platforms: **split into sentences** and queue them. `spokenChars` = completed sentences + the latest `onboundary` charIndex, else a time estimate (≈ 14 chars/s × rate).
- Safety timeout per sentence (estimated duration + 3 s) in case `onend` never fires. `cancel()` must resolve `done` promptly.
- Voices load async (`voiceschanged`); `ready()` resolves when loaded or after 1.5 s.
- No speechSynthesis: resolve after the reading-time estimate, advancing `spokenChars` over time.

**STT (`createListener(lang, cb)`)**: `window.SpeechRecognition || window.webkitSpeechRecognition` (declare minimal types locally; they are not in lib.dom), `continuous = true`, `interimResults = true`. Restart on `onend` while active (Chrome ends sessions on its own). Map errors: `not-allowed`/`service-not-allowed` → not-allowed, `audio-capture` → no-mic, `network` → network, ignore `no-speech`/`aborted`.

**Mic meter (`createMicMeter()`)**: `getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}})` + `AnalyserNode` RMS, smoothed, 0..1. Stop tracks on `stop()`.

## 6. Server (src/lib/server/*, src/app/api/*)

### Claude usage (verified against @anthropic-ai/sdk 0.134)

- Model: `process.env.GD_MODEL ?? "claude-opus-5-5"` for turns, `process.env.GD_SCORING_MODEL ?? "claude-opus-5-5"` for scoring. Do not hard-code another model.
- Always via the beta namespace with server-side refusal fallback:
  `client.beta.messages.create({ model, max_tokens, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", output_config: { effort }, system, messages }, { signal })`.
  Do **not** send `thinking` (Opus 5.5 always thinks adaptively; `{type:"disabled"}` is a 400), `temperature`, or `budget_tokens`. No assistant prefill (400).
- Check `stop_reason === "refusal"` before reading content → treat as no line. Read text from `content` blocks with `type === "text"`.
- Turns: `effort: "low"` (env `GD_TURN_EFFORT`), `max_tokens: 2000`, non-streaming. Pass `request.signal` so an aborted prefetch cancels the upstream call.
- **Prompt caching**: one system prompt per GD (rules + all five personas + topic + candidate name; identical bytes for every turn of that GD) with `cache_control: {type:"ephemeral"}`. The user message content is: a fixed header block, then **one text block per transcript turn** (`"{Name}: {text}"`, plus `" [cut off]"` if interrupted), with `cache_control` on the **last transcript block**, then a final instruction block (speaker, cue, length, mode). The instruction must come after the breakpoint so the growing transcript prefix is reused across turns. Nothing volatile (timestamps, ids) before the breakpoints.
- Scoring: `client.beta.messages.parse({ …same fallback fields…, max_tokens: 16000, output_config: { effort: "medium", format: betaZodOutputFormat(AssessmentSchema) } })` from `@anthropic-ai/sdk/helpers/beta/zod`; read `parsed_output` (null → 502). Clamp ratings to 0..10 and score to 0..100, cap list lengths (strengths/improvements 3).
- Errors: catch `Anthropic.RateLimitError` → 503 "busy, try again"; `Anthropic.APIError` → 502; never leak the API key or raw upstream errors.
- `export const maxDuration = 30` (turn) and `120` (score). Node runtime.

### Turn prompt content

System prompt (per GD): you voice five participants in a live spoken GD practice for an Indian MBA/campus-placement candidate named {user}; topic; for abstract topics, participants interpret the word/phrase creatively. Personas with names and briefs (`briefFor`). Rules for every line: output only the words spoken aloud (no name prefix, quotes, stage directions, markdown, lists or emojis); natural spoken Indian-English GD register; react to what was actually said, naming people; never invent what someone said; don't repeat points unless the persona does; hedged, broadly accurate numbers only; never mention being an AI; don't address the moderator; don't summarise unless asked; stay within the word range.

Instruction block per request: "Write {Name}'s next line ({persona role}). {cue guidance}. Length: {min}-{max} words." Cue guidance examples:
- open: open the discussion: frame the topic, take a clear stand, outline two angles.
- respond-user: {user} just spoke; respond directly to their specific point.
- agree-user: start with "I agree with {user}" and restate their point; add nothing new.
- drift: drift onto a related tangent, no acknowledgement.
- follow-drift: go along with {drifter}'s tangent.
- bring-back: firmly bring the discussion back to the topic.
- late-strong: first contribution, late: one sharp new angle or framework.
- continue-after-interjection: you just cut {user} off and they stopped; take the floor and make your point.
- wrap-up: under a minute left; consolidate, no new threads.
- interject (mode): cut in on {user} mid-sentence, 10-22 words, react to what they are saying right now ("Sorry to cut in, but…").
- summary (mode): closing summary, 60-90 words, both sides incl. {user}'s points by name, end with a conclusion.

Post-process: strip a leading "Name:" prefix, wrapping quotes, markdown; collapse whitespace; hard cap ~1.6× the max words at a sentence boundary.

### Limits and abuse protection (cost control)

The main running cost is Claude usage per GD (see README for the estimate). Defaults are limited, configurable by env:
- `DAILY_GD_LIMIT` per device (default 3; `0` = unlimited). Device = random id in an httpOnly cookie `gd_device` (1 year).
- `DAILY_GD_LIMIT_PER_IP` (default 30; `0` = off): looser so a whole campus behind one NAT still works.
- `DAILY_GD_LIMIT_GLOBAL` (default 0 = off): a hard budget cap across everyone.
- Days roll over at midnight in `LIMIT_TIMEZONE` (default `Asia/Kolkata`).
- `POST /api/session` consumes one GD (device, IP, global). If any limit is exceeded, undo the increments already made and return 429 `{code:"daily_limit"}` with a friendly message. Returns `{ token, remainingToday }`.
- Token: `base64url(JSON{sid, exp})` + "." + HMAC-SHA256. Secret: `SESSION_SECRET`, else derived as sha256("gd-arena:" + ANTHROPIC_API_KEY). Expiry 45 min. Constant-time compare.
- `/api/turn`: valid token required (401 `bad_token`); per-session cap of 150 turn calls (429 `turn_limit`). `/api/score`: valid token; max 3 calls per session.
- Request validation with zod (`src/lib/server/validate.ts`): topic title ≤ 200 chars, userName 1-40 chars, transcript ≤ 80 turns, each text ≤ 2,000 chars, partialUserText ≤ 3,000; score record ≤ 300 turns. 400 on invalid.
- Counter store: Upstash Redis REST if `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (or Vercel's `KV_REST_API_URL` + `KV_REST_API_TOKEN`) are set (`POST {url}/pipeline` with `[["INCR",k],["EXPIRE",k,ttl]]`, Bearer token; `DECRBY`/`DECR` to undo); otherwise an in-memory Map (per server instance; fine for local dev, documented as approximate on Vercel).

## 7. Metrics (src/lib/metrics.ts)

`computeMetrics(record: GDRecord): GDMetrics`, deterministic and pure (used by `/api/score` and unit tests).
- Discussion phase only for entries/airtime/silence; summary turns count toward words/pace/fillers.
- `openedDiscussion`: the first discussion-phase non-moderator turn is the candidate's.
- `entries`: candidate discussion turns with `continuation !== true`. `cutIns`: candidate entries immediately preceded by an AI turn with `interruptedBy === "user"`.
- Airtime: `endMs - startMs` per turn; interjections count for the dominator.
- `longestSilenceSec`: the largest gap in the discussion window (`discussionStartMs`→`discussionEndMs`) not covered by candidate turns.
- WPM: candidate words / candidate speaking minutes; null in text mode (all typed) or under 20 s of speech.
- Fillers (case-insensitive, whole words/phrases, count multi-word first and don't double count): um, umm, uh, uhh, er, erm, like, basically, actually, literally, you know, i mean, sort of, kind of, so yeah, right?, okay so. Note in the UI that browser speech-to-text often drops "um"/"uh", so counts are a floor.
- `referencesToOthers`: candidate turns mentioning any participant's name (cast via `castFor`).
- `summaryGiven`: summary-phase candidate words ≥ 15.

## 8. UI and design

- Tailwind 4 with the tokens in `globals.css` (bg-bg, bg-panel, text-ink, border-line, bg-accent, …); works in light and dark. Persona colours from `personas.ts` via inline styles (`style={{ "--ring": color }}` for `.speaking-ring`).
- Animation: `motion` (`import { motion, AnimatePresence } from "motion/react"`); respect `prefers-reduced-motion` (`useReducedMotion`). Icons: `lucide-react`. No other new dependencies.
- Make it feel **alive**: the room is the product. A round-table layout: moderator at the head, five AI tiles and the candidate's tile around it; the speaking tile glows and pulses in its colour; "about to speak" dots on the preparing participant; the live caption with the spoken part highlighted word by word; an audio-reactive mic meter while the candidate speaks; a live airtime bar (stacked by speaker colour) that grows as people talk; the countdown ring turns amber in the last 2 minutes and red in the last 30 s; cut-offs flash a "cut off" tag on the tile; interruption events show a toast ("Arjun cut in. Hold your ground or yield"). The Jump-in button is large, centred, keyboard (Space) accessible, and shows "Done" while the candidate holds the floor.
- Phone width must work (single column, 16 px gutters, no horizontal scroll); desktop gets the side panel (Notes | Transcript tabs).
- Accessibility: real buttons, visible focus rings, `aria-live="polite"` for captions/notices, contrast in both themes, no information by colour alone (names on tiles).
- Before the GD: a browser check (SpeechRecognition support → otherwise explain text mode; recommend Chrome/Edge on desktop and **headphones** so the mic doesn't pick up the AI voices).
- Scorecard: animated overall score ring + headline + verdict; KPI tiles (opened?, entries, airtime share vs fair share 17%, first entry time, WPM, fillers/100 words, interruptions held/yielded); an airtime bar chart by speaker (persona colours, labels, not colour alone); the eight assessment sections with rating bars and comments (new vs repeated points as two lists, examples and references as lists, drift pulled back yes/no); strengths and improvements; the full transcript (speaker names + timestamps mm:ss from discussion start, candidate turns highlighted, filler words underlined, cut-offs marked); "Download transcript (.txt)" and "Practise again" buttons.

## 9. Conventions

- Next.js **16.4**: read `node_modules/next/dist/docs/` for anything version-specific (route handlers, `LayoutProps`, etc.). App Router, TypeScript strict, `"use client"` only where needed.
- Browser-only APIs must not run during server rendering (guard with `typeof window` / effects).
- No new npm dependencies (already installed: next, react, @anthropic-ai/sdk, zod, motion, lucide-react, tailwindcss).
- Keep code readable and commented where intent isn't obvious; no dead code.
- Checks: `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm test`.

# GD Arena

Practise a **group discussion (GD)** out loud against five AI participants, then get a scorecard and the full transcript.

GD Arena is a web app. The browser provides speech-to-text and the voices for free, and the Claude API runs the participants and the scoring.

## How a GD works

1. **Choose a topic.** Pick from business, current affairs or abstract topics (like "Red vs Blue"), type your own, or get a random one.
2. **Prepare for 2 minutes** with an on-screen notepad. Your notes stay beside you during the GD and are never sent to the AI.
3. **The GD starts.** The moderator reads the topic. Five AI participants speak out loud, and you speak through your mic.
4. **Jump in to speak.** Pressing the button (or Space) cuts off the current speaker, just like a real GD. If you wait too long, others take the space.
5. **Summarise.** After 10–12 minutes (or 5 for a quick round), the moderator calls time and asks you for a closing summary.
6. **Get your scorecard** along with the full transcript (downloadable as text or printable as PDF).

### The five participants

They react to what you actually said, not to a script.

| | Name | What they do |
|---|---|---|
| 🔥 | **Arjun**, the Dominator | Talks a lot and interrupts you mid-sentence. Keep talking to hold your ground. |
| 📊 | **Meera**, the Data Person | Throws in stats, cases and examples. |
| 👍 | **Rohit**, the Agreer | Says "I agree with *you*…" and adds nothing. |
| 🎈 | **Kabir**, the Drifter | Goes off-topic. This tests whether you can pull the discussion back. |
| 🦉 | **Ananya**, the Silent Smart One | Speaks late, with a strong point, and gives a closing summary after yours. |

If your first name matches a participant's, that participant uses a different name.

### The scorecard

- whether you opened the discussion
- how many times you entered, and your share of airtime against a fair share (about 1/6)
- new points vs repetition
- whether you used examples or data, and referred to what others said
- how you handled interruptions (held your ground or yielded)
- whether you pulled the discussion back after the drift
- the quality of your closing summary
- filler words and speaking pace

Entries, airtime, pace, fillers and interruptions are measured directly from the session. The judgement calls (new vs repeated points, quality of the summary, and so on) come from Claude reading the transcript.

## Browser support

- **Best:** Chrome or Edge on a desktop or laptop, **with headphones** so the mic doesn't pick up the AI voices.
- Voice input uses the browser's Web Speech API. Where it isn't available (for example Firefox), GD Arena switches to **text mode**: you type your turns, while the AI participants still speak.
- Browser speech-to-text often drops "um" and "uh", so the filler count is a minimum.

## Run it locally

Requires Node.js 20 or later.

```bash
npm install
cp .env.example .env.local   # then set one AI key (ANTHROPIC_API_KEY, GEMINI_API_KEY or GROQ_API_KEY)
npm run dev
```

Open <http://localhost:3000>.

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build && npm start` | Production build and server |
| `npm test` | Unit tests in `tests/` (director, engine, metrics, speech helpers, server helpers, room view model, transcript text) |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |

## Configuration

All settings are environment variables; see [`.env.example`](.env.example).

| Variable | Default | Purpose |
|---|---|---|
| `GD_PROVIDER` | auto | `claude`, `gemini`, `groq` or `openai`. Default: the first with a key set, in that order |
| `ANTHROPIC_API_KEY` | | Claude API key (best quality; needs prepaid credits) |
| `GEMINI_API_KEY` | | Google Gemini API key (free tier available) |
| `GROQ_API_KEY` | | Groq API key (free plan available) |
| `LLM_BASE_URL` / `LLM_API_KEY` | | Any other OpenAI-compatible API (`GD_PROVIDER=openai`, also set `GD_MODEL`) |
| `GD_MODEL` | per provider | Model for the AI participants: `claude-opus-5-5`, `openai/gpt-oss-120b` (Groq), or for Gemini the list `gemini-flash-lite-latest, gemini-flash-latest, gemini-2.5-flash-lite, gemini-2.5-flash`. For Gemini, Groq and other OpenAI-compatible APIs, a comma-separated list is tried in order: a model that is missing or out of quota hands over to the next |
| `GD_SCORING_MODEL` | per provider | Model (or list) for the scorecard: `claude-opus-5-5`, Gemini starts with `gemini-flash-latest`, otherwise `GD_MODEL` |
| `GD_TURN_EFFORT` | `low` | Effort for participant lines (keeps replies fast) |
| `DAILY_GD_LIMIT` | `3` | GDs per device per day (`0` = unlimited) |
| `DAILY_GD_LIMIT_PER_IP` | `30` | GDs per IP address per day (`0` = off). Kept loose so a whole campus behind one network still works |
| `DAILY_GD_LIMIT_GLOBAL` | `0` (off) | Hard cap on GDs across all users per day, as a budget guard |
| `LIMIT_TIMEZONE` | `Asia/Kolkata` | When the daily limits reset |
| `SESSION_SECRET` | derived from the API key | Signs session tokens |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | unset | Shared counter store for the limits (Vercel's `KV_REST_API_URL` / `KV_REST_API_TOKEN` also work) |

Without Upstash/KV, the limits are counted in memory per server instance. That's fine locally, but only approximate on Vercel.

## Deploy to Vercel

1. Import the repository in Vercel (framework preset: Next.js).
2. Set one AI key (`ANTHROPIC_API_KEY`, or a free `GEMINI_API_KEY` / `GROQ_API_KEY`), and preferably `SESSION_SECRET` (any long random string). Open `/api/health` after deploying to check which AI service the server uses, and `/api/health?check=1` to see which of the models your Gemini or Groq key can use and to generate one test line (cached for five minutes).
3. For limits that hold across instances, add an Upstash Redis database from the Vercel Marketplace; it sets the `KV_REST_API_*` variables automatically.
4. Deploy.

## Cost per GD and the free-vs-limited decision

**Practice mode (no key, no cost):** with no AI key set, or when the AI can't be used (no credits, a rejected key, a free-tier limit), GD Arena still runs. The participants use built-in lines that quote your words and the topic, and the scorecard is built from the measured numbers. The room shows a "Practice mode" label and the scorecard says so. Real AI reactions need one of the keys below.

**Running it for free:** set `GEMINI_API_KEY` (Google AI Studio) or `GROQ_API_KEY` (Groq console) instead of a Claude key. Both have free tiers with per-minute and per-day limits, so a free key supports a few GDs a day; when a limit is hit the participants pause briefly ("busy") and retry. Quality is below Claude's.

The main running cost is Claude API usage. One 12-minute GD makes roughly 25–35 participant calls, each short with low effort, plus one scoring call.

- **Rough estimate on Claude Opus 5.5 ($4 / $20 per million input / output tokens): about $0.30–0.50 per GD.** The participants' transcript is prompt-cached, so each call mostly re-reads cached tokens at a twentieth of the input price ($0.20 per million).
- This is an estimate. Check real usage in the Claude Console after a few GDs.
- To cut the cost, set `GD_MODEL` to a cheaper model (for example `claude-sonnet-5-5` at $2 / $10, or `claude-haiku-5-5` at $0.10 / $0.50). The participants are the bulk of the calls, and scoring can stay on Opus.

The default is **limited**: 3 GDs per device per day, 30 per IP per day, and no global cap. Whether GD Arena should be free for everyone or limited per day is a product decision. Change the defaults with the variables above; `DAILY_GD_LIMIT_GLOBAL` caps your worst-case daily spend at roughly that number × the cost per GD.

## How it's built

- **Next.js 16** (App Router) + React 19 + Tailwind CSS 4, deployed on Vercel.
- **Browser engine** (`src/lib/engine.ts`): a state machine that runs the GD. It covers the moderator, turn-taking, cut-offs, prefetching the next line while the current one is spoken, Arjun's interruptions, silence detection, time-up and summaries.
- **Director** (`src/lib/director.ts`): decides who speaks next and with what cue (open, respond to you, drift, follow the drift, bring it back, late strong point, wrap up).
- **Speech** (`src/lib/speech/`): `speechSynthesis` voices per participant (preferring Indian-English voices), `SpeechRecognition` for your mic, and a live mic meter.
- **API routes** (`src/app/api/`): `session` (daily limits + signed session token), `turn` (one participant line from Claude), and `score` (metrics + Claude's structured assessment).
- **Metrics** (`src/lib/metrics.ts`): deterministic numbers (entries, airtime, pace, fillers, interruptions) computed from the transcript.

The full design spec is in [`docs/DESIGN.md`](docs/DESIGN.md).

## Roadmap

- More realistic voices (neural TTS)
- A history of past GDs and progress over time
- Mixed rooms: 2–3 real students plus AI participants

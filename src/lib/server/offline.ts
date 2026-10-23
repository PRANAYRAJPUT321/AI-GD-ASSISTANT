// Practice mode: built-in participant lines and a metrics-only scorecard, used when no AI
// service is configured or the configured one is unavailable (no credits, a rejected key,
// a free-tier limit). The GD keeps running at no cost; the UI says practice mode is on.
//
// Lines are templates per persona and cue. They quote the candidate's own words and the
// topic, so the room still reacts to what was said, but they cannot reason about it the
// way a model does. Nothing here invents statistics.

import { countWords } from "../metrics";
import { castFor, type Cast } from "../personas";
import type { Assessment, GDMetrics } from "../scoring";
import type { GDRecord, PersonaId, TurnRequest, WireTurn } from "../types";

type LineInput = Omit<TurnRequest, "token">;

interface Context {
  cast: Cast;
  user: string;
  topic: string;
  /** The candidate's latest words, trimmed to a short quotable snippet ("" if they haven't spoken). */
  said: string;
  /** Name of whoever spoke last (not the moderator), for the Agreer. */
  lastName: string;
  /** A one- or two-word phrase from the discussion for the Drifter to wander off with. */
  hook: string;
}

const STOP = new Set(
  "a an the and or but if of to in on at for with by from is are was were be been being it its this that these those i you he she we they me my our your their not no so as do does did have has had can could will would should may might just very really also about into than then there here what which who whom how why when where all any some more most such only own same too out up down over under again further once like basically actually literally um uh okay yeah".split(
    " ",
  ),
);

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
}

/** The first run of one or two consecutive content words ("quick commerce", "gig work"). */
function phrase(text: string): string | undefined {
  const ws = words(text);
  for (let i = 0; i < ws.length; i++) {
    if (STOP.has(ws[i]) || ws[i].length < 3) continue;
    const next = ws[i + 1];
    return next && !STOP.has(next) && next.length >= 3 ? `${ws[i]} ${next}` : ws[i];
  }
  return undefined;
}

/** The opening of the last sentence the candidate finished, about 4-12 words, for quoting. */
function snippet(text: string): string {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => countWords(s) >= 3);
  const pick = sentences.at(-1) ?? text.trim();
  const ws = pick.replace(/[.!?,;:]+$/, "").split(" ");
  return (ws.length > 12 ? ws.slice(0, 12).join(" ") + "…" : ws.join(" ")).replace(/^["'“”]+|["'“”]+$/g, "");
}

function lastTurn(transcript: WireTurn[], test: (t: WireTurn) => boolean): WireTurn | undefined {
  for (let i = transcript.length - 1; i >= 0; i--) if (test(transcript[i])) return transcript[i];
  return undefined;
}

function context(input: LineInput): Context {
  const cast = castFor(input.userName);
  const user = input.userName.trim().split(/\s+/)[0] || input.userName;
  const lastUser = lastTurn(input.transcript, (t) => t.speaker === "user");
  const last = lastTurn(input.transcript, (t) => t.speaker !== "moderator");
  const lastName =
    !last || last.speaker === "user" ? user : last.speaker === "moderator" ? "everyone" : cast[last.speaker].name;
  const hook = phrase(lastUser?.text ?? "") ?? phrase(input.topic.title) ?? "this";
  return {
    cast,
    user,
    // Quoted, so a title like "Quick commerce: boon or bane?" reads cleanly mid-sentence.
    topic: `"${input.topic.title.trim().replace(/[?.!]+$/, "")}"`,
    said: input.mode === "interject" && input.partialUserText ? snippet(input.partialUserText) : lastUser ? snippet(lastUser.text) : "",
    lastName,
    hook,
  };
}

type Template = (c: Context) => string;

const DOMINATOR: Record<string, Template[]> = {
  open: [
    (c) =>
      `Let me start, because someone has to. On ${c.topic}, I'll take a clear position: the benefits are real, but only if the execution is serious. We should look at this from three angles: the economics, the people who are actually affected, and what happens in the long run. Most arguments on this fall apart on execution, so let's not hide behind a vague middle path.`,
    (c) =>
      `Good evening, everyone. I'll open. ${c.topic}: I think we need to stop treating this as a simple yes or no. The real issue is who gains, who pays, and how fast things change. My view is that the upside is bigger than the risks, but only with clear rules, and I'd like us to be honest about the trade-offs from the start.`,
  ],
  respond: [
    (c) =>
      `Let me stop you there, ${c.user}. "${c.said}" sounds good on paper, but it ignores the ground reality. If we're serious about ${c.topic}, we have to talk about who actually bears the cost and who walks away with the benefit. I've heard this argument many times, and it always skips the hard part: implementation.`,
    (c) =>
      `${c.user}, with respect, I don't buy that. You said "${c.said}", but that's the easy half of the argument. The tougher question is what happens when this scales, when the incentives change and people start gaming the system. That's where I think your point breaks down, and we need a firmer position than that.`,
  ],
  normal: [
    (c) =>
      `Look, we keep going around in circles. On ${c.topic}, the honest answer is that the benefits are concentrated and the costs are spread out. Unless we fix that imbalance, no amount of optimism helps. I'd like us to move from opinions to what would actually have to change, because that's where this discussion should be going.`,
    (c) =>
      `I want to push this forward. Everyone agrees there are pros and cons, fine. But a group discussion isn't about listing both sides, it's about taking a stand. Mine is simple: on ${c.topic}, the long-term gains outweigh the short-term pain, provided the rules are clear and someone is actually accountable.`,
  ],
  bring: [
    (c) =>
      `Okay, let's get back to the actual topic, which is ${c.topic}. We've drifted. The question in front of us is whether this is good on balance and under what conditions. I'd say yes, with strong safeguards, and I'd like to hear someone argue the other side properly.`,
  ],
  continue: [
    (c) =>
      `As I was saying, the core issue with ${c.topic} is accountability. When something goes wrong, who answers for it? Until we have a clear answer to that, the optimistic case doesn't hold, and that's the point I want this group to engage with.`,
  ],
  wrap: [
    (c) =>
      `We're nearly out of time, so let me be direct. On ${c.topic}, I stand by my view: it can work, but only with clear rules and real accountability. Let's not leave this discussion sitting on the fence.`,
  ],
  interject: [
    (c) => `Sorry to cut in, ${c.user}, but that's exactly the problem. It doesn't hold up once you look at how it plays out in practice.`,
    (c) => `Hold on, ${c.user}, let me jump in. That sounds neat, but you're ignoring who actually pays for it.`,
    (c) => `One second, ${c.user}. I have to disagree right there, because the ground reality is very different.`,
  ],
};

const DATA: Record<string, Template[]> = {
  respond: [
    (c) =>
      `Building on what ${c.user} said about "${c.said}", the evidence I've seen is mixed. Where this has worked, there was a clear policy framework and someone measuring outcomes. Where it hasn't, the problem was usually poor implementation rather than the idea itself. So I'd ask: what would we measure to know if it's working?`,
    (c) =>
      `I'd like to test ${c.user}'s point with an example. Take a large Indian city: the people at the top tend to capture the gains first, and the benefits reach smaller towns much later, if at all. So "${c.said}" may be true on average and still miss who is left out.`,
  ],
  normal: [
    (c) =>
      `If we look at how ${c.topic} has played out in practice, the pattern is fairly consistent: early adopters gain, and the rest catch up slowly. Countries that planned for the transition did better than the ones that just let it happen. That's the example I'd keep in mind before we pick a side.`,
    (c) =>
      `Let me bring in a concrete example. Companies that tried this with clear targets and regular reviews generally reported better outcomes than those that made a one-time announcement. The lesson for ${c.topic} is that the design and the follow-through matter more than the headline.`,
  ],
  follow: [
    (c) =>
      `That's an interesting comparison, actually. The ${c.hook} example shows how quickly habits change once something becomes cheap and convenient, and the same thing has happened in a lot of consumer markets.`,
  ],
  bring: [
    (c) =>
      `Can we bring this back to ${c.topic}? The useful question is what the evidence says about outcomes, and that's where I think we should spend our remaining time.`,
  ],
  wrap: [
    (c) =>
      `To wrap up my side: on ${c.topic}, the examples point the same way. It works where it's measured and managed, and it fails where it's left to chance.`,
  ],
};

const AGREER: Record<string, Template[]> = {
  user: [
    (c) => `I agree with ${c.user}. What ${c.user} is saying, basically, is that "${c.said}", and I think that's a very important point that we shouldn't miss.`,
    (c) => `I agree with ${c.user} completely. "${c.said}" is exactly right, and I think everyone here should keep that in mind.`,
  ],
  last: [
    (c) => `I agree with ${c.lastName}. That's a really good point, and I think it's exactly what we should be focusing on.`,
    (c) => `I agree with what ${c.lastName} just said. It's an important point, and I think we're all more or less on the same page there.`,
  ],
  follow: [
    (c) => `I agree with ${c.lastName}, actually. That ${c.hook} example is so true, and I've noticed the same thing myself.`,
  ],
};

const DRIFTER: Template[] = [
  (c) =>
    `Speaking of ${c.hook}, it reminds me of something from my college days. We had a professor who said the real test of any idea is whether your parents would accept it at the dinner table. Honestly, I think so much of this comes down to family expectations and what we were taught growing up, and that's a whole discussion in itself.`,
  (c) =>
    `You know, this makes me think of social media. Everything about ${c.hook} today is shaped by what goes viral, and I sometimes wonder whether we even form our own opinions any more. My cousin was saying the same thing about influencers last week, and I think that's the bigger story here.`,
  (c) =>
    `This actually connects to cricket for me. Look at how the IPL changed everything: the money, the fans, even how young players train. When something like ${c.hook} becomes a business, the whole culture around it changes, and I find that fascinating.`,
];

const SMART: Record<string, Template[]> = {
  late: [
    (c) =>
      `Can I offer a different way to look at this? We've been arguing about whether ${c.topic} is good or bad, but the more useful question is: for whom, and over what time frame? If we separate the short term from the long term, and the people who gain from the people who carry the risk, most of today's disagreement disappears. The real debate is about who bears the transition cost.`,
    (c) =>
      `One thing nobody has said yet: the answer on ${c.topic} depends on incentives. Change the incentives and the same idea produces very different outcomes. So instead of asking whether it's good, we should ask what rules would make it good, and who should be accountable for them.`,
  ],
  normal: [
    (c) =>
      `If I may add one point: the disagreement here is less about facts and more about priorities. ${c.user} and ${c.cast.dominator.name} are weighing different things, and once we name those priorities, we can actually compare the options on ${c.topic}.`,
  ],
  summary: [
    (c) =>
      `Let me summarise. We started with ${c.topic} and heard two broad views: one saying the benefits clearly outweigh the costs, and one saying the costs fall on the people least able to bear them. ${c.user} made the point that "${c.said}". We drifted for a while, but came back to implementation and accountability. My conclusion: it can work, but only with clear rules, honest measurement and attention to who carries the risk.`,
  ],
};

/** Picks a variant that changes from turn to turn but is stable for a given transcript. */
function choose(list: Template[], input: LineInput, salt: number): Template {
  return list[(input.transcript.length + salt) % list.length];
}

const SALT: Record<PersonaId, number> = { dominator: 0, data: 1, agreer: 2, drifter: 3, smart: 4 };

/** One built-in line for the requested speaker, mode and cue. */
export function offlineLine(input: LineInput): string {
  const c = context(input);
  const salt = SALT[input.speaker];
  const pick = (list: Template[]) => choose(list, input, salt)(c);
  const userSpoke = c.said !== "";

  if (input.mode === "interject") return pick(DOMINATOR.interject);
  if (input.mode === "summary") return pick(SMART.summary).replace(/ \S+ made the point that ""\./, "");

  switch (input.speaker) {
    case "dominator":
      if (input.cue === "open") return pick(DOMINATOR.open);
      if (input.cue === "bring-back") return pick(DOMINATOR.bring);
      if (input.cue === "continue-after-interjection") return pick(DOMINATOR.continue);
      if (input.cue === "wrap-up") return pick(DOMINATOR.wrap);
      return input.cue === "respond-user" && userSpoke ? pick(DOMINATOR.respond) : pick(DOMINATOR.normal);
    case "data":
      if (input.cue === "open") return pick(DATA.normal);
      if (input.cue === "follow-drift") return pick(DATA.follow);
      if (input.cue === "bring-back") return pick(DATA.bring);
      if (input.cue === "wrap-up") return pick(DATA.wrap);
      return input.cue === "respond-user" && userSpoke ? pick(DATA.respond) : pick(DATA.normal);
    case "agreer":
      if (input.cue === "follow-drift") return pick(AGREER.follow);
      return (input.cue === "agree-user" || input.cue === "respond-user") && userSpoke ? pick(AGREER.user) : pick(AGREER.last);
    case "drifter":
      return pick(DRIFTER);
    case "smart":
      if (input.cue === "late-strong" || input.cue === "open") return pick(SMART.late);
      return pick(SMART.normal);
  }
}

// ---------- Metrics-only scorecard ----------

const clamp = (n: number) => Math.max(0, Math.min(10, Math.round(n)));

function userSentences(record: GDRecord): string[] {
  return record.transcript
    .filter((t) => t.speaker === "user" && t.phase === "discussion")
    .flatMap((t) => t.text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter((s) => countWords(s) >= 5);
}

function shorten(sentence: string): string {
  const ws = sentence.replace(/[.!?]+$/, "").split(" ");
  return ws.length > 14 ? ws.slice(0, 14).join(" ") + "…" : ws.join(" ");
}

function contentWords(s: string): Set<string> {
  return new Set(words(s).filter((w) => !STOP.has(w) && w.length > 2));
}

/** Points made, split into new ones and ones that mostly repeat an earlier sentence. */
function points(sentences: string[]): { fresh: string[]; repeated: string[] } {
  const fresh: string[] = [];
  const repeated: string[] = [];
  const seen: Set<string>[] = [];
  for (const s of sentences) {
    const cw = contentWords(s);
    const overlaps = seen.some((prev) => {
      const shared = [...cw].filter((w) => prev.has(w)).length;
      return cw.size > 0 && shared / cw.size >= 0.6;
    });
    (overlaps ? repeated : fresh).push(shorten(s));
    seen.push(cw);
  }
  return { fresh: fresh.slice(0, 8), repeated: repeated.slice(0, 8) };
}

/** A scorecard built only from the measured numbers and simple text checks (no AI). */
export function offlineAssessment(record: GDRecord, m: GDMetrics): Assessment {
  const cast = castFor(record.config.userName);
  const names = Object.values(cast).map((p) => p.name.toLowerCase());
  const sentences = userSentences(record);
  const { fresh, repeated } = points(sentences);
  const examples = sentences
    .filter((s) => /\d|%|for example|for instance|such as|take the case|look at/i.test(s))
    .map(shorten)
    .slice(0, 8);
  const references = sentences
    .filter((s) => names.some((n) => s.toLowerCase().includes(n)))
    .map(shorten)
    .slice(0, 8);
  const share = m.airtimeShare;

  const opening = m.openedDiscussion ? 8 : m.firstEntrySec === null ? 0 : m.firstEntrySec < 60 ? 5 : m.firstEntrySec < 180 ? 3 : 2;
  const participation =
    m.entries === 0 ? 0 : clamp((share >= 0.12 && share <= 0.3 ? 8 : share > 0.3 ? 6 : share >= 0.06 ? 5 : 3) + (m.entries >= 3 ? 1 : 0));
  const content = clamp(fresh.length === 0 ? 0 : 3 + fresh.length * 1.5 - repeated.length);
  const evidence = clamp(2 + (examples.length > 0 ? 3 : 0) + (references.length > 0 || m.referencesToOthers > 0 ? 3 : 0));
  const interruptions = m.interruptionsFaced === 0 ? 6 : clamp(3 + (7 * m.interruptionsHeld) / m.interruptionsFaced);
  const pulledBack = m.driftTurns === 0 ? null : pulledBackAfterDrift(record);
  const drift = pulledBack === null ? 6 : pulledBack ? 7 : 3;
  const summary = !m.summaryGiven ? 0 : m.summaryWords < 40 ? 5 : m.summaryWords > 160 ? 6 : 8;
  const pace = m.wordsPerMinute;
  const delivery =
    m.inputMode === "text" || pace === null
      ? 6
      : clamp((pace >= 115 && pace <= 165 ? 8 : 6) + (m.fillersPer100 < 2 ? 1 : m.fillersPer100 > 5 ? -2 : 0));

  const ratings = { opening, participation, content, evidence, interruptions, drift, summary, delivery };
  const score = Math.round(
    (opening * 10 + participation * 15 + content * 20 + evidence * 15 + interruptions * 10 + drift * 5 + summary * 15 + delivery * 10) / 10,
  );
  const fairPct = Math.round(share * 100);

  const advice: Record<keyof typeof ratings, [string, string]> = {
    opening: ["You opened the discussion, which shows initiative.", "Open the discussion yourself: plan a crisp first line during prep."],
    participation: [`You took a healthy share of the airtime (${fairPct}%).`, `Enter more often: you had ${fairPct}% of the airtime against a fair share of about 17%.`],
    content: ["You brought several distinct points.", "Bring more distinct points instead of restating earlier ones."],
    evidence: ["You used examples or built on what others said.", "Back your points with an example and name the person you're responding to."],
    interruptions: ["You held your ground when interrupted.", "When someone cuts in, finish your sentence calmly before yielding."],
    drift: ["You pulled the group back after it drifted.", "When the group drifts, bring it back to the topic explicitly."],
    summary: ["You gave a closing summary.", "Always give a closing summary: both sides, then a conclusion, in under a minute."],
    delivery: ["Your pace and filler use were under control.", "Slow down and cut filler words; aim for about 120-160 words a minute."],
  };
  const keys = Object.keys(ratings) as (keyof typeof ratings)[];
  const best = [...keys].sort((a, b) => ratings[b] - ratings[a]).filter((k) => ratings[k] >= 7).slice(0, 3);
  const worst = [...keys].sort((a, b) => ratings[a] - ratings[b]).filter((k) => ratings[k] <= 5).slice(0, 3);

  return {
    overall: {
      score,
      headline: score >= 70 ? "Solid, active participation" : score >= 50 ? "A fair start, room to grow" : "Speak up more next time",
      verdict:
        `This is a practice-mode scorecard: no AI evaluator was available, so it is based on your measured numbers and simple checks of what you said. ` +
        `You entered ${m.entries} time${m.entries === 1 ? "" : "s"} and had ${fairPct}% of the airtime. ` +
        (m.summaryGiven ? "You gave a closing summary." : "You didn't give a closing summary."),
    },
    opening: {
      rating: opening,
      comment: m.openedDiscussion
        ? "You opened the discussion before any AI participant."
        : m.firstEntrySec === null
          ? "You didn't enter the discussion."
          : `Your first entry came ${Math.round(m.firstEntrySec)} seconds in; someone else opened.`,
    },
    participation: {
      rating: participation,
      comment: `You entered ${m.entries} time${m.entries === 1 ? "" : "s"} (${m.cutIns} by cutting someone off) and spoke for about ${Math.round(m.userAirtimeSec)} seconds, ${fairPct}% of the airtime. A fair share with six speakers is about 17%.`,
    },
    content: {
      rating: content,
      comment:
        fresh.length === 0
          ? "No complete points were recorded from you."
          : `You made ${fresh.length} distinct point${fresh.length === 1 ? "" : "s"}${repeated.length ? ` and repeated yourself ${repeated.length} time${repeated.length === 1 ? "" : "s"}` : ""}.`,
      newPoints: fresh,
      repeatedPoints: repeated,
    },
    evidence: {
      rating: evidence,
      comment: `${examples.length ? "You used at least one example or number." : "You didn't use examples or numbers."} ${m.referencesToOthers ? `You referred to other participants ${m.referencesToOthers} time${m.referencesToOthers === 1 ? "" : "s"}.` : "You didn't refer to what others said by name."}`,
      examples,
      references,
    },
    interruptions: {
      rating: interruptions,
      comment:
        m.interruptionsFaced === 0
          ? "Nobody cut you off this time, so this wasn't tested."
          : `You were cut off ${m.interruptionsFaced} time${m.interruptionsFaced === 1 ? "" : "s"} and held your ground ${m.interruptionsHeld} time${m.interruptionsHeld === 1 ? "" : "s"}.`,
    },
    drift: {
      rating: drift,
      comment:
        pulledBack === null
          ? "The discussion didn't drift off-topic, so this wasn't tested."
          : pulledBack
            ? "After the discussion drifted, you spoke up soon after, which helps pull it back."
            : "The discussion drifted and you didn't step in to bring it back.",
      pulledBack,
    },
    summary: {
      rating: summary,
      comment: m.summaryGiven ? `Your closing summary ran to about ${m.summaryWords} words.` : "You didn't give a closing summary.",
    },
    delivery: {
      rating: delivery,
      comment:
        pace === null
          ? "Pace wasn't measured (typed turns or too little speech)."
          : `You spoke at about ${pace} words a minute with ${m.fillersPer100} filler words per 100 (browser speech-to-text often drops "um" and "uh", so that's a minimum).`,
    },
    strengths: best.map((k) => advice[k][0]),
    improvements: worst.map((k) => advice[k][1]),
  };
}

/** True when the candidate spoke within the two turns after the drifter's first drift. */
function pulledBackAfterDrift(record: GDRecord): boolean {
  const turns = record.transcript.filter((t) => t.phase === "discussion" && t.speaker !== "moderator");
  const drift = turns.findIndex((t) => t.speaker === "drifter");
  if (drift < 0) return false;
  return turns.slice(drift + 1, drift + 3).some((t) => t.speaker === "user");
}

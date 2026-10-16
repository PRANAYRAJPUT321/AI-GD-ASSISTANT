import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { chooseNext, type DirectorChoice, type DirectorContext } from "@/lib/director";
import { PERSONA_IDS, type Cue, type GDPhase, type PersonaId, type SpeakerId, type Turn } from "@/lib/types";

// ---------- Fixtures ----------

/** Small seeded PRNG (mulberry32) so every run draws the same numbers. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let seq = 0;
function turn(speaker: SpeakerId, extra: Partial<Turn> & { phase?: GDPhase; cue?: Cue } = {}): Turn {
  seq += 1;
  return {
    id: `t${seq}`,
    speaker,
    text: `${speaker} says something`,
    startMs: seq * 1000,
    endMs: seq * 1000 + 900,
    phase: "discussion",
    kind: speaker === "moderator" ? "moderator" : "turn",
    ...extra,
  };
}

const intro = () => turn("moderator", { phase: "intro" });

/** Draws `n` choices for the same transcript and context, each with fresh random numbers. */
function draws(transcript: Turn[], ctx: Omit<DirectorContext, "random">, n = 2000, seed = 1): DirectorChoice[] {
  const random = seeded(seed);
  return Array.from({ length: n }, () => chooseNext(transcript, { ...ctx, random }));
}

function share(choices: DirectorChoice[], match: (c: DirectorChoice) => boolean): number {
  return choices.filter(match).length / choices.length;
}

/** A plain stretch of discussion without the drifter, the smart one or the candidate. */
const plain = (n: number): Turn[] =>
  Array.from({ length: n }, (_, i) => turn(i % 2 === 0 ? "dominator" : "data", { cue: "normal" }));

// ---------- Tests ----------

describe("chooseNext", () => {
  test("the dominator opens when nobody has spoken (the moderator does not count)", () => {
    assert.deepEqual(chooseNext([], { elapsedFrac: 0, random: seeded(1) }), { speaker: "dominator", cue: "open" });
    assert.deepEqual(chooseNext([intro()], { elapsedFrac: 0.05, random: seeded(2) }), {
      speaker: "dominator",
      cue: "open",
    });
    // If the dominator's line just failed, someone else opens.
    assert.deepEqual(chooseNext([intro()], { elapsedFrac: 0, random: seeded(3), avoid: "dominator" }), {
      speaker: "data",
      cue: "open",
    });
  });

  test("a forced choice always wins", () => {
    const forced = { speaker: "dominator", cue: "continue-after-interjection" } as const;
    const transcript = [intro(), turn("dominator", { kind: "interjection" })];
    for (const choice of draws(transcript, { elapsedFrac: 0.5, forced }, 50)) assert.deepEqual(choice, forced);
    // Even straight after a drift, or when the forced speaker spoke last.
    assert.deepEqual(chooseNext([intro(), turn("drifter", { cue: "drift" })], { elapsedFrac: 0.4, forced, random: seeded(4) }), forced);
  });

  test("after a drift: 60% the agreer follows, 15% the data person follows, 25% the dominator brings it back", () => {
    const transcript = [intro(), ...plain(4), turn("drifter", { cue: "drift" })];
    const choices = draws(transcript, { elapsedFrac: 0.4 }, 4000);
    const allowed = new Set(["agreer/follow-drift", "data/follow-drift", "dominator/bring-back"]);
    for (const c of choices) assert.ok(allowed.has(`${c.speaker}/${c.cue}`), `${c.speaker}/${c.cue}`);
    assert.ok(Math.abs(share(choices, (c) => c.speaker === "agreer") - 0.6) < 0.03);
    assert.ok(Math.abs(share(choices, (c) => c.speaker === "data") - 0.15) < 0.03);
    assert.ok(Math.abs(share(choices, (c) => c.speaker === "dominator") - 0.25) < 0.03);
    // Exact cut points of the roll.
    assert.deepEqual(chooseNext(transcript, { elapsedFrac: 0.4, random: () => 0.1 }), { speaker: "agreer", cue: "follow-drift" });
    assert.deepEqual(chooseNext(transcript, { elapsedFrac: 0.4, random: () => 0.7 }), { speaker: "data", cue: "follow-drift" });
    assert.deepEqual(chooseNext(transcript, { elapsedFrac: 0.4, random: () => 0.9 }), { speaker: "dominator", cue: "bring-back" });
  });

  test("a later moderator line or another phase does not hide the drift", () => {
    const transcript = [intro(), ...plain(4), turn("drifter", { cue: "drift" }), turn("moderator", { phase: "discussion" })];
    for (const c of draws(transcript, { elapsedFrac: 0.4 }, 200)) {
      assert.ok(c.cue === "follow-drift" || c.cue === "bring-back");
    }
  });

  test("after someone follows the drift, the dominator brings it back (the data person if the dominator just spoke)", () => {
    const base = [intro(), ...plain(4), turn("drifter", { cue: "drift" })];
    const afterAgreer = [...base, turn("agreer", { cue: "follow-drift" })];
    for (const c of draws(afterAgreer, { elapsedFrac: 0.45 }, 100)) assert.deepEqual(c, { speaker: "dominator", cue: "bring-back" });
    const afterData = [...base, turn("data", { cue: "follow-drift" })];
    assert.deepEqual(chooseNext(afterData, { elapsedFrac: 0.45, random: seeded(5) }), { speaker: "dominator", cue: "bring-back" });
    const afterDominator = [...base, turn("dominator", { cue: "follow-drift" })];
    assert.deepEqual(chooseNext(afterDominator, { elapsedFrac: 0.45, random: seeded(6) }), { speaker: "data", cue: "bring-back" });
    // The dominator's line failed: the data person brings it back instead.
    assert.deepEqual(chooseNext(afterAgreer, { elapsedFrac: 0.45, random: seeded(7), avoid: "dominator" }), {
      speaker: "data",
      cue: "bring-back",
    });
  });

  test("never picks the previous speaker, nor one to avoid", () => {
    for (const last of PERSONA_IDS) {
      if (last === "drifter") continue; // covered by the drift rule
      const transcript = [intro(), ...plain(6), turn(last, { cue: "normal" })];
      for (const frac of [0.1, 0.5, 0.7, 0.95]) {
        for (const c of draws(transcript, { elapsedFrac: frac, avoid: last === "data" ? "agreer" : "data" }, 400, frac * 100)) {
          assert.notEqual(c.speaker, last, `repeated ${last} at ${frac}`);
          assert.notEqual(c.speaker, last === "data" ? "agreer" : "data");
        }
      }
    }
  });

  test("the smart one stays silent before 0.55, then speaks with a late strong point, at most twice", () => {
    const transcript = [intro(), ...plain(8)];
    assert.equal(share(draws(transcript, { elapsedFrac: 0.54 }), (c) => c.speaker === "smart"), 0);

    const first = draws(transcript, { elapsedFrac: 0.6 });
    const smartFirst = first.filter((c) => c.speaker === "smart");
    assert.ok(smartFirst.length / first.length > 0.3, "the smart one is the likeliest speaker once allowed");
    for (const c of smartFirst) assert.equal(c.cue, "late-strong");

    const once = [...transcript, turn("smart", { cue: "late-strong" }), ...plain(2)];
    assert.equal(share(draws(once, { elapsedFrac: 0.8 }), (c) => c.speaker === "smart"), 0, "no second turn before 0.82");
    const second = draws(once, { elapsedFrac: 0.85 }).filter((c) => c.speaker === "smart");
    assert.ok(second.length > 0, "a second turn is possible late");
    for (const c of second) assert.notEqual(c.cue, "late-strong");

    const twice = [...once, turn("smart", { cue: "normal" }), ...plain(2)];
    assert.equal(share(draws(twice, { elapsedFrac: 0.95 }), (c) => c.speaker === "smart"), 0, "never a third turn");
  });

  test("the drifter drifts at most 3 times, inside 0.15..0.85, with 4 turns between drifts", () => {
    const drifts = (transcript: Turn[], frac: number) =>
      draws(transcript, { elapsedFrac: frac }).filter((c) => c.speaker === "drifter");

    const fresh = [intro(), ...plain(6)];
    assert.equal(drifts(fresh, 0.1).length, 0, "too early");
    assert.equal(drifts(fresh, 0.9).length, 0, "too late");
    const early = drifts(fresh, 0.2).length;
    const boosted = drifts(fresh, 0.35).length;
    assert.ok(early > 0 && boosted > early, "the first drift gets likelier after 0.3");
    for (const c of drifts(fresh, 0.5)) assert.equal(c.cue, "drift");

    const drift = () => turn("drifter", { cue: "drift" });
    const recent = [intro(), ...plain(4), drift(), turn("dominator", { cue: "bring-back" }), ...plain(2)];
    assert.equal(drifts(recent, 0.5).length, 0, "only 3 turns since the last drift");
    assert.ok(drifts([...recent, turn("dominator", { cue: "normal" })], 0.5).length > 0, "4 turns since: allowed");

    const three = [intro(), ...plain(4), drift(), ...plain(4), drift(), ...plain(4), drift(), ...plain(6)];
    assert.equal(drifts(three, 0.5).length, 0, "never a fourth drift");
  });

  test("the agreer agrees with the candidate once they have spoken, else with the last speaker", () => {
    const pickAgreer = (transcript: Turn[]) => {
      const choices = draws(transcript, { elapsedFrac: 0.3 }).filter((c) => c.speaker === "agreer");
      assert.ok(choices.length > 0);
      return new Set(choices.map((c) => c.cue));
    };
    assert.deepEqual(pickAgreer([intro(), ...plain(3)]), new Set(["agree-last"]));
    assert.deepEqual(pickAgreer([intro(), turn("user"), ...plain(3)]), new Set(["agree-user"]));
    // Straight after the candidate the agreer is likelier and still agrees with them.
    const afterUser = [intro(), ...plain(3), turn("user")];
    assert.deepEqual(pickAgreer(afterUser), new Set(["agree-user"]));
    assert.ok(
      share(draws(afterUser, { elapsedFrac: 0.3 }), (c) => c.speaker === "agreer") >
        share(draws([intro(), ...plain(4)], { elapsedFrac: 0.3 }), (c) => c.speaker === "agreer"),
    );
  });

  test("after the candidate speaks, others respond to them", () => {
    const transcript = [intro(), ...plain(3), turn("user")];
    const choices = draws(transcript, { elapsedFrac: 0.3 });
    for (const c of choices) {
      if (c.speaker === "dominator" || c.speaker === "data") assert.equal(c.cue, "respond-user");
    }
    // The candidate's turn wins over wrap-up too.
    for (const c of draws(transcript, { elapsedFrac: 0.95 })) {
      if (c.speaker === "dominator" || c.speaker === "data") assert.equal(c.cue, "respond-user");
    }
  });

  test("near the end, ordinary turns wrap up", () => {
    const transcript = [intro(), ...plain(6), turn("smart", { cue: "late-strong" }), turn("smart", { cue: "normal" }), ...plain(1)];
    // Only the dominator and the data person have no cue of their own (the drifter drifts, the agreer agrees).
    const cues = (frac: number) =>
      new Set(
        draws(transcript, { elapsedFrac: frac })
          .filter((c) => c.speaker === "dominator" || c.speaker === "data")
          .map((c) => c.cue),
      );
    assert.deepEqual(cues(0.92), new Set<Cue>(["wrap-up"]));
    assert.deepEqual(cues(0.6), new Set<Cue>(["normal"]));
  });

  test("is pure: same transcript and draws give the same choice", () => {
    const transcript = [intro(), ...plain(5), turn("user")];
    const a = draws(transcript, { elapsedFrac: 0.62 }, 300, 42);
    const b = draws(transcript, { elapsedFrac: 0.62 }, 300, 42);
    assert.deepEqual(a, b);
    const speakers = new Set<PersonaId>(a.map((c) => c.speaker));
    assert.ok(speakers.size >= 3, "draws vary with the random numbers");
  });
});

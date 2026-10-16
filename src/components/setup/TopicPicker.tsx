"use client";

import { Check, ChevronDown, Dices, PenLine } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { CATEGORY_BLURBS, CATEGORY_LABELS, TOPICS, customTopic, topicsIn } from "@/lib/topics";
import type { Topic, TopicCategory } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Card, Eyebrow } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";
import { useHydrated, usePrefersReducedMotion } from "@/components/ui/hooks";
import { fieldClass } from "@/components/ui/style";
import { MAX_CUSTOM_TOPIC_LENGTH, MIN_CUSTOM_TOPIC_LENGTH } from "./options";

const CATEGORIES: readonly TopicCategory[] = ["business", "current-affairs", "abstract"];
/** Topic cards shown per category before "Show all". */
const COLLAPSED_COUNT = 6;
/** Gaps between the titles flashed by "Surprise me": quick at first, then slowing to a stop. */
const SHUFFLE_GAPS_MS = [70, 70, 80, 90, 105, 125, 150, 185, 230];
const SHUFFLE_LAND_MS = 280;

function isCustomTopic(topic: Topic): boolean {
  return topic.id.startsWith("custom:");
}

/** Random bank topics for the shuffle animation: no repeats back to back, never one of `avoid`. */
function shuffleDecoys(count: number, avoid: readonly string[]): Topic[] {
  const decoys: Topic[] = [];
  let previous: string | undefined;
  while (decoys.length < count) {
    const candidate = TOPICS[Math.floor(Math.random() * TOPICS.length)];
    if (candidate.id === previous || avoid.includes(candidate.id)) continue;
    decoys.push(candidate);
    previous = candidate.id;
  }
  return decoys;
}

/**
 * Topic selection state for the setup screen: a bank topic, a custom one, or none, plus the
 * "Surprise me" shuffle. Lives in a hook so SetupScreen can read `topic` for the Start button
 * while TopicPicker renders the controls.
 */
export function useTopicChoice(initialTopic?: Topic) {
  const reduceMotion = usePrefersReducedMotion();
  const initialCustom = initialTopic !== undefined && isCustomTopic(initialTopic);
  const initialBank = initialTopic !== undefined && !initialCustom ? initialTopic : null;

  const [category, setCategory] = useState<TopicCategory>(initialBank?.category ?? "business");
  const [bankTopic, setBankTopic] = useState<Topic | null>(initialBank);
  const [customText, setCustomText] = useState(initialCustom ? initialTopic.title : "");
  const [customActive, setCustomActive] = useState(initialCustom);
  /** Title currently flashed by the shuffle; null when not shuffling. */
  const [shuffleTitle, setShuffleTitle] = useState<string | null>(null);
  /** Counts "Surprise me" landings: keys the landing animation and the announcement. */
  const [landings, setLandings] = useState(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const customReady = customText.trim().length >= MIN_CUSTOM_TOPIC_LENGTH;
  const topic: Topic | null = customActive ? (customReady ? customTopic(customText) : null) : bankTopic;
  const shuffling = shuffleTitle !== null;

  function selectBank(next: Topic) {
    setBankTopic(next);
    setCustomActive(false);
  }

  /** Typing a custom topic selects it; clearing it falls back to the last chosen card. */
  function editCustom(text: string) {
    setCustomText(text);
    setCustomActive(text.trim().length > 0);
  }

  function selectCustom() {
    if (customText.trim()) setCustomActive(true);
  }

  function land(next: Topic) {
    timers.current.length = 0;
    setShuffleTitle(null);
    setCategory(next.category);
    selectBank(next);
    setLandings((count) => count + 1);
  }

  function surprise() {
    if (shuffling) return;
    const final = shuffleDecoys(1, topic ? [topic.id] : [])[0];
    if (reduceMotion) {
      land(final);
      return;
    }
    const decoys = shuffleDecoys(SHUFFLE_GAPS_MS.length + 1, [final.id]);
    setShuffleTitle(decoys[0].title);
    let at = 0;
    SHUFFLE_GAPS_MS.forEach((gap, index) => {
      at += gap;
      timers.current.push(window.setTimeout(() => setShuffleTitle(decoys[index + 1].title), at));
    });
    timers.current.push(window.setTimeout(() => land(final), at + SHUFFLE_LAND_MS));
  }

  return {
    category,
    setCategory,
    bankTopic,
    customText,
    customActive,
    customReady,
    topic,
    shuffleTitle,
    shuffling,
    landings,
    selectBank,
    editCustom,
    selectCustom,
    surprise,
  };
}

export type TopicChoice = ReturnType<typeof useTopicChoice>;

/** "Pick a topic": live topic banner, category tabs, topic cards, Surprise me and a custom topic. */
export function TopicPicker({ choice }: { choice: TopicChoice }) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  // Server-rendered cards must be visible on first paint; later (tab switches, surprise
  // landings, client-side visits) they stagger in.
  const hydrated = useHydrated();
  const topics = topicsIn(choice.category);
  const selectedIndex = choice.customActive ? -1 : topics.findIndex((t) => t.id === choice.bankTopic?.id);
  // A selected topic is never hidden behind "Show all".
  const forcedOpen = selectedIndex >= COLLAPSED_COUNT;
  const showAll = expanded || forcedOpen;
  const visible = showAll ? topics : topics.slice(0, COLLAPSED_COUNT);

  return (
    <Card as="section" aria-labelledby={`${id}-title`} className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`${id}-title`} className="text-lg font-semibold text-ink">
            Pick a topic
          </h2>
          <p className="text-sm text-ink-2">Choose one, let fate decide, or bring your own.</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          aria-disabled={choice.shuffling || undefined}
          onClick={choice.surprise}
          icon={
            <Dices
              aria-hidden
              className={cn("size-4 text-accent", choice.shuffling && "animate-spin motion-reduce:animate-none")}
            />
          }
        >
          Surprise me
        </Button>
      </div>

      <TopicBanner choice={choice} />

      <CategoryTabs
        idPrefix={id}
        value={choice.category}
        onChange={(next) => {
          choice.setCategory(next);
          setExpanded(false);
        }}
      />

      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${choice.category}`}
        className="flex flex-col gap-3"
      >
        <p className="text-sm text-ink-2">{CATEGORY_BLURBS[choice.category]}</p>
        <fieldset>
          <legend className="sr-only">{CATEGORY_LABELS[choice.category]} topics</legend>
          <motion.div
            key={choice.category}
            initial={hydrated ? "hidden" : false}
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.03 } } }}
            className="grid gap-2 sm:grid-cols-2"
          >
            {visible.map((topic) => (
              <TopicCard
                key={topic.id}
                name={`${id}-topic`}
                topic={topic}
                selected={!choice.customActive && topic.id === choice.bankTopic?.id}
                onSelect={() => choice.selectBank(topic)}
              />
            ))}
          </motion.div>
        </fieldset>
        {topics.length > COLLAPSED_COUNT && !forcedOpen && (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            aria-expanded={showAll}
            aria-controls={`${id}-panel`}
            onClick={() => setExpanded((open) => !open)}
            iconEnd={
              <ChevronDown
                aria-hidden
                className={cn("size-4 transition-transform motion-reduce:transition-none", showAll && "rotate-180")}
              />
            }
          >
            {showAll ? "Show fewer" : `Show all ${topics.length} topics`}
          </Button>
        )}
      </div>

      <CustomTopicField idPrefix={id} choice={choice} />

      <p className="sr-only" aria-live="polite">
        {choice.landings > 0 && !choice.shuffling && choice.topic ? `Topic chosen: ${choice.topic.title}` : ""}
      </p>
    </Card>
  );
}

/** The chosen topic, big, with a slot-machine roll while "Surprise me" shuffles. */
function TopicBanner({ choice }: { choice: TopicChoice }) {
  const { topic, shuffleTitle, shuffling } = choice;
  // Custom topics update in place as you type; everything else rolls in.
  const key = shuffling
    ? `shuffle:${shuffleTitle}`
    : choice.customActive
      ? "custom"
      : `${choice.landings}:${topic?.id ?? "none"}`;
  const label = shuffling
    ? "Shuffling…"
    : topic
      ? isCustomTopic(topic)
        ? "Your own topic"
        : `Your topic · ${CATEGORY_LABELS[topic.category]}`
      : "No topic yet";

  return (
    <div
      aria-hidden={shuffling || undefined}
      className={cn(
        "relative overflow-hidden rounded-xl border px-4 py-3 transition-colors duration-300",
        topic && !shuffling ? "border-accent/40 bg-accent-soft" : "border-dashed border-line bg-panel-2",
      )}
    >
      <Eyebrow>{label}</Eyebrow>
      <div className="relative mt-1 min-h-7">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.p
            key={key}
            initial={shuffling ? { y: 18, opacity: 0 } : { y: 10, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -18, opacity: 0 }}
            transition={
              shuffling ? { duration: 0.08, ease: "linear" } : { type: "spring", stiffness: 420, damping: 24 }
            }
            className={cn("text-base font-semibold sm:text-lg", (shuffleTitle ?? topic) ? "text-ink" : "text-ink-2")}
          >
            {shuffleTitle ?? topic?.title ?? "Choose a card below, or press Surprise me."}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}

function CategoryTabs({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: TopicCategory;
  onChange(category: TopicCategory): void;
}) {
  // Roving tab stop: arrow keys / Home / End move between tabs and select them.
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = CATEGORIES.length - 1;
    const target =
      event.key === "ArrowRight"
        ? (index + 1) % CATEGORIES.length
        : event.key === "ArrowLeft"
          ? (index - 1 + CATEGORIES.length) % CATEGORIES.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    onChange(CATEGORIES[target]);
    document.getElementById(`${idPrefix}-tab-${CATEGORIES[target]}`)?.focus();
  }

  return (
    <div role="tablist" aria-label="Topic categories" className="flex gap-1 rounded-xl bg-panel-2 p-1">
      {CATEGORIES.map((category, index) => {
        const selected = category === value;
        return (
          <button
            key={category}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${category}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(category)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "relative min-h-10 flex-1 rounded-lg px-2 py-1.5 text-[13px] font-semibold leading-tight outline-none sm:text-sm",
              "transition-colors focus-visible:ring-2 focus-visible:ring-accent",
              selected ? "text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {selected && (
              <motion.span
                aria-hidden
                layoutId={`${idPrefix}-tab-thumb`}
                className="absolute inset-0 rounded-lg border border-line bg-panel shadow-card"
                transition={{ type: "spring", stiffness: 520, damping: 40 }}
              />
            )}
            <span className="relative">{CATEGORY_LABELS[category]}</span>
          </button>
        );
      })}
    </div>
  );
}

function TopicCard({
  name,
  topic,
  selected,
  onSelect,
}: {
  name: string;
  topic: Topic;
  selected: boolean;
  onSelect(): void;
}) {
  return (
    <motion.label
      variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
      whileTap={{ scale: 0.985 }}
      className={cn(
        "relative flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors duration-150",
        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-panel",
        selected ? "border-accent bg-accent-soft" : "border-line bg-panel hover:border-ink-3/60 hover:bg-panel-2",
      )}
    >
      <input type="radio" name={name} value={topic.id} checked={selected} onChange={onSelect} className="sr-only" />
      <span
        aria-hidden
        className={cn(
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors",
          selected ? "border-accent bg-accent text-accent-ink" : "border-line",
        )}
      >
        <AnimatePresence initial={false}>
          {selected && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
              <Check className="size-3" strokeWidth={3.5} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-snug text-ink">{topic.title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-ink-2">
          {topic.hint ?? "Abstract: interpret it your own way."}
        </span>
      </span>
    </motion.label>
  );
}

function CustomTopicField({ idPrefix, choice }: { idPrefix: string; choice: TopicChoice }) {
  const inputId = `${idPrefix}-custom`;
  const hintId = `${idPrefix}-custom-hint`;
  const active = choice.customActive;
  const canUse = !active && choice.customText.trim().length > 0;

  return (
    <div
      className={cn(
        "rounded-xl border p-3 transition-colors duration-200",
        active ? "border-accent bg-accent-soft" : "border-dashed border-line",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={inputId} className="flex items-center gap-2 text-sm font-semibold text-ink">
          <PenLine aria-hidden className="size-4 text-accent" />
          Or bring your own topic
        </label>
        {active && choice.customReady && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-ink">
            <Check aria-hidden className="size-3" strokeWidth={3} /> Selected
          </span>
        )}
        {canUse && (
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={choice.selectCustom}>
            Use my topic
          </Button>
        )}
      </div>
      <input
        id={inputId}
        type="text"
        value={choice.customText}
        onChange={(event) => choice.editCustom(event.target.value)}
        maxLength={MAX_CUSTOM_TOPIC_LENGTH}
        placeholder="e.g. Should exams be open-book?"
        autoComplete="off"
        aria-describedby={hintId}
        className={cn(fieldClass, "mt-2 h-11")}
      />
      <p id={hintId} className="mt-1.5 text-xs text-ink-2">
        {active && !choice.customReady
          ? `Keep going: at least ${MIN_CUSTOM_TOPIC_LENGTH} characters.`
          : "Anything from a case question to a single abstract word."}
      </p>
    </div>
  );
}

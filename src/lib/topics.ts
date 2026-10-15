import type { Topic, TopicCategory } from "./types";

export const CATEGORY_LABELS: Record<TopicCategory, string> = {
  business: "Business",
  "current-affairs": "Current affairs",
  abstract: "Abstract",
};

export const CATEGORY_BLURBS: Record<TopicCategory, string> = {
  business: "Strategy, markets, management and the economy.",
  "current-affairs": "Policy, society and technology debates.",
  abstract: "One word or phrase. Interpretation is the test.",
};

function t(category: TopicCategory, title: string, hint?: string): Topic {
  const id = `${category}:${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}`;
  return { id, title, category, hint };
}

export const TOPICS: Topic[] = [
  // Business
  t("business", "Should India prioritise manufacturing over services?", "Jobs, exports and where growth should come from."),
  t("business", "Is the gig economy good for India's workforce?", "Flexibility and income versus security and benefits."),
  t("business", "Startup or corporate job: which is better for a fresh MBA?", "Learning, risk, pay and career capital."),
  t("business", "Should companies adopt a four-day work week?", "Productivity, costs and employee well-being."),
  t("business", "Quick commerce: boon or bane?", "10-minute delivery, kirana stores and unit economics."),
  t("business", "Should CEO pay be capped?", "Talent markets, fairness and shareholder value."),
  t("business", "Is brand loyalty dead?", "Discounts, D2C brands and endless choice."),
  t("business", "Will AI shrink jobs in Indian IT services?", "Automation, reskilling and the services export model."),
  t("business", "Family-run businesses versus professional management", "Governance, speed of decisions and succession."),
  t("business", "Work from home: productivity boost or myth?", "Output, culture, real estate and talent."),
  t("business", "D2C brands: hype or the future of retail?", "Customer acquisition costs and profitability."),
  t("business", "Should Indian startups chase profits over growth?", "Funding winters, valuations and sustainability."),
  t("business", "Is advertising to children ethical?", "Marketing, regulation and responsibility."),
  t("business", "Mergers create value or destroy it?", "Synergies, culture clashes and market power."),

  // Current affairs
  t("current-affairs", "One Nation, One Election", "Costs, governance and federalism."),
  t("current-affairs", "Should social media platforms be regulated more strictly?", "Free speech, misinformation and accountability."),
  t("current-affairs", "Are electric vehicles ready for India?", "Charging infrastructure, costs and the grid."),
  t("current-affairs", "Should cryptocurrencies be regulated or banned?", "Innovation, risk and monetary control."),
  t("current-affairs", "Demographic dividend or demographic burden?", "Jobs, skills and a young population."),
  t("current-affairs", "Climate goals versus economic growth", "Can a developing economy afford both?"),
  t("current-affairs", "Should voting be made compulsory?", "Participation, freedom and enforcement."),
  t("current-affairs", "Freebies in elections: welfare or populism?", "Fiscal space, targeting and voter choice."),
  t("current-affairs", "Should online real-money gaming be banned?", "Addiction, revenue and personal freedom."),
  t("current-affairs", "Who should set the rules for AI?", "Governments, companies or global bodies."),
  t("current-affairs", "Is the four-year undergraduate programme a good move?", "Flexibility, cost and employability."),
  t("current-affairs", "Should India bid to host the Olympics?", "Prestige, infrastructure and opportunity cost."),
  t("current-affairs", "Is a cashless economy desirable for India?", "UPI, inclusion, privacy and resilience."),
  t("current-affairs", "Reservation in private-sector jobs", "Equity, merit and implementation."),

  // Abstract
  t("abstract", "Red vs Blue"),
  t("abstract", "Zero"),
  t("abstract", "Black and white"),
  t("abstract", "A drop of water"),
  t("abstract", "The sky is the limit"),
  t("abstract", "Mirror"),
  t("abstract", "Bridges"),
  t("abstract", "The empty chair"),
  t("abstract", "Silence"),
  t("abstract", "Footprints"),
  t("abstract", "Two sides of a coin"),
  t("abstract", "The last page"),
  t("abstract", "Doors"),
  t("abstract", "Chess"),
  t("abstract", "Rainbow"),
];

export function topicsIn(category: TopicCategory): Topic[] {
  return TOPICS.filter((topic) => topic.category === category);
}

export function randomTopic(category?: TopicCategory, exceptId?: string): Topic {
  const pool = (category ? topicsIn(category) : TOPICS).filter((topic) => topic.id !== exceptId);
  return pool[Math.floor(Math.random() * pool.length)];
}

export function customTopic(title: string): Topic {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 160);
  return { id: `custom:${clean.toLowerCase()}`, title: clean, category: "current-affairs" };
}

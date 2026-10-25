// Turning a participant's line into what a voice should say. Lines are written for reading
// ("₹500", "2,00,000", "40%"); voices say them better spelled out. A Hindi voice (used for an
// Indian accent when the browser has no English (India) voice) reads digits in Hindi, so for
// it every number becomes English words, in the Indian system (lakh, crore).

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  const tens = TENS[Math.floor(n / 10)];
  return n % 10 ? `${tens} ${ONES[n % 10]}` : tens;
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (!hundreds) return belowHundred(rest);
  return rest ? `${ONES[hundreds]} hundred ${belowHundred(rest)}` : `${ONES[hundreds]} hundred`;
}

/** A whole number in words, Indian system: 250000 → "two lakh fifty thousand". */
export function integerToWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${integerToWords(crore)} crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} thousand`);
  if (n) parts.push(belowThousand(n));
  return parts.join(" ");
}

/** A year as people say it: 1991 → "nineteen ninety one", 2005 → "two thousand five", 2026 → "twenty twenty six". */
function yearToWords(year: number): string {
  if (year >= 2000 && year < 2010) return integerToWords(year);
  const high = Math.floor(year / 100);
  const low = year % 100;
  if (low === 0) return `${belowHundred(high)} hundred`;
  return `${belowHundred(high)} ${low < 10 ? `oh ${ONES[low]}` : belowHundred(low)}`;
}

const ORDINAL_WORDS: Record<string, string> = {
  one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth",
};

function ordinal(words: string): string {
  const parts = words.split(" ");
  const last = parts.pop() ?? "";
  const turned = ORDINAL_WORDS[last] ?? (last.endsWith("y") ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return [...parts, turned].join(" ");
}

function plural(words: string): string {
  return words.endsWith("y") ? `${words.slice(0, -1)}ies` : `${words}s`;
}

/** A number as written ("2,00,000", "1.5", "2026", "21st", "1990s", "40%") in words. */
function numberToWords(whole: string, fraction: string | undefined, suffix: string | undefined): string {
  const digits = whole.replace(/,/g, "");
  const n = Number(digits);
  const kind = suffix?.toLowerCase();
  const looksLikeYear = !fraction && !whole.includes(",") && digits.length === 4 && n >= 1100 && n < 2100;
  let words = looksLikeYear && kind !== "%" ? yearToWords(n) : integerToWords(n);
  if (fraction) words += ` point ${[...fraction].map((d) => ONES[Number(d)]).join(" ")}`;
  if (kind === "%") return `${words} percent`;
  if (kind === "st" || kind === "nd" || kind === "rd" || kind === "th") return ordinal(words);
  if (kind === "s") return plural(words);
  return words;
}

const NUMBER = /\b(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d+))?(%|st\b|nd\b|rd\b|th\b|s\b)?/gi;

/** "₹500", "Rs. 2,000 crore", "INR 50" → "500 rupees", "2,000 crore rupees", "50 rupees"; "$5 billion" → "5 billion dollars". */
const CURRENCY = /(₹|\bRs\.?|\bINR\b|\$)\s?(\d[\d,]*(?:\.\d+)?)(\s?(?:thousand|lakh|crore|million|billion|trillion)s?\b)?/gi;

export interface SpeechTextOptions {
  /** Spell every number out in English words (for voices that would read digits in another language). */
  numbersAsWords: boolean;
}

/** The line as a voice should say it: currency units after the amount, and numbers in words when asked. */
export function speechText(text: string, { numbersAsWords }: SpeechTextOptions): string {
  let out = text.replace(CURRENCY, (_match, symbol: string, amount: string, scale: string | undefined) => {
    const unit = symbol === "$" ? "dollars" : "rupees";
    return `${amount}${scale ?? ""} ${unit}`;
  });
  if (numbersAsWords) {
    out = out.replace(NUMBER, (_match, whole: string, fraction?: string, suffix?: string) =>
      numberToWords(whole, fraction, suffix),
    );
  }
  return out;
}

/** True for a language tag that is English ("en", "en-IN", "en_GB"). */
export function isEnglishLang(lang: string): boolean {
  return /^en(?:$|[-_])/i.test(lang);
}

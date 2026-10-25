import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { integerToWords, isEnglishLang, speechText } from "@/lib/speech/spoken";

const words = (text: string) => speechText(text, { numbersAsWords: true });
const english = (text: string) => speechText(text, { numbersAsWords: false });

describe("integerToWords", () => {
  test("small and round numbers", () => {
    assert.equal(integerToWords(0), "zero");
    assert.equal(integerToWords(7), "seven");
    assert.equal(integerToWords(15), "fifteen");
    assert.equal(integerToWords(40), "forty");
    assert.equal(integerToWords(99), "ninety nine");
    assert.equal(integerToWords(100), "one hundred");
    assert.equal(integerToWords(305), "three hundred five");
  });

  test("uses the Indian system for large numbers", () => {
    assert.equal(integerToWords(2000), "two thousand");
    assert.equal(integerToWords(45_600), "forty five thousand six hundred");
    assert.equal(integerToWords(250_000), "two lakh fifty thousand");
    assert.equal(integerToWords(10_000_000), "one crore");
    assert.equal(integerToWords(1_234_500_000), "one hundred twenty three crore forty five lakh");
  });
});

describe("speechText", () => {
  test("puts the currency after the amount for every voice", () => {
    assert.equal(english("An order of ₹500 costs ₹ 80 to deliver."), "An order of 500 rupees costs 80 rupees to deliver.");
    assert.equal(english("Rs. 2,000 crore and Rs 50 and INR 10"), "2,000 crore rupees and 50 rupees and 10 rupees");
    assert.equal(english("a $5 billion market"), "a 5 billion dollars market");
    assert.equal(english("No numbers here."), "No numbers here.");
  });

  test("leaves digits alone for English voices", () => {
    assert.equal(english("About 40% of 2,00,000 shoppers in 2026."), "About 40% of 2,00,000 shoppers in 2026.");
  });

  test("spells numbers out in English words when asked", () => {
    assert.equal(words("10-minute delivery from 2,000 dark stores"), "ten-minute delivery from two thousand dark stores");
    assert.equal(words("2,00,000 jobs and 200,000 more"), "two lakh jobs and two lakh more");
    assert.equal(words("roughly 40% growth"), "roughly forty percent growth");
    assert.equal(words("a 1.5 times increase"), "a one point five times increase");
    assert.equal(words("India in 2026, the 1990s, 1991 and 2005"), "India in twenty twenty six, the nineteen nineties, nineteen ninety one and two thousand five");
    assert.equal(words("the 1st, 2nd, 3rd and 21st place"), "the first, second, third and twenty first place");
    assert.equal(words("₹500 orders"), "five hundred rupees orders");
  });

  test("recognises English language tags", () => {
    for (const lang of ["en", "en-IN", "en_GB", "EN-us"]) assert.ok(isEnglishLang(lang), lang);
    for (const lang of ["hi-IN", "hi", "", "eng"]) assert.ok(!isEnglishLang(lang), lang);
  });
});

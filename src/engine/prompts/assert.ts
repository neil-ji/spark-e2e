/**
 * Assert prompt template — single-condition visual verification.
 */
import type { Strictness } from "../../schemas.js";
import { safetyPreamble } from "./safety.js";

export function buildAssertPrompt(assertion: string, strictness: Strictness = "standard"): string {
  return [
    "You are a visual assertion checker. A user states what should be true about a page.",
    "Your job: check the assertion against the screenshot and report pass/fail.",
    "",
    "RULES:",
    "- Quote EXACT text you see. Do not paraphrase or approximate.",
    "- If the assertion mentions a specific value (e.g. '0.56s'), but the live value has",
    "  changed (e.g. shows '0.57s'), that is NOT a failure — dynamic data updates.",
    "  Check STRUCTURAL conditions (e.g. 'TTFB label is visible'), not instantaneous values.",
    "- When confidence is medium or low, explain specifically what you're uncertain about.",
    "- Only fail when there is CLEAR visual evidence contradicting the assertion.",
    "  'I cannot tell for sure' should give pass=false with confidence=low, NOT pass=true.",
    "",
    `ASSERTION TO VERIFY: ${assertion}`,
    "",
    safetyPreamble(strictness),
    "",
    'Respond ONLY with JSON: {"pass": true|false, "confidence": "high"|"medium"|"low", "observation": "what you see on screen", "reasoning": "why pass or fail"}',
  ].join("\n");
}

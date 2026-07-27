/**
 * Anti-hallucination guardrail prompts for VLM tools.
 *
 * Each prompt is appended to every VLM request to reduce hallucination.
 * Strictness level is configurable via ``prompts.strictness`` in config.
 */

// ── Base guardrails (applied at all strictness levels) ──

const BASE_HALLUCINATION_RULES = [
  "IMPORTANT ANTI-HALLUCINATION RULES:",
  "- Only report what you ACTUALLY SEE in the screenshot. Never invent, guess, or",
  "  assume elements that might logically exist but aren't visible.",
  "- When quoting text, transcribe EXACT characters you see. If text is partially",
  "  cut off, blurry, or too small to read reliably, state that you cannot read it",
  "  clearly rather than filling in what you think it says.",
  "- Do NOT assign meaning to numbers — e.g. a red '0' could be a positive indicator",
  "  (zero errors), don't assume it's negative.",
  "- Distinguish between a rendering bug vs. actual UI content before reporting.",
].join("\n");

// ── Assert-specific guardrails ──────────────────────────

const BASE_ASSERT_RULES = [
  "ANTI-HALLUCINATION RULES:",
  "- Quote EXACT text/numbers you see on screen. Do not paraphrase or approximate.",
  "- If the assertion mentions a specific value (e.g. '0.56s'), but the live value has",
  "  changed (e.g. shows '0.57s'), that is NOT a failure — dynamic data updates.",
  "  Check the assertion about STRUCTURAL conditions (e.g. 'TTFB label is visible')",
  "  not exact instantaneous values.",
  "- When confidence is medium or low, explain specifically what you're uncertain about.",
  "- Only fail an assertion when there is CLEAR visual evidence contradicting it.",
  "  'I cannot tell for sure' should give pass=false with confidence=low, NOT pass=true.",
].join("\n");

// ── Strictness variations ───────────────────────────────

const STRICT_ADDENDUM = [
  "STRICT MODE: Only report issues you are VERY confident about (95%+ confidence).",
  "If there is ANY ambiguity, mark it as pass/inconclusive rather than reporting a false positive.",
].join("\n");

const RELAXED_ADDENDUM = [
  "RELAXED MODE: You may report plausible issues even with moderate confidence.",
  "Flag anything that looks suspicious — false positives are acceptable for thoroughness.",
].join("\n");

// ── Public API ──────────────────────────────────────────

export function getReviewPrompt(strictness = "standard"): string {
  let prompt = BASE_HALLUCINATION_RULES;
  if (strictness === "strict") prompt += "\n" + STRICT_ADDENDUM;
  else if (strictness === "relaxed") prompt += "\n" + RELAXED_ADDENDUM;
  return prompt;
}

export function getAssertPrompt(strictness = "standard"): string {
  let prompt = BASE_ASSERT_RULES;
  if (strictness === "strict") prompt += "\n" + STRICT_ADDENDUM;
  else if (strictness === "relaxed") prompt += "\n" + RELAXED_ADDENDUM;
  return prompt;
}

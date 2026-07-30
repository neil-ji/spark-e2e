/**
 * Shared safety rule fragments injected into every VLM prompt.
 */
import type { Strictness } from "../../schemas.js";

// ── Credential safety (applied to ALL VLM prompts) ──

export const CREDENTIAL_SAFETY_RULES = [
  "CREDENTIAL SAFETY RULES:",
  "- NEVER include passwords, API keys, access tokens, secret keys, or any other",
  "  credentials in your response. If you see a credential visible on screen,",
  '  do NOT quote or transcribe it. Instead say "[credential visible]".',
  "- If you see what looks like an API key (e.g. long random strings, patterns like",
  "  sk-*, AKID*, eyJ*), access token, or password on screen, note its presence",
  "  but NEVER reproduce its value.",
  "- For password fields: report that a password field is present and whether it",
  "  appears filled, but never attempt to read or quote its contents.",
].join("\n");

// ── Anti-hallucination (applied at all strictness levels) ──

export const BASE_HALLUCINATION_RULES = [
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

// ── Strictness addenda ──

const STRICT_ADDENDUM = [
  "STRICT MODE: Only report issues you are VERY confident about (95%+ confidence).",
  "If there is ANY ambiguity, mark it as pass/inconclusive rather than reporting a false positive.",
].join("\n");

const RELAXED_ADDENDUM = [
  "RELAXED MODE: You may report plausible issues even with moderate confidence.",
  "Flag anything that looks suspicious — false positives are acceptable for thoroughness.",
].join("\n");

export function getStrictnessAddendum(strictness: Strictness): string {
  if (strictness === "strict") return STRICT_ADDENDUM;
  if (strictness === "relaxed") return RELAXED_ADDENDUM;
  return "";
}

// ── Aesthetics injection ──

export function getAestheticsBlock(aesthetics?: string): string {
  if (!aesthetics?.trim()) return "";
  return [
    "AESTHETIC & LAYOUT PRINCIPLES (project-specific):",
    "Apply the following aesthetic standards when evaluating this UI:",
    "",
    aesthetics,
    "",
    "When reporting issues, reference which specific aesthetic principle is violated.",
  ].join("\n");
}

// ── Compose full safety preamble ──

export function safetyPreamble(strictness: Strictness = "standard"): string {
  const parts = [CREDENTIAL_SAFETY_RULES, BASE_HALLUCINATION_RULES];
  const addendum = getStrictnessAddendum(strictness);
  if (addendum) parts.push(addendum);
  return parts.join("\n\n");
}

/**
 * Anti-hallucination guardrail prompts for VLM tools.
 *
 * Each prompt is appended to every VLM request to reduce hallucination.
 * Strictness level is configurable via ``prompts.strictness`` in config.
 */

// ── Credential safety guardrails (applied to ALL VLM prompts) ──

const CREDENTIAL_SAFETY_RULES = [
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

// ── Combined: base + credential safety ──

function withCredentialSafety(prompt: string): string {
  return CREDENTIAL_SAFETY_RULES + "\n\n" + prompt;
}

// ── Review-specific prompt ───────────────────────────────

const BASE_REVIEW_RULES = [
  "You are a visual UI reviewer. Given a screenshot, identify visual issues.",
  "",
  "RULES:",
  "- Report ONLY issues you can SEE. Each finding must cite visible evidence.",
  "- Do NOT flag issues about dynamic data (timestamps, counters, usernames).",
  "- Do NOT flag issues about font rendering differences (anti-aliasing, hinting).",
  "- Prioritize STRUCTURAL issues: layout, alignment, sizing, overflow, truncation.",
  "- For each issue, specify WHERE on the page it occurs (e.g. 'top-right card').",
  "",
  "Respond ONLY with JSON:",
  '{"findings": [{"severity": "critical"|"major"|"minor", "category": "layout"|"typography"|"color"|"spacing"|"alignment"|"overflow"|"chart", "location": "...", "description": "...", "evidence": "...", "confidence": "high"|"medium"|"low"}], "summary": "N issues found", "no_issues_found": true|false}',
].join("\n");

// ── Assert-specific guardrails ──────────────────────────

const BASE_ASSERT_RULES = [
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
  "Respond ONLY with JSON:",
  '{"pass": true|false, "confidence": "high"|"medium"|"low", "observation": "what you see on screen", "reasoning": "why pass or fail"}',
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
  let prompt = BASE_REVIEW_RULES;
  prompt += "\n\n" + BASE_HALLUCINATION_RULES;
  if (strictness === "strict") prompt += "\n" + STRICT_ADDENDUM;
  else if (strictness === "relaxed") prompt += "\n" + RELAXED_ADDENDUM;
  return withCredentialSafety(prompt);
}

export function getAssertPrompt(strictness = "standard"): string {
  let prompt = BASE_ASSERT_RULES;
  if (strictness === "strict") prompt += "\n" + STRICT_ADDENDUM;
  else if (strictness === "relaxed") prompt += "\n" + RELAXED_ADDENDUM;
  return withCredentialSafety(prompt);
}

// ── Test-specific guardrails ──────────────────────────

const BASE_TEST_RULES = [
  "You are a visual E2E test runner. A user has described what they expect to see on a page.",
  "Your job: check EVERY expectation against the screenshot and report pass/fail for each.",
  "",
  "RULES:",
  "- Each expectation is a separate check. Report pass/fail independently per expectation.",
  "- Only report what you ACTUALLY SEE. If an element is not visible, say so — don't guess.",
  "- For text content: quote EXACT text you see. If text is cut off, report the visible portion.",
  "- Structural checks (layout, alignment, sizing, visibility) are more reliable than exact color/value checks.",
  "- If a check is about dynamic data (numbers, timestamps, user names), be lenient —",
  "  only fail if the STRUCTURE is broken (missing label, truncated text), not if the value changed.",
  "- If you genuinely cannot determine pass/fail, set confidence to 'low' and explain why.",
  "- Be specific in your reasoning: mention WHERE on the page you looked and WHAT you observed.",
].join("\n");

export function getTestPrompt(expectations: string, strictness = "standard"): string {
  let prompt = BASE_TEST_RULES;
  prompt += "\n\nEXPECTATIONS TO VERIFY:\n" + expectations;
  prompt += "\n\n" + BASE_HALLUCINATION_RULES;
  if (strictness === "strict") prompt += "\n" + STRICT_ADDENDUM;
  else if (strictness === "relaxed") prompt += "\n" + RELAXED_ADDENDUM;
  prompt += "\n\nRespond ONLY with JSON: {\"pass\": true|false, \"confidence\": \"high\"|\"medium\"|\"low\", \"checks\": [{\"expectation\": \"...\", \"pass\": true|false, \"confidence\": \"high\"|\"medium\"|\"low\", \"observation\": \"...\", \"reasoning\": \"...\"}], \"summary\": \"...\"}";
  return withCredentialSafety(prompt);
}

// ── Baseline comparison prompt ──────────────────────────

const BASELINE_COMPARE_RULES = [
  "You are a visual regression tester. You are shown TWO screenshots of the same page:",
  "- Image 1: the BASELINE (reference / known-good state)",
  "- Image 2: the CURRENT state (what the page looks like now)",
  "",
  "Your job: identify MEANINGFUL visual differences between the two. Ignore trivial noise.",
  "",
  "RULES:",
  "- Focus on STRUCTURAL differences: layout shifts, missing elements, new elements, size changes.",
  "- Content changes (different text, different numbers, different images) ARE meaningful — report them.",
  "- Anti-aliasing differences, sub-pixel rendering, and font hinting variations are NOT meaningful — ignore them.",
  "- If an element moved by 1-2px, mention it as minor. If it moved significantly, flag as major.",
  "- If you see NO meaningful differences, clearly state that the pages match.",
  "- For each difference: describe the region (e.g. 'top-right KPI card'), the type of change,",
  "  and the severity (critical/major/minor).",
  "- Color changes in text/background that affect readability are meaningful.",
  "- Be conservative: if unsure whether a difference is meaningful, mark it as minor, not critical.",
].join("\n");

export function getBaselineComparePrompt(baselineName: string): string {
  return withCredentialSafety(
    BASELINE_COMPARE_RULES +
    `\n\nBaseline name: "${baselineName}"` +
    '\n\nRespond ONLY with JSON: {"match": true|false, "confidence": "high"|"medium"|"low", "changes": [{"region": "...", "type": "added"|"removed"|"changed"|"layout_shift", "severity": "critical"|"major"|"minor", "description": "..."}], "summary": "..."}'
  );
}

// ── Element location (visual grounding) ─────────────────

const LOCATE_RULES = [
  "You are a visual element locator. Given a screenshot and a description, find the target element.",
  "",
  "RULES:",
  "- Return the CENTER pixel coordinates (x, y) of the described element.",
  "- Coordinates are relative to the FULL screenshot (top-left is 0, 0).",
  "- If the element is not visible, set found=false and explain why.",
  "- If there are multiple matches, pick the most prominent/likely one and note the ambiguity.",
  "- For text fields (inputs, textareas): return coordinates of the input area center.",
  "- For buttons: return coordinates of the button center (not its label text).",
  "- For menu items / nav links: return the center of the clickable area.",
  "- Round coordinates to integers.",
  "- Be precise — the click will happen exactly at these coordinates.",
].join("\n");

export function getLocatePrompt(target: string): string {
  return withCredentialSafety(
    LOCATE_RULES +
    `\n\nFind this element: "${target}"` +
    '\n\nRespond ONLY with JSON: {"found": true|false, "element": "...", "x": number, "y": number, "confidence": "high"|"medium"|"low", "reasoning": "..."}'
  );
}

export function getAestheticsPrompt(aesthetics: string): string {
  if (!aesthetics.trim()) return "";
  return [
    "AESTHETIC & LAYOUT PRINCIPLES (project-specific):",
    "Apply the following aesthetic standards when evaluating this UI:",
    "",
    aesthetics,
    "",
    "When reporting issues, reference which specific aesthetic principle is violated.",
  ].join("\n");
}

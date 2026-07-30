/**
 * Engine prompts — structured VLM prompt templates.
 *
 * Each module builds a complete prompt string with:
 * - Task-specific system instructions
 * - Anti-hallucination guardrails (safety.ts)
 * - Credential safety rules (safety.ts)
 * - Strictness-level controls
 * - Structured JSON output format
 */
export { buildLightReviewPrompt, buildDimensionReviewPrompt, getDimensions } from "./review.js";
export { buildAssertPrompt } from "./assert.js";
export { buildLocatePrompt } from "./locate.js";
export { buildBaselineComparePrompt } from "./baseline.js";
export { safetyPreamble, getAestheticsBlock, CREDENTIAL_SAFETY_RULES, BASE_HALLUCINATION_RULES } from "./safety.js";

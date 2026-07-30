/**
 * spark-e2e Engine — VLM + DOM dual-engine visual audit.
 *
 * review    VLM-powered visual audit (light/strict modes, dimension routing)
 * dom-lint  Deterministic DOM rule checker (token compliance, a11y)
 * dom-get   Precise element property lookup by @ref
 * rules     Lint rule registry + dom-rules.json loader
 * prompts   Structured VLM prompt templates with safety guardrails
 */
export { review } from "./review.js";
export { domLint } from "./dom-lint.js";
export { domGet, domFind } from "./dom-get.js";
export { registerRule, getRule, listRules, loadDomRules } from "./rules.js";
export {
  buildLightReviewPrompt,
  buildDimensionReviewPrompt,
  getDimensions,
  buildAssertPrompt,
  buildLocatePrompt,
  buildBaselineComparePrompt,
} from "./prompts/index.js";

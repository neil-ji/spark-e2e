/**
 * Review prompt templates — dimension-specific strategies for VLM visual audit.
 *
 * light mode: 1 comprehensive prompt covering all dimensions.
 * strict mode: N parallel calls, each with a focused dimension prompt.
 */
import type { FocusArea, Strictness } from "../../schemas.js";
import { safetyPreamble, getAestheticsBlock } from "./safety.js";

// ── Dimension definitions ──

interface Dimension {
  key: string;
  label: string;
  focusPrompt: string;
  categories: string[];
}

const DIMENSIONS: Record<string, Dimension> = {
  layout: {
    key: "layout",
    label: "Layout & Grid",
    focusPrompt: [
      "Focus on LAYOUT & STRUCTURAL issues:",
      "- Card/panel heights: are adjacent cards equal height? Are they misaligned?",
      "- Grid alignment: do columns align? Are there uneven gaps?",
      "- Spacing: are section gaps consistent? Is there crowding or excessive whitespace?",
      "- Overflow: any content clipped, truncated, or overflowing its container?",
      "- Overlapping: any elements overlapping that shouldn't be?",
      "- Responsive break: does the layout break at this viewport width?",
      "- Z-index issues: any elements hidden behind others unintentionally?",
    ].join("\n"),
    categories: ["layout", "spacing", "alignment", "overflow"],
  },
  typography: {
    key: "typography",
    label: "Typography",
    focusPrompt: [
      "Focus on TYPOGRAPHY issues:",
      "- Text truncation: any text cut off mid-word? Ellipsis missing where expected?",
      "- Contrast: is text readable against its background? Low-contrast text?",
      "- Font inconsistencies: mixed font families, inconsistent weights within same hierarchy?",
      "- Overlapping text: labels overlapping each other or other elements?",
      "- Cut-off labels: axis labels, legend text, or tooltips clipped?",
      "- Line-height: text too cramped or too loose relative to design expectations?",
    ].join("\n"),
    categories: ["typography"],
  },
  color: {
    key: "color",
    label: "Color & Theming",
    focusPrompt: [
      "Focus on COLOR consistency:",
      "- Cross-reference visible colors against the AESTHETICS.md palette (if provided).",
      "- Any hex values that deviate from the defined color tokens?",
      "- Semantic color misuse: is a 'danger' color used where 'primary' belongs?",
      "- Dark/light mode: does color contrast hold up?",
      "- Inactive/disabled elements: note muted colors but do NOT flag as errors",
      "  (disabled elements are intentionally low-opacity).",
      "- Color banding or gradient artifacts?",
    ].join("\n"),
    categories: ["color"],
  },
  spacing: {
    key: "spacing",
    label: "Spacing & Padding",
    focusPrompt: [
      "Focus on SPACING consistency:",
      "- Internal padding: are card/panel paddings consistent across similar components?",
      "- Element gaps: are gaps between related elements (form fields, nav items) uniform?",
      "- Section spacing: are vertical spacings between page sections consistent?",
      "- Edge alignment: do elements align to the same left/right edge?",
      "- Margin collapse: any unexpected margin behavior causing gaps or overlaps?",
    ].join("\n"),
    categories: ["spacing", "alignment"],
  },
  interactive: {
    key: "interactive",
    label: "Interactive Elements",
    focusPrompt: [
      "Focus on INTERACTIVE element states:",
      "- Button states: are primary/secondary/disabled visually distinct?",
      "- Hover feedback: (if screenshot captured hover state) is the feedback correct?",
      "- Active/focus: are focus rings visible and consistent?",
      "- Menu highlighting: does the active nav item match the current page?",
      "- Tooltip visibility: any tooltips cut off or positioned incorrectly?",
      "- Form validation: error states clear and correctly positioned?",
    ].join("\n"),
    categories: ["layout", "color"],
  },
  charts: {
    key: "charts",
    label: "Charts & DataViz",
    focusPrompt: [
      "Focus on CHART & data visualization issues:",
      "- Gauge/donut colors: do arc colors match the legend?",
      "- Label clipping: any axis labels, data labels, or legend text truncated?",
      "- Axis artifacts: gridline misalignment, tick mark issues, axis label overlap?",
      "- Legend: positioned correctly? Items aligned?",
      "- Tooltip: does it appear to render correctly (if visible)?",
      "- Spacing: adequate padding between chart edge and container?",
      "- Responsive: chart scaled to container or overflowing?",
    ].join("\n"),
    categories: ["chart", "typography", "overflow"],
  },
};

// ── Get dimensions for a focus area ──

export function getDimensions(focus: FocusArea): Dimension[] {
  if (focus === "comprehensive") return Object.values(DIMENSIONS);
  const dim = DIMENSIONS[focus];
  if (!dim) return Object.values(DIMENSIONS);
  // Include related dimensions for a richer review
  if (focus === "layout") return [DIMENSIONS.layout, DIMENSIONS.spacing];
  if (focus === "charts") return [DIMENSIONS.charts, DIMENSIONS.typography];
  return [dim];
}

// ── Build prompts ──

function findingJsonSchema(): string {
  return [
    '{"severity": "critical"|"major"|"minor",',
    ' "category": "layout"|"typography"|"color"|"spacing"|"alignment"|"overflow"|"chart",',
    ' "location": "...",',
    ' "description": "...",',
    ' "evidence": "actual: ... | expected: ...",',
    ' "confidence": "high"|"medium"|"low"}',
  ].join("\n");
}

/**
 * Build a light-mode prompt: one comprehensive call covering all dimensions.
 */
export function buildLightReviewPrompt(
  focus: FocusArea,
  strictness: Strictness,
  aesthetics?: string,
): string {
  const dims = getDimensions(focus);
  const focusDescriptions = dims.map((d) => d.focusPrompt).join("\n\n");

  return [
    "You are a senior UI quality reviewer. Do a thorough visual audit of this screenshot.",
    "",
    focusDescriptions,
    "",
    safetyPreamble(strictness),
    getAestheticsBlock(aesthetics),
    "",
    "Respond ONLY with a JSON object:",
    '{"findings": [' + findingJsonSchema() + '],',
    ' "summary": "N issues found",',
    ' "no_issues_found": true|false}',
  ].join("\n");
}

/**
 * Build a strict-mode prompt for a single dimension.
 */
export function buildDimensionReviewPrompt(
  dimension: Dimension,
  strictness: Strictness,
  aesthetics?: string,
): string {
  return [
    `You are a UI quality reviewer specialized in ${dimension.label}.`,
    `Review this screenshot ONLY for ${dimension.label.toLowerCase()} issues.`,
    "Ignore issues outside your specialty — another reviewer handles those.",
    "",
    dimension.focusPrompt,
    "",
    safetyPreamble(strictness),
    getAestheticsBlock(aesthetics),
    "",
    "Respond ONLY with a JSON object:",
    '{"findings": [' + findingJsonSchema() + '],',
    ' "summary": "N issues found in ' + dimension.label.toLowerCase() + '",',
    ' "no_issues_found": true|false}',
  ].join("\n");
}

export { DIMENSIONS };

/**
 * Shared type definitions for spark-e2e engine layer.
 *
 * These schemas define the I/O contract: PNG + DOM in, Findings out.
 * Playwright owns browser control and DOM capture — spark-e2e owns analysis.
 */

// ── DOM dump (produced by Playwright, consumed by spark-e2e) ───

export interface DomElement {
  ref: string; // e.g. "@div-1", "@button-3"
  tag: string; // e.g. "DIV", "BUTTON"
  classes: string[]; // e.g. ["spark-card", "spark-card--active"]
  /** Resolved computed styles (getComputedStyle) */
  computed: {
    color: string;
    backgroundColor: string;
    fontSize: string;
    fontWeight: string;
    opacity: string;
    [key: string]: string; // extensible
  };
  /** Inline styles from element.style (for detecting hardcoded values) */
  inline?: Record<string, string>;
  attributes: Record<string, string>;
  text: string; // truncated to 100 chars
  children: DomElement[];
}

export interface DomDump {
  url: string;
  viewport: { width: number; height: number };
  elements: DomElement[]; // root's direct children (layout tree)
}

// ── dom-rules.json (produced by init, consumed by dom-lint) ──

export interface DomColorRule {
  value: string;
  var: string;
}

export interface TypographyRule {
  selector: string;
  fontWeight?: string;
  fontSize?: string;
  lineHeight?: string;
}

export interface ComponentRule {
  fontWeight?: string;
  fontSize?: string;
  borderRadius?: string;
  padding?: string;
  [key: string]: string | undefined;
}

export interface DomRules {
  version: string;
  generatedAt: string;
  tokens: {
    colors: Record<string, DomColorRule>;
    spacing: string[];
    fontSizes: string[];
  };
  rules: {
    typography: TypographyRule[];
    components: Record<string, ComponentRule>;
  };
}

// ── Review engine ──────────────────────────────────────────

export type FocusArea =
  | "comprehensive"
  | "layout"
  | "typography"
  | "color"
  | "spacing"
  | "charts"
  | "interactive";

export type ReviewMode = "light" | "strict";
export type Strictness = "standard" | "strict" | "relaxed";
export type Severity = "critical" | "major" | "minor";
export type FindingCategory =
  | "layout"
  | "typography"
  | "color"
  | "spacing"
  | "alignment"
  | "overflow"
  | "chart"
  | "a11y";
export type FindingSource = "vlm" | "dom" | "vlm_contested";
export type Confidence = "high" | "medium" | "low";

export interface ReviewInput {
  /** PNG screenshot as a Buffer */
  screenshot: Buffer;
  /** Optional DOM dump for cross-validation */
  dom?: DomDump;
  /** AESTHETICS.md content injected as review ground truth */
  aesthetics?: string;
  /** Focus area for the review */
  focus?: FocusArea;
  /** light = single comprehensive call; strict = per-dimension parallel */
  mode?: ReviewMode;
  /** Anti-hallucination strictness level */
  strictness?: Strictness;
  /** VLM model override */
  model?: string;
  /** Extended thinking budget (0 = off) */
  thinkingBudget?: number;
}

export interface Finding {
  severity: Severity;
  category: FindingCategory;
  location: string; // e.g. "top-right card" or "@button-3"
  description: string;
  evidence: {
    actual: string;
    expected: string;
    source: string; // e.g. "AESTHETICS.md § Color Palette" or ".spark/dom-rules.json"
  };
  source: FindingSource;
  confidence: Confidence;
}

export interface ReviewOutput {
  findings: Finding[];
  summary: string;
  noIssuesFound: boolean;
  mode: ReviewMode;
  dimensions?: string[]; // strict mode: which dimensions were run
}

// ── dom-lint engine ────────────────────────────────────────

export interface DomLintInput {
  dom: DomDump;
  rules?: DomRules; // from dom-rules.json (optional — built-in rules still run)
  enabledRules?: string[]; // specific rule IDs to run (default: all)
}

export interface LintFinding {
  ruleId: string; // e.g. "no-hardcoded-px", "font-weight-audit"
  severity: Severity;
  element: string; // @ref
  description: string;
  evidence: {
    actual: string;
    expected: string;
    source: string; // e.g. ".spark/dom-rules.json → typography/button"
  };
}

export interface DomLintOutput {
  findings: LintFinding[];
  summary: string;
  rulesRun: string[];
}

// ── dom-get engine ─────────────────────────────────────────

export interface DomGetInput {
  ref: string; // e.g. "@button-3"
  dom: DomDump;
}

export interface DomGetOutput {
  ref: string;
  tag: string;
  classes: string[];
  computed: Record<string, string>;
  attributes: Record<string, string>;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
}

// ── Lint rule interface ────────────────────────────────────

export interface LintRule {
  id: string;
  description: string;
  severity: Severity;
  /** Return findings for elements violating this rule */
  check(dump: DomDump, rules?: DomRules): LintFinding[];
}

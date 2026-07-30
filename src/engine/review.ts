/**
 * Review engine — VLM-powered visual audit with light/strict modes.
 *
 * light:  1 comprehensive VLM call covering all dimensions.
 * strict: N parallel VLM calls, each focused on a single dimension.
 *         High-confidence findings from all dimensions are aggregated.
 *
 * Post-processing:
 * - DOM cross-validation (if DOM provided): disabled elements filter,
 *   font-size/color confirmation
 * - Known false positive pattern filtering
 * - Source tagging (vlm | dom | vlm_contested)
 */
import type {
  ReviewInput,
  ReviewOutput,
  Finding,
  DomDump,
  DomElement,
  FocusArea,
  Strictness,
  FindingSource,
} from "../schemas.js";
import type { VLMProvider } from "../vlm/index.js";
import {
  buildLightReviewPrompt,
  buildDimensionReviewPrompt,
  getDimensions,
} from "./prompts/index.js";

// ── Helpers ──────────────────────────────────────────────

function toDataUrl(buf: Buffer): string {
  return "data:image/png;base64," + buf.toString("base64");
}

function flattenElements(elements: DomElement[]): DomElement[] {
  const result: DomElement[] = [];
  function walk(el: DomElement) {
    result.push(el);
    for (const child of el.children) walk(child);
  }
  for (const el of elements) walk(el);
  return result;
}

function isDisabled(el: DomElement): boolean {
  return (
    el.attributes.disabled === "" ||
    el.attributes.disabled === "true" ||
    el.attributes["aria-disabled"] === "true" ||
    parseFloat(el.computed.opacity) < 0.5
  );
}

// ── Post-processing ──────────────────────────────────────

interface RawFinding {
  severity?: string;
  category?: string;
  location?: string;
  description?: string;
  evidence?: string;
  confidence?: string;
}

interface RawVlmResponse {
  findings?: RawFinding[];
  summary?: string;
  no_issues_found?: boolean;
}

/**
 * Cross-reference a VLM finding against the DOM dump.
 * Returns updated source and evidence if DOM confirms/refutes.
 */
function crossReferenceDom(
  finding: Finding,
  dom: DomDump,
): { source: FindingSource; evidence: typeof finding.evidence } {
  const all = flattenElements(dom.elements);

  // Try to match finding location to a DOM element
  // Location can be: "@button-3" or "top-right card" or descriptive text
  const refMatch = finding.location.match(/@[\w-]+/);
  let matchedEl: DomElement | undefined;

  if (refMatch) {
    matchedEl = all.find((e) => e.ref === refMatch[0]);
  }

  if (!matchedEl) {
    // Try to fuzzy-match by text content
    const locationLower = finding.location.toLowerCase();
    matchedEl = all.find((e) => e.text.toLowerCase().includes(locationLower.slice(0, 20)));
  }

  if (!matchedEl) {
    return { source: "vlm", evidence: finding.evidence };
  }

  // Rule 1: Disabled elements — ignore color/style findings
  if (isDisabled(matchedEl) && ["color", "typography"].includes(finding.category)) {
    return {
      source: "dom",
      evidence: {
        ...finding.evidence,
        actual: `${finding.evidence.actual} (element is disabled — opacity: ${matchedEl.computed.opacity})`,
        expected: finding.evidence.expected,
        source: `${finding.evidence.source} + DOM cross-ref (${matchedEl.ref}: disabled, not a bug)`,
      },
    };
  }

  // Rule 2: Font-size confirmation via DOM
  if (finding.category === "typography" && finding.description.toLowerCase().includes("font")) {
    const domFontSize = matchedEl.computed.fontSize;
    if (domFontSize) {
      return {
        source: "dom",
        evidence: {
          ...finding.evidence,
          actual: `${finding.evidence.actual} (DOM computed: ${domFontSize})`,
          expected: finding.evidence.expected,
          source: `${finding.evidence.source} + DOM confirms (${matchedEl.ref})`,
        },
      };
    }
  }

  // Rule 3: Color confirmation via DOM
  if (finding.category === "color" && matchedEl.computed.color) {
    return {
      source: "dom",
      evidence: {
        ...finding.evidence,
        actual: `${finding.evidence.actual} (DOM computed color: ${matchedEl.computed.color})`,
        expected: finding.evidence.expected,
        source: `${finding.evidence.source} + DOM confirms (${matchedEl.ref})`,
      },
    };
  }

  return { source: "vlm", evidence: finding.evidence };
}

/**
 * Apply known false positive filters on VLM findings.
 * Filters operate on the normalized Finding objects.
 */
function filterFalsePositives(findings: Finding[], dom?: DomDump): Finding[] {
  return findings.filter((f) => {
    // Filter: low-confidence findings in light mode are not useful
    if (f.confidence === "low") return false;

    // If DOM is available, filter disabled-element style findings
    if (dom && f.source === "dom" && f.evidence.actual.includes("disabled")) {
      // Keep the finding but downgrade severity — it's informative, not actionable
      f.severity = "minor";
      f.description += " (element is in disabled state — may be intentional)";
      return true;
    }

    return true;
  });
}

/**
 * Normalize a raw VLM response into typed Finding objects.
 */
function normalizeFindings(raw: RawVlmResponse, defaultSource: FindingSource = "vlm"): Finding[] {
  if (!raw.findings || !Array.isArray(raw.findings)) return [];

  return raw.findings
    .filter((r) => r.description && r.description.trim().length > 0)
    .map((r) => ({
      severity: (["critical", "major", "minor"].includes(r.severity ?? "")
        ? r.severity
        : "minor") as Finding["severity"],
      category: (r.category ?? "layout") as Finding["category"],
      location: r.location ?? "unknown",
      description: r.description ?? "",
      evidence: {
        actual: r.evidence ?? "visible in screenshot",
        expected: "per design specification",
        source: "VLM visual analysis",
      },
      source: defaultSource,
      confidence: (["high", "medium", "low"].includes(r.confidence ?? "")
        ? r.confidence
        : "medium") as Finding["confidence"],
    }));
}

// ── VLM extraction ───────────────────────────────────────

async function callVlm(
  provider: VLMProvider,
  prompt: string,
  dataUrl: string,
  model?: string,
  thinkingBudget?: number,
): Promise<RawVlmResponse> {
  // Dynamic import to avoid circular dependency at module load
  const { extractJson } = await import("../vlm/openai-compat.js");
  const raw = await provider.chat(prompt, dataUrl, model, thinkingBudget);
  try {
    return extractJson(raw) as unknown as RawVlmResponse;
  } catch {
    return { findings: [], summary: "VLM returned unparseable response", no_issues_found: true };
  }
}

// ── Public API ────────────────────────────────────────────

/**
 * Run a visual review against a screenshot.
 *
 * @param provider - VLM provider instance (from src/vlm)
 * @param input - Review parameters: screenshot, optional DOM, aesthetics, etc.
 * @returns Structured findings with source tagging and confidence levels.
 */
export async function review(
  provider: VLMProvider,
  input: ReviewInput,
): Promise<ReviewOutput> {
  const dataUrl = toDataUrl(input.screenshot);
  const mode = input.mode ?? "light";
  const focus = input.focus ?? "comprehensive";
  const strictness = input.strictness ?? "standard";

  if (mode === "light") {
    // ── Light mode: single comprehensive call ──
    const prompt = buildLightReviewPrompt(focus, strictness, input.aesthetics);
    const raw = await callVlm(provider, prompt, dataUrl, input.model, input.thinkingBudget);
    const findings = normalizeFindings(raw, "vlm");

    // Post-process: DOM cross-ref + false positive filter
    let processed = findings;
    if (input.dom) {
      processed = processed.map((f) => {
        const updated = crossReferenceDom(f, input.dom!);
        return { ...f, source: updated.source, evidence: updated.evidence };
      });
    }
    processed = filterFalsePositives(processed, input.dom);

    return {
      findings: processed,
      summary: raw.summary ?? `${processed.length} issue(s) found`,
      noIssuesFound: processed.length === 0,
      mode: "light",
    };
  }

  // ── Strict mode: per-dimension parallel calls ──
  const dimensions = getDimensions(focus);
  const results = await Promise.all(
    dimensions.map(async (dim) => {
      const dimPrompt = buildDimensionReviewPrompt(dim, strictness, input.aesthetics);
      const raw = await callVlm(provider, dimPrompt, dataUrl, input.model, input.thinkingBudget);
      const findings = normalizeFindings(raw, "vlm");
      return { dimension: dim.key, findings, raw };
    }),
  );

  // Aggregate: merge findings from all dimensions
  const allFindings: Finding[] = [];
  const seen = new Set<string>(); // dedup by description

  for (const { findings } of results) {
    for (const f of findings) {
      const key = `${f.category}:${f.location}:${f.description.slice(0, 60)}`;
      if (!seen.has(key)) {
        seen.add(key);
        allFindings.push(f);
      }
    }
  }

  // Post-process
  let processed = allFindings;
  if (input.dom) {
    processed = processed.map((f) => {
      const updated = crossReferenceDom(f, input.dom!);
      return { ...f, source: updated.source, evidence: updated.evidence };
    });
  }
  processed = filterFalsePositives(processed, input.dom);

  // Determine contested findings (only found by 1 dimension in strict mode)
  const dimensionCounts = new Map<string, number>();
  for (const { findings } of results) {
    for (const f of findings) {
      const key = `${f.category}:${f.location}:${(f.description ?? "").slice(0, 60)}`;
      dimensionCounts.set(key, (dimensionCounts.get(key) ?? 0) + 1);
    }
  }
  processed = processed.map((f) => {
    const key = `${f.category}:${f.location}:${f.description.slice(0, 60)}`;
    const count = dimensionCounts.get(key) ?? 0;
    if (count === 1 && f.source === "vlm") {
      return { ...f, source: "vlm_contested" as FindingSource };
    }
    return f;
  });

  return {
    findings: processed,
    summary: `${processed.length} issue(s) found across ${dimensions.length} dimension(s)`,
    noIssuesFound: processed.length === 0,
    mode: "strict",
    dimensions: dimensions.map((d) => d.key),
  };
}

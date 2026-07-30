/**
 * dom-lint rule registry + dom-rules.json loader.
 *
 * Each rule is a pure function: (DomDump, DomRules?) → LintFinding[].
 * Rules are registered by ID and can be selectively enabled.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DomDump, DomElement, DomRules, LintFinding, LintRule } from "../schemas.js";

// ── Registry ─────────────────────────────────────────────

const registry = new Map<string, LintRule>();

export function registerRule(rule: LintRule): void {
  registry.set(rule.id, rule);
}

export function getRule(id: string): LintRule | undefined {
  return registry.get(id);
}

export function listRules(): LintRule[] {
  return [...registry.values()];
}

// ── dom-rules.json loader ────────────────────────────────

export function loadDomRules(rulesPath?: string): DomRules | undefined {
  const path = rulesPath ?? resolve(process.cwd(), ".spark", "plugin", "e2e", "dom-rules.json");
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as DomRules;
  } catch {
    return undefined;
  }
}

// ── Helpers ──────────────────────────────────────────────

/** Flatten all elements in the DOM dump into a single array (depth-first). */
function flattenElements(elements: DomElement[]): DomElement[] {
  const result: DomElement[] = [];
  function walk(el: DomElement) {
    result.push(el);
    for (const child of el.children) walk(child);
  }
  for (const el of elements) walk(el);
  return result;
}

/** Check if a CSS value is a hardcoded pixel value (not a var() reference). */
function isHardcodedPx(value: string): boolean {
  if (!value) return false;
  // Matches patterns like "20px", "1.5px", but NOT "var(--space-5)" or "0"
  const trimmed = value.trim();
  if (trimmed === "0" || trimmed === "0px") return false; // 0 is fine
  return /^\d+(\.\d+)?px$/.test(trimmed) && !trimmed.includes("var(");
}

/** Check if a color value is hardcoded (not a var() reference and not transparent). */
function isHardcodedColor(value: string): boolean {
  if (!value || value === "transparent" || value === "rgba(0, 0, 0, 0)") return false;
  const trimmed = value.trim();
  return (trimmed.startsWith("#") || trimmed.startsWith("rgb")) && !trimmed.includes("var(");
}

/** Check if a token exists in the known token scale. */
function isKnownToken(value: string, tokens: DomRules["tokens"]): boolean {
  if (!value) return true; // empty is not a violation
  // Extract var(--xxx) references
  const varMatch = value.match(/var\((--[\w-]+)/g);
  if (!varMatch) return true; // no var() usage, not a token issue
  const knownVars = new Set([
    ...tokens.spacing,
    ...tokens.fontSizes,
    ...Object.values(tokens.colors).map((c: { value: string; var: string }) => c.var),
  ]);
  for (const m of varMatch) {
    const varName = m.replace("var(", "");
    if (!knownVars.has(varName)) return false;
  }
  return true;
}

/** Find elements matching a CSS class selector in the flattened DOM. */
function findByClass(elements: DomElement[], className: string): DomElement[] {
  return elements.filter((el) => el.classes.some((c) => c === className || c.startsWith(className)));
}

/** Find elements matching a tag name. */
function findByTag(elements: DomElement[], tag: string): DomElement[] {
  return elements.filter((el) => el.tag.toLowerCase() === tag.toLowerCase());
}

// ── Built-in rules ───────────────────────────────────────

// Rule 1: no-hardcoded-px
registerRule({
  id: "no-hardcoded-px",
  description: "margin/padding using hardcoded px values instead of var(--space-*) tokens",
  severity: "major",
  check(dump: DomDump, rules?: DomRules): LintFinding[] {
    const findings: LintFinding[] = [];
    const all = flattenElements(dump.elements);
    const spacingTokens = rules?.tokens.spacing ?? [];

    for (const el of all) {
      const inline = el.inline ?? {};
      const checks: Array<{ prop: string; value: string }> = [];
      for (const [prop, value] of Object.entries(inline)) {
        if (/^(margin|padding|gap)/.test(prop) && isHardcodedPx(value)) {
          checks.push({ prop, value });
        }
      }
      for (const { prop, value } of checks) {
        findings.push({
          ruleId: "no-hardcoded-px",
          severity: "major",
          element: el.ref,
          description: `${el.tag} uses hardcoded ${prop}: ${value} — should use a spacing token`,
          evidence: {
            actual: `${prop}: ${value}`,
            expected: spacingTokens.length > 0
              ? `one of: ${spacingTokens.join(", ")}`
              : "a var(--space-*) token",
            source: ".spark/dom-rules.json → tokens.spacing",
          },
        });
      }
    }
    return findings;
  },
});

// Rule 2: no-raw-colors
registerRule({
  id: "no-raw-colors",
  description: "color/background-color using hardcoded hex/rgb instead of var(--*) tokens",
  severity: "major",
  check(dump: DomDump, rules?: DomRules): LintFinding[] {
    const findings: LintFinding[] = [];
    const all = flattenElements(dump.elements);
    const colorTokens = rules?.tokens.colors ?? {};

    for (const el of all) {
      const inline = el.inline ?? {};
      const checks: Array<{ prop: string; value: string }> = [];
      for (const [prop, value] of Object.entries(inline)) {
        if (/(^|-)color$|^background$|^background-color$/.test(prop) && isHardcodedColor(value)) {
          checks.push({ prop, value });
        }
      }
      for (const { prop, value } of checks) {
        const tokenNames = Object.keys(colorTokens);
        findings.push({
          ruleId: "no-raw-colors",
          severity: "major",
          element: el.ref,
          description: `${el.tag} uses hardcoded ${prop}: ${value} — should use a color token`,
          evidence: {
            actual: `${prop}: ${value}`,
            expected: tokenNames.length > 0
              ? `a var(--*) token: ${tokenNames.map((n) => colorTokens[n].var).join(", ")}`
              : "a var(--color-*) token",
            source: ".spark/dom-rules.json → tokens.colors",
          },
        });
      }
    }
    return findings;
  },
});

// Rule 3: font-weight-audit
registerRule({
  id: "font-weight-audit",
  description: "computed font-weight doesn't match dom-rules.json specification",
  severity: "major",
  check(dump: DomDump, rules?: DomRules): LintFinding[] {
    const findings: LintFinding[] = [];
    if (!rules?.rules.typography?.length) return findings;

    const all = flattenElements(dump.elements);

    for (const spec of rules.rules.typography) {
      if (!spec.fontWeight) continue;
      const elements = findByClass(all, spec.selector.replace(/^\./, ""));
      for (const el of elements) {
        const actualWeight = el.computed.fontWeight;
        const expectedWeight = spec.fontWeight;
        if (actualWeight !== expectedWeight) {
          findings.push({
            ruleId: "font-weight-audit",
            severity: "major",
            element: el.ref,
            description: `${spec.selector}: computed font-weight ${actualWeight}, expected ${expectedWeight}`,
            evidence: {
              actual: `font-weight: ${actualWeight}`,
              expected: `font-weight: ${expectedWeight}`,
              source: `.spark/dom-rules.json → rules.typography (selector: ${spec.selector})`,
            },
          });
        }
      }

      // Also check component rules
      if (rules.rules.components) {
        for (const [compName, compSpec] of Object.entries(rules.rules.components)) {
          if (!compSpec.fontWeight) continue;
          const compElements = findByClass(all, `spark-${compName}`);
          for (const el of compElements) {
            const actualWeight = el.computed.fontWeight;
            const expectedWeight = compSpec.fontWeight;
            if (actualWeight !== expectedWeight) {
              findings.push({
                ruleId: "font-weight-audit",
                severity: "major",
                element: el.ref,
                description: `${compName}: computed font-weight ${actualWeight}, expected ${expectedWeight}`,
                evidence: {
                  actual: `font-weight: ${actualWeight}`,
                  expected: `font-weight: ${expectedWeight}`,
                  source: `.spark/dom-rules.json → rules.components.${compName}`,
                },
              });
            }
          }
        }
      }
    }
    return findings;
  },
});

// Rule 4: token-usage
registerRule({
  id: "token-usage",
  description: "CSS variable usage references unknown tokens (possible typo)",
  severity: "minor",
  check(dump: DomDump, rules?: DomRules): LintFinding[] {
    const findings: LintFinding[] = [];
    if (!rules?.tokens) return findings;

    const all = flattenElements(dump.elements);

    for (const el of all) {
      const inline = el.inline ?? {};
      for (const [, value] of Object.entries(inline)) {
        if (!isKnownToken(value, rules.tokens)) {
          findings.push({
            ruleId: "token-usage",
            severity: "minor",
            element: el.ref,
            description: `${el.tag} references unknown CSS variable in inline style: ${value.slice(0, 60)}`,
            evidence: {
              actual: value.slice(0, 80),
              expected: "a known token from dom-rules.json",
              source: ".spark/dom-rules.json → tokens",
            },
          });
        }
      }
    }
    return findings;
  },
});

// Rule 5: missing-alt
registerRule({
  id: "missing-alt",
  description: "<img> element missing alt attribute (accessibility)",
  severity: "minor",
  check(dump: DomDump, _rules?: DomRules): LintFinding[] {
    const findings: LintFinding[] = [];
    const all = flattenElements(dump.elements);
    const images = findByTag(all, "img");

    for (const img of images) {
      if (!img.attributes.alt && img.attributes.alt !== "") {
        // alt="" is valid for decorative images, but missing alt entirely is not
        findings.push({
          ruleId: "missing-alt",
          severity: "minor",
          element: img.ref,
          description: `<img> missing alt attribute — add alt="" for decorative images or describe the image`,
          evidence: {
            actual: "no alt attribute",
            expected: 'alt="..." or alt=""',
            source: "WCAG 1.1.1 Non-text Content",
          },
        });
      }
    }
    return findings;
  },
});

// Rule 6: empty-button
registerRule({
  id: "empty-button",
  description: "<button> has no text content and no aria-label (accessibility)",
  severity: "minor",
  check(dump: DomDump, _rules?: DomRules): LintFinding[] {
    const findings: LintFinding[] = [];
    const all = flattenElements(dump.elements);
    const buttons = findByTag(all, "button");

    for (const btn of buttons) {
      const hasText = btn.text.trim().length > 0;
      const hasAriaLabel = btn.attributes["aria-label"]?.trim();
      const hasTitle = btn.attributes.title?.trim();

      if (!hasText && !hasAriaLabel && !hasTitle) {
        findings.push({
          ruleId: "empty-button",
          severity: "minor",
          element: btn.ref,
          description: "<button> has no text content, aria-label, or title — screen readers cannot identify it",
          evidence: {
            actual: "button is empty",
            expected: "text content or aria-label attribute",
            source: "WCAG 4.1.2 Name, Role, Value",
          },
        });
      }
    }
    return findings;
  },
});

/**
 * dom-lint — deterministic DOM rule checker.
 *
 * Runs registered lint rules against a DOM dump. Unlike VLM review,
 * dom-lint performs exact, deterministic checks using computed styles
 * and attributes — no VLM hallucination risk.
 *
 * Rules are registered in src/engine/rules.ts. Custom rules can be
 * added via the registerRule() API.
 *
 * Usage:
 *   import { domLint } from "./engine/dom-lint.js";
 *   const result = domLint({ dom: myDomDump, rules: myDomRules });
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DomDump, DomRules, DomLintInput, DomLintOutput } from "../schemas.js";
import { listRules } from "./rules.js";

function loadDomDump(domPath: string): DomDump {
  const path = resolve(domPath);
  if (!existsSync(path)) {
    throw new Error(`DOM dump not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as DomDump;
}

/**
 * Run dom-lint rules against a DOM dump (file path or object).
 *
 * By default runs all registered rules. Use `enabledRules` to
 * selectively enable specific rule IDs.
 */
export function domLint(input: DomLintInput | string, rulesPath?: string): DomLintOutput {
  // Resolve input
  let dom: DomDump;
  let domRules: DomRules | undefined;
  let enabledRules: string[] | undefined;

  if (typeof input === "string") {
    // Legacy signature: domLint(domPath, rulesPath)
    dom = loadDomDump(input);
  } else {
    dom = input.dom;
    domRules = input.rules;
    enabledRules = input.enabledRules;
  }

  // Determine which rules to run
  const allRules = listRules();
  const rulesToRun = enabledRules
    ? allRules.filter((r) => enabledRules!.includes(r.id))
    : allRules;

  // Run each rule
  const allFindings = [];
  for (const rule of rulesToRun) {
    try {
      const findings = rule.check(dom, domRules);
      allFindings.push(...findings);
    } catch {
      // Rule failures are non-fatal — skip the rule, continue with others
    }
  }

  const summary = allFindings.length === 0
    ? "No DOM lint issues found"
    : `${allFindings.length} DOM lint issue(s) found across ${rulesToRun.length} rule(s)`;

  return {
    findings: allFindings,
    summary,
    rulesRun: rulesToRun.map((r) => r.id),
  };
}

/**
 * YAML test runner — declares scenarios as YAML, runs them sequentially.
 *
 * Usage:
 *   spark-e2e run                    # runs tests/*.yaml
 *   spark-e2e run path/to/test.yaml  # runs a single file
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { resolve, join, basename, extname } from "node:path";
import * as yaml from "js-yaml";
import { getConfig, interpolateEnvVars } from "./config.js";
import { PlaywrightBrowser } from "./browser/playwright.js";
import { getProvider } from "./vlm/index.js";
import { getTestPrompt, getAssertPrompt, getLocatePrompt } from "./prompts.js";
import { extractJson } from "./vlm/openai-compat.js";

// ── Types ──────────────────────────────────────────────────

interface TestSuite {
  name?: string;
  config?: {
    url?: string;
    viewport?: { width?: number; height?: number };
  };
  scenarios: Scenario[];
}

interface Scenario {
  name: string;
  steps: Step[];
}

type Step =
  | { navigate: string }
  | { click: string }
  | { type: { text: string; into: string } }
  | { hover: string }
  | { test: string }
  | { assert: string }
  | { wait: number }
  | { snapshot: string };

interface StepResult {
  step: Record<string, unknown>;
  pass: boolean;
  type: string;
  detail: string;
  durationMs: number;
}

interface ScenarioResult {
  name: string;
  pass: boolean;
  steps: StepResult[];
}

interface RunReport {
  file: string;
  pass: boolean;
  scenarios: ScenarioResult[];
  durationMs: number;
}

// ── Step execution ────────────────────────────────────────

async function runStep(
  step: Step,
  browser: PlaywrightBrowser,
  provider: ReturnType<typeof getProvider>,
  cfg: ReturnType<typeof getConfig>,
  baseUrl: string,
  outputDir: string,
): Promise<StepResult> {
  const started = Date.now();

  // ── navigate ──
  if ("navigate" in step) {
    const url = step.navigate.startsWith("http") ? step.navigate : new URL(step.navigate, baseUrl).href;
    await browser.navigate(url);
    return { step: step as Record<string, unknown>, pass: true, type: "navigate", detail: url, durationMs: Date.now() - started };
  }

  // ── wait ──
  if ("wait" in step) {
    await browser.waitForTimeout(step.wait * 1000);
    return { step: step as Record<string, unknown>, pass: true, type: "wait", detail: `${step.wait}s`, durationMs: Date.now() - started };
  }

  // ── snapshot ──
  if ("snapshot" in step) {
    const buf = await browser.captureScreenshot();
    const filename = `${step.snapshot.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;
    const outPath = join(outputDir, filename);
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(outPath, Buffer.isBuffer(buf) ? buf : Buffer.from(buf as ArrayBuffer));
    return { step: step as Record<string, unknown>, pass: true, type: "snapshot", detail: outPath, durationMs: Date.now() - started };
  }

  // ── VLM-based steps (click, type, hover, test, assert) ──

  const { dataUrl } = await captureCurrent(browser, cfg);

  // ── click ──
  if ("click" in step) {
    if (step.click.startsWith("@")) {
      const coords = resolveDomRef(step.click);
      if (!coords) return { step: step as Record<string, unknown>, pass: false, type: "click", detail: `Dom ref not found: ${step.click}`, durationMs: Date.now() - started };
      await browser.clickAt(coords.x, coords.y);
      return { step: step as Record<string, unknown>, pass: true, type: "click", detail: `${step.click} (${coords.x}, ${coords.y}) [dom-ref]`, durationMs: Date.now() - started };
    }
    const locate = await locateElement(provider, cfg, dataUrl, step.click);
    if (!locate.found) return { step: step as Record<string, unknown>, pass: false, type: "click", detail: `Not found: ${locate.reasoning}`, durationMs: Date.now() - started };
    await browser.clickAt(locate.x, locate.y);
    return { step: step as Record<string, unknown>, pass: true, type: "click", detail: `(${locate.x}, ${locate.y})`, durationMs: Date.now() - started };
  }

  // ── type ──
  if ("type" in step) {
    if (step.type.into.startsWith("@")) {
      const coords = resolveDomRef(step.type.into);
      if (!coords) return { step: step as Record<string, unknown>, pass: false, type: "type", detail: `Dom ref not found: ${step.type.into}`, durationMs: Date.now() - started };
      await browser.clickAt(coords.x, coords.y);
      await browser.waitForTimeout(150);
      await browser.clearAndType(step.type.text);
      return { step: step as Record<string, unknown>, pass: true, type: "type", detail: `[masked] into ${step.type.into} [dom-ref]`, durationMs: Date.now() - started };
    }
    const locate = await locateElement(provider, cfg, dataUrl, step.type.into);
    if (!locate.found) return { step: step as Record<string, unknown>, pass: false, type: "type", detail: `Target not found: ${locate.reasoning}`, durationMs: Date.now() - started };
    await browser.clickAt(locate.x, locate.y);
    await browser.waitForTimeout(150);
    await browser.clearAndType(step.type.text);
    return { step: step as Record<string, unknown>, pass: true, type: "type", detail: `[masked] into (${locate.x}, ${locate.y})`, durationMs: Date.now() - started };
  }

  // ── hover ──
  if ("hover" in step) {
    if (step.hover.startsWith("@")) {
      const coords = resolveDomRef(step.hover);
      if (!coords) return { step: step as Record<string, unknown>, pass: false, type: "hover", detail: `Dom ref not found: ${step.hover}`, durationMs: Date.now() - started };
      await browser.hoverAt(coords.x, coords.y);
      return { step: step as Record<string, unknown>, pass: true, type: "hover", detail: `${step.hover} (${coords.x}, ${coords.y}) [dom-ref]`, durationMs: Date.now() - started };
    }
    const locate = await locateElement(provider, cfg, dataUrl, step.hover);
    if (!locate.found) return { step: step as Record<string, unknown>, pass: false, type: "hover", detail: `Not found: ${locate.reasoning}`, durationMs: Date.now() - started };
    await browser.hoverAt(locate.x, locate.y);
    return { step: step as Record<string, unknown>, pass: true, type: "hover", detail: `(${locate.x}, ${locate.y})`, durationMs: Date.now() - started };
  }

  // ── test ──
  if ("test" in step) {
    const prompt = getTestPrompt(step.test, cfg.prompts.strictness);
    const raw = await provider.chat(prompt, dataUrl, undefined, cfg.vlm.thinkingBudget);
    let result: Record<string, unknown> = {};
    try { result = extractJson(raw) as Record<string, unknown>; } catch { result = { pass: false, summary: raw.slice(0, 200) }; }
    const pass = result.pass === true;
    return { step: step as Record<string, unknown>, pass, type: "test", detail: (result.summary as string) || (pass ? "passed" : "failed"), durationMs: Date.now() - started };
  }

  // ── assert ──
  if ("assert" in step) {
    const prompt = [
      "You are a visual E2E test verifier. Determine whether this assertion is TRUE or FALSE.",
      `ASSERTION: ${step.assert}`,
      "",
      getAssertPrompt(cfg.prompts.strictness),
      "",
      'Respond ONLY with JSON: {"pass": true|false, "confidence": "high"|"medium"|"low", "observation": "...", "reasoning": "..."}',
    ].join("\n");
    const raw = await provider.chat(prompt, dataUrl, undefined, cfg.vlm.thinkingBudget);
    let result: Record<string, unknown> = {};
    try { result = extractJson(raw) as Record<string, unknown>; } catch { result = { pass: false, reasoning: raw.slice(0, 200) }; }
    const pass = result.pass === true;
    return { step: step as Record<string, unknown>, pass, type: "assert", detail: (result.reasoning as string) || (result.summary as string) || (pass ? "passed" : "failed"), durationMs: Date.now() - started };
  }

  // Should not reach here for valid YAML
  return { step: step as Record<string, unknown>, pass: false, type: "unknown", detail: "Unknown step type", durationMs: Date.now() - started };
}

// ── Helpers ────────────────────────────────────────────────

async function captureCurrent(browser: PlaywrightBrowser, cfg: ReturnType<typeof getConfig>): Promise<{ dataUrl: string }> {
  const buf = await browser.captureScreenshot({ reload: false, maskSelectors: cfg.security.maskSelectors });
  const raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf as ArrayBuffer);
  return { dataUrl: browser.toDataUrl(raw) };
}

function resolveDomRef(ref: string): { x: number; y: number } | null {
  const domStatePath = resolve(process.cwd(), ".spark", "plugin", "e2e", "dom-state.json");
  if (!existsSync(domStatePath)) return null;
  try {
    const state = JSON.parse(readFileSync(domStatePath, "utf-8"));
    const el = state.layout?.find((e: { ref: string }) => e.ref === ref);
    if (!el) return null;
    return { x: el.center.x, y: el.center.y };
  } catch {
    return null;
  }
}

interface LocateResult {
  found: boolean;
  x: number;
  y: number;
  reasoning?: string;
}

async function locateElement(
  provider: ReturnType<typeof getProvider>,
  cfg: ReturnType<typeof getConfig>,
  dataUrl: string,
  target: string,
): Promise<LocateResult> {
  const prompt = getLocatePrompt(target);
  const raw = await provider.chat(prompt, dataUrl, undefined, cfg.vlm.thinkingBudget);
  try {
    const result = extractJson(raw) as Record<string, unknown>;
    return {
      found: result.found === true,
      x: (result.x as number) || 0,
      y: (result.y as number) || 0,
      reasoning: result.reasoning as string,
    };
  } catch {
    return { found: false, x: 0, y: 0, reasoning: "VLM returned unparseable response" };
  }
}

// ── Run one file ──────────────────────────────────────────

async function runFile(yamlPath: string): Promise<RunReport> {
  const started = Date.now();
  const raw = readFileSync(yamlPath, "utf-8");
  const suite = interpolateEnvVars(yaml.load(raw)) as unknown as TestSuite;

  if (!suite.scenarios || !Array.isArray(suite.scenarios)) {
    throw new Error(`Invalid test file: ${yamlPath} — missing "scenarios" list`);
  }

  const cfg = getConfig();
  const browser = new PlaywrightBrowser();
  const provider = getProvider(cfg.vlm.provider);
  const baseUrl = suite.config?.url || cfg.browser.url || "";

  // Apply viewport from YAML config if present
  if (suite.config?.viewport?.width && suite.config?.viewport?.height) {
    const page = await browser.ensurePage();
    await page.setViewportSize({
      width: suite.config.viewport.width,
      height: suite.config.viewport.height,
    });
  }

  const outputDir = resolve(process.cwd(), ".spark", "plugin", "e2e", "runs", basename(yamlPath, ".yaml"));

  const scenarioResults: ScenarioResult[] = [];

  for (const scenario of suite.scenarios) {
    if (!scenario.name) {
      scenarioResults.push({ name: "(unnamed)", pass: false, steps: [] });
      continue;
    }

    console.error(`\n  Scenario: ${scenario.name}`);
    const stepResults: StepResult[] = [];

    for (const step of scenario.steps) {
      const result = await runStep(step, browser, provider, cfg, baseUrl, outputDir);
      const icon = result.pass ? "✓" : "✗";
      console.error(`    ${icon} ${result.type}: ${result.detail.slice(0, 80)}`);
      stepResults.push(result);
      // Stop scenario on first failure? Or continue? Let's continue by default.
    }

    const allPassed = stepResults.every((r) => r.pass);
    scenarioResults.push({ name: scenario.name, pass: allPassed, steps: stepResults });
  }

  await browser.close();

  return {
    file: yamlPath,
    pass: scenarioResults.every((s) => s.pass),
    scenarios: scenarioResults,
    durationMs: Date.now() - started,
  };
}

// ── File discovery ────────────────────────────────────────

function findTestFiles(pattern?: string): string[] {
  // If a specific file is given, use it directly
  if (pattern) {
    const resolved = resolve(pattern);
    if (existsSync(resolved) && statSync(resolved).isFile()) return [resolved];
    // If it's a directory, scan it
    if (existsSync(resolved) && statSync(resolved).isDirectory()) {
      return scanDir(resolved);
    }
    console.error(`No test files found at: ${pattern}`);
    return [];
  }

  // Default: scan tests/ directory
  const testsDir = resolve(process.cwd(), "tests");
  if (!existsSync(testsDir)) return [];
  return scanDir(testsDir);
}

function scanDir(dir: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...scanDir(fullPath));
      } else if (entry.isFile() && [".yaml", ".yml"].includes(extname(entry.name))) {
        files.push(fullPath);
      }
    }
  } catch {
    // Permission errors, etc. — skip
  }
  return files.sort();
}

// ── Public API ─────────────────────────────────────────────

export async function runTests(pattern?: string): Promise<RunReport[]> {
  const files = findTestFiles(pattern);

  if (files.length === 0) {
    console.error("No test files found. Create tests/*.yaml files or specify a path.");
    console.error("Example: spark-e2e run tests/login.test.yaml");
    return [];
  }

  const reports: RunReport[] = [];
  for (const file of files) {
    console.error(`\n📄 ${file}`);
    try {
      const report = await runFile(file);
      reports.push(report);
      const status = report.pass ? "✓ PASS" : "✗ FAIL";
      console.error(`  ${status} (${(report.durationMs / 1000).toFixed(1)}s)`);
    } catch (err) {
      console.error(`  ✗ ERROR: ${(err as Error).message}`);
      reports.push({
        file,
        pass: false,
        scenarios: [],
        durationMs: 0,
      });
    }
  }

  return reports;
}

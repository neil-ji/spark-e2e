#!/usr/bin/env node
/**
 * spark-e2e CLI — VLM-powered visual E2E testing.
 *
 * Run it directly — no MCP server needed.
 *
 * Commands:
 *   setup        Interactive configuration wizard
 *   navigate     Load a URL in the browser
 *   snapshot     Capture a browser screenshot
 *   inspect      Free-form VLM screenshot analysis
 *   assert       Run a visual assertion (pass/fail)
 *   compare      Compare page against expected state
 *   click        Click an element by visual description (VLM-located)
 *   type         Type text into a VLM-located field
 *   hover        Hover over an element by visual description
 *   test         Natural language E2E test (navigate → review → assert in one call)
 *   baseline     Visual regression baselines (save, compare, list, delete)
 *   review       Comprehensive visual UI audit
 *   dom-verify   Batch DOM structure + CSS discovery
 *   doctor       Diagnose the environment
 */
import { Command } from "commander";
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync, cpSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Agent definitions ───────────────────────────────────

interface Agent {
  name: string;
  label: string;
  /** Project-level skills directory (relative to project root) */
  projectDir: string;
  /** User-level skills directory (relative to $HOME) */
  userDir: string;
  /** Directories that indicate this agent is in use */
  detectDirs: string[];
  /** If true, always resolve under $HOME regardless of --scope */
  homeDirOnly?: boolean;
}

export const AGENTS: Agent[] = [
  {
    name: "claude",
    label: "Claude Code",
    projectDir: ".claude/skills",
    userDir: ".claude/skills",
    detectDirs: [".claude"],
  },
  {
    name: "codex",
    label: "OpenAI Codex",
    projectDir: ".agents/skills",
    userDir: ".agents/skills",
    detectDirs: [".agents", ".codex"],
  },
  {
    name: "qoder",
    label: "Qoder",
    projectDir: ".qoder/skills",
    userDir: ".qoder/skills",
    detectDirs: [".qoder"],
  },
  {
    name: "trae",
    label: "Trae",
    projectDir: ".trae/skills",
    userDir: ".trae/skills",
    detectDirs: [".trae", ".traecli"],
  },
  {
    name: "spark-hub",
    label: "Spark Hub",
    projectDir: ".spark/skills",
    userDir: ".spark/config/custom-skills",
    detectDirs: [".spark"],
  },
];
import { spawnSync } from "node:child_process";

// Providers and browser
import { registerProvider } from "./vlm/index.js";
import { OpenAICompatProvider, extractJson } from "./vlm/openai-compat.js";
import { PlaywrightBrowser } from "./browser/index.js";
registerProvider("openai-compat", OpenAICompatProvider);

const browser = new PlaywrightBrowser();

import { getConfig, load, findConfigFile, getAesthetics } from "./config.js";
// browser singleton imported above as `browser`
import { getProvider } from "./vlm/index.js";
import { getReviewPrompt, getAssertPrompt, getTestPrompt, getBaselineComparePrompt, getLocatePrompt, getAestheticsPrompt } from "./prompts.js";
import { saveBaseline, loadBaseline, listBaselines, deleteBaseline, readBaselineScreenshot } from "./baselines.js";

const program = new Command();

// ── Helpers ─────────────────────────────────────────────

async function captureAndEncode(opts?: {
  viewport?: { width: number; height: number; deviceScaleFactor?: number };
  reload?: boolean;
  delay?: number;
  format?: "png" | "jpeg";
  quality?: number;
}): Promise<{ dataUrl: string; buf: Buffer }> {
  const raw = await browser.captureScreenshot(opts);
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
  return { dataUrl: browser.toDataUrl(buf), buf };
}

// ── setup ─────────────────────────────────────────────────

program
  .command("setup")
  .description("Interactive setup wizard — configure VLM, browser, and install skills")
  .option("--dir <path>", "Project directory (default: current directory)")
  .option("--yes", "Skip prompts, use defaults for everything")
  .option("--api-key <key>", "VLM API key (for --yes mode)")
  .option("--base-url <url>", "VLM base URL (for --yes mode)")
  .action(async (opts) => {
    const cfg = getConfig();
    const { setupCommand } = await import("./setup.js");
    await setupCommand({ dir: opts.dir, yes: opts.yes, apiKey: opts.apiKey, baseUrl: opts.baseUrl });
  });

// ── navigate ─────────────────────────────────────────────

program
  .command("navigate")
  .description("Load a URL in the browser")
  .argument("[url]", "Target URL (default from config)")
  .option("--width <px>", "Viewport width", parseInt)
  .option("--height <px>", "Viewport height", parseInt)
  .action(async (url, opts) => {
    const cfg = getConfig();
    const targetUrl = url ?? cfg.browser.url;
    
    if (opts.width && opts.height) {
      await browser.captureScreenshot({
        viewport: { width: opts.width, height: opts.height, deviceScaleFactor: 1 },
        reload: false,
      });
    }
    await browser.navigate(targetUrl);
    const info = await browser.getPageInfo();
    console.log(JSON.stringify(info, null, 2));
  });

// ── scroll ────────────────────────────────────────────────

program
  .command("scroll")
  .description("Scroll the page (handles lazy-loaded content)")
  .option("--x <px>", "Horizontal scroll position", parseInt)
  .option("--y <px>", "Vertical scroll position", parseInt)
  .option("--selector <css>", "CSS selector to scroll into view")
  .action(async (opts) => {
    const cfg = getConfig();
    
    const info = await browser.scroll({ x: opts.x, y: opts.y, selector: opts.selector });
    console.log(JSON.stringify(info, null, 2));
  });

// ── snapshot ─────────────────────────────────────────────

program
  .command("snapshot")
  .description("Capture a browser screenshot")
  .option("--url <url>", "Target URL")
  .option("--output, -o <path>", "Output file path", "/tmp/spark-e2e-snapshot.png")
  .option("--width <px>", "Viewport width", parseInt)
  .option("--height <px>", "Viewport height", parseInt)
  .option("--no-reload", "Skip reload before capture")
  .option("--delay <s>", "Delay after reload (seconds)", parseFloat, 0.3)
  .option("--full-page", "Capture the entire scrollable page")
  .action(async (opts) => {
    const cfg = getConfig();
    const url = opts.url ?? cfg.browser.url;
    
    console.log(`Navigating to ${url} ...`);
    await browser.navigate(url);

    const viewport = opts.width && opts.height
      ? { width: opts.width, height: opts.height, deviceScaleFactor: 1 }
      : undefined;

    const png = await browser.captureScreenshot({
      viewport, reload: opts.reload, delay: opts.delay, fullPage: opts.fullPage ?? false,
    });
    const buf = Buffer.isBuffer(png) ? png : Buffer.from(png as ArrayBuffer);
    writeFileSync(opts.output, buf);
    console.log(`Saved ${opts.output} (${buf.length} bytes)`);
    await browser.close();
  });

// ── inspect ──────────────────────────────────────────────

program
  .command("inspect")
  .description("Analyze the current page with a VLM (free-form)")
  .argument("<instruction>", "What to look for")
  .option("--url <url>", "Target URL")
  .option("--model <model>", "VLM model override")
  .option("--width <px>", "Viewport width", parseInt)
  .option("--height <px>", "Viewport height", parseInt)
  .option("--no-reload", "Skip reload")
  .option("--delay <s>", "Delay after reload", parseFloat, 0.3)
  .action(async (instruction, opts) => {
    const cfg = getConfig();
    const url = opts.url ?? cfg.browser.url;
    
    const provider = getProvider(cfg.vlm.provider);

    if (url) { await browser.navigate(url); }
    const { dataUrl } = await captureAndEncode({
      viewport: opts.width && opts.height ? { width: opts.width, height: opts.height, deviceScaleFactor: 1 } : undefined,
      reload: opts.reload,
      delay: opts.delay,
    });

    const prompt = [
      "You are a visual inspection tool for automated E2E testing.",
      "Analyze this webpage screenshot carefully and thoroughly.",
      "",
      `INSTRUCTION: ${instruction}`,
      "",
      "Be specific and precise. If you cannot determine something confidently, say so.",
      getReviewPrompt(cfg.prompts.strictness),
    ].join("\n");

    const raw = await provider.chat(prompt, dataUrl, opts.model, cfg.vlm.thinkingBudget);
    console.log(raw);
    await browser.close();
  });

// ── assert ───────────────────────────────────────────────

program
  .command("assert")
  .description("Verify a visual condition (returns pass/fail JSON)")
  .argument("<assertion>", "The assertion to verify")
  .option("--url <url>", "Target URL")
  .option("--model <model>", "VLM model override")
  .option("--width <px>", "Viewport width", parseInt)
  .option("--height <px>", "Viewport height", parseInt)
  .option("--no-reload", "Skip reload")
  .option("--delay <s>", "Delay after reload", parseFloat, 0.3)
  .action(async (assertion, opts) => {
    const cfg = getConfig();
    const url = opts.url ?? cfg.browser.url;
    
    const provider = getProvider(cfg.vlm.provider);

    if (url) { await browser.navigate(url); }
    const { dataUrl } = await captureAndEncode({
      viewport: opts.width && opts.height ? { width: opts.width, height: opts.height, deviceScaleFactor: 1 } : undefined,
      reload: opts.reload,
      delay: opts.delay,
    });

    const prompt = [
      "You are a visual E2E test verifier. Determine whether this assertion is TRUE or FALSE.",
      `ASSERTION: ${assertion}`,
      "",
      getAssertPrompt(cfg.prompts.strictness),
      "",
      'Respond ONLY with JSON: {"pass": true|false, "confidence": "high"|"medium"|"low", "observation": "...", "reasoning": "..."}',
    ].join("\n");

    const raw = await provider.chat(prompt, dataUrl, opts.model, cfg.vlm.thinkingBudget);
    try {
      console.log(JSON.stringify(extractJson(raw), null, 2));
    } catch {
      console.log(raw);
    }
    await browser.close();
  });

// ── compare ──────────────────────────────────────────────

program
  .command("compare")
  .description("Compare page against an expected description")
  .argument("<expected>", "Expected visual state description")
  .option("--url <url>", "Target URL")
  .option("--after <action>", "Action performed before comparison")
  .option("--model <model>", "VLM model override")
  .option("--width <px>", "Viewport width", parseInt)
  .option("--height <px>", "Viewport height", parseInt)
  .action(async (expected, opts) => {
    const cfg = getConfig();
    const url = opts.url ?? cfg.browser.url;
    
    const provider = getProvider(cfg.vlm.provider);

    if (url) { await browser.navigate(url); }
    const { dataUrl } = await captureAndEncode({
      viewport: opts.width && opts.height ? { width: opts.width, height: opts.height, deviceScaleFactor: 1 } : undefined,
      reload: true,
    });

    const actionCtx = opts.after ? `CONTEXT — Action performed: ${opts.after}\n\n` : "";
    const prompt = [
      "You are a visual regression tester. Compare this screenshot against the expected state.",
      actionCtx,
      `EXPECTED STATE: ${expected}`,
      "",
      getReviewPrompt(cfg.prompts.strictness),
      "",
      'Respond ONLY with JSON: {"match": true|false, "differences": [...], "matches": [...], "overall_assessment": "..."}',
    ].join("\n");

    const raw = await provider.chat(prompt, dataUrl, opts.model, cfg.vlm.thinkingBudget);
    try {
      console.log(JSON.stringify(extractJson(raw), null, 2));
    } catch {
      console.log(raw);
    }
    await browser.close();
  });

// ── click ─────────────────────────────────────────────────

program
  .command("click")
  .description("Click an element by visual description (VLM locates → Playwright clicks)")
  .argument("<target>", "Visual description of the element (e.g. 'the Submit button')")
  .option("--url <url>", "Target URL")
  .option("--model <model>", "VLM model override")
  .option("--width <px>", "Viewport width", parseInt)
  .option("--height <px>", "Viewport height", parseInt)
  .action(async (target, opts) => {
    const cfg = getConfig();
    const provider = getProvider(cfg.vlm.provider);
    const url = opts.url ?? cfg.browser.url;

    if (url) await browser.navigate(url);
    const { dataUrl } = await captureAndEncode({
      viewport: opts.width && opts.height ? { width: opts.width, height: opts.height, deviceScaleFactor: 1 } : undefined,
    });

    console.error(`Locating: "${target}"`);
    const prompt = getLocatePrompt(target);
    const raw = await provider.chat(prompt, dataUrl, opts.model, cfg.vlm.thinkingBudget);

    let result: Record<string, unknown>;
    try { result = extractJson(raw) as Record<string, unknown>; } catch { result = {}; }

    if (!result.found) {
      console.error(`Element not found: ${result.reasoning || "unknown reason"}`);
      await browser.close();
      process.exit(1);
    }

    const x = result.x as number;
    const y = result.y as number;
    await browser.clickAt(x, y);
    console.log(JSON.stringify({ clicked: target, x, y, confidence: result.confidence }, null, 2));
    await browser.close();
  });

// ── type ──────────────────────────────────────────────────

program
  .command("type")
  .description("Type text into a field located by visual description")
  .argument("<text>", "Text to type")
  .requiredOption("--into <target>", "Visual description of the target field (e.g. 'email input')")
  .option("--url <url>", "Target URL")
  .option("--model <model>", "VLM model override")
  .option("--width <px>", "Viewport width", parseInt)
  .option("--height <px>", "Viewport height", parseInt)
  .action(async (text, opts) => {
    const cfg = getConfig();
    const provider = getProvider(cfg.vlm.provider);
    const url = opts.url ?? cfg.browser.url;

    if (url) await browser.navigate(url);
    const { dataUrl } = await captureAndEncode({
      viewport: opts.width && opts.height ? { width: opts.width, height: opts.height, deviceScaleFactor: 1 } : undefined,
    });

    // Step 1: locate the field
    console.error(`Locating: "${opts.into}"`);
    const locatePrompt = getLocatePrompt(opts.into);
    const locateRaw = await provider.chat(locatePrompt, dataUrl, opts.model, cfg.vlm.thinkingBudget);

    let locateResult: Record<string, unknown>;
    try { locateResult = extractJson(locateRaw) as Record<string, unknown>; } catch { locateResult = {}; }

    if (!locateResult.found) {
      console.error(`Target field not found: ${locateResult.reasoning || "unknown reason"}`);
      await browser.close();
      process.exit(1);
    }

    // Step 2: click to focus
    await browser.clickAt(locateResult.x as number, locateResult.y as number);
    await browser.waitForTimeout(150);

    // Step 3: clear + type
    await browser.clearAndType(text);

    console.log(JSON.stringify({
      typed: text,
      into: opts.into,
      x: locateResult.x,
      y: locateResult.y,
      confidence: locateResult.confidence,
    }, null, 2));
    await browser.close();
  });

// ── hover ─────────────────────────────────────────────────

program
  .command("hover")
  .description("Hover over an element by visual description")
  .argument("<target>", "Visual description of the element (e.g. 'the first menu item')")
  .option("--url <url>", "Target URL")
  .option("--model <model>", "VLM model override")
  .option("--width <px>", "Viewport width", parseInt)
  .option("--height <px>", "Viewport height", parseInt)
  .action(async (target, opts) => {
    const cfg = getConfig();
    const provider = getProvider(cfg.vlm.provider);
    const url = opts.url ?? cfg.browser.url;

    if (url) await browser.navigate(url);
    const { dataUrl } = await captureAndEncode({
      viewport: opts.width && opts.height ? { width: opts.width, height: opts.height, deviceScaleFactor: 1 } : undefined,
    });

    console.error(`Locating: "${target}"`);
    const prompt = getLocatePrompt(target);
    const raw = await provider.chat(prompt, dataUrl, opts.model, cfg.vlm.thinkingBudget);

    let result: Record<string, unknown>;
    try { result = extractJson(raw) as Record<string, unknown>; } catch { result = {}; }

    if (!result.found) {
      console.error(`Element not found: ${result.reasoning || "unknown reason"}`);
      await browser.close();
      process.exit(1);
    }

    await browser.hoverAt(result.x as number, result.y as number);
    console.log(JSON.stringify({ hovered: target, x: result.x, y: result.y, confidence: result.confidence }, null, 2));
    await browser.close();
  });

// ── test ─────────────────────────────────────────────────

program
  .command("test")
  .description("Natural language E2E test — navigate, review, and assert in one call")
  .argument("<expectations>", "What you expect to see (natural language, e.g. 'The sidebar has 5 menu items and Dashboard is highlighted')")
  .option("--url <url>", "Target URL")
  .option("--model <model>", "VLM model override")
  .option("--width <px>", "Viewport width", parseInt)
  .option("--height <px>", "Viewport height", parseInt)
  .option("--no-reload", "Skip reload")
  .option("--delay <s>", "Delay after reload", parseFloat, 0.3)
  .action(async (expectations, opts) => {
    const cfg = getConfig();
    const url = opts.url ?? cfg.browser.url;

    const provider = getProvider(cfg.vlm.provider);

    if (url) { await browser.navigate(url); }
    const { dataUrl } = await captureAndEncode({
      viewport: opts.width && opts.height ? { width: opts.width, height: opts.height, deviceScaleFactor: 1 } : undefined,
      reload: opts.reload,
      delay: opts.delay,
    });

    console.error(`Testing: ${expectations.slice(0, 80)}${expectations.length > 80 ? "..." : ""}`);

    const prompt = getTestPrompt(expectations, cfg.prompts.strictness);

    const raw = await provider.chat(prompt, dataUrl, opts.model, cfg.vlm.thinkingBudget);
    try {
      const result = extractJson(raw);
      console.log(JSON.stringify(result, null, 2));
    } catch {
      console.log(raw);
    }
    await browser.close();
  });

// ── baseline ──────────────────────────────────────────────

const baseline = program
  .command("baseline")
  .description("Visual regression baselines — save, compare, list, delete");

baseline
  .command("save")
  .description("Save current page screenshot as a named baseline")
  .requiredOption("--name <name>", "Baseline name (e.g. 'dashboard-v1')")
  .option("--url <url>", "Target URL")
  .option("--width <px>", "Viewport width", parseInt)
  .option("--height <px>", "Viewport height", parseInt)
  .action(async (opts) => {
    const cfg = getConfig();
    const url = opts.url ?? cfg.browser.url;

    if (url) await browser.navigate(url);
    const { buf } = await captureAndEncode({
      viewport: opts.width && opts.height ? { width: opts.width, height: opts.height, deviceScaleFactor: 1 } : undefined,
    });

    const dir = saveBaseline(opts.name, buf, {
      url,
      viewport: { width: opts.width ?? cfg.viewport.width, height: opts.height ?? cfg.viewport.height, deviceScaleFactor: 1 },
      model: cfg.vlm.model,
    });

    console.log(JSON.stringify({ saved: opts.name, path: dir }, null, 2));
    await browser.close();
  });

baseline
  .command("compare")
  .description("Compare current page against a saved baseline (AI-powered visual diff)")
  .requiredOption("--name <name>", "Baseline name to compare against")
  .option("--url <url>", "Target URL")
  .option("--model <model>", "VLM model override")
  .option("--width <px>", "Viewport width", parseInt)
  .option("--height <px>", "Viewport height", parseInt)
  .action(async (opts) => {
    const cfg = getConfig();
    const provider = getProvider(cfg.vlm.provider);

    const baselineEntry = loadBaseline(opts.name);
    if (!baselineEntry) {
      console.error(`Baseline "${opts.name}" not found. Use \`spark-e2e baseline list\` to see available baselines.`);
      process.exit(1);
    }

    const url = opts.url ?? baselineEntry.meta.url;
    if (url) await browser.navigate(url);

    // Use same viewport as baseline or override from CLI
    const vpWidth = opts.width ?? baselineEntry.meta.viewport.width;
    const vpHeight = opts.height ?? baselineEntry.meta.viewport.height;

    const { buf: currentPngBuf } = await captureAndEncode({
      viewport: { width: vpWidth, height: vpHeight, deviceScaleFactor: 1 },
    });

    const baselinePng = readBaselineScreenshot(opts.name);
    if (!baselinePng) {
      console.error(`Baseline "${opts.name}" screenshot missing. Re-save it.`);
      process.exit(1);
    }

    const baselineDataUrl = "data:image/png;base64," + baselinePng.toString("base64");
    const currentDataUrl = "data:image/png;base64," + currentPngBuf.toString("base64");

    console.error(`Comparing against baseline "${opts.name}" (${baselineEntry.meta.timestamp}) ...`);

    const prompt = getBaselineComparePrompt(opts.name);
    const raw = await provider.chat(prompt, [baselineDataUrl, currentDataUrl], opts.model, cfg.vlm.thinkingBudget);

    try {
      const result = extractJson(raw);
      console.log(JSON.stringify(result, null, 2));
    } catch {
      console.log(raw);
    }
    await browser.close();
  });

baseline
  .command("list")
  .description("List all saved baselines")
  .action(() => {
    const baselines = listBaselines();
    if (baselines.length === 0) {
      console.log("No baselines saved yet. Use `spark-e2e baseline save --name <name>` to create one.");
      return;
    }
    console.log(JSON.stringify(
      baselines.map((b) => ({
        name: b.name,
        url: b.url,
        viewport: `${b.viewport.width}x${b.viewport.height}`,
        timestamp: b.timestamp,
        model: b.model,
      })),
      null,
      2,
    ));
  });

baseline
  .command("delete")
  .description("Delete a saved baseline")
  .requiredOption("--name <name>", "Baseline name to delete")
  .action((opts) => {
    const ok = deleteBaseline(opts.name);
    if (ok) {
      console.log(`Deleted baseline "${opts.name}".`);
    } else {
      console.error(`Baseline "${opts.name}" not found.`);
      process.exit(1);
    }
  });

// ── review ───────────────────────────────────────────────

program
  .command("review")
  .description("Comprehensive visual UI audit (returns structured findings)")
  .option("--url <url>", "Target URL")
  .option("--focus <focus>", "comprehensive|layout|typography|charts|interactive", "comprehensive")
  .option("--model <model>", "VLM model override")
  .option("--output, -o <path>", "Save report to file")
  .option("--width <px>", "Viewport width", parseInt)
  .option("--height <px>", "Viewport height", parseInt)
  .option("--no-reload", "Skip reload")
  .option("--delay <s>", "Delay after reload", parseFloat, 0.3)
  .action(async (opts) => {
    const cfg = getConfig();
    const url = opts.url ?? cfg.browser.url;
    
    const provider = getProvider(cfg.vlm.provider);

    if (url) { await browser.navigate(url); }
    const { dataUrl } = await captureAndEncode({
      viewport: opts.width && opts.height ? { width: opts.width, height: opts.height, deviceScaleFactor: 1 } : undefined,
      reload: opts.reload,
      delay: opts.delay,
    });

    const focusPrompts: Record<string, string> = {
      comprehensive: "Review ALL aspects: layout, alignment, spacing, color consistency, typography, text truncation, visual artifacts.",
      layout: "Focus on layout: card heights, grid alignment, spacing, uneven gaps, overlapping content.",
      typography: "Focus on typography: text truncation, contrast, font inconsistencies, overlapping text, cut-off labels.",
      charts: "Focus on charts: gauge arc colors, donut label clipping, axis/legend artifacts, label positioning.",
      interactive: "Focus on interactive: button states, hover feedback, menu highlighting, tooltip visibility.",
    };

    const aesthetics = getAesthetics();
    const prompt = [
      "You are a senior UI quality reviewer. Do a thorough visual audit.",
      `FOCUS: ${focusPrompts[opts.focus] ?? focusPrompts.comprehensive}`,
      "",
      "For each issue: describe what's wrong, why it matters, how severe.",
      getReviewPrompt(cfg.prompts.strictness),
      getAestheticsPrompt(aesthetics),
      "",
      'Respond ONLY with JSON: {"findings": [{"description":"...","location":"...","severity":"critical|major|minor","category":"layout|typography|color|spacing|rendering"}], "summary":"...", "no_issues_found":false}',
    ].join("\n");

    console.log(`Reviewing (focus=${opts.focus}) ...`);
    const raw = await provider.chat(prompt, dataUrl, opts.model, cfg.vlm.thinkingBudget);
    try {
      const result = extractJson(raw);
      const output = JSON.stringify(result, null, 2);
      console.log(output);
      if (opts.output) { writeFileSync(opts.output, output, "utf-8"); console.log(`Saved to ${opts.output}`); }
    } catch {
      console.log(raw);
    }
    await browser.close();
  });

// ── dom-verify ───────────────────────────────────────────

program
  .command("dom-verify")
  .description("Batch DOM structure + CSS token discovery")
  .option("--url <url>", "Target URL (navigate first)")
  .option("--width <px>", "Viewport width", parseInt)
  .option("--height <px>", "Viewport height", parseInt)
  .action(async (opts) => {
    const cfg = getConfig();
    

    if (opts.url) {
      if (opts.width && opts.height) {
        await browser.captureScreenshot({
          viewport: { width: opts.width, height: opts.height, deviceScaleFactor: 1 },
          reload: false,
        });
      }
      await browser.navigate(opts.url);
    }

    const cssVarList = cfg.cssVariables.length > 0
      ? cfg.cssVariables
      : ["--color-accent", "--color-text", "--color-text-secondary", "--color-text-muted",
         "--color-border", "--color-primary", "--color-positive", "--color-negative", "--color-warning"];

    const jsCode = `(function() {
  var root = document.getElementById('root') || document.querySelector('#app, [class*="app"]');
  var main = root ? root.firstElementChild : null;
  var layout = Array.from(main ? main.children : document.body.children).map(function(c) {
    var r = c.getBoundingClientRect();
    return {tag: c.tagName, classes: (c.className||'').slice(0,60), role: c.getAttribute('role')||'', top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), text: (c.textContent||'').trim().slice(0,40)};
  });
  var classPrefixes = new Set();
  var all = Array.from(document.querySelectorAll('[class]'));
  for (var i = 0; i < Math.min(200, all.length); i++) {
    var names = all[i].className.split(/\\\\s+/);
    for (var j = 0; j < names.length; j++) {
      if (names[j] && !names[j].startsWith('_')) classPrefixes.add(names[j].split('__')[0].split('--')[0]);
    }
  }
  var rootStyle = getComputedStyle(document.documentElement);
  var cssVars = {};
  ${JSON.stringify(cssVarList)}.forEach(function(v) {
    var val = rootStyle.getPropertyValue(v).trim();
    if (val) cssVars[v] = val;
  });
  return {layout: layout, classPrefixes: Array.from(classPrefixes).sort().slice(0,30), cssVars: cssVars};
})()`;

    const result = await browser.executeJs(jsCode);
    console.log(JSON.stringify(result, null, 2));
    await browser.close();
  });

// ── doctor ───────────────────────────────────────────────

program
  .command("doctor")
  .description("Diagnose the environment")
  .option("--quick", "Skip connectivity tests")
  .action(async (opts) => {
    const cfg = getConfig();
    console.log("spark-e2e doctor — Environment Diagnostic");
    console.log("=".repeat(50));

    const nodeVer = process.versions.node;
    const [major] = nodeVer.split(".").map(Number);
    console.log(`${major >= 18 ? "✓" : "✗"} Node.js ${nodeVer}${major >= 18 ? "" : " (need ≥18)"}`);

    console.log();
    console.log("─ Configuration ─");
    const cfgPath = findConfigFile();
    if (cfgPath) {
      console.log(`✓ Config file: ${cfgPath}`);
    } else {
      console.log("⚠ No config file found (create .spark-e2e.yaml or set SPARK_E2E_CONFIG)");
    }

    try {
      const cfg = load();
      console.log(`  Browser: Playwright`);
      console.log(`  URL: ${cfg.browser.url}`);
      console.log(`  VLM provider: ${cfg.vlm.provider}`);
      console.log(`  VLM model: ${cfg.vlm.model}`);
      console.log(`  API key: ${cfg.vlm.apiKey ? "***" : "(not set)"}`);
    } catch (e) {
      console.log(`✗ Config error: ${e}`);
    }

    console.log();
    console.log("─ Browser ─");
    console.log("  Backend: Playwright");
    try {
      const r = spawnSync("npx", ["playwright", "--version"], { encoding: "utf-8", timeout: 10000 });
      console.log(r.status === 0 ? `  ✓ ${(r.stdout ?? "").trim()}` : "  ✗ playwright not found");
    } catch { console.log("  ✗ playwright check failed"); }

    console.log();
    if (!opts.quick) {
      console.log("─ VLM ─");
      console.log(cfg.vlm.apiKey ? "✓ API key set" : "⚠ Set SPARK_E2E_API_KEY to enable VLM");
    }
    console.log();
    console.log("Done.");
  });

// ── Parse ────────────────────────────────────────────────

// Only auto-parse when executed directly, not when imported by tests
if (!process.env.VITEST) {
  program.parse();
}

export { program };

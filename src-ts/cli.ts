#!/usr/bin/env node
/**
 * spark-e2e CLI — VLM-powered visual E2E testing.
 *
 * Run it directly — no MCP server needed.
 *
 * Commands:
 *   init         Copy skills to .claude/skills/
 *   navigate     Load a URL in the browser
 *   snapshot     Capture a browser screenshot
 *   inspect      Free-form VLM screenshot analysis
 *   assert       Run a visual assertion (pass/fail)
 *   compare      Compare page against expected state
 *   review       Comprehensive visual UI audit
 *   dom-verify   Batch DOM structure + CSS discovery
 *   doctor       Diagnose the environment
 */
import { Command } from "commander";
import { writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync, cpSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
import { spawnSync } from "node:child_process";

// Register built-in backends and providers
import { registerBackend } from "./browser/index.js";
import { BrowserHarnessBackend } from "./browser/browser-harness.js";
import { toDataUrl } from "./browser/browser-harness.js";
import { registerProvider } from "./vlm/index.js";
import { OpenAICompatProvider, extractJson } from "./vlm/openai-compat.js";
registerBackend("browser-harness", BrowserHarnessBackend);
registerProvider("openai-compat", OpenAICompatProvider);

import { getConfig, load, findConfigFile } from "./config.js";
import { getBackend, listBackends } from "./browser/index.js";
import { getProvider } from "./vlm/index.js";
import { getReviewPrompt, getAssertPrompt } from "./prompts.js";

const program = new Command();

// ── Helpers ─────────────────────────────────────────────

async function captureAndEncode(opts?: {
  viewport?: { width: number; height: number; deviceScaleFactor?: number };
  reload?: boolean;
  delay?: number;
}): Promise<{ dataUrl: string; png: Buffer }> {
  const backend = getBackend(getConfig().browser.backend);
  const png = await backend.captureScreenshot(opts);
  const buf = Buffer.isBuffer(png) ? png : Buffer.from(png as ArrayBuffer);
  return { dataUrl: toDataUrl(buf), png: buf };
}

// ── init ─────────────────────────────────────────────────

program
  .command("init")
  .description("Copy spark-e2e skills to .claude/skills/")
  .option("--dir <path>", "Target directory", ".claude/skills")
  .action(async (opts) => {
    const target = resolve(opts.dir);
    mkdirSync(target, { recursive: true });

    let skillsSrc: string | null = null;
    const candidates = [
      resolve(__dirname, "..", "skills"),
      resolve(process.cwd(), "skills"),
    ];
    for (const c of candidates) {
      if (existsSync(c) && statSync(c).isDirectory()) { skillsSrc = c; break; }
    }

    if (!skillsSrc) {
      console.error("ERROR: Cannot find spark-e2e skills source.");
      console.error("Clone the repo or run from the project root.");
      process.exit(1);
    }

    console.log(`spark-e2e init — Installing skills from ${skillsSrc}`);
    console.log(`Target: ${target}`);
    console.log();

    let count = 0;
    for (const entry of readdirSync(skillsSrc).sort()) {
      const entryPath = join(skillsSrc, entry);
      if (statSync(entryPath).isDirectory() && existsSync(join(entryPath, "SKILL.md"))) {
        const dest = join(target, entry);
        rmSync(dest, { recursive: true, force: true });
        cpSync(entryPath, dest, { recursive: true });
        console.log(`  ✓ ${entry}`);
        count++;
      }
    }

    console.log();
    console.log(`Installed ${count} skills. Run in Claude Code: /${readdirSync(skillsSrc).filter(e => statSync(join(skillsSrc, e)).isDirectory() && existsSync(join(skillsSrc, e, "SKILL.md"))).join(", /")}`);
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
    const backend = getBackend(cfg.browser.backend);
    if (opts.width && opts.height) {
      await backend.captureScreenshot({
        viewport: { width: opts.width, height: opts.height, deviceScaleFactor: 1 },
        reload: false,
      });
    }
    await backend.navigate(targetUrl);
    const info = await backend.getPageInfo();
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
  .action(async (opts) => {
    const cfg = getConfig();
    const url = opts.url ?? cfg.browser.url;
    const backend = getBackend(cfg.browser.backend);
    console.log(`Navigating to ${url} ...`);
    await backend.navigate(url);

    const viewport = opts.width && opts.height
      ? { width: opts.width, height: opts.height, deviceScaleFactor: 1 }
      : undefined;

    const png = await backend.captureScreenshot({ viewport, reload: opts.reload, delay: opts.delay });
    const buf = Buffer.isBuffer(png) ? png : Buffer.from(png as ArrayBuffer);
    writeFileSync(opts.output, buf);
    console.log(`Saved ${opts.output} (${buf.length} bytes)`);
    await backend.close();
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
    const backend = getBackend(cfg.browser.backend);
    const provider = getProvider(cfg.vlm.provider);

    if (url) { await backend.navigate(url); }
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

    const raw = await provider.chat(prompt, dataUrl, opts.model);
    console.log(raw);
    await backend.close();
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
    const backend = getBackend(cfg.browser.backend);
    const provider = getProvider(cfg.vlm.provider);

    if (url) { await backend.navigate(url); }
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

    const raw = await provider.chat(prompt, dataUrl, opts.model);
    try {
      console.log(JSON.stringify(extractJson(raw), null, 2));
    } catch {
      console.log(raw);
    }
    await backend.close();
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
    const backend = getBackend(cfg.browser.backend);
    const provider = getProvider(cfg.vlm.provider);

    if (url) { await backend.navigate(url); }
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

    const raw = await provider.chat(prompt, dataUrl, opts.model);
    try {
      console.log(JSON.stringify(extractJson(raw), null, 2));
    } catch {
      console.log(raw);
    }
    await backend.close();
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
    const backend = getBackend(cfg.browser.backend);
    const provider = getProvider(cfg.vlm.provider);

    if (url) { await backend.navigate(url); }
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

    const prompt = [
      "You are a senior UI quality reviewer. Do a thorough visual audit.",
      `FOCUS: ${focusPrompts[opts.focus] ?? focusPrompts.comprehensive}`,
      "",
      "For each issue: describe what's wrong, why it matters, how severe.",
      getReviewPrompt(cfg.prompts.strictness),
      "",
      'Respond ONLY with JSON: {"findings": [{"description":"...","location":"...","severity":"critical|major|minor","category":"layout|typography|color|spacing|rendering"}], "summary":"...", "no_issues_found":false}',
    ].join("\n");

    console.log(`Reviewing (focus=${opts.focus}) ...`);
    const raw = await provider.chat(prompt, dataUrl, opts.model);
    try {
      const result = extractJson(raw);
      const output = JSON.stringify(result, null, 2);
      console.log(output);
      if (opts.output) { writeFileSync(opts.output, output, "utf-8"); console.log(`Saved to ${opts.output}`); }
    } catch {
      console.log(raw);
    }
    await backend.close();
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
    const backend = getBackend(cfg.browser.backend);

    if (opts.url) {
      if (opts.width && opts.height) {
        await backend.captureScreenshot({
          viewport: { width: opts.width, height: opts.height, deviceScaleFactor: 1 },
          reload: false,
        });
      }
      await backend.navigate(opts.url);
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

    const result = await backend.executeJs(jsCode);
    console.log(JSON.stringify(result, null, 2));
    await backend.close();
  });

// ── doctor ───────────────────────────────────────────────

program
  .command("doctor")
  .description("Diagnose the environment")
  .option("--quick", "Skip connectivity tests")
  .action(async (opts) => {
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
      console.log(`  Backend: ${cfg.browser.backend}`);
      console.log(`  URL: ${cfg.browser.url}`);
      console.log(`  VLM provider: ${cfg.vlm.provider}`);
      console.log(`  VLM model: ${cfg.vlm.model}`);
      console.log(`  API key: ${cfg.vlm.apiKey ? "***" : "(not set)"}`);
    } catch (e) {
      console.log(`✗ Config error: ${e}`);
    }

    console.log();
    console.log("─ Browser ─");
    const backends = listBackends();
    console.log(`Available: ${backends.join(", ") || "(none)"}`);

    if (backends.includes("browser-harness")) {
      const r = spawnSync("browser-harness", ["--version"], { encoding: "utf-8", timeout: 5000 });
      console.log(r.status === 0 ? `✓ browser-harness: ${(r.stdout ?? "").trim()}` : "✗ browser-harness not found");
    }

    console.log();
    if (!opts.quick) {
      console.log("─ VLM ─");
      const cfg = getConfig();
      console.log(cfg.vlm.apiKey ? "✓ API key set" : "⚠ Set SPARK_E2E_API_KEY to enable VLM");
    }
    console.log();
    console.log("Done.");
  });

// ── Parse ────────────────────────────────────────────────

program.parse();

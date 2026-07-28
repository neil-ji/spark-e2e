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
}

const AGENTS: Agent[] = [
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
];
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
  .description("Set up spark-e2e skills for AI coding agents")
  .option("--agent <name>", "Target a specific agent: claude, codex, qoder, trae")
  .option("--all", "Install for all supported agents")
  .option("--scope <scope>", "Install scope: project (default) or user", "project")
  .option("--dir <path>", "Custom target directory (overrides agent detection)")
  .option("--api-key <key>", "VLM API key (saved to ~/.spark-e2e/.env)")
  .option("--base-url <url>", "VLM base URL (saved to ~/.spark-e2e/.env)")
  .action(async (opts) => {
    const cwd = process.cwd();
    const home = homedir();
    const isUser = opts.scope === "user";

    // ── Find skills source ──
    let skillsSrc: string | null = null;
    for (const c of [resolve(__dirname, "..", "skills"), resolve(cwd, "skills")]) {
      if (existsSync(c) && statSync(c).isDirectory()) { skillsSrc = c; break; }
    }
    if (!skillsSrc) {
      console.error("ERROR: Cannot find spark-e2e skills source. Install: npm install -g spark-e2e");
      process.exit(1);
    }

    // ── Which agents to install for ──
    const targets: { label: string; dir: string }[] = [];

    if (opts.dir) {
      targets.push({ label: "custom", dir: resolve(opts.dir) });
    } else if (opts.all) {
      for (const a of AGENTS) {
        const base = isUser ? resolve(home, a.userDir) : resolve(cwd, a.projectDir);
        targets.push({ label: a.label, dir: base });
      }
    } else if (opts.agent) {
      const a = AGENTS.find(x => x.name === opts.agent);
      if (!a) {
        console.error(`Unknown agent: ${opts.agent}. Supported: ${AGENTS.map(x => x.name).join(", ")}`);
        process.exit(1);
      }
      const base = isUser ? resolve(home, a.userDir) : resolve(cwd, a.projectDir);
      targets.push({ label: a.label, dir: base });
    } else {
      // Auto-detect: check which agent dirs exist in the project
      const detected = AGENTS.filter(a =>
        a.detectDirs.some(d => existsSync(resolve(cwd, d)))
      );
      if (detected.length > 0) {
        for (const a of detected) {
          const base = isUser ? resolve(home, a.userDir) : resolve(cwd, a.projectDir);
          targets.push({ label: a.label, dir: base });
        }
      } else {
        // Default: Claude Code
        targets.push({
          label: "Claude Code (default)",
          dir: resolve(isUser ? home : cwd, ".claude/skills"),
        });
      }
    }

    // ── Collect skill names ──
    const skillNames = readdirSync(skillsSrc)
      .filter(e => statSync(join(skillsSrc, e)).isDirectory() && existsSync(join(skillsSrc, e, "SKILL.md")))
      .sort();

    if (skillNames.length === 0) {
      console.error("No skills found in source directory.");
      process.exit(1);
    }

    // ── Install skills ──
    console.log("spark-e2e init");
    console.log(`Source: ${skillsSrc}`);
    if (isUser) console.log("Scope: user (installing to home directory)");

    for (const { label, dir } of targets) {
      console.log(`── ${label} ──`);
      console.log(`   ${dir}/`);
      mkdirSync(dir, { recursive: true });

      for (const name of skillNames) {
        const src = join(skillsSrc, name);
        const dest = join(dir, name);
        rmSync(dest, { recursive: true, force: true });
        cpSync(src, dest, { recursive: true });
        console.log(`   ✓ ${name}`);
      }
      console.log();
    }

    // ── VLM config (global ~/.spark-e2e/.env) ──
    if (opts.apiKey || opts.baseUrl) {
      const globalDir = resolve(home, ".spark-e2e");
      mkdirSync(globalDir, { recursive: true });
      const envPath = resolve(globalDir, ".env");
      let existing = "";
      if (existsSync(envPath)) existing = readFileSync(envPath, "utf-8");

      const lines: string[] = [];
      if (opts.apiKey) lines.push(`SPARK_E2E_API_KEY=${opts.apiKey}`);
      if (opts.baseUrl) lines.push(`SPARK_E2E_BASE_URL=${opts.baseUrl}`);

      if (lines.length > 0) {
        // Merge: update existing keys, keep other lines
        const toWrite = new Map<string, string>();
        for (const line of existing.split("\n")) {
          const eq = line.indexOf("=");
          if (eq > 0) toWrite.set(line.slice(0, eq).trim(), line);
        }
        for (const line of lines) {
          const eq = line.indexOf("=");
          toWrite.set(line.slice(0, eq), line);
        }
        // Add default model if not present
        if (!toWrite.has("SPARK_E2E_MODEL")) {
          toWrite.set("SPARK_E2E_MODEL", "SPARK_E2E_MODEL=gpt-4o");
        }
        writeFileSync(envPath, [...toWrite.values()].join("\n") + "\n", "utf-8");
        console.log(`── VLM Config ──`);
        console.log(`   ✓ ${envPath}`);
        if (opts.apiKey) console.log("   ✓ API key saved");
        if (opts.baseUrl) console.log("   ✓ Base URL saved");
        console.log();
      }
    }

    // ── Create config templates if missing ──
    const configPath = resolve(cwd, ".spark-e2e.yaml");
    if (!existsSync(configPath)) {
      const template = [
        "# spark-e2e configuration",
        "# See: https://github.com/neilji/spark-e2e",
        "",
        "browser:",
        "  backend: browser-harness",
        "  url: http://localhost:5173",
        "",
        "viewport:",
        "  width: 1600",
        "  height: 1200",
        "  deviceScaleFactor: 1",
        "",
        "vlm:",
        '  api_key: "${SPARK_E2E_API_KEY}"',
        '  base_url: "${SPARK_E2E_BASE_URL}"',
        "  model: gpt-4o",
        "",
        "prompts:",
        "  strictness: standard",
        "",
      ].join("\n");
      writeFileSync(configPath, template, "utf-8");
      console.log(`── Config ──`);
      console.log(`   ✓ Created .spark-e2e.yaml`);
      console.log();
    }

    const envPath = resolve(cwd, ".env.example");
    if (!existsSync(envPath) && !existsSync(resolve(cwd, ".env"))) {
      writeFileSync(envPath, [
        "# spark-e2e VLM credentials",
        "SPARK_E2E_API_KEY=your-api-key",
        "SPARK_E2E_BASE_URL=https://your-vlm/v1",
        "SPARK_E2E_MODEL=gpt-4o",
        "",
      ].join("\n"), "utf-8");
      console.log(`   ✓ Created .env.example (copy to .env and fill in your key)`);
      console.log();
    }

    // ── Summary ──
    const scopeLabel = isUser ? "globally (all projects)" : `in ${cwd}`;
    console.log(`Done. ${skillNames.length} skills installed ${scopeLabel}.`);
    console.log();
    console.log("Skills available as slash commands:");
    for (const name of skillNames) console.log(`  /${name}`);
    console.log();
    console.log("Next steps:");
    console.log("  1. Set your VLM API key: export SPARK_E2E_API_KEY=...");
    console.log("  2. Verify setup:        spark-e2e doctor");
    console.log("  3. Try a review:        spark-e2e review --url http://localhost:5173");
    console.log("  4. In your AI agent:    /ui-review http://localhost:5173");
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

// ── scroll ────────────────────────────────────────────────

program
  .command("scroll")
  .description("Scroll the page (handles lazy-loaded content)")
  .option("--x <px>", "Horizontal scroll position", parseInt)
  .option("--y <px>", "Vertical scroll position", parseInt)
  .option("--selector <css>", "CSS selector to scroll into view")
  .action(async (opts) => {
    const cfg = getConfig();
    const backend = getBackend(cfg.browser.backend);
    const info = await backend.scroll({ x: opts.x, y: opts.y, selector: opts.selector });
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
    const backend = getBackend(cfg.browser.backend);
    console.log(`Navigating to ${url} ...`);
    await backend.navigate(url);

    const viewport = opts.width && opts.height
      ? { width: opts.width, height: opts.height, deviceScaleFactor: 1 }
      : undefined;

    const png = await backend.captureScreenshot({
      viewport, reload: opts.reload, delay: opts.delay, fullPage: opts.fullPage ?? false,
    });
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

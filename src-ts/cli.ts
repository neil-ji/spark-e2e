#!/usr/bin/env node
/**
 * spark-e2e CLI — VLM-powered visual E2E testing.
 *
 * Native Node.js implementation. No Python required.
 *
 * Commands:
 *   serve      Start the MCP server
 *   init       Copy skills to .claude/skills/
 *   doctor     Diagnose the environment
 *   snapshot   Capture a browser screenshot
 *   assert     Run a visual assertion
 *   review     Run a comprehensive visual review
 */
import { Command } from "commander";
import { readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig, load, findConfigFile } from "./config.js";
import { getBackend, listBackends } from "./browser/index.js";
import { toDataUrl } from "./browser/browser-harness.js";
import { getProvider } from "./vlm/index.js";
import { extractJson } from "./vlm/openai-compat.js";
import { getReviewPrompt, getAssertPrompt } from "./prompts.js";
import { spawnSync } from "node:child_process";

// Register built-in backends and providers
import { registerBackend } from "./browser/index.js";
import { BrowserHarnessBackend } from "./browser/browser-harness.js";
import { registerProvider } from "./vlm/index.js";
import { OpenAICompatProvider } from "./vlm/openai-compat.js";
registerBackend("browser-harness", BrowserHarnessBackend);
registerProvider("openai-compat", OpenAICompatProvider);

const __dirname = dirname(fileURLToPath(import.meta.url));
const program = new Command();

// ── serve ───────────────────────────────────────────────

program
  .command("serve")
  .description("Start the MCP server (for Claude Code integration)")
  .action(async () => {
    const { main } = await import("./server.js");
    await main();
  });

// ── init ─────────────────────────────────────────────────

program
  .command("init")
  .description("Copy spark-e2e skills to .claude/skills/")
  .option("--dir <path>", "Target directory", ".claude/skills")
  .action(async (opts) => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const target = path.resolve(opts.dir);
    fs.mkdirSync(target, { recursive: true });

    // Find skills source
    let skillsSrc: string | null = null;
    const candidates = [
      // Repo layout: skills/ next to src-ts/
      path.resolve(__dirname, "..", "skills"),
      // CWD
      path.resolve(process.cwd(), "skills"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) {
        skillsSrc = c;
        break;
      }
    }

    if (!skillsSrc) {
      console.error("ERROR: Cannot find spark-e2e skills source.");
      console.error("Clone the repo or run from the project root.");
      console.error("Or use the plugin marketplace:");
      console.error("  /plugin marketplace add neilji/spark-e2e");
      console.error("  /plugin install spark-e2e-skills@spark-e2e");
      process.exit(1);
    }

    console.log(`spark-e2e init — Installing skills from ${skillsSrc}`);
    console.log(`Target: ${target}`);
    console.log();

    let count = 0;
    for (const entry of fs.readdirSync(skillsSrc).sort()) {
      const entryPath = path.join(skillsSrc, entry);
      if (
        fs.statSync(entryPath).isDirectory() &&
        fs.existsSync(path.join(entryPath, "SKILL.md"))
      ) {
        const dest = path.join(target, entry);
        fs.rmSync(dest, { recursive: true, force: true });
        fs.cpSync(entryPath, dest, { recursive: true });
        console.log(`  ✓ ${entry}`);
        count++;
      }
    }

    console.log();
    console.log(`Installed ${count} skills to ${target}`);
    console.log();
    if (count > 0) {
      console.log("Skills are now available in Claude Code:");
      for (const entry of fs.readdirSync(skillsSrc).sort()) {
        const entryPath = path.join(skillsSrc, entry);
        if (
          fs.statSync(entryPath).isDirectory() &&
          fs.existsSync(path.join(entryPath, "SKILL.md"))
        ) {
          console.log(`  /${entry}`);
        }
      }
      console.log();
      console.log("You can also install via the plugin marketplace:");
      console.log("  /plugin marketplace add neilji/spark-e2e");
      console.log("  /plugin install spark-e2e-skills@spark-e2e");
    }
  });

// ── doctor ───────────────────────────────────────────────

program
  .command("doctor")
  .description("Diagnose the environment")
  .option("--quick", "Skip connectivity tests")
  .action(async (opts) => {
    console.log("spark-e2e doctor — Environment Diagnostic");
    console.log("=".repeat(50));

    // 1. Node.js version
    const nodeVer = process.versions.node;
    const [major] = nodeVer.split(".").map(Number);
    console.log(`${major >= 18 ? "✓" : "✗"} Node.js ${nodeVer}${major >= 18 ? "" : " (need ≥18)"}`);

    // 2. Config
    console.log();
    console.log("─ Configuration ─");
    const cfgPath = findConfigFile();
    if (cfgPath) {
      console.log(`✓ Config file: ${cfgPath}`);
    } else {
      console.log("⚠ No config file found (set SPARK_E2E_CONFIG or create .spark-e2e.yaml)");
    }

    try {
      const cfg = load();
      console.log(`  Backend: ${cfg.browser.backend}`);
      console.log(`  URL: ${cfg.browser.url}`);
      console.log(`  VLM provider: ${cfg.vlm.provider}`);
      console.log(`  VLM model: ${cfg.vlm.model}`);
      const hasKey = !!cfg.vlm.apiKey;
      console.log(`  API key: ${hasKey ? "***" : "(not set)"}`);
    } catch (e) {
      console.log(`✗ Config error: ${e}`);
    }

    // 3. Browser backend
    console.log();
    console.log("─ Browser Backend ─");
    const backends = listBackends();
    console.log(`Available: ${backends.join(", ")}`);

    if (backends.includes("browser-harness")) {
      const result = spawnSync("browser-harness", ["--version"], { encoding: "utf-8", timeout: 5000 });
      if (result.status === 0) {
        console.log(`✓ browser-harness: ${(result.stdout ?? "").trim()}`);
      } else {
        console.log("✗ browser-harness not on PATH (install: brew install browser-use/tap/browser-harness)");
      }
    }

    if (backends.includes("playwright")) {
      console.log("✓ Playwright backend available");
    }

    // 4. VLM connectivity
    console.log();
    if (!opts.quick) {
      console.log("─ VLM Connectivity ─");
      const cfg = getConfig();
      if (cfg.vlm.apiKey) {
        console.log("✓ API key set. Use --quick to skip connectivity test.");
      } else {
        console.log("⚠ Set SPARK_E2E_API_KEY to enable VLM features");
      }
    }
    console.log();
    console.log("Done.");
  });

// ── snapshot ─────────────────────────────────────────────

program
  .command("snapshot")
  .description("Capture a browser screenshot")
  .option("--url <url>", "Target URL")
  .option("--output, -o <path>", "Output file path", "/tmp/spark-e2e-snapshot.png")
  .option("--width <px>", "Viewport width", parseInt)
  .option("--height <px>", "Viewport height", parseInt)
  .option("--no-reload", "Don't reload before capture")
  .option("--delay <s>", "Delay after reload (seconds)", parseFloat, 0.3)
  .action(async (opts) => {
    const cfg = getConfig();
    const url = opts.url ?? cfg.browser.url;
    const backend = getBackend(cfg.browser.backend);

    console.log(`Navigating to ${url} ...`);
    await backend.navigate(url);

    const viewport =
      opts.width && opts.height
        ? { width: opts.width, height: opts.height, deviceScaleFactor: 1 }
        : undefined;

    console.log("Capturing screenshot ...");
    const png = await backend.captureScreenshot({
      viewport,
      reload: opts.reload,
      delay: opts.delay,
    });

    const output = opts.output;
    const buf = Buffer.isBuffer(png) ? png : Buffer.from(png as ArrayBuffer);
    writeFileSync(output, buf);
    console.log(`Saved ${output} (${buf.length} bytes)`);
    await backend.close();
  });

// ── assert ───────────────────────────────────────────────

program
  .command("assert")
  .description("Run a visual assertion")
  .argument("<assertion>", "The assertion to verify")
  .option("--url <url>", "Target URL")
  .option("--model <model>", "VLM model override")
  .option("--width <px>", "Viewport width", parseInt)
  .option("--height <px>", "Viewport height", parseInt)
  .option("--no-reload", "Don't reload before capture")
  .option("--delay <s>", "Delay after reload", parseFloat, 0.3)
  .action(async (assertion, opts) => {
    const cfg = getConfig();
    const url = opts.url ?? cfg.browser.url;
    const backend = getBackend(cfg.browser.backend);
    const provider = getProvider(cfg.vlm.provider);

    console.log(`Navigating to ${url} ...`);
    await backend.navigate(url);

    const viewport =
      opts.width && opts.height
        ? { width: opts.width, height: opts.height, deviceScaleFactor: 1 }
        : undefined;

    const png = await backend.captureScreenshot({
      viewport,
      reload: opts.reload,
      delay: opts.delay,
    });
    const dataUrl = toDataUrl(Buffer.isBuffer(png) ? png : Buffer.from(png as ArrayBuffer));

    const prompt = [
      "You are a visual E2E test verifier. Determine whether this assertion is TRUE or FALSE.",
      "",
      `ASSERTION: ${assertion}`,
      "",
      getAssertPrompt(cfg.prompts.strictness),
      "",
      "Respond with ONLY a JSON object:",
      '{"pass": true|false, "confidence": "high"|"medium"|"low",',
      '"observation": "...", "reasoning": "..."}',
    ].join("\n");

    console.log("VLM analyzing ...");
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
  .description("Run a comprehensive visual review")
  .option("--url <url>", "Target URL")
  .option("--focus <focus>", "Review focus: comprehensive|layout|typography|charts|interactive", "comprehensive")
  .option("--model <model>", "VLM model override")
  .option("--output, -o <path>", "Save report to file")
  .option("--width <px>", "Viewport width", parseInt)
  .option("--height <px>", "Viewport height", parseInt)
  .option("--no-reload", "Don't reload before capture")
  .option("--delay <s>", "Delay after reload", parseFloat, 0.3)
  .action(async (opts) => {
    const cfg = getConfig();
    const url = opts.url ?? cfg.browser.url;
    const backend = getBackend(cfg.browser.backend);
    const provider = getProvider(cfg.vlm.provider);

    console.log(`Navigating to ${url} ...`);
    await backend.navigate(url);

    const viewport =
      opts.width && opts.height
        ? { width: opts.width, height: opts.height, deviceScaleFactor: 1 }
        : undefined;

    const png = await backend.captureScreenshot({
      viewport,
      reload: opts.reload,
      delay: opts.delay,
    });
    const dataUrl = toDataUrl(Buffer.isBuffer(png) ? png : Buffer.from(png as ArrayBuffer));

    const focusPrompts: Record<string, string> = {
      comprehensive:
        "Review ALL aspects: layout, alignment, spacing, color consistency, typography, text truncation, visual artifacts, rendering defects.",
      layout:
        "Focus on layout: card heights, grid alignment, spacing between elements, uneven gaps, overlapping content.",
      typography:
        "Focus on typography: text truncation, contrast issues, font size inconsistencies, overlapping text, cut-off labels.",
      charts:
        "Focus on charts/data viz: gauge arc colors, donut label clipping, axis/legend artifacts, label positioning, number formatting issues.",
      interactive:
        "Focus on interactive elements: button states, hover feedback, menu highlighting, tooltip visibility.",
    };

    const prompt = [
      "You are a senior UI quality reviewer. Do a thorough visual audit.",
      `FOCUS: ${focusPrompts[opts.focus] ?? focusPrompts.comprehensive}`,
      "",
      getReviewPrompt(cfg.prompts.strictness),
      "",
      'Respond ONLY with JSON: {"findings": [...], "summary": "...", "no_issues_found": false}',
    ].join("\n");

    console.log(`Reviewing (focus=${opts.focus}) ...`);
    const raw = await provider.chat(prompt, dataUrl, opts.model);
    try {
      const result = extractJson(raw);
      const output = JSON.stringify(result, null, 2);
      console.log(output);
      if (opts.output) {
        writeFileSync(opts.output, output, "utf-8");
        console.log(`Saved to ${opts.output}`);
      }
    } catch {
      console.log(raw);
    }

    await backend.close();
  });

// ── Parse ────────────────────────────────────────────────

program.parse();

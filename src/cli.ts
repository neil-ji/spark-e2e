#!/usr/bin/env node
/**
 * spark-e2e CLI — VLM + DOM dual-engine visual audit.
 *
 * Does NOT control the browser. Playwright CLI / MCP handles that.
 * spark-e2e reviews screenshots and DOM dumps — PNG + JSON in, Findings out.
 *
 * Commands:
 *   setup        Interactive configuration wizard
 *   review       Comprehensive visual UI audit (VLM-powered)
 *   assert       Single-condition visual pass/fail check
 *   inspect      Free-form VLM screenshot analysis
 *   test         Multi-expectation visual verification
 *   baseline     Visual regression baselines (save, compare, list, delete)
 *   dom-lint     Deterministic DOM rule checks (token compliance, a11y)
 *   dom-get      Element property lookup by @ref
 *   doctor       Diagnose the environment
 *   update       Migrate config and data from older versions
 */
import { Command } from "commander";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Agent definitions ───────────────────────────────────

interface Agent {
  name: string;
  label: string;
  projectDir: string;
  userDir: string;
  detectDirs: string[];
  homeDirOnly?: boolean;
}

export const AGENTS: Agent[] = [
  { name: "claude", label: "Claude Code", projectDir: ".claude/skills", userDir: ".claude/skills", detectDirs: [".claude"] },
  { name: "codex", label: "OpenAI Codex", projectDir: ".agents/skills", userDir: ".agents/skills", detectDirs: [".agents", ".codex"] },
  { name: "qoder", label: "Qoder", projectDir: ".qoder/skills", userDir: ".qoder/skills", detectDirs: [".qoder"] },
  { name: "trae", label: "Trae", projectDir: ".trae/skills", userDir: ".trae/skills", detectDirs: [".trae", ".traecli"] },
  { name: "spark-hub", label: "Spark Hub", projectDir: ".spark/skills", userDir: ".spark/config/custom-skills", detectDirs: [".spark"] },
];

// ── VLM provider ────────────────────────────────────────

import { registerProvider } from "./vlm/index.js";
import { OpenAICompatProvider, extractJson } from "./vlm/openai-compat.js";
registerProvider("openai-compat", OpenAICompatProvider);

// ── Config & engine ─────────────────────────────────────

import { getConfig, load, findConfigFile, getAesthetics, loadAesthetics } from "./config.js";
import { getProvider } from "./vlm/index.js";
import { review as engineReview, domLint, domGet } from "./engine/index.js";
import {
  buildLightReviewPrompt,
  buildAssertPrompt,
  buildBaselineComparePrompt,
} from "./engine/prompts/index.js";
import { saveBaseline, loadBaseline, listBaselines, deleteBaseline, readBaselineScreenshot } from "./baselines.js";

const program = new Command();

// ── setup ─────────────────────────────────────────────────

program
  .command("setup")
  .description("Interactive setup wizard — configure VLM and install skills")
  .option("--dir <path>", "Project directory (default: current directory)")
  .option("--yes", "Skip prompts, use defaults for everything")
  .option("--api-key <key>", "VLM API key (⚠️ WARNING: may leak to shell history. Use '-' to read from stdin, or omit for interactive hidden input)")
  .option("--base-url <url>", "VLM base URL (for --yes mode)")
  .action(async (opts) => {
    let apiKey = opts.apiKey;
    if (apiKey === "-") {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      apiKey = Buffer.concat(chunks).toString("utf-8").trim();
    }
    const { setupCommand } = await import("./setup.js");
    await setupCommand({ dir: opts.dir, yes: opts.yes, apiKey, baseUrl: opts.baseUrl });
  });

// ── review ───────────────────────────────────────────────

program
  .command("review")
  .description("Comprehensive visual UI audit — PNG in, findings out")
  .requiredOption("--screenshot <path>", "Path to PNG screenshot")
  .option("--dom <path>", "Path to DOM dump JSON for cross-validation")
  .option("--focus <focus>", "comprehensive|layout|typography|color|spacing|charts|interactive", "comprehensive")
  .option("--mode <mode>", "light (single pass) | strict (per-dimension parallel)", "light")
  .option("--model <model>", "VLM model override")
  .option("--output, -o <path>", "Save report to file")
  .action(async (opts) => {
    const cfg = getConfig();
    const provider = getProvider(cfg.vlm.provider);
    const aesthetics = getAesthetics();

    const screenshotBuf = readFileSync(resolve(opts.screenshot));
    const domDump = opts.dom ? JSON.parse(readFileSync(resolve(opts.dom), "utf-8")) : undefined;

    console.error(`Reviewing screenshot (focus=${opts.focus}, mode=${opts.mode}) ...`);

    const result = await engineReview(provider, {
      screenshot: screenshotBuf,
      dom: domDump,
      aesthetics,
      focus: opts.focus,
      mode: opts.mode,
      model: opts.model,
      thinkingBudget: cfg.vlm.thinkingBudget,
    });

    const output = JSON.stringify(result, null, 2);
    console.log(output);
    if (opts.output) { writeFileSync(opts.output, output, "utf-8"); console.error(`Saved to ${opts.output}`); }
  });

// ── assert ───────────────────────────────────────────────

program
  .command("assert")
  .description("Single-condition visual pass/fail check")
  .argument("<assertion>", "The assertion to verify")
  .requiredOption("--screenshot <path>", "Path to PNG screenshot")
  .option("--model <model>", "VLM model override")
  .action(async (assertion, opts) => {
    const cfg = getConfig();
    const provider = getProvider(cfg.vlm.provider);
    const screenshotBuf = readFileSync(resolve(opts.screenshot));
    const dataUrl = "data:image/png;base64," + screenshotBuf.toString("base64");

    const prompt = buildAssertPrompt(assertion, cfg.prompts.strictness);
    const raw = await provider.chat(prompt, dataUrl, opts.model, cfg.vlm.thinkingBudget);
    try {
      console.log(JSON.stringify(extractJson(raw), null, 2));
    } catch {
      console.log(raw);
    }
  });

// ── inspect ──────────────────────────────────────────────

program
  .command("inspect")
  .description("Free-form VLM screenshot analysis")
  .argument("<instruction>", "What to look for")
  .requiredOption("--screenshot <path>", "Path to PNG screenshot")
  .option("--model <model>", "VLM model override")
  .action(async (instruction, opts) => {
    const cfg = getConfig();
    const provider = getProvider(cfg.vlm.provider);
    const screenshotBuf = readFileSync(resolve(opts.screenshot));
    const dataUrl = "data:image/png;base64," + screenshotBuf.toString("base64");

    const prompt = [
      "You are a visual inspection tool for automated E2E testing.",
      "Analyze this webpage screenshot carefully and thoroughly.",
      "",
      `INSTRUCTION: ${instruction}`,
      "",
      "Be specific and precise. If you cannot determine something confidently, say so.",
    ].join("\n");

    const raw = await provider.chat(prompt, dataUrl, opts.model, cfg.vlm.thinkingBudget);
    console.log(raw);
  });

// ── test ─────────────────────────────────────────────────

program
  .command("test")
  .description("Multi-expectation visual verification")
  .argument("<expectations>", "What you expect to see (natural language)")
  .requiredOption("--screenshot <path>", "Path to PNG screenshot")
  .option("--model <model>", "VLM model override")
  .action(async (expectations, opts) => {
    const cfg = getConfig();
    const provider = getProvider(cfg.vlm.provider);
    const screenshotBuf = readFileSync(resolve(opts.screenshot));
    const dataUrl = "data:image/png;base64," + screenshotBuf.toString("base64");

    console.error(`Testing: ${expectations.slice(0, 80)}${expectations.length > 80 ? "..." : ""}`);

    const prompt = [
      "You are a visual E2E test runner. A user has described what they expect to see on a page.",
      "Your job: check EVERY expectation against the screenshot and report pass/fail for each.",
      "",
      "RULES:",
      "- Each expectation is a separate check. Report pass/fail independently per expectation.",
      "- Only report what you ACTUALLY SEE. If an element is not visible, say so — don't guess.",
      "- For text content: quote EXACT text you see. If text is cut off, report the visible portion.",
      "- Structural checks (layout, alignment, sizing, visibility) are more reliable than exact color/value checks.",
      "- If a check is about dynamic data (numbers, timestamps, user names), be lenient —",
      "  only fail if the STRUCTURE is broken (missing label, truncated text), not if the value changed.",
      "- If you genuinely cannot determine pass/fail, set confidence to 'low' and explain why.",
      "- Be specific in your reasoning: mention WHERE on the page you looked and WHAT you observed.",
      "",
      `EXPECTATIONS TO VERIFY:\n${expectations}`,
      "",
      'Respond ONLY with JSON: {"pass": true|false, "confidence": "high"|"medium"|"low", "checks": [{"expectation": "...", "pass": true|false, "confidence": "high"|"medium"|"low", "observation": "...", "reasoning": "..."}], "summary": "..."}',
    ].join("\n");

    const raw = await provider.chat(prompt, dataUrl, opts.model, cfg.vlm.thinkingBudget);
    try {
      console.log(JSON.stringify(extractJson(raw), null, 2));
    } catch {
      console.log(raw);
    }
  });

// ── baseline ──────────────────────────────────────────────

const baseline = program
  .command("baseline")
  .description("Visual regression baselines — save, compare, list, delete");

baseline
  .command("save")
  .description("Save a screenshot as a named baseline")
  .requiredOption("--name <name>", "Baseline name (e.g. 'dashboard-v1')")
  .requiredOption("--screenshot <path>", "Path to PNG screenshot")
  .option("--url <url>", "Page URL for metadata")
  .option("--width <px>", "Viewport width", parseInt)
  .option("--height <px>", "Viewport height", parseInt)
  .action((opts) => {
    const cfg = getConfig();
    const buf = readFileSync(resolve(opts.screenshot));

    const dir = saveBaseline(opts.name, buf, {
      url: opts.url ?? "",
      viewport: {
        width: opts.width ?? cfg.viewport.width,
        height: opts.height ?? cfg.viewport.height,
        deviceScaleFactor: 1,
      },
      model: cfg.vlm.model,
    });

    console.log(JSON.stringify({ saved: opts.name, path: dir }, null, 2));
  });

baseline
  .command("compare")
  .description("Compare a screenshot against a saved baseline (AI-powered visual diff)")
  .requiredOption("--name <name>", "Baseline name to compare against")
  .requiredOption("--screenshot <path>", "Path to current PNG screenshot")
  .option("--model <model>", "VLM model override")
  .action(async (opts) => {
    const cfg = getConfig();
    const provider = getProvider(cfg.vlm.provider);

    const baselineEntry = loadBaseline(opts.name);
    if (!baselineEntry) {
      console.error(`Baseline "${opts.name}" not found. Use \`spark-e2e baseline list\` to see available baselines.`);
      process.exit(1);
    }

    const baselinePng = readBaselineScreenshot(opts.name);
    if (!baselinePng) {
      console.error(`Baseline "${opts.name}" screenshot missing. Re-save it.`);
      process.exit(1);
    }

    const currentPng = readFileSync(resolve(opts.screenshot));
    const baselineDataUrl = "data:image/png;base64," + baselinePng.toString("base64");
    const currentDataUrl = "data:image/png;base64," + currentPng.toString("base64");

    console.error(`Comparing against baseline "${opts.name}" (${baselineEntry.meta.timestamp}) ...`);

    const prompt = buildBaselineComparePrompt(opts.name);
    const raw = await provider.chat(prompt, [baselineDataUrl, currentDataUrl], opts.model, cfg.vlm.thinkingBudget);

    try {
      console.log(JSON.stringify(extractJson(raw), null, 2));
    } catch {
      console.log(raw);
    }
  });

baseline
  .command("list")
  .description("List all saved baselines")
  .action(() => {
    const baselines = listBaselines();
    if (baselines.length === 0) {
      console.log("No baselines saved yet. Use `spark-e2e baseline save --name <name> --screenshot <path>` to create one.");
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

// ── dom-lint ─────────────────────────────────────────────

program
  .command("dom-lint")
  .description("Run deterministic DOM rule checks (token compliance, a11y)")
  .requiredOption("--dom <path>", "Path to DOM dump JSON file")
  .option("--rules <path>", "Path to dom-rules.json (default: .spark/plugin/e2e/dom-rules.json)")
  .option("--enable <ids>", "Comma-separated rule IDs to run (default: all)")
  .action(async (opts) => {
    const { loadDomRules } = await import("./engine/rules.js");
    const domRules = loadDomRules(opts.rules);
    const enabledRules = opts.enable ? opts.enable.split(",").map((s: string) => s.trim()) : undefined;

    const result = domLint({
      dom: JSON.parse(readFileSync(resolve(opts.dom), "utf-8")),
      rules: domRules,
      enabledRules,
    });

    console.log(JSON.stringify(result, null, 2));
  });

// ── dom-get ──────────────────────────────────────────────

program
  .command("dom-get")
  .description("Look up an element by @ref in a DOM dump")
  .argument("<ref>", "Element reference (e.g. @button-3)")
  .requiredOption("--dom <path>", "Path to DOM dump JSON file")
  .action((ref, opts) => {
    const el = domGet(ref, resolve(opts.dom));
    if (!el) {
      console.error(`Element "${ref}" not found in DOM dump.`);
      process.exit(1);
    }
    console.log(JSON.stringify(el, null, 2));
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
      const c = load();
      if (c.browser?.url) console.log(`  URL: ${c.browser.url}`);
      console.log(`  VLM provider: ${c.vlm.provider}`);
      console.log(`  VLM model: ${c.vlm.model}`);
      console.log(`  API key: ${c.vlm.apiKey ? "***" : "(not set)"}`);
    } catch (e) {
      console.log(`✗ Config error: ${e}`);
    }

    // Check for project .env
    const projectEnv = resolve(process.cwd(), ".env");
    if (existsSync(projectEnv)) {
      console.log(`  ✓ Project .env found`);
    } else {
      console.log(`  ⓘ  No project .env — create one for test credentials`);
    }

    // AESTHETICS.md
    console.log();
    console.log("─ AESTHETICS.md ─");
    const aesthetics = loadAesthetics();
    if (aesthetics.sources.length === 0) {
      console.log(`  ⓘ  No AESTHETICS.md found`);
      console.log(`     Global: ~/.spark/AESTHETICS.md`);
      console.log(`     Project: ./AESTHETICS.md`);
      console.log(`     Run /spark-e2e-init to generate.`);
    } else {
      for (const src of aesthetics.sources) {
        const label = src.startsWith(homedir()) ? `Global: ${src.replace(homedir(), "~")}` : `Project: ${src}`;
        console.log(`  ✓ ${label}`);
      }
    }

    // dom-rules.json
    console.log();
    console.log("─ dom-rules.json ─");
    const domRulesPath = resolve(process.cwd(), ".spark", "plugin", "e2e", "dom-rules.json");
    if (existsSync(domRulesPath)) {
      console.log(`  ✓ ${domRulesPath}`);
    } else {
      console.log(`  ⓘ  No dom-rules.json — run /spark-e2e-init to generate.`);
    }

    console.log();
    if (!opts.quick) {
      console.log("─ VLM ─");
      if (!cfg.vlm.apiKey) {
        console.log("  ⚠ Set SPARK_E2E_API_KEY to enable VLM");
      } else {
        console.log(`  ✓ API key: ***`);
        console.log(`  Provider: ${cfg.vlm.provider}`);
        console.log(`  Base URL: ${cfg.vlm.baseUrl || "(default)"}`);
        console.log(`  Model: ${cfg.vlm.model}`);

        try {
          const baseUrl = cfg.vlm.baseUrl || "https://api.openai.com/v1";
          const modelsUrl = baseUrl.replace(/\/+$/, "") + "/models";
          const res = await fetch(modelsUrl, {
            headers: { Authorization: `Bearer ${cfg.vlm.apiKey}` },
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            console.log(`  ✓ Endpoint reachable`);
          } else {
            console.log(`  ⚠  Endpoint returned ${res.status} — check URL and API key`);
          }
        } catch (e) {
          console.log(`  ⚠  Cannot reach ${cfg.vlm.baseUrl || "endpoint"} — ${(e as Error).message}`);
        }
      }
    }
    console.log();
    console.log("Done.");
  });

// ── update ─────────────────────────────────────────────────

program
  .command("update")
  .description("Migrate local config and data from older versions to latest")
  .option("--dry-run", "Show what would be migrated without doing it")
  .option("--yes", "Skip confirmation prompts")
  .option("--list", "List all migrations and their status")
  .action(async (opts) => {
    const { MIGRATIONS, getPendingMigrations, runMigrations } = await import("./migrate.js");

    if (opts.list) {
      const pending = getPendingMigrations({ cwd: process.cwd() });
      console.log("spark-e2e migrations:");
      console.log("");
      for (const m of MIGRATIONS) {
        const isPending = pending.some((p: { version: string }) => p.version === m.version);
        console.log(`  ${isPending ? "⟳" : "✓"}  v${m.version} — ${m.description}`);
      }
      console.log("");
      if (pending.length === 0) {
        console.log("All migrations applied — nothing to do.");
      } else {
        console.log(`${pending.length} migration(s) pending. Run "spark-e2e update" to apply.`);
      }
      return;
    }

    const pending = getPendingMigrations({ cwd: process.cwd() });
    if (pending.length === 0) {
      console.log("Nothing to migrate — all data is already on the latest paths.");
      return;
    }

    console.log(`Found ${pending.length} pending migration(s):`);
    console.log("");
    for (const m of pending) {
      console.log(`  v${m.version} — ${m.description}`);
    }
    console.log("");

    const log = (msg: string) => console.log(msg);

    if (opts.dryRun) {
      await runMigrations({ cwd: process.cwd(), dryRun: true, log });
      return;
    }

    if (!opts.yes) {
      const { confirm } = await import("@clack/prompts");
      const ok = await confirm({ message: "Proceed with migration?", initialValue: true });
      if (!ok || (typeof ok === "object" && (ok as { isCancel?: boolean }).isCancel)) {
        console.log("Cancelled.");
        return;
      }
    }

    await runMigrations({ cwd: process.cwd(), log });
  });

// ── Parse ────────────────────────────────────────────────

if (!process.env.VITEST) {
  program.parse();
}

export { program };

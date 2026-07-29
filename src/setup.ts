/**
 * Interactive setup wizard for spark-e2e.
 *
 * Guides users through VLM config and browser config — minimal prompts,
 * sensible defaults, auto-detection for everything else.
 */
import * as p from "@clack/prompts";
import { writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { homedir } from "node:os";
import * as yaml from "js-yaml";
import { execSync } from "node:child_process";
import { AGENTS } from "./cli.js";

// ── Helpers ───────────────────────────────────────────────

function nl(): void {
  console.log();
}

export function yamlOf(obj: Record<string, unknown>): string {
  return yaml.dump(obj, { lineWidth: 120, noRefs: true });
}

export function fmtPath(p: string): string {
  const home = homedir();
  if (p.startsWith(home)) return p.replace(home, "~");
  return p;
}

// ── Provider presets ──────────────────────────────────────

const PROVIDER_PRESETS: Record<string, { label: string; baseUrl: string; model: string }> = {
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
  },
  anthropic: {
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-5",
  },
  gemini: {
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.5-flash",
  },
  ollama: {
    label: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    model: "llava",
  },
};

// ── Auto-detection helpers ────────────────────────────────

function detectScreenSize(): { width: number; height: number } {
  try {
    if (process.platform === "darwin") {
      const out = execSync(
        "system_profiler SPDisplaysDataType 2>/dev/null | grep 'Resolution:' | head -1",
        { encoding: "utf-8", timeout: 5000 }
      );
      const match = out.match(/(\d+)\s*x\s*(\d+)/);
      if (match) return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
    }
    if (process.platform === "linux") {
      const out = execSync("xrandr --current 2>/dev/null | grep '*' | head -1", {
        encoding: "utf-8",
        timeout: 5000,
      });
      const match = out.match(/(\d+)\s*x\s*(\d+)/);
      if (match) return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
    }
    if (process.platform === "win32") {
      const out = execSync(
        'powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds"',
        { encoding: "utf-8", timeout: 5000 }
      );
      const w = out.match(/Width\s*:\s*(\d+)/);
      const h = out.match(/Height\s*:\s*(\d+)/);
      if (w && h) return { width: parseInt(w[1], 10), height: parseInt(h[1], 10) };
    }
  } catch {
    /* fall through to defaults */
  }
  return { width: 1600, height: 1200 };
}

function detectAgents(cwd: string): string[] {
  const home = homedir();
  const detected: string[] = [];
  for (const a of AGENTS) {
    if (existsSync(resolve(cwd, a.projectDir)) || existsSync(resolve(home, a.userDir))) {
      detected.push(a.name);
    }
  }
  return detected;
}

function hasPlaywright(): boolean {
  try {
    execSync("npx playwright --version", { stdio: "pipe", timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

// ── Pure logic (testable without TTY) ─────────────────────

export interface SetupAnswers {
  apiKey: string;
  baseUrl: string;
  model: string;
  defaultUrl: string;
  viewportWidth: number;
  viewportHeight: number;
  thinkingBudget?: number;
  strictness?: string;
  aestheticsFile?: string;
  agent?: string;
  scope?: string;
  installPlaywright?: boolean;
}

export function buildConfigFromAnswers(answers: SetupAnswers): Record<string, unknown> {
  return {
    browser: {
      url: answers.defaultUrl,
    },
    viewport: {
      width: answers.viewportWidth,
      height: answers.viewportHeight,
    },
    vlm: {
      api_key: answers.apiKey,
      base_url: answers.baseUrl,
      model: answers.model,
      thinking_budget: answers.thinkingBudget ?? 4000,
    },
    prompts: {
      strictness: answers.strictness ?? "standard",
    },
    aesthetics_file: answers.aestheticsFile ?? "AESTHETICS.md",
  };
}

export function resolveTargets(opts: {
  agent: string;
  scope: string;
  cwd: string;
}): { label: string; dir: string }[] {
  const home = homedir();
  const isUser = opts.scope === "user";
  const targets: { label: string; dir: string }[] = [];

  if (opts.agent === "all") {
    for (const a of AGENTS) {
      const base = isUser ? resolve(home, a.userDir) : resolve(opts.cwd, a.projectDir);
      targets.push({ label: a.label, dir: base });
    }
  } else {
    const a = AGENTS.find((x) => x.name === opts.agent);
    if (!a) return [];
    const base = isUser ? resolve(home, a.userDir) : resolve(opts.cwd, a.projectDir);
    targets.push({ label: a.label, dir: base });
  }
  return targets;
}

export function buildEnvContent(
  apiKey: string,
  baseUrl: string,
  model: string,
  thinkingBudget: string
): string {
  return (
    [
      "# spark-e2e global config — generated by `spark-e2e setup`",
      `SPARK_E2E_API_KEY=${apiKey}`,
      `SPARK_E2E_BASE_URL=${baseUrl}`,
      `SPARK_E2E_MODEL=${model}`,
      `SPARK_E2E_THINKING_BUDGET=${thinkingBudget}`,
    ].join("\n") + "\n"
  );
}

// ── Agent skill installation ──────────────────────────────

export async function installSkills(opts: {
  agent: string;
  scope: string;
  cwd: string;
}): Promise<string[]> {
  const { mkdirSync, existsSync, readdirSync, statSync } = await import("node:fs");
  const { copyFileSync } = await import("node:fs");
  const { resolve, join } = await import("node:path");

  // Find skills source
  const candidates = [
    resolve(import.meta.dirname!, "..", "skills"),
    resolve(import.meta.dirname!, "..", "..", "skills"),
    join(opts.cwd, "skills"),
  ];
  let skillsSrc: string | null = null;
  for (const c of candidates) {
    try {
      if (statSync(c).isDirectory()) {
        skillsSrc = c;
        break;
      }
    } catch {
      /* skip */
    }
  }

  if (!skillsSrc) {
    p.log.warn("Cannot find skills source — skipping skill installation.");
    return [];
  }

  const home = homedir();
  const isUser = opts.scope === "user";
  const targets: { label: string; dir: string }[] = [];

  if (opts.agent === "all") {
    for (const a of AGENTS) {
      const base = isUser ? resolve(home, a.userDir) : resolve(opts.cwd, a.projectDir);
      targets.push({ label: a.label, dir: base });
    }
  } else {
    const a = AGENTS.find((x) => x.name === opts.agent);
    if (!a) return [];
    const base = isUser ? resolve(home, a.userDir) : resolve(opts.cwd, a.projectDir);
    targets.push({ label: a.label, dir: base });
  }

  const skillNames: string[] = [];
  for (const entry of readdirSync(skillsSrc, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      try {
        if (statSync(join(skillsSrc!, entry.name, "SKILL.md")).isFile()) {
          skillNames.push(entry.name);
        }
      } catch {
        /* skip */
      }
    }
  }

  for (const t of targets) {
    mkdirSync(t.dir, { recursive: true });
    for (const name of skillNames) {
      const srcDir = join(skillsSrc, name);
      const destDir = join(t.dir, name);
      try {
        mkdirSync(destDir, { recursive: true });
        for (const f of readdirSync(srcDir, { withFileTypes: true })) {
          if (f.isFile()) {
            copyFileSync(join(srcDir, f.name), join(destDir, f.name));
          }
        }
      } catch {
        /* skip individual skill errors */
      }
    }
  }

  return skillNames;
}

// ── Main setup flow ───────────────────────────────────────

export async function setupCommand(opts: {
  dir?: string;
  apiKey?: string;
  baseUrl?: string;
  yes?: boolean;
}) {
  const cwd = process.cwd();
  const targetDir = opts.dir || cwd;

  p.intro("spark-e2e setup — VLM-powered Visual E2E Testing");

  // ── Section 1: Provider Selection ─────────────────────

  let baseUrl: string;
  let model: string;
  let isLocalProvider = false;

  if (opts.yes) {
    baseUrl = opts.baseUrl ?? PROVIDER_PRESETS.openai.baseUrl;
    model = PROVIDER_PRESETS.openai.model;
  } else {
    const providerKey = await p.select({
      message: "VLM Provider",
      options: [
        { value: "openai", label: "OpenAI", hint: "gpt-4o" },
        { value: "anthropic", label: "Anthropic", hint: "claude-sonnet-5" },
        { value: "gemini", label: "Google Gemini", hint: "gemini-2.5-flash" },
        { value: "ollama", label: "Ollama (local)", hint: "llava — no API key needed" },
        { value: "custom", label: "Custom endpoint", hint: "any OpenAI-compatible API" },
      ],
    });

    if (p.isCancel(providerKey)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    if (providerKey === "ollama") {
      isLocalProvider = true;
      baseUrl = PROVIDER_PRESETS.ollama.baseUrl;
      model = PROVIDER_PRESETS.ollama.model;
      p.log.info(`Ollama (local): ${model} @ ${baseUrl}`);
    } else if (providerKey === "custom") {
      baseUrl = (await p.text({
        message: "VLM Base URL",
        placeholder: "https://api.openai.com/v1",
        defaultValue: "https://api.openai.com/v1",
      })) as string;
      model = (await p.text({
        message: "Default VLM Model",
        placeholder: "gpt-4o",
        defaultValue: "gpt-4o",
      })) as string;
    } else {
      const preset = PROVIDER_PRESETS[providerKey as string];
      baseUrl = preset.baseUrl;
      model = preset.model;
      p.log.info(`${preset.label}: ${model} @ ${baseUrl}`);
    }
  }

  // ── Section 2: API Key ────────────────────────────────

  let apiKey: string;
  if (opts.apiKey) {
    apiKey = opts.apiKey;
  } else if (opts.yes || isLocalProvider) {
    apiKey = "ollama"; // local providers don't need a real key
  } else {
    const key = await p.password({
      message: "VLM API Key (input hidden)",
      validate: (v) => {
        if (!v || v.trim().length < 3) return "API key is required";
      },
    });
    if (p.isCancel(key)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
    apiKey = key;
  }

  // ── Section 2: Browser Configuration ──────────────────

  const defaultUrl = opts.yes
    ? "http://localhost:5173"
    : ((await p.text({
        message: "Default URL to test (optional, use --url to override)",
        placeholder: "Leave empty to skip, e.g. http://localhost:5173",
        defaultValue: "",
      })) as string);

  // Auto-detect viewport from system screen size
  const viewport = detectScreenSize();
  if (!opts.yes) {
    p.log.info(`Viewport auto-detected: ${viewport.width}×${viewport.height}`);
  }

  // ── Section 3: Auto-setup (Playwright + Skills) ───────

  let installPw = false;
  if (!opts.yes) {
    if (hasPlaywright()) {
      p.log.info("Playwright already installed ✓");
    } else {
      installPw = (await p.confirm({
        message: "Install Playwright globally?",
        initialValue: true,
      })) as boolean;
    }
  }

  // Auto-detect agent for skill installation
  const detectedAgents = detectAgents(targetDir);
  let selectedAgent = "skip";
  let scope = "project";

  if (!opts.yes) {
    if (detectedAgents.length === 1) {
      const agentName = detectedAgents[0];
      const agentLabel = AGENTS.find((a) => a.name === agentName)?.label ?? agentName;
      const installChoice = (await p.select({
        message: `Detected ${agentLabel}. Install skills?`,
        options: [
          {
            value: "project",
            label: "Yes, project scope",
            hint: `→ ${fmtPath(resolve(targetDir, ".claude/skills/"))}`,
          },
          {
            value: "user",
            label: "Yes, global (all projects)",
            hint: `→ ${fmtPath(resolve(homedir(), ".claude/skills/"))}`,
          },
          { value: "skip", label: "Skip", hint: "no skill installation" },
        ],
      })) as string;
      if (installChoice !== "skip") {
        selectedAgent = agentName;
        scope = installChoice;
      }
    } else if (detectedAgents.length > 1) {
      selectedAgent = (await p.select({
        message: "Install skills for which agent?",
        options: [
          ...detectedAgents.map((name) => {
            const a = AGENTS.find((x) => x.name === name);
            return { value: name, label: a?.label ?? name };
          }),
          { value: "all", label: "All detected", hint: "install everywhere" },
          { value: "skip", label: "Skip", hint: "no skill installation" },
        ],
      })) as string;
      if (selectedAgent !== "skip") {
        scope = (await p.select({
          message: "Install scope",
          options: [
            { value: "project", label: "project", hint: "this project only" },
            { value: "user", label: "user (global)", hint: "all projects" },
          ],
        })) as string;
      }
    }
    // 0 agents detected → silently skip skills
  }

  // ── Build config ─────────────────────────────────────────

  const thinkingBudget = 4000;
  const config: Record<string, unknown> = {
    browser: {
      url: defaultUrl,
    },
    viewport: {
      width: viewport.width,
      height: viewport.height,
    },
    vlm: {
      api_key: apiKey,
      base_url: baseUrl,
      model: model,
      thinking_budget: thinkingBudget,
    },
    prompts: {
      strictness: "standard",
    },
    aesthetics_file: "AESTHETICS.md",
  };

  // ── Save files ───────────────────────────────────────────
  const s = p.spinner();

  const yamlPath = resolve(targetDir, ".spark-e2e.yaml");
  s.start("Writing configuration files...");

  writeFileSync(
    yamlPath,
    `# spark-e2e configuration — generated by \`spark-e2e setup\`\n# See https://github.com/neilji/spark-e2e for full documentation\n\n${yamlOf(config)}`,
    "utf-8"
  );

  // Write API key to global .env for security (never in project YAML)
  const globalEnvDir = resolve(homedir(), ".spark", "plugin", "e2e");
  mkdirSync(globalEnvDir, { recursive: true });
  const globalEnvPath = resolve(globalEnvDir, ".env");
  const envLines = [
    `# spark-e2e global config — generated by \`spark-e2e setup\``,
    `SPARK_E2E_API_KEY=${apiKey}`,
    `SPARK_E2E_BASE_URL=${baseUrl}`,
    `SPARK_E2E_MODEL=${model}`,
    `SPARK_E2E_THINKING_BUDGET=${thinkingBudget}`,
  ];
  writeFileSync(globalEnvPath, envLines.join("\n") + "\n", "utf-8");
  chmodSync(globalEnvPath, 0o600); // owner read/write only — contains API key

  s.stop(`Configuration saved:
  ${fmtPath(yamlPath)}
  ${fmtPath(globalEnvPath)}`);

  // ── Install Playwright ────────────────────────────────────
  if (installPw) {
    s.start("Installing Playwright globally...");
    try {
      const npm = process.env.npm_execpath ?? "npm";
      execSync(`${npm} install -g playwright`, { stdio: "pipe", timeout: 120000 });
      s.message("Downloading Chromium...");
      execSync(`npx playwright install chromium`, { stdio: "pipe", timeout: 120000 });
      s.stop("Playwright installed ✓");
    } catch (e) {
      s.stop(`Playwright install failed: ${(e as Error).message}`);
      p.log.warn(
        "You can install manually: npm install -g playwright && npx playwright install chromium"
      );
    }
  }

  // ── Install skills ───────────────────────────────────────
  let installedSkills: string[] = [];
  if (selectedAgent !== "skip") {
    s.start("Installing skills...");
    installedSkills = await installSkills({
      agent: selectedAgent,
      scope: scope,
      cwd: targetDir,
    });
    if (installedSkills.length > 0) {
      s.stop(`Skills installed (${selectedAgent}, ${scope} scope)`);
    } else {
      s.stop("No skills installed (source not found)");
    }
  }

  // ── Outro ────────────────────────────────────────────────
  nl();
  p.outro("spark-e2e is ready!");

  const boxWidth = 50;
  const line = "─".repeat(boxWidth);
  console.log(`  ${line}`);
  console.log(`  Next steps:`);
  console.log();
  console.log(`    spark-e2e doctor                Verify your setup`);
  if (defaultUrl) {
    console.log(`    spark-e2e review --url ${defaultUrl}    Run first visual review`);
  } else {
    console.log(`    spark-e2e review --url <your-url>    Run first visual review`);
  }
  console.log();
  if (installedSkills.length > 0) {
    console.log(`  Slash commands:`);
    for (const name of installedSkills) {
      console.log(`    /${name}`);
    }
    console.log();
  }
  console.log(`  ${line}`);
}

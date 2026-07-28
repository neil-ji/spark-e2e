/**
 * Tests for setup.ts pure functions — no TTY required.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir, homedir } from "node:os";
import {
  buildConfigFromAnswers,
  resolveTargets,
  buildEnvContent,
  fmtPath,
  yamlOf,
  installSkills,
  type SetupAnswers,
} from "../setup.js";
import { AGENTS } from "../cli.js";

// ── buildConfigFromAnswers ────────────────────────────────

function defaultAnswers(overrides?: Partial<SetupAnswers>): SetupAnswers {
  return {
    apiKey: "sk-test",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    thinkingBudget: "4000",
    backend: "browser-harness",
    defaultUrl: "http://localhost:5173",
    viewportWidth: "1600",
    viewportHeight: "1200",
    strictness: "standard",
    aestheticsFile: "AESTHETICS.md",
    agent: "claude",
    scope: "project",
    ...overrides,
  };
}

describe("buildConfigFromAnswers", () => {
  it("generates correct browser section", () => {
    const cfg = buildConfigFromAnswers(defaultAnswers({ backend: "playwright", defaultUrl: "http://localhost:3000" }));
    expect(cfg.browser).toEqual({ backend: "playwright", url: "http://localhost:3000" });
  });

  it("parses viewport dimensions as integers", () => {
    const cfg = buildConfigFromAnswers(defaultAnswers({ viewportWidth: "1920", viewportHeight: "1080" }));
    expect(cfg.viewport).toEqual({ width: 1920, height: 1080 });
  });

  it("VLM section includes api_key and model", () => {
    const cfg = buildConfigFromAnswers(defaultAnswers({ apiKey: "sk-abc", model: "claude-opus-5" }));
    expect(cfg.vlm).toMatchObject({
      api_key: "sk-abc",
      base_url: "https://api.openai.com/v1",
      model: "claude-opus-5",
      thinking_budget: 4000,
    });
  });

  it("thinking budget is parsed as integer", () => {
    const cfg = buildConfigFromAnswers(defaultAnswers({ thinkingBudget: "0" }));
    expect(cfg.vlm.thinking_budget).toBe(0);
    expect(typeof cfg.vlm.thinking_budget).toBe("number");
  });

  it("strictness is passed through", () => {
    const cfg = buildConfigFromAnswers(defaultAnswers({ strictness: "relaxed" }));
    expect(cfg.prompts).toEqual({ strictness: "relaxed" });
  });

  it("custom aesthetics file path", () => {
    const cfg = buildConfigFromAnswers(defaultAnswers({ aestheticsFile: "design-system.md" }));
    expect(cfg.aesthetics_file).toBe("design-system.md");
  });
});

// ── buildEnvContent ───────────────────────────────────────

describe("buildEnvContent", () => {
  it("contains all required env vars", () => {
    const content = buildEnvContent("key123", "https://example.com/v1", "gpt-4o", "8000");
    expect(content).toContain("SPARK_E2E_API_KEY=key123");
    expect(content).toContain("SPARK_E2E_BASE_URL=https://example.com/v1");
    expect(content).toContain("SPARK_E2E_MODEL=gpt-4o");
    expect(content).toContain("SPARK_E2E_THINKING_BUDGET=8000");
  });

  it("starts with comment header", () => {
    const content = buildEnvContent("k", "u", "m", "0");
    expect(content.startsWith("# spark-e2e global config")).toBe(true);
  });

  it("ends with newline", () => {
    const content = buildEnvContent("k", "u", "m", "0");
    expect(content.endsWith("\n")).toBe(true);
  });
});

// ── resolveTargets ────────────────────────────────────────

describe("resolveTargets", () => {
  const home = homedir();
  const cwd = "/fake/project";

  it("single agent, project scope → resolves under CWD", () => {
    const targets = resolveTargets({ agent: "claude", scope: "project", cwd });
    expect(targets).toHaveLength(1);
    expect(targets[0].label).toBe("Claude Code");
    expect(targets[0].dir).toBe(resolve(cwd, ".claude/skills"));
  });

  it("single agent, user scope → resolves under HOME", () => {
    const targets = resolveTargets({ agent: "claude", scope: "user", cwd });
    expect(targets[0].dir).toBe(resolve(home, ".claude/skills"));
  });

  it("spark-hub project scope → CWD/.spark/skills", () => {
    const targets = resolveTargets({ agent: "spark-hub", scope: "project", cwd });
    expect(targets[0].dir).toBe(resolve(cwd, ".spark/skills"));
  });

  it("spark-hub user scope → HOME/.spark/config/custom-skills", () => {
    const targets = resolveTargets({ agent: "spark-hub", scope: "user", cwd });
    expect(targets[0].dir).toBe(resolve(home, ".spark/config/custom-skills"));
  });

  it("all → returns all 5 agents", () => {
    const targets = resolveTargets({ agent: "all", scope: "project", cwd });
    expect(targets).toHaveLength(5);
    const names = targets.map(t => t.label);
    expect(names).toContain("Claude Code");
    expect(names).toContain("Spark Hub");
    expect(names).toContain("Trae");
  });

  it("unknown agent → empty array", () => {
    const targets = resolveTargets({ agent: "nonexistent", scope: "project", cwd });
    expect(targets).toHaveLength(0);
  });

  it("all agents with user scope → all under HOME", () => {
    const targets = resolveTargets({ agent: "all", scope: "user", cwd });
    for (const t of targets) {
      expect(t.dir.startsWith(home)).toBe(true);
    }
  });
});

// ── fmtPath ───────────────────────────────────────────────

describe("fmtPath", () => {
  it("replaces home directory with ~", () => {
    const home = homedir();
    expect(fmtPath(join(home, "foo"))).toBe("~/foo");
  });

  it("leaves paths outside home unchanged", () => {
    expect(fmtPath("/usr/local/bin")).toBe("/usr/local/bin");
  });
});

// ── yamlOf ────────────────────────────────────────────────

describe("yamlOf", () => {
  it("produces valid YAML", () => {
    const yaml = yamlOf({ browser: { backend: "playwright" }, viewport: { width: 1920, height: 1080 } });
    expect(yaml).toContain("backend: playwright");
    expect(yaml).toContain("width: 1920");
  });
});

// ── installSkills (integration via tmp dir) ───────────────

describe("installSkills", () => {
  const home = homedir();
  const tmpRoot = join(tmpdir(), `spark-e2e-skills-${process.pid}`);

  beforeEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    mkdirSync(tmpRoot, { recursive: true });
    // Create a fake skills source
    const skillsSrc = join(tmpRoot, "skills-src");
    mkdirSync(skillsSrc, { recursive: true });
    mkdirSync(join(skillsSrc, "my-skill"));
    writeFileSync(join(skillsSrc, "my-skill", "SKILL.md"), "# My Skill\n", "utf-8");
    mkdirSync(join(skillsSrc, "another-skill"));
    writeFileSync(join(skillsSrc, "another-skill", "SKILL.md"), "# Another\n", "utf-8");
    // Non-skill dir (no SKILL.md)
    mkdirSync(join(skillsSrc, "not-a-skill"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("handles missing skills source gracefully", async () => {
    // cwd without a skills/ directory — returns empty array
    const result = await installSkills({
      agent: "claude",
      scope: "project",
      cwd: tmpRoot,
    });
    // If no skills source found, returns [] without error
    expect(Array.isArray(result)).toBe(true);
  });

  // Note: installSkills auto-discovers skills from ../skills relative to
  // import.meta.dirname. Full integration test would need actual skills dir.
  it("has exported installSkills function", () => {
    // At minimum, verify the function is exported and callable
    expect(typeof installSkills).toBe("function");
  });
});

/**
 * Tests for setup.ts — config generation, skill installation.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import yaml from "js-yaml";
import { AGENTS } from "../cli.js";

// ── Helpers (mirrors setup.ts logic) ────────────────────

function buildConfig(values: {
  backend?: string;
  url?: string;
  width?: number;
  height?: number;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  thinkingBudget?: string;
  strictness?: string;
  aestheticsFile?: string;
}): { browser: { backend: string; url: string }; viewport: { width: number; height: number }; vlm: { api_key: string; base_url: string; model: string; thinking_budget: number }; prompts: { strictness: string }; aesthetics_file: string } {
  return {
    browser: {
      backend: values.backend ?? "browser-harness",
      url: values.url ?? "http://localhost:5173",
    },
    viewport: {
      width: values.width ?? 1600,
      height: values.height ?? 1200,
    },
    vlm: {
      api_key: values.apiKey ?? "",
      base_url: values.baseUrl ?? "https://api.openai.com/v1",
      model: values.model ?? "gpt-4o",
      thinking_budget: parseInt(values.thinkingBudget ?? "4000", 10),
    },
    prompts: {
      strictness: values.strictness ?? "standard",
    },
    aesthetics_file: values.aestheticsFile ?? "AESTHETICS.md",
  };
}

// ── Tests ────────────────────────────────────────────────

describe("Config generation", () => {
  it("should generate valid YAML with defaults", () => {
    const config = buildConfig({});
    expect(config.browser).toBeDefined();
    expect(config.viewport).toBeDefined();
    expect(config.vlm).toBeDefined();
    expect(config.prompts).toBeDefined();
  });

  it("should use provided browser backend", () => {
    const config = buildConfig({ backend: "playwright" });
    expect(config.browser.backend).toBe("playwright");
  });

  it("should use provided URL", () => {
    const config = buildConfig({ url: "http://localhost:3000" });
    expect(config.browser.url).toBe("http://localhost:3000");
  });

  it("should use provided viewport dimensions", () => {
    const config = buildConfig({ width: 1920, height: 1080 });
    expect(config.viewport.width).toBe(1920);
    expect(config.viewport.height).toBe(1080);
  });

  it("should use provided VLM model", () => {
    const config = buildConfig({ model: "gpt-4-vision-preview" });
    expect(config.vlm.model).toBe("gpt-4-vision-preview");
  });

  it("should parse thinking budget as integer", () => {
    const config = buildConfig({ thinkingBudget: "8000" });
    expect(config.vlm.thinking_budget).toBe(8000);
    expect(typeof config.vlm.thinking_budget).toBe("number");
  });

  it("should handle strictness levels", () => {
    const standard = buildConfig({ strictness: "standard" });
    expect(standard.prompts.strictness).toBe("standard");

    const strict = buildConfig({ strictness: "strict" });
    expect(strict.prompts.strictness).toBe("strict");

    const relaxed = buildConfig({ strictness: "relaxed" });
    expect(relaxed.prompts.strictness).toBe("relaxed");
  });

  it("should accept custom aesthetics file path", () => {
    const config = buildConfig({ aestheticsFile: "custom-style.md" });
    expect(config.aesthetics_file).toBe("custom-style.md");
  });

  it("should generate YAML that can be parsed back", () => {
    const config = buildConfig({
      backend: "playwright",
      url: "http://localhost:3000",
      model: "gpt-4o",
    });

    const yamlStr = yaml.dump(config, { lineWidth: 120, noRefs: true });
    const parsed = yaml.load(yamlStr);

    expect(parsed.browser.backend).toBe("playwright");
    expect(parsed.browser.url).toBe("http://localhost:3000");
    expect(parsed.vlm.model).toBe("gpt-4o");
  });
});

describe("Config file operations", () => {
  it("should write .spark-e2e.yaml correctly", () => {
    const tmpDir = join(tmpdir(), `spark-e2e-setup-test-${process.pid}-${Date.now()}`);
    try {
      mkdirSync(tmpDir, { recursive: true });

      const config = buildConfig({});
      const yamlStr = "# spark-e2e configuration\n\n" + yaml.dump(config, { lineWidth: 120, noRefs: true });

      const yamlPath = join(tmpDir, ".spark-e2e.yaml");
      writeFileSync(yamlPath, yamlStr, "utf-8");

      expect(existsSync(yamlPath)).toBe(true);
      const content = readFileSync(yamlPath, "utf-8");
      expect(content).toContain("browser:");
      expect(content).toContain("vlm:");
      expect(content).toContain("viewport:");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should write API key to env file correctly", () => {
    const tmpDir = join(tmpdir(), `spark-e2e-env-test-${process.pid}-${Date.now()}`);
    try {
      mkdirSync(tmpDir, { recursive: true });

      const envDir = join(tmpDir, ".spark-e2e");
      mkdirSync(envDir, { recursive: true });
      const envPath = join(envDir, ".env");
      const envContent = [
        "# spark-e2e global config",
        "SPARK_E2E_API_KEY=sk-test-key",
        "SPARK_E2E_BASE_URL=https://api.openai.com/v1",
        "SPARK_E2E_MODEL=gpt-4o",
        "SPARK_E2E_THINKING_BUDGET=4000",
      ].join("\n") + "\n";

      writeFileSync(envPath, envContent, "utf-8");

      expect(existsSync(envPath)).toBe(true);
      const content = readFileSync(envPath, "utf-8");
      expect(content).toContain("SPARK_E2E_API_KEY=sk-test-key");
      expect(content).toContain("SPARK_E2E_BASE_URL=https://api.openai.com/v1");
      expect(content).toContain("SPARK_E2E_MODEL=gpt-4o");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("Skill installation paths", () => {
  it("spark-hub project scope resolves to .spark/skills", () => {
    const agent = AGENTS.find(a => a.name === "spark-hub")!;
    expect(agent.projectDir).toBe(".spark/skills");
  });

  it("spark-hub user scope resolves to .spark/config/custom-skills", () => {
    const agent = AGENTS.find(a => a.name === "spark-hub")!;
    expect(agent.userDir).toBe(".spark/config/custom-skills");
  });

  it("claude has consistent project and user dirs", () => {
    const agent = AGENTS.find(a => a.name === "claude")!;
    expect(agent.projectDir).toBe(".claude/skills");
    expect(agent.userDir).toBe(".claude/skills");
  });
});

describe("Setup config defaults", () => {
  it("default backend should be browser-harness", () => {
    const config = buildConfig({});
    expect(config.browser.backend).toBe("browser-harness");
  });

  it("default URL should be localhost:5173", () => {
    const config = buildConfig({});
    expect(config.browser.url).toBe("http://localhost:5173");
  });

  it("default viewport should be 1600x1200", () => {
    const config = buildConfig({});
    expect(config.viewport.width).toBe(1600);
    expect(config.viewport.height).toBe(1200);
  });

  it("default model should be gpt-4o", () => {
    const config = buildConfig({});
    expect(config.vlm.model).toBe("gpt-4o");
  });

  it("default thinking budget should be 4000", () => {
    const config = buildConfig({});
    expect(config.vlm.thinking_budget).toBe(4000);
  });
});

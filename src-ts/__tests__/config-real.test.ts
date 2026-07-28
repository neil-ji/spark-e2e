/**
 * Real config tests — YAML loading, env interpolation, extractJson, error paths.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { interpolateEnvVars } from "../config.js";
import { extractJson } from "../vlm/openai-compat.js";

// ── extractJson ──────────────────────────────────────────

describe("extractJson", () => {
  it("plain JSON", () => expect(extractJson('{"foo":"bar"}')).toEqual({ foo: "bar" }));
  it("JSON with whitespace", () => expect(extractJson(' \n {"key":42} \n ')).toEqual({ key: 42 }));
  it('strips ```json fences', () => expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 }));
  it("strips ``` fences", () => expect(extractJson('```\n{"b":2}\n```')).toEqual({ b: 2 }));
  it("text before JSON", () => expect(extractJson('Result: {"x":10}')).toEqual({ x: 10 }));
  it("text after JSON", () => expect(extractJson('{"ok":true} — done')).toEqual({ ok: true }));
  it("text both sides", () => expect(extractJson('Analyzing: {"score":95}. Fin.')).toEqual({ score: 95 }));
  it("truncated JSON", () => expect(extractJson('{"items":[1,2,3]')).toEqual({ items: [1, 2, 3] }));
  it("invalid → {}", () => expect(extractJson("not json")).toEqual({}));
  it("empty → {}", () => expect(extractJson("")).toEqual({}));
  it("nested objects", () => expect(extractJson('{"u":{"n":"A"},"ok":true}')).toEqual({ u: { n: "A" }, ok: true }));
  it("escaped quotes", () => expect(extractJson('{"msg":"hello \\"world\\""}')).toEqual({ msg: 'hello "world"' }));
  it("array in object", () => expect(extractJson('{"d":[1,2,3]')).toEqual({ d: [1, 2, 3] }));
  it("unbalanced string", () => {
    const result = extractJson('{"key":"unclosed string}');
    expect(typeof result).toBe("object");
  });
});

// ── interpolateEnvVars ───────────────────────────────────

describe("interpolateEnvVars", () => {
  it("replaces ${VAR}", () => {
    process.env.T = "X"; expect(interpolateEnvVars("${T}")).toBe("X"); delete process.env.T;
  });
  it("unknown var unchanged", () => {
    delete process.env.NO; expect(interpolateEnvVars("${NO}")).toBe("${NO}");
  });
  it("multiple vars", () => {
    process.env.A = "1"; process.env.B = "2";
    expect(interpolateEnvVars("${A}-${B}")).toBe("1-2");
    delete process.env.A; delete process.env.B;
  });
  it("recurses arrays", () => {
    process.env.X = "x";
    expect(interpolateEnvVars(["${X}", "y"])).toEqual(["x", "y"]);
    delete process.env.X;
  });
  it("recurses objects", () => {
    process.env.K = "v";
    expect(interpolateEnvVars({ k: "${K}", n: 1 })).toEqual({ k: "v", n: 1 });
    delete process.env.K;
  });
  it("non-string scalars unchanged", () => {
    expect(interpolateEnvVars(42)).toBe(42);
    expect(interpolateEnvVars(true)).toBe(true);
    expect(interpolateEnvVars(null)).toBe(null);
  });
});

// ── Config load integration ──────────────────────────────

describe("Config load integration", () => {
  const tmpDir = join(tmpdir(), `spark-e2e-int-${process.pid}`);

  function isolEnv() {
    // Prevent real ~/.spark-e2e/.env from leaking into tests
    writeFileSync(join(tmpDir, "_clean.env"), "# clean\n", "utf-8");
    process.env.SPARK_E2E_ENV = join(tmpDir, "_clean.env");
    vi.resetModules();
  }

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SPARK_E2E_") || key.startsWith("VLM_")) delete process.env[key];
    }
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads YAML config correctly", async () => {
    isolEnv();
    writeFileSync(join(tmpDir, ".spark-e2e.yaml"), `
browser:
  backend: playwright
  url: http://localhost:3000
viewport:
  width: 1920
  height: 1080
vlm:
  model: gpt-4-vision-preview
`.trim(), "utf-8");

    const { load } = await import("../config.js");
    const cfg = load(join(tmpDir, ".spark-e2e.yaml"));

    expect(cfg.browser.backend).toBe("playwright");
    expect(cfg.browser.url).toBe("http://localhost:3000");
    expect(cfg.viewport.width).toBe(1920);
    expect(cfg.viewport.height).toBe(1080);
    expect(cfg.vlm.model).toBe("gpt-4-vision-preview");
    expect(cfg.vlm.thinkingBudget).toBe(4000);
    expect(cfg.prompts.strictness).toBe("standard");
  });

  it("throws for explicitly provided but missing path", async () => {
    isolEnv();
    vi.resetModules();
    const { load } = await import("../config.js");
    expect(() => load("/no/such/config.yaml")).toThrow();
  });

  it("env vars override YAML values", async () => {
    isolEnv();
    writeFileSync(join(tmpDir, ".spark-e2e.yaml"), `
browser:
  backend: playwright
vlm:
  model: gpt-4o
`.trim(), "utf-8");

    process.env.SPARK_E2E_BACKEND = "browser-harness";
    process.env.SPARK_E2E_MODEL = "custom-model";

    const { load } = await import("../config.js");
    const cfg = load(join(tmpDir, ".spark-e2e.yaml"));
    expect(cfg.browser.backend).toBe("browser-harness");
    expect(cfg.vlm.model).toBe("custom-model");
  });

  it("apiKey is empty when not configured", async () => {
    isolEnv();
    writeFileSync(join(tmpDir, ".spark-e2e.yaml"), "browser:\n  backend: browser-harness\n", "utf-8");

    const { load } = await import("../config.js");
    const cfg = load(join(tmpDir, ".spark-e2e.yaml"));
    expect(cfg.vlm.apiKey).toBe("");
  });

  it("supports strictness values", async () => {
    isolEnv();
    writeFileSync(join(tmpDir, ".spark-e2e.yaml"), "prompts:\n  strictness: strict\n", "utf-8");
    const { load } = await import("../config.js");
    const cfg = load(join(tmpDir, ".spark-e2e.yaml"));
    expect(cfg.prompts.strictness).toBe("strict");
  });

  it("throws on empty YAML file", async () => {
    isolEnv();
    writeFileSync(join(tmpDir, ".spark-e2e.yaml"), "", "utf-8");
    const { load } = await import("../config.js");
    expect(() => load(join(tmpDir, ".spark-e2e.yaml"))).toThrow("YAML mapping");
  });
});

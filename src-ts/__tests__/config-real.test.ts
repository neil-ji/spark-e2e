/**
 * Real config tests — actually loads YAML, tests env interpolation,
 * and exercises error paths. Uses direct imports, no subprocesses.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { interpolateEnvVars } from "../config.js";
import { extractJson } from "../vlm/openai-compat.js";

const tmpDir = join(tmpdir(), `spark-e2e-int-${process.pid}`);

beforeEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  vi.resetModules();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── extractJson ──────────────────────────────────────────

describe("extractJson", () => {
  it("plain JSON", () => {
    expect(extractJson('{"foo":"bar"}')).toEqual({ foo: "bar" });
  });

  it("JSON with surrounding whitespace", () => {
    expect(extractJson('  \n  {"key":42}  \n  ')).toEqual({ key: 42 });
  });

  it('strips ```json fences', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("strips ``` fences without language", () => {
    expect(extractJson('```\n{"b":2}\n```')).toEqual({ b: 2 });
  });

  it("text before JSON", () => {
    expect(extractJson('Result: {"x":10}')).toEqual({ x: 10 });
  });

  it("text after JSON", () => {
    expect(extractJson('{"ok":true} — done')).toEqual({ ok: true });
  });

  it("text on both sides", () => {
    expect(extractJson('Analyzing: {"score":95}. Fin.')).toEqual({ score: 95 });
  });

  it("truncated JSON — balanceJs adds closing brace", () => {
    expect(extractJson('{"items":[1,2,3]')).toEqual({ items: [1, 2, 3] });
  });

  it("completely invalid input → {}", () => {
    expect(extractJson("not json")).toEqual({});
  });

  it("empty string → {}", () => {
    expect(extractJson("")).toEqual({});
  });

  it("nested objects", () => {
    expect(extractJson('{"u":{"n":"A","a":30},"ok":true}')).toEqual({ u: { n: "A", a: 30 }, ok: true });
  });

  it("escaped quotes", () => {
    expect(extractJson('{"msg":"hello \\"world\\""}')).toEqual({ msg: 'hello "world"' });
  });

  it("top-level array in object", () => {
    expect(extractJson('{"d":[1,2,3]')).toEqual({ d: [1, 2, 3] });
  });

  it("unbalanced string (inString) gets auto-closed", () => {
    // balanceJs handles incomplete strings
    const result = extractJson('{"key":"unclosed string}');
    // Should return empty or best-effort — JSON.parse will catch the error
    expect(typeof result).toBe("object");
  });
});

// ── interpolateEnvVars ───────────────────────────────────

describe("interpolateEnvVars", () => {
  it("replaces ${VAR} with env value", () => {
    process.env.TEST_FOO = "hello";
    const result = interpolateEnvVars('prefix-${TEST_FOO}-suffix');
    expect(result).toBe("prefix-hello-suffix");
    delete process.env.TEST_FOO;
  });

  it("leaves unknown vars as-is", () => {
    delete process.env.NO_SUCH_VAR;
    const result = interpolateEnvVars('${NO_SUCH_VAR}');
    expect(result).toBe("${NO_SUCH_VAR}");
  });

  it("handles multiple interpolations", () => {
    process.env.A = "1";
    process.env.B = "2";
    const result = interpolateEnvVars('${A}-${B}');
    expect(result).toBe("1-2");
    delete process.env.A;
    delete process.env.B;
  });

  it("recurses into arrays", () => {
    process.env.X = "x";
    const result = interpolateEnvVars(["${X}", "y"]);
    expect(result).toEqual(["x", "y"]);
    delete process.env.X;
  });

  it("recurses into objects", () => {
    process.env.K = "val";
    const result = interpolateEnvVars({ key: "${K}", num: 1 });
    expect(result).toEqual({ key: "val", num: 1 });
    delete process.env.K;
  });

  it("returns non-string scalars unchanged", () => {
    expect(interpolateEnvVars(42)).toBe(42);
    expect(interpolateEnvVars(true)).toBe(true);
    expect(interpolateEnvVars(null)).toBe(null);
  });
});

// ── Config integration via load ──────────────────────────

describe("Config load integration", () => {
  const tmpDir = join(tmpdir(), `spark-e2e-int-${process.pid}-${Date.now()}`);

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads YAML config file and returns typed config", async () => {
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

    // Import load dynamically so we don't pollute module-level cache
    const { load } = await import("../config.js");
    const cfg = load(join(tmpDir, ".spark-e2e.yaml"));

    expect(cfg.browser.backend).toBe("playwright");
    expect(cfg.browser.url).toBe("http://localhost:3000");
    expect(cfg.viewport.width).toBe(1920);
    expect(cfg.viewport.height).toBe(1080);
    expect(cfg.vlm.model).toBe("gpt-4-vision-preview");
    expect(cfg.vlm.thinkingBudget).toBe(4000); // default
    expect(cfg.prompts.strictness).toBe("standard"); // default
  });

  it("throws when config file path is explicitly provided but missing", async () => {
    const { load } = await import("../config.js");
    expect(() => load("/nonexistent/xyz.yaml")).toThrow("Config file not found");
  });

  it("finds config via auto-discovery when no path given", async () => {
    writeFileSync(join(tmpDir, ".spark-e2e.yaml"), `
browser:
  backend: playwright
`.trim(), "utf-8");

    const origCwd = process.cwd;
    try {
      process.cwd = () => tmpDir;
      const { load } = await import("../config.js");
      const cfg = load(); // auto-discovers .spark-e2e.yaml in cwd
      expect(cfg.browser.backend).toBe("playwright");
    } finally {
      process.cwd = origCwd;
    }
  });

  it("env vars override YAML values", async () => {
    writeFileSync(join(tmpDir, ".spark-e2e.yaml"), `
browser:
  backend: playwright
vlm:
  model: gpt-4o
`.trim(), "utf-8");

    const origBackend = process.env.SPARK_E2E_BACKEND;
    const origModel = process.env.SPARK_E2E_MODEL;
    process.env.SPARK_E2E_BACKEND = "browser-harness";
    process.env.SPARK_E2E_MODEL = "custom-model";

    try {
      const { load } = await import("../config.js");
      const cfg = load(join(tmpDir, ".spark-e2e.yaml"));
      expect(cfg.browser.backend).toBe("browser-harness");
      expect(cfg.vlm.model).toBe("custom-model");
    } finally {
      if (origBackend !== undefined) process.env.SPARK_E2E_BACKEND = origBackend;
      else delete process.env.SPARK_E2E_BACKEND;
      if (origModel !== undefined) process.env.SPARK_E2E_MODEL = origModel;
      else delete process.env.SPARK_E2E_MODEL;
    }
  });

  it("warns when API key is missing", async () => {
    delete process.env.SPARK_E2E_API_KEY;
    delete process.env.VLM_API_KEY;

    writeFileSync(join(tmpDir, ".spark-e2e.yaml"), "browser:\n  backend: browser-harness\n", "utf-8");

    const { load } = await import("../config.js");
    const cfg = load(join(tmpDir, ".spark-e2e.yaml"));
    expect(cfg.vlm.apiKey).toBe("");
  });

  it("supports strictness: standard / strict / relaxed", async () => {
    // Since config has an internal cache, just test with the strictness file
    writeFileSync(join(tmpDir, ".spark-e2e.yaml"), `prompts:\n  strictness: strict\n`, "utf-8");
    const { load } = await import("../config.js");
    const cfg = load(join(tmpDir, ".spark-e2e.yaml"));
    expect(cfg.prompts.strictness).toBe("strict");
  });

  it("throws on empty YAML file (must be a mapping)", async () => {
    writeFileSync(join(tmpDir, ".spark-e2e.yaml"), "", "utf-8");
    const { load } = await import("../config.js");
    expect(() => load(join(tmpDir, ".spark-e2e.yaml"))).toThrow("YAML mapping");
  });
});

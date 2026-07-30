import { describe, it, expect } from "vitest";
import { extractJson, balanceJson } from "../vlm/openai-compat.js";
import { interpolateEnvVars, ConfigSchema } from "../config.js";

describe("extractJson", () => {
  it("plain JSON", () => expect(extractJson('{"a":1}')).toEqual({ a: 1 }));
  it("with ``` fences", () => expect(extractJson('```json\n{"b":2}\n```')).toEqual({ b: 2 }));
  it("text before JSON", () => expect(extractJson('Result: {"x":10}')).toEqual({ x: 10 }));
  it("truncated", () => expect(extractJson('{"items":[1,2,3]')).toEqual({ items: [1, 2, 3] }));
  it("empty → {}", () => expect(extractJson("")).toEqual({}));
  it("invalid → {}", () => expect(extractJson("not json")).toEqual({}));
});

describe("balanceJson", () => {
  it("already balanced", () => expect(balanceJson('{"a":1}')[0]).toBe('{"a":1}'));
  it("missing brace", () => expect(JSON.parse(balanceJson('{"a":1')[0])).toEqual({ a: 1 }));
});

describe("interpolateEnvVars", () => {
  it("replaces ${VAR}", () => {
    process.env.TEST_V = "X";
    expect(interpolateEnvVars("${TEST_V}")).toBe("X");
    delete process.env.TEST_V;
  });
  it("unknown unchanged", () => {
    delete process.env.NOVAR;
    expect(interpolateEnvVars("${NOVAR}")).toBe("${NOVAR}");
  });
});

describe("CLI AGENTS", () => {
  it("has spark-hub", async () => {
    const { AGENTS } = await import("../cli.js");
    const sh = AGENTS.find((a: any) => a.name === "spark-hub");
    expect(sh).toBeDefined();
    expect(sh.projectDir).toBe(".spark/skills");
    expect(sh.userDir).toBe(".spark/config/custom-skills");
  });

  it("has all 5 agents", async () => {
    const { AGENTS } = await import("../cli.js");
    expect(AGENTS).toHaveLength(5);
  });
});

// ── Tier 1.1: Security config schema ───────────────────────

describe("security config", () => {
  it("schema default maskSelectors is empty (browser masking removed)", () => {
    const result = ConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.security.maskSelectors).toHaveLength(0);
    }
  });

  it("custom maskSelectors override defaults", () => {
    const result = ConfigSchema.safeParse({
      security: { maskSelectors: ['.secret-field', '#api-key-display'] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.security.maskSelectors).toEqual(['.secret-field', '#api-key-display']);
    }
  });

  it("empty maskSelectors array is valid", () => {
    const result = ConfigSchema.safeParse({
      security: { maskSelectors: [] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.security.maskSelectors).toHaveLength(0);
    }
  });
});

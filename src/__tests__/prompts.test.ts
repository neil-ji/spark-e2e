import { describe, it, expect } from "vitest";
import { getTestPrompt, getLocatePrompt, getBaselineComparePrompt, getReviewPrompt, getAssertPrompt } from "../prompts.js";

describe("getTestPrompt", () => {
  it("includes expectations in output", () => {
    const prompt = getTestPrompt("sidebar has 5 items", "standard");
    expect(prompt).toContain("sidebar has 5 items");
    expect(prompt).toContain("EXPECTATIONS TO VERIFY");
    expect(prompt).toContain('"pass": true|false');
  });

  it("strict mode adds extra rules (longer output)", () => {
    const std = getTestPrompt("x", "standard");
    const strict = getTestPrompt("x", "strict");
    expect(strict.length).toBeGreaterThan(std.length);
  });

  it("relaxed mode is shorter than strict", () => {
    const strict = getTestPrompt("x", "strict");
    const relaxed = getTestPrompt("x", "relaxed");
    expect(relaxed.length).toBeLessThan(strict.length);
  });

  it("prompts for multi-expectation text", () => {
    const prompt = getTestPrompt("A. sidebar has items\nB. cards equal height\nC. no clipping", "standard");
    expect(prompt).toContain("A. sidebar has items");
    expect(prompt).toContain("B. cards equal height");
    expect(prompt).toContain("C. no clipping");
  });
});

describe("getLocatePrompt", () => {
  it("includes target element description", () => {
    const prompt = getLocatePrompt("the Submit button");
    expect(prompt).toContain("the Submit button");
    expect(prompt).toContain("Find this element:");
  });

  it("requests pixel coordinates", () => {
    const prompt = getLocatePrompt("login link");
    expect(prompt).toContain("x");
    expect(prompt).toContain("y");
    expect(prompt).toContain("coordinates");
  });

  it("handles special characters in target", () => {
    const prompt = getLocatePrompt('button labeled "Sign In"');
    expect(prompt).toContain('button labeled "Sign In"');
  });

  it("returns found/not-found schema", () => {
    const prompt = getLocatePrompt("any element");
    expect(prompt).toContain('"found": true|false');
    expect(prompt).toContain('"confidence"');
  });
});

describe("getBaselineComparePrompt", () => {
  it("includes baseline name", () => {
    const prompt = getBaselineComparePrompt("dashboard-v1");
    expect(prompt).toContain("dashboard-v1");
  });

  it("describes two-image comparison", () => {
    const prompt = getBaselineComparePrompt("v1");
    expect(prompt).toContain("BASELINE");
    expect(prompt).toContain("CURRENT");
    expect(prompt).toContain("TWO screenshots");
  });

  it("returns match/changes schema", () => {
    const prompt = getBaselineComparePrompt("v1");
    expect(prompt).toContain('"match": true|false');
    expect(prompt).toContain('"changes"');
    expect(prompt).toContain('"region"');
  });

  it("mentions anti-aliasing as ignored", () => {
    const prompt = getBaselineComparePrompt("v1");
    expect(prompt).toContain("Anti-aliasing");
  });
});

// ── Tier 0.3: Credential safety rules ──────────────────────

const ALL_PROMPTS = {
  getTestPrompt: () => getTestPrompt("check login", "standard"),
  getLocatePrompt: () => getLocatePrompt("Submit button"),
  getBaselineComparePrompt: () => getBaselineComparePrompt("v1"),
  getReviewPrompt: () => getReviewPrompt("standard"),
  getAssertPrompt: () => getAssertPrompt("standard"),
};

describe("credential safety in all prompts", () => {
  for (const [name, fn] of Object.entries(ALL_PROMPTS)) {
    it(`${name} includes CREDENTIAL SAFETY RULES`, () => {
      const prompt = fn();
      expect(prompt).toContain("CREDENTIAL SAFETY RULES");
    });

    it(`${name} bans credential transcription`, () => {
      const prompt = fn();
      expect(prompt).toContain("credential visible");
    });

    it(`${name} bans password/API key quoting`, () => {
      const prompt = fn();
      expect(prompt).toContain("passwords");
      expect(prompt).toContain("API keys");
    });
  }
});

/**
 * Tests for review engine — prompt building and post-processing.
 *
 * VLM integration is mocked since it requires a real API endpoint.
 */
import { describe, it, expect } from "vitest";
import {
  buildLightReviewPrompt,
  buildDimensionReviewPrompt,
  getDimensions,
  buildAssertPrompt,
  buildLocatePrompt,
  buildBaselineComparePrompt,
} from "../../engine/prompts/index.js";

describe("getDimensions", () => {
  it("returns all 6 dimensions for comprehensive focus", () => {
    const dims = getDimensions("comprehensive");
    expect(dims).toHaveLength(6);
    expect(dims.map((d) => d.key).sort()).toEqual([
      "charts",
      "color",
      "interactive",
      "layout",
      "spacing",
      "typography",
    ]);
  });

  it("returns layout + spacing for layout focus", () => {
    const dims = getDimensions("layout");
    expect(dims).toHaveLength(2);
    expect(dims.map((d) => d.key)).toContain("layout");
    expect(dims.map((d) => d.key)).toContain("spacing");
  });

  it("returns charts + typography for charts focus", () => {
    const dims = getDimensions("charts");
    expect(dims).toHaveLength(2);
    expect(dims.map((d) => d.key)).toContain("charts");
    expect(dims.map((d) => d.key)).toContain("typography");
  });

  it("returns single dimension for specific focus", () => {
    const dims = getDimensions("color");
    expect(dims).toHaveLength(1);
    expect(dims[0].key).toBe("color");
  });
});

describe("buildLightReviewPrompt", () => {
  it("includes focus area and safety rules", () => {
    const prompt = buildLightReviewPrompt("layout", "standard");
    expect(prompt).toContain("CREDENTIAL SAFETY RULES");
    expect(prompt).toContain("ANTI-HALLUCINATION RULES");
    expect(prompt).toContain("adjacent cards");
    expect(prompt).toContain("Respond ONLY with a JSON object");
  });

  it("injects aesthetics when provided", () => {
    const prompt = buildLightReviewPrompt("color", "standard", "## Colors\n- Primary: #F0824C");
    expect(prompt).toContain("AESTHETIC & LAYOUT PRINCIPLES");
    expect(prompt).toContain("#F0824C");
  });

  it("omits aesthetics block when empty", () => {
    const prompt = buildLightReviewPrompt("comprehensive", "standard", "");
    expect(prompt).not.toContain("AESTHETIC & LAYOUT PRINCIPLES");
  });

  it("includes strict mode addendum", () => {
    const prompt = buildLightReviewPrompt("comprehensive", "strict");
    expect(prompt).toContain("STRICT MODE");
    expect(prompt).toContain("95%+ confidence");
  });

  it("includes relaxed mode addendum", () => {
    const prompt = buildLightReviewPrompt("comprehensive", "relaxed");
    expect(prompt).toContain("RELAXED MODE");
    expect(prompt).toContain("false positives are acceptable");
  });
});

describe("buildDimensionReviewPrompt", () => {
  it("includes dimension-specific instructions", () => {
    const dims = getDimensions("typography");
    const prompt = buildDimensionReviewPrompt(dims[0], "standard");
    expect(prompt).toContain("typography");
    expect(prompt).toContain("Ignore issues outside your specialty");
    expect(prompt).toContain("CREDENTIAL SAFETY RULES");
  });

  it("each dimension has distinct prompts", () => {
    const layoutPrompt = buildDimensionReviewPrompt(getDimensions("layout")[0], "standard");
    const colorPrompt = buildDimensionReviewPrompt(getDimensions("color")[0], "standard");
    expect(layoutPrompt).not.toBe(colorPrompt);
    expect(layoutPrompt).toContain("LAYOUT & STRUCTURAL");
    expect(colorPrompt).toContain("COLOR consistency");
  });
});

describe("buildAssertPrompt", () => {
  it("includes the assertion text", () => {
    const prompt = buildAssertPrompt("sidebar has 5 items", "standard");
    expect(prompt).toContain("sidebar has 5 items");
    expect(prompt).toContain("CREDENTIAL SAFETY RULES");
    expect(prompt).toContain("pass/fail");
  });
});

describe("buildLocatePrompt", () => {
  it("includes the target element description", () => {
    const prompt = buildLocatePrompt("Sign In button");
    expect(prompt).toContain("Sign In button");
    expect(prompt).toContain("CENTER pixel coordinates");
    expect(prompt).toContain("x");
    expect(prompt).toContain("y");
  });
});

describe("buildBaselineComparePrompt", () => {
  it("includes baseline name and comparison rules", () => {
    const prompt = buildBaselineComparePrompt("dashboard-v1");
    expect(prompt).toContain("dashboard-v1");
    expect(prompt).toContain("TWO screenshots");
    expect(prompt).toContain("Anti-aliasing");
    expect(prompt).toContain("layout_shift");
  });
});

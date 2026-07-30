/**
 * Tests for dom-lint engine — deterministic DOM rule checking.
 */
import { describe, it, expect } from "vitest";
import { domLint } from "../../engine/dom-lint.js";
import "../../engine/rules.js"; // register built-in rules
import type { DomDump } from "../../schemas.js";

// ── Test fixtures ────────────────────────────────────────

function makeDump(elements: DomDump["elements"]): DomDump {
  return { url: "http://localhost:3000", viewport: { width: 1600, height: 1200 }, elements };
}

function makeEl(overrides: Record<string, unknown> = {}): DomDump["elements"][0] {
  return {
    ref: "@div-1",
    tag: "DIV",
    classes: [],
    computed: {
      color: "rgb(0, 0, 0)",
      backgroundColor: "rgba(0, 0, 0, 0)",
      fontSize: "14px",
      fontWeight: "400",
      opacity: "1",
    },
    attributes: {},
    text: "",
    children: [],
    ...overrides,
  } as DomDump["elements"][0];
}

describe("dom-lint", () => {
  it("returns empty findings for clean DOM", () => {
    const dump = makeDump([makeEl()]);
    const result = domLint({ dom: dump });
    expect(result.findings).toHaveLength(0);
    expect(result.summary).toContain("No DOM lint issues found");
  });

  it("runs all built-in rules by default", () => {
    const dump = makeDump([makeEl()]);
    const result = domLint({ dom: dump });
    // All 6 rules registered and ran
    expect(result.rulesRun).toHaveLength(6);
  });

  it("can selectively enable rules", () => {
    const dump = makeDump([makeEl()]);
    const result = domLint({
      dom: dump,
      enabledRules: ["missing-alt", "empty-button"],
    });
    expect(result.rulesRun).toEqual(["missing-alt", "empty-button"]);
  });
});

describe("no-hardcoded-px rule", () => {
  it("detects hardcoded px in inline margin", () => {
    const dump = makeDump([
      makeEl({
        ref: "@bad-div",
        tag: "DIV",
        inline: { margin: "20px", padding: "var(--space-3)" },
      }),
    ]);

    const result = domLint({
      dom: dump,
      enabledRules: ["no-hardcoded-px"],
    });

    const finding = result.findings.find((f) => f.element === "@bad-div");
    expect(finding).toBeDefined();
    expect(finding!.ruleId).toBe("no-hardcoded-px");
    expect(finding!.description).toContain("20px");
  });

  it("ignores var() references and 0 values", () => {
    const dump = makeDump([
      makeEl({
        ref: "@good-div",
        tag: "DIV",
        inline: { margin: "var(--space-3)", padding: "0" },
      }),
    ]);

    const result = domLint({
      dom: dump,
      enabledRules: ["no-hardcoded-px"],
    });

    expect(result.findings).toHaveLength(0);
  });

  it("checks gap and padding too", () => {
    const dump = makeDump([
      makeEl({
        ref: "@flex",
        tag: "DIV",
        inline: { gap: "16px", padding: "8px" },
      }),
    ]);

    const result = domLint({
      dom: dump,
      enabledRules: ["no-hardcoded-px"],
    });

    expect(result.findings).toHaveLength(2);
  });
});

describe("no-raw-colors rule", () => {
  it("detects hardcoded hex color", () => {
    const dump = makeDump([
      makeEl({
        ref: "@bad-color",
        tag: "SPAN",
        inline: { color: "#333333" },
      }),
    ]);

    const result = domLint({
      dom: dump,
      enabledRules: ["no-raw-colors"],
    });

    const finding = result.findings.find((f) => f.element === "@bad-color");
    expect(finding).toBeDefined();
    expect(finding!.ruleId).toBe("no-raw-colors");
  });

  it("ignores transparent and var() colors", () => {
    const dump = makeDump([
      makeEl({
        ref: "@good-color",
        tag: "SPAN",
        inline: { color: "transparent", backgroundColor: "var(--spark-bg)" },
      }),
    ]);

    const result = domLint({
      dom: dump,
      enabledRules: ["no-raw-colors"],
    });

    expect(result.findings).toHaveLength(0);
  });
});

describe("font-weight-audit rule", () => {
  it("detects font-weight mismatch when dom-rules provided", () => {
    const dump = makeDump([
      makeEl({
        ref: "@btn-1",
        tag: "BUTTON",
        classes: ["spark-button"],
        computed: { color: "rgb(0,0,0)", backgroundColor: "rgba(0,0,0,0)", fontSize: "14px", fontWeight: "400", opacity: "1" },
      }),
    ]);

    const domRules = {
      version: "1",
      generatedAt: "2026-01-01T00:00:00Z",
      tokens: { colors: {}, spacing: [], fontSizes: [] },
      rules: {
        typography: [{ selector: "spark-button", fontWeight: "500" }],
        components: {},
      },
    };

    const result = domLint({
      dom: dump,
      rules: domRules,
      enabledRules: ["font-weight-audit"],
    });

    const finding = result.findings.find((f) => f.element === "@btn-1");
    expect(finding).toBeDefined();
    expect(finding!.description).toContain("400");
    expect(finding!.description).toContain("500");
  });

  it("passes when font-weight matches", () => {
    const dump = makeDump([
      makeEl({
        ref: "@btn-2",
        tag: "BUTTON",
        classes: ["spark-button"],
        computed: { color: "rgb(0,0,0)", backgroundColor: "rgba(0,0,0,0)", fontSize: "14px", fontWeight: "500", opacity: "1" },
      }),
    ]);

    const domRules = {
      version: "1",
      generatedAt: "2026-01-01T00:00:00Z",
      tokens: { colors: {}, spacing: [], fontSizes: [] },
      rules: {
        typography: [{ selector: "spark-button", fontWeight: "500" }],
        components: {},
      },
    };

    const result = domLint({
      dom: dump,
      rules: domRules,
      enabledRules: ["font-weight-audit"],
    });

    expect(result.findings).toHaveLength(0);
  });
});

describe("missing-alt rule", () => {
  it("detects img without alt attribute", () => {
    const dump = makeDump([
      makeEl({ ref: "@img-1", tag: "IMG", attributes: { src: "photo.jpg" } }),
    ]);

    const result = domLint({
      dom: dump,
      enabledRules: ["missing-alt"],
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].element).toBe("@img-1");
  });

  it("passes img with alt attribute", () => {
    const dump = makeDump([
      makeEl({ ref: "@img-2", tag: "IMG", attributes: { src: "photo.jpg", alt: "A photo" } }),
    ]);

    const result = domLint({
      dom: dump,
      enabledRules: ["missing-alt"],
    });

    expect(result.findings).toHaveLength(0);
  });
});

describe("empty-button rule", () => {
  it("detects button without text or label", () => {
    const dump = makeDump([
      makeEl({ ref: "@btn-empty", tag: "BUTTON", text: "" }),
    ]);

    const result = domLint({
      dom: dump,
      enabledRules: ["empty-button"],
    });

    expect(result.findings).toHaveLength(1);
  });

  it("passes button with text", () => {
    const dump = makeDump([
      makeEl({ ref: "@btn-ok", tag: "BUTTON", text: "Submit" }),
    ]);

    const result = domLint({
      dom: dump,
      enabledRules: ["empty-button"],
    });

    expect(result.findings).toHaveLength(0);
  });

  it("passes button with aria-label", () => {
    const dump = makeDump([
      makeEl({ ref: "@btn-icon", tag: "BUTTON", text: "", attributes: { "aria-label": "Close" } }),
    ]);

    const result = domLint({
      dom: dump,
      enabledRules: ["empty-button"],
    });

    expect(result.findings).toHaveLength(0);
  });
});

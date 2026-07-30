/**
 * Tests for dom-get engine — element property lookup.
 */
import { describe, it, expect } from "vitest";
import { domGet, domFind } from "../../engine/dom-get.js";
import type { DomDump } from "../../schemas.js";

// ── Test fixtures ────────────────────────────────────────

const testDump: DomDump = {
  url: "http://localhost:3000/dashboard",
  viewport: { width: 1600, height: 1200 },
  elements: [
    {
      ref: "@div-1",
      tag: "DIV",
      classes: ["spark-layout"],
      computed: {
        color: "rgb(0, 0, 0)",
        backgroundColor: "rgba(0, 0, 0, 0)",
        fontSize: "16px",
        fontWeight: "400",
        opacity: "1",
      },
      attributes: {},
      text: "Main container",
      children: [
        {
          ref: "@button-3",
          tag: "BUTTON",
          classes: ["spark-button", "spark-button--primary"],
          computed: {
            color: "rgb(255, 255, 255)",
            backgroundColor: "rgba(240, 130, 76, 0.45)",
            fontSize: "14px",
            fontWeight: "500",
            opacity: "0.45",
          },
          attributes: { disabled: "", "aria-disabled": "true", type: "submit" },
          text: "Login",
          children: [],
        },
        {
          ref: "@img-hero",
          tag: "IMG",
          classes: ["spark-hero-image"],
          computed: {
            color: "rgba(0,0,0,0)",
            backgroundColor: "rgba(0,0,0,0)",
            fontSize: "16px",
            fontWeight: "400",
            opacity: "1",
          },
          attributes: { src: "/hero.jpg", alt: "Dashboard overview" },
          text: "",
          children: [],
        },
      ],
    },
  ],
};

describe("domGet", () => {
  it("returns element by exact ref match", () => {
    const result = domGet("@button-3", testDump);
    expect(result).not.toBeNull();
    expect(result!.tag).toBe("BUTTON");
    expect(result!.classes).toContain("spark-button--primary");
    expect(result!.computed.color).toBe("rgb(255, 255, 255)");
  });

  it("returns nested element", () => {
    const result = domGet("@button-3", testDump);
    expect(result!.attributes.disabled).toBe("");
    expect(result!.attributes["aria-disabled"]).toBe("true");
    expect(result!.text).toBe("Login");
  });

  it("returns null for nonexistent ref", () => {
    const result = domGet("@nonexistent", testDump);
    expect(result).toBeNull();
  });

  it("returns root element", () => {
    const result = domGet("@div-1", testDump);
    expect(result).not.toBeNull();
    expect(result!.tag).toBe("DIV");
  });

  it("returns computed opacity for disabled element", () => {
    const result = domGet("@button-3", testDump);
    expect(result!.computed.opacity).toBe("0.45");
    expect(result!.computed.backgroundColor).toContain("0.45");
  });
});

describe("domFind", () => {
  it("finds elements by CSS class", () => {
    const results = domFind(".spark-button", testDump);
    expect(results).toHaveLength(1);
    expect(results[0].ref).toBe("@button-3");
  });

  it("finds elements by tag name", () => {
    const results = domFind("IMG", testDump);
    expect(results).toHaveLength(1);
    expect(results[0].ref).toBe("@img-hero");
    expect(results[0].attributes.alt).toBe("Dashboard overview");
  });

  it("returns empty array for no matches", () => {
    const results = domFind(".nonexistent-class", testDump);
    expect(results).toHaveLength(0);
  });
});

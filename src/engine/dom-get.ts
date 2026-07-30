/**
 * dom-get — precise element property lookup by @ref.
 *
 * Given a DOM dump and an element ref, return its full detail:
 * tag, classes, computed styles, attributes, text, and bounding rect.
 *
 * Used by agents to cross-validate VLM findings:
 *   Agent: "VLM says @button-3 color is wrong"
 *   dom-get @button-3 → computed.background = rgba(240,130,76,0.45) + disabled=""
 *   → Conclusion: button is disabled (45% opacity), not a bug
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DomDump, DomElement, DomGetOutput } from "../schemas.js";

// ── Helpers ──────────────────────────────────────────────

function flattenElements(elements: DomElement[]): DomElement[] {
  const result: DomElement[] = [];
  function walk(el: DomElement) {
    result.push(el);
    for (const child of el.children) walk(child);
  }
  for (const el of elements) walk(el);
  return result;
}

function loadDomDump(domPath: string): DomDump {
  const path = resolve(domPath);
  if (!existsSync(path)) {
    throw new Error(`DOM dump not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as DomDump;
}

// ── Public API ────────────────────────────────────────────

/**
 * Look up a single element by @ref in a DOM dump file or object.
 */
export function domGet(ref: string, domInput: string | DomDump): DomGetOutput | null {
  const dump = typeof domInput === "string" ? loadDomDump(domInput) : domInput;
  const all = flattenElements(dump.elements);
  const el = all.find((e) => e.ref === ref);

  if (!el) return null;

  // Derive bounding rect from the element's position in the layout tree.
  // The DOM dump format has position data on the root children;
  // for nested elements, we don't have exact rect data in the current format.
  // Return what we can — exact rect info depends on the DOM dump producer.
  return {
    ref: el.ref,
    tag: el.tag,
    classes: el.classes,
    computed: el.computed,
    attributes: el.attributes,
    text: el.text,
    rect: { x: 0, y: 0, width: 0, height: 0 }, // requires layout data in dump
  };
}

/**
 * Look up multiple elements matching a CSS class selector.
 */
export function domFind(selector: string, domInput: string | DomDump): DomGetOutput[] {
  const dump = typeof domInput === "string" ? loadDomDump(domInput) : domInput;
  const all = flattenElements(dump.elements);

  // Support simple class selectors: ".spark-button", "button.spark-button--primary"
  const isTagSelector = !selector.startsWith(".");
  const className = selector.replace(/^\./, "").split(".").filter(Boolean).join("");

  const matches = all.filter((el) => {
    if (!isTagSelector) {
      return el.classes.some((c) => c.includes(className));
    }
    return el.tag.toLowerCase() === selector.toLowerCase();
  });

  return matches.map((el) => ({
    ref: el.ref,
    tag: el.tag,
    classes: el.classes,
    computed: el.computed,
    attributes: el.attributes,
    text: el.text,
    rect: { x: 0, y: 0, width: 0, height: 0 },
  }));
}

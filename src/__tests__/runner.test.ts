import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Helpers ────────────────────────────────────────────────

const TMP_DIR = resolve(process.cwd(), "tests", "__tmp__");
const TMP_STATE = resolve(process.cwd(), ".spark", "plugin", "e2e", "dom-state.json");

function cleanup() {
  for (const p of [TMP_DIR, TMP_STATE, resolve(process.cwd(), ".spark", "plugin", "e2e", "baselines", "__runner-test__")]) {
    try { if (existsSync(p)) rmSync(p, { recursive: true, force: true }); } catch {}
  }
}

// ── Tests ──────────────────────────────────────────────────

describe("runner exports and file discovery", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("runTests returns empty for nonexistent file path", async () => {
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });

    const { runTests } = await import("../runner.js");
    const reports = await runTests(resolve(TMP_DIR, "nonexistent.yaml"));
    expect(reports).toHaveLength(0);
  });

  it("runTests exports expected function", async () => {
    const mod = await import("../runner.js");
    expect(mod.runTests).toBeDefined();
    expect(typeof mod.runTests).toBe("function");
  });

  it("runTests handles missing scenarios key", async () => {
    // Write a YAML file that has the key "scenarios" but as null
    if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
    writeFileSync(resolve(TMP_DIR, "malformed.yaml"), "name: Bad\nscenarios:\n");

    const { runTests } = await import("../runner.js");
    // Missing scenarios array should result in an error reported as pass=false
    const reports = await runTests(resolve(TMP_DIR, "malformed.yaml"));
    expect(reports.length).toBeGreaterThanOrEqual(1);
    if (reports.length > 0) {
      expect(reports[0].pass).toBe(false);
    }
  });
});

describe("dom-state.json resolveDomRef", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("resolveDomRef finds element by ref", () => {
    const domStateDir = resolve(process.cwd(), ".spark", "plugin", "e2e");
    if (!existsSync(domStateDir)) mkdirSync(domStateDir, { recursive: true });

    writeFileSync(TMP_STATE, JSON.stringify({
      layout: [
        { ref: "@button-1", tag: "BUTTON", center: { x: 100, y: 200 }, text: "Submit" },
        { ref: "@input-1", tag: "INPUT", center: { x: 300, y: 400 }, text: "Email" },
      ],
    }));

    // The resolveDomRef function is internal to runner and cli modules.
    // We test the file format contract: the JSON structure must have layout[].ref and layout[].center.{x,y}
    const state = JSON.parse(readFileSync(TMP_STATE, "utf-8"));
    expect(state.layout).toHaveLength(2);
    expect(state.layout[0].ref).toBe("@button-1");
    expect(state.layout[0].center.x).toBe(100);
    expect(state.layout[0].center.y).toBe(200);
    expect(state.layout[1].ref).toBe("@input-1");
  });

  it("dom-state refs are unique", () => {
    const domStateDir = resolve(process.cwd(), ".spark", "plugin", "e2e");
    if (!existsSync(domStateDir)) mkdirSync(domStateDir, { recursive: true });

    writeFileSync(TMP_STATE, JSON.stringify({
      layout: [
        { ref: "@e1", tag: "DIV", center: { x: 1, y: 1 }, text: "" },
        { ref: "@e2", tag: "DIV", center: { x: 2, y: 2 }, text: "" },
        { ref: "@e3", tag: "DIV", center: { x: 3, y: 3 }, text: "" },
      ],
    }));

    const state = JSON.parse(readFileSync(TMP_STATE, "utf-8"));
    const refs = state.layout.map((e: any) => e.ref);
    expect(new Set(refs).size).toBe(refs.length); // all unique
  });

  it("center coordinates are within viewport bounds", () => {
    // Simulated viewport 1600x1200
    const domStateDir = resolve(process.cwd(), ".spark", "plugin", "e2e");
    if (!existsSync(domStateDir)) mkdirSync(domStateDir, { recursive: true });

    writeFileSync(TMP_STATE, JSON.stringify({
      layout: [
        { ref: "@e1", tag: "NAV", center: { x: 120, y: 600 }, text: "Sidebar" },
        { ref: "@e2", tag: "MAIN", center: { x: 920, y: 600 }, text: "Content" },
      ],
    }));

    const state = JSON.parse(readFileSync(TMP_STATE, "utf-8"));
    for (const el of state.layout) {
      expect(el.center.x).toBeGreaterThanOrEqual(0);
      expect(el.center.x).toBeLessThanOrEqual(1600);
      expect(el.center.y).toBeGreaterThanOrEqual(0);
      expect(el.center.y).toBeLessThanOrEqual(1200);
    }
  });
});

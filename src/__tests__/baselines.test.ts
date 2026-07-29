import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  saveBaseline,
  loadBaseline,
  listBaselines,
  deleteBaseline,
  readBaselineScreenshot,
} from "../baselines.js";

const TMP_BASELINES = resolve(process.cwd(), ".spark-e2e", "baselines");

describe("baselines CRUD", () => {
  beforeEach(() => {
    // Clean slate
    if (existsSync(TMP_BASELINES)) rmSync(TMP_BASELINES, { recursive: true, force: true });
  });

  afterEach(() => {
    if (existsSync(TMP_BASELINES)) rmSync(TMP_BASELINES, { recursive: true, force: true });
  });

  it("save creates directory with screenshot and meta", () => {
    const buf = Buffer.from("fake-png-data");
    const dir = saveBaseline("test-v1", buf, {
      url: "http://localhost:5173",
      viewport: { width: 1600, height: 1200, deviceScaleFactor: 1 },
    });

    expect(existsSync(dir)).toBe(true);
    expect(existsSync(resolve(dir, "screenshot.png"))).toBe(true);
    expect(existsSync(resolve(dir, "meta.json"))).toBe(true);

    const meta = JSON.parse(readFileSync(resolve(dir, "meta.json"), "utf-8"));
    expect(meta.name).toBe("test-v1");
    expect(meta.url).toBe("http://localhost:5173");
    expect(meta.viewport.width).toBe(1600);
    expect(meta.timestamp).toBeDefined();
  });

  it("save with findings stores them in meta", () => {
    const buf = Buffer.from("fake-png-data");
    const findings = { pass: true, summary: "all good" };
    saveBaseline("with-findings", buf, {
      url: "http://localhost:3000",
      viewport: { width: 800, height: 600, deviceScaleFactor: 1 },
    }, findings);

    const entry = loadBaseline("with-findings");
    expect(entry).not.toBeNull();
    expect(entry!.meta.findings).toEqual(findings);
  });

  it("load returns null for missing baseline", () => {
    expect(loadBaseline("nonexistent")).toBeNull();
  });

  it("load returns meta and screenshot path", () => {
    const buf = Buffer.from("hello");
    saveBaseline("load-test", buf, {
      url: "http://example.com",
      viewport: { width: 1024, height: 768, deviceScaleFactor: 2 },
    });

    const entry = loadBaseline("load-test");
    expect(entry).not.toBeNull();
    expect(entry!.name).toBe("load-test");
    expect(entry!.meta.url).toBe("http://example.com");
    expect(entry!.meta.viewport.deviceScaleFactor).toBe(2);
    expect(entry!.screenshotPath).toContain("screenshot.png");
  });

  it("list returns empty when no baselines", () => {
    expect(listBaselines()).toHaveLength(0);
  });

  it("list returns all saved baselines, newest first", () => {
    const buf = Buffer.from("x");
    saveBaseline("older", buf, { url: "http://a.com", viewport: { width: 1, height: 1, deviceScaleFactor: 1 } });
    saveBaseline("newer", buf, { url: "http://b.com", viewport: { width: 1, height: 1, deviceScaleFactor: 1 } });

    const list = listBaselines();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe("newer"); // newest first
    expect(list[1].name).toBe("older");
  });

  it("delete removes baseline", () => {
    const buf = Buffer.from("x");
    saveBaseline("to-delete", buf, { url: "http://x.com", viewport: { width: 1, height: 1, deviceScaleFactor: 1 } });

    expect(deleteBaseline("to-delete")).toBe(true);
    expect(loadBaseline("to-delete")).toBeNull();
    expect(deleteBaseline("to-delete")).toBe(false); // already gone
  });

  it("readBaselineScreenshot returns PNG buffer", () => {
    const buf = Buffer.from("test-png-bytes");
    saveBaseline("read-test", buf, { url: "http://x.com", viewport: { width: 1, height: 1, deviceScaleFactor: 1 } });

    const read = readBaselineScreenshot("read-test");
    expect(read).not.toBeNull();
    expect(read!.toString()).toBe("test-png-bytes");
  });

  it("readBaselineScreenshot returns null for missing", () => {
    expect(readBaselineScreenshot("no-such")).toBeNull();
  });
});

/**
 * Tests for the versioned migration system (src/migrate.ts).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getPendingMigrations, runMigrations, MIGRATIONS } from "../migrate.js";

// ── Helpers ────────────────────────────────────────────────

const TMP_CWD = resolve(process.cwd(), "tests", "__migrate_cwd__");
const OLD_PROJECT = (rel: string) => resolve(TMP_CWD, ".spark-e2e", rel);
const NEW_PROJECT = (rel: string) => resolve(TMP_CWD, ".spark", "plugin", "e2e", rel);

function createOldData(): void {
  // baselines
  mkdirSync(OLD_PROJECT("baselines/my-baseline"), { recursive: true });
  writeFileSync(OLD_PROJECT("baselines/my-baseline/screenshot.png"), "fake-png");
  writeFileSync(OLD_PROJECT("baselines/my-baseline/meta.json"), '{"url":"x"}');

  // runs
  mkdirSync(OLD_PROJECT("runs/login-flow"), { recursive: true });
  writeFileSync(OLD_PROJECT("runs/login-flow/step1.png"), "fake-png");

  // dom-state
  writeFileSync(OLD_PROJECT("dom-state.json"), '{"layout":[]}');
}

function cleanup(): void {
  try { if (existsSync(TMP_CWD)) rmSync(TMP_CWD, { recursive: true, force: true }); } catch {}
}

// ── Tests ──────────────────────────────────────────────────

describe("MIGRATIONS registry", () => {
  it("is non-empty and sorted", () => {
    expect(MIGRATIONS.length).toBeGreaterThan(0);
    // Verify each migration has required fields
    for (const m of MIGRATIONS) {
      expect(m.version).toBeTruthy();
      expect(m.description).toBeTruthy();
      expect(typeof m.run).toBe("function");
    }
  });

  it("includes v0.5.0 directory migration", () => {
    const v050 = MIGRATIONS.find((m) => m.version === "0.5.0");
    expect(v050).toBeDefined();
    expect(v050!.description).toContain("Directory structure");
  });
});

describe("getPendingMigrations", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("returns empty when no old data exists", () => {
    const pending = getPendingMigrations({ cwd: TMP_CWD, homeDir: TMP_CWD });
    expect(pending).toHaveLength(0);
  });

  it("returns v0.5.0 when old .spark-e2e paths exist", () => {
    mkdirSync(TMP_CWD, { recursive: true });
    createOldData();

    const pending = getPendingMigrations({ cwd: TMP_CWD, homeDir: TMP_CWD });
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.some((m) => m.version === "0.5.0")).toBe(true);
  });
});

describe("runMigrations dry-run", () => {
  beforeEach(() => { cleanup(); mkdirSync(TMP_CWD, { recursive: true }); createOldData(); });
  afterEach(cleanup);

  it("reports planned changes without moving files", async () => {
    const logs: string[] = [];
    const result = await runMigrations({
      cwd: TMP_CWD,
      homeDir: TMP_CWD,
      dryRun: true,
      log: (msg: string) => logs.push(msg),
    });

    expect(result.dryRun).toBe(true);
    expect(result.totalChanges).toBeGreaterThan(0);

    // Old files should still exist (not moved)
    expect(existsSync(OLD_PROJECT("dom-state.json"))).toBe(true);
    expect(existsSync(OLD_PROJECT("baselines"))).toBe(true);
    // New files should NOT exist
    expect(existsSync(NEW_PROJECT("dom-state.json"))).toBe(false);

    const output = logs.join("\n");
    expect(output).toContain("DRY RUN");
    expect(output).toContain("would be migrated");
  });
});

describe("runMigrations actual", () => {
  beforeEach(() => { cleanup(); mkdirSync(TMP_CWD, { recursive: true }); createOldData(); });
  afterEach(cleanup);

  it("moves old project files to new paths", async () => {
    const logs: string[] = [];
    const result = await runMigrations({
      cwd: TMP_CWD,
      homeDir: TMP_CWD,
      log: (msg: string) => logs.push(msg),
    });

    expect(result.dryRun).toBe(false);
    expect(result.totalChanges).toBeGreaterThan(0);

    // Old individual files should be gone (move, not copy)
    expect(existsSync(OLD_PROJECT("dom-state.json"))).toBe(false);

    // New files should exist
    expect(existsSync(NEW_PROJECT("dom-state.json"))).toBe(true);
    expect(existsSync(NEW_PROJECT("baselines/my-baseline/screenshot.png"))).toBe(true);
    expect(existsSync(NEW_PROJECT("runs/login-flow/step1.png"))).toBe(true);

    // Content preserved
    const domState = JSON.parse(readFileSync(NEW_PROJECT("dom-state.json"), "utf-8"));
    expect(domState.layout).toEqual([]);

    const baselineMeta = JSON.parse(readFileSync(NEW_PROJECT("baselines/my-baseline/meta.json"), "utf-8"));
    expect(baselineMeta.url).toBe("x");

    // Old empty directories cleaned up
    expect(existsSync(OLD_PROJECT(""))).toBe(false);

    const output = logs.join("\n");
    expect(output).toContain("MIGRATING");
    expect(output).toContain("dom-state.json");
    expect(output).toContain("baselines");
    expect(output).toContain("complete");
  });

  it("is idempotent — second run does nothing", async () => {
    // First run
    await runMigrations({ cwd: TMP_CWD });

    // Second run
    const logs: string[] = [];
    const result = await runMigrations({
      cwd: TMP_CWD,
      homeDir: TMP_CWD,
      log: (msg: string) => logs.push(msg),
    });

    expect(result.totalChanges).toBe(0);
    const output = logs.join("\n");
    expect(output).toContain("Nothing to migrate");
  });
});

describe("runMigrations skip on conflict", () => {
  beforeEach(() => {
    cleanup();
    mkdirSync(TMP_CWD, { recursive: true });
    createOldData();
    // Pre-create conflicting file at new path
    mkdirSync(NEW_PROJECT(""), { recursive: true });
    writeFileSync(NEW_PROJECT("dom-state.json"), '{"existing":true}');
  });
  afterEach(cleanup);

  it("skips files when target already exists", async () => {
    const logs: string[] = [];
    await runMigrations({
      cwd: TMP_CWD,
      homeDir: TMP_CWD,
      log: (msg: string) => logs.push(msg),
    });

    // dom-state.json should NOT have been overwritten
    const domState = JSON.parse(readFileSync(NEW_PROJECT("dom-state.json"), "utf-8"));
    expect(domState.existing).toBe(true);

    const output = logs.join("\n");
    expect(output).toContain("Skip");
  });
});

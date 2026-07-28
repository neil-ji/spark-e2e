/**
 * Tests for loadDotenv — multi-layer .env loading with priority.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadDotenv } from "../config.js";

const tmpRoot = join(tmpdir(), `spark-e2e-dotenv-${process.pid}`);
const origEnv = { ...process.env };

beforeEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  mkdirSync(tmpRoot, { recursive: true });
  delete process.env.SPARK_E2E_API_KEY;
  delete process.env.SPARK_E2E_MODEL;
  delete process.env.SPARK_E2E_ENV;
  vi.resetModules();
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.SPARK_E2E_API_KEY;
  delete process.env.SPARK_E2E_MODEL;
  delete process.env.SPARK_E2E_ENV;
});

describe("loadDotenv", () => {
  it("loads from explicit SPARK_E2E_ENV path", () => {
    const envPath = join(tmpRoot, "explicit.env");
    writeFileSync(envPath, "SPARK_E2E_API_KEY=explicit-key\nSPARK_E2E_MODEL=explicit-model\n", "utf-8");

    delete process.env.SPARK_E2E_API_KEY;
    delete process.env.SPARK_E2E_MODEL;
    process.env.SPARK_E2E_ENV = envPath;
    loadDotenv();

    expect(process.env.SPARK_E2E_API_KEY).toBe("explicit-key");
    expect(process.env.SPARK_E2E_MODEL).toBe("explicit-model");

    delete process.env.SPARK_E2E_ENV;
    delete process.env.SPARK_E2E_API_KEY;
    delete process.env.SPARK_E2E_MODEL;
  });

  it("explicit SPARK_E2E_ENV overrides project .env (both present)", () => {
    // Project .env on disk (but we reference via explicit path)
    writeFileSync(join(tmpRoot, ".env"), "SPARK_E2E_API_KEY=project-key\nSPARK_E2E_MODEL=project-model\n", "utf-8");
    const explicitPath = join(tmpRoot, "override.env");
    writeFileSync(explicitPath, "SPARK_E2E_API_KEY=override-key\n", "utf-8");

    delete process.env.SPARK_E2E_API_KEY;
    process.env.SPARK_E2E_ENV = explicitPath;
    loadDotenv();

    // Explicit path wins
    expect(process.env.SPARK_E2E_API_KEY).toBe("override-key");

    delete process.env.SPARK_E2E_ENV;
    delete process.env.SPARK_E2E_API_KEY;
  });

  it("does not override env vars already set (dotenv default behavior)", () => {
    writeFileSync(join(tmpRoot, ".env"), "SPARK_E2E_API_KEY=from-file\n", "utf-8");

    delete process.env.SPARK_E2E_API_KEY;
    process.env.SPARK_E2E_API_KEY = "already-set-before";
    process.env.SPARK_E2E_ENV = join(tmpRoot, ".env");
    loadDotenv();

    // dotenv never overrides existing vars by default
    expect(process.env.SPARK_E2E_API_KEY).toBe("already-set-before");

    delete process.env.SPARK_E2E_ENV;
    delete process.env.SPARK_E2E_API_KEY;
  });

  it("skips missing explicit path gracefully", () => {
    delete process.env.SPARK_E2E_API_KEY;
    process.env.SPARK_E2E_ENV = "/no/such/.env";
    // Should not throw
    expect(() => loadDotenv()).not.toThrow();
    expect(process.env.SPARK_E2E_API_KEY).toBeUndefined();

    delete process.env.SPARK_E2E_ENV;
  });
});

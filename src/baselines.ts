/**
 * Baseline storage — reference screenshots for visual regression comparison.
 *
 * Storage layout:
 *   .spark/plugin/e2e/baselines/<name>/
 *     screenshot.png   — reference screenshot
 *     meta.json        — { name, url, viewport, timestamp, model, findings? }
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";

// ── Types ──────────────────────────────────────────────────

export interface BaselineMeta {
  name: string;
  url: string;
  viewport: { width: number; height: number; deviceScaleFactor: number };
  timestamp: string; // ISO 8601
  model?: string;
  findings?: Record<string, unknown>; // optional: saved VLM review output
}

export interface BaselineEntry {
  name: string;
  meta: BaselineMeta;
  screenshotPath: string;
}

export interface CompareResult {
  baseline: string;
  match: boolean;
  confidence: "high" | "medium" | "low";
  changes: Array<{
    region: string;
    type: "added" | "removed" | "changed" | "layout_shift";
    severity: "critical" | "major" | "minor";
    description: string;
  }>;
  summary: string;
}

// ── Paths ──────────────────────────────────────────────────

function baselinesDir(): string {
  const dir = resolve(process.cwd(), ".spark", "plugin", "e2e", "baselines");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function baselinePath(name: string): string {
  return join(baselinesDir(), name);
}

// ── CRUD ───────────────────────────────────────────────────

export function saveBaseline(
  name: string,
  screenshot: Buffer,
  meta: Omit<BaselineMeta, "name" | "timestamp">,
  findings?: Record<string, unknown>,
): string {
  const dir = baselinePath(name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, "screenshot.png"), screenshot);

  const fullMeta: BaselineMeta = {
    name,
    ...meta,
    timestamp: new Date().toISOString(),
    ...(findings ? { findings } : {}),
  };
  writeFileSync(join(dir, "meta.json"), JSON.stringify(fullMeta, null, 2));

  return dir;
}

export function loadBaseline(name: string): BaselineEntry | null {
  const dir = baselinePath(name);
  const ssPath = join(dir, "screenshot.png");
  if (!existsSync(ssPath) || !existsSync(join(dir, "meta.json"))) return null;

  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf-8")) as BaselineMeta;
  return { name, meta, screenshotPath: ssPath };
}

export function listBaselines(): BaselineMeta[] {
  const root = baselinesDir();
  const entries: BaselineMeta[] = [];
  if (!existsSync(root)) return entries;

  for (const name of readdirSync(root, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const metaPath = join(root, name.name, "meta.json");
    if (existsSync(metaPath)) {
      try {
        entries.push(JSON.parse(readFileSync(metaPath, "utf-8")) as BaselineMeta);
      } catch {
        // skip corrupted baselines
      }
    }
  }
  return entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function deleteBaseline(name: string): boolean {
  const dir = baselinePath(name);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

export function readBaselineScreenshot(name: string): Buffer | null {
  const dir = baselinePath(name);
  const ssPath = join(dir, "screenshot.png");
  if (!existsSync(ssPath)) return null;
  return readFileSync(ssPath);
}

/**
 * Versioned migration system for spark-e2e local data.
 *
 * Each migration is idempotent — it checks whether old paths exist and only
 * acts when they do.  After a successful move the old path is gone, so the
 * migration won't fire again.
 *
 * Adding a new migration: add an entry to MIGRATIONS array sorted by version.
 */
import {
  existsSync,
  mkdirSync,
  renameSync,
  readdirSync,
  statSync,
  chmodSync,
  rmdirSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { homedir } from "node:os";

// ── Types ───────────────────────────────────────────────────

export interface MigrationContext {
  /** Project working directory */
  cwd: string;
  /** Home directory (for global files like ~/.spark/...) */
  homeDir: string;
  /** If true, only report what would happen — don't move anything */
  dryRun: boolean;
  /** Callback for progress messages */
  log: (msg: string) => void;
}

export interface Migration {
  /** Target version after this migration runs */
  version: string;
  /** Human-readable summary */
  description: string;
  /** Execute the migration. Returns count of items migrated. */
  run(ctx: MigrationContext): Promise<number>;
}

// ── Helpers ─────────────────────────────────────────────────

function project(cwd: string, rel: string): string {
  return resolve(cwd, rel);
}

/** Move a single file from src to dst. Return true if moved, false if skipped. */
function moveFile(
  src: string,
  dst: string,
  ctx: MigrationContext,
  label: string,
): boolean {
  if (!existsSync(src)) return false;

  if (existsSync(dst)) {
    ctx.log(`  ⏭  Skip (target exists): ${label}`);
    return false;
  }

  if (ctx.dryRun) {
    ctx.log(`  →  ${label}`);
    return true;
  }

  mkdirSync(dirname(dst), { recursive: true });
  renameSync(src, dst);

  // Tighten permissions for credential files
  if (dst.endsWith(".env")) {
    try { chmodSync(dst, 0o600); } catch { /* best effort */ }
  }

  ctx.log(`  ✓  ${label}`);
  return true;
}

/** Move everything inside srcDir/ into dstDir/, preserving filenames. */
function moveDirContents(
  srcDir: string,
  dstDir: string,
  ctx: MigrationContext,
  label: string,
): number {
  if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) return 0;

  const entries = readdirSync(srcDir, { withFileTypes: true });
  if (entries.length === 0) return 0;

  if (existsSync(dstDir)) {
    // Check if any entries would conflict
    const conflicts = entries.filter((e) => existsSync(join(dstDir, e.name)));
    if (conflicts.length > 0) {
      ctx.log(`  ⏭  Skip (target has conflicts): ${label} (${conflicts.map(e => e.name).join(", ")})`);
      return 0;
    }
  }

  if (ctx.dryRun) {
    ctx.log(`  →  ${label} (${entries.length} files)`);
    return entries.length;
  }

  mkdirSync(dstDir, { recursive: true });
  let moved = 0;
  for (const entry of entries) {
    const src = join(srcDir, entry.name);
    const dst = join(dstDir, entry.name);
    renameSync(src, dst);
    moved++;
  }

  ctx.log(`  ✓  ${label} (${moved} files)`);
  return moved;
}

/** Remove directory if it exists and is empty (best-effort cleanup). */
function rmdirIfEmpty(dir: string): void {
  try {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir);
    if (entries.length === 0) rmdirSync(dir);
  } catch {
    /* best effort — not critical */
  }
}

// ── Migration: v0.5.0 — Directory restructure ───────────────

const MIGRATION_V050: Migration = {
  version: "0.5.0",
  description: "Directory structure: .spark-e2e/ → .spark/plugin/e2e/",

  async run(ctx: MigrationContext): Promise<number> {
    let changed = 0;

    // 1. Global .env file
    const oldGlobalEnv = resolve(ctx.homeDir, ".spark-e2e", ".env");
    const newGlobalEnv = resolve(ctx.homeDir, ".spark", "plugin", "e2e", ".env");
    if (moveFile(
      oldGlobalEnv,
      newGlobalEnv,
      ctx,
      `${oldGlobalEnv} → ${newGlobalEnv}`,
    )) changed++;

    // 2. Project baselines directory
    changed += moveDirContents(
      project(ctx.cwd, ".spark-e2e/baselines"),
      project(ctx.cwd, ".spark/plugin/e2e/baselines"),
      ctx,
      ".spark-e2e/baselines/ → .spark/plugin/e2e/baselines/",
    );

    // 3. Project runs directory
    changed += moveDirContents(
      project(ctx.cwd, ".spark-e2e/runs"),
      project(ctx.cwd, ".spark/plugin/e2e/runs"),
      ctx,
      ".spark-e2e/runs/ → .spark/plugin/e2e/runs/",
    );

    // 4. Project dom-state.json
    if (moveFile(
      project(ctx.cwd, ".spark-e2e/dom-state.json"),
      project(ctx.cwd, ".spark/plugin/e2e/dom-state.json"),
      ctx,
      ".spark-e2e/dom-state.json → .spark/plugin/e2e/dom-state.json",
    )) changed++;

    // 5. Cleanup: remove old empty directories (best-effort)
    if (!ctx.dryRun && changed > 0) {
      rmdirIfEmpty(project(ctx.cwd, ".spark-e2e/baselines"));
      rmdirIfEmpty(project(ctx.cwd, ".spark-e2e/runs"));
      rmdirIfEmpty(project(ctx.cwd, ".spark-e2e"));
      rmdirIfEmpty(resolve(ctx.homeDir, ".spark-e2e"));
    }

    return changed;
  },
};

// ── Engine ──────────────────────────────────────────────────

/** All migrations, sorted oldest-first by version. Add new ones here. */
export const MIGRATIONS: Migration[] = [MIGRATION_V050];

export interface MigrationOptions {
  cwd: string;
  /** Override home directory (for testing). Defaults to os.homedir(). */
  homeDir?: string;
}

function resolveHome(opts: MigrationOptions): string {
  return opts.homeDir ?? homedir();
}

/** Return migrations that still have pending work for the given project. */
export function getPendingMigrations(opts: MigrationOptions): Migration[] {
  const h = resolveHome(opts);
  return MIGRATIONS.filter((m) => {
    // v0.5.0: check if ANY old path still exists
    if (m.version === "0.5.0") {
      return (
        existsSync(resolve(h, ".spark-e2e", ".env")) ||
        existsSync(project(opts.cwd, ".spark-e2e/baselines")) ||
        existsSync(project(opts.cwd, ".spark-e2e/runs")) ||
        existsSync(project(opts.cwd, ".spark-e2e/dom-state.json"))
      );
    }
    // Default: assume pending (future migrations can override)
    return true;
  });
}

/** Check whether any migration is pending for the given project. */
export function hasPendingMigrations(opts: MigrationOptions): boolean {
  return getPendingMigrations(opts).length > 0;
}

export interface RunMigrationsResult {
  /** Migrations that ran (or would have run in dry-run mode) */
  ran: { version: string; description: string; changes: number }[];
  /** Total items moved / would have been moved */
  totalChanges: number;
  /** True if this was a dry run */
  dryRun: boolean;
}

export interface RunMigrationsOptions extends MigrationOptions {
  dryRun?: boolean;
  log?: (msg: string) => void;
}

/** Execute (or preview) all pending migrations. */
export async function runMigrations(opts: RunMigrationsOptions): Promise<RunMigrationsResult> {
  const dryRun = opts.dryRun ?? false;
  const log = opts.log ?? (() => {});
  const homeDir = resolveHome(opts);
  const pending = getPendingMigrations(opts);
  const ran: RunMigrationsResult["ran"] = [];
  let totalChanges = 0;

  if (pending.length === 0) {
    log("Nothing to migrate — all data is already on the latest paths.");
    return { ran, totalChanges: 0, dryRun };
  }

  const mode = dryRun ? "DRY RUN" : "MIGRATING";
  log(`spark-e2e update — ${mode}`);
  log("");

  for (const m of pending) {
    log(`v${m.version}: ${m.description}`);
    log("");
    const changes = await m.run({ cwd: opts.cwd, homeDir, dryRun, log });
    log("");
    ran.push({ version: m.version, description: m.description, changes });
    totalChanges += changes;
  }

  if (dryRun) {
    log(`Dry run complete — ${totalChanges} item(s) would be migrated.`);
    log('Run "spark-e2e update" to execute.');
  } else {
    log(`Migration complete — ${totalChanges} item(s) migrated.`);
    log('Run "spark-e2e doctor" to verify your setup.');
  }

  return { ran, totalChanges, dryRun };
}

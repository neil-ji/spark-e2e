/**
 * Configuration system — YAML file + env vars + defaults.
 *
 * Priority (highest first):
 * 1. CLI arguments (passed directly to functions)
 * 2. Environment variables (SPARK_E2E_* prefix)
 * 3. Config file (.spark-e2e.yaml in cwd)
 * 4. Legacy env vars (VLM_* — backward compat)
 * 5. Hardcoded defaults
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import * as yaml from "js-yaml";
import { config as dotenvConfig } from "dotenv";
import { z } from "zod";

// ── Schema ─────────────────────────────────────────────

const ViewportConfigSchema = z.object({
  width: z.number().default(1600),
  height: z.number().default(1200),
  deviceScaleFactor: z.number().default(1),
});

const VLMConfigSchema = z.object({
  apiKey: z.string().default(""),
  baseUrl: z.string().default(""),
  model: z.string().default("gpt-4o"),
  provider: z.string().default("openai-compat"),
  thinkingBudget: z.number().int().min(0).default(4000),
});

const PromptsConfigSchema = z.object({
  strictness: z.enum(["standard", "strict", "relaxed"]).default("standard"),
});

const SecurityConfigSchema = z.object({
  maskSelectors: z.array(z.string()).default([]),
});

export const ConfigSchema = z.object({
  browser: z.object({ url: z.string().optional() }).default({}),
  viewport: ViewportConfigSchema.default({}),
  vlm: VLMConfigSchema.default({}),
  prompts: PromptsConfigSchema.default({}),
  security: SecurityConfigSchema.default({}),
  cssVariables: z.array(z.string()).default([]),
  // Deprecated — kept for backward compat with old config files
  selectors: z.record(z.string()).default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

// ── Default config ─────────────────────────────────────

const DEFAULT_CONFIG: Config = {
  browser: {},
  viewport: { width: 1600, height: 1200, deviceScaleFactor: 1 },
  vlm: { apiKey: "", baseUrl: "", model: "gpt-4o", provider: "openai-compat", thinkingBudget: 4000 },
  prompts: { strictness: "standard" },
  security: { maskSelectors: [] },
  cssVariables: [],
  selectors: {},
};

// ── Cache ───────────────────────────────────────────────

let _config: Config | null = null;

// ── Logger ──────────────────────────────────────────────

function log(msg: string): void {
  process.stderr.write(`[spark-e2e] ${msg}\n`);
}

// ── Helpers ─────────────────────────────────────────────

function interpolateEnvVars(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{(\w+)\}/g, (_, name: string) => {
      return process.env[name] ?? `$\{${name}}`;
    });
  }
  if (Array.isArray(value)) return value.map(interpolateEnvVars);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = interpolateEnvVars(v);
    }
    return result;
  }
  return value;
}

function findConfigFile(): string | null {
  const envPath = process.env.SPARK_E2E_CONFIG;
  if (envPath && existsSync(envPath)) return envPath;

  for (const name of [".spark-e2e.yaml", ".spark-e2e.yml", "spark-e2e.yaml", "spark-e2e.yml"]) {
    if (existsSync(name)) return resolve(name);
  }
  return null;
}

function loadYamlConfig(path: string): Record<string, unknown> {
  const raw = readFileSync(path, "utf-8");
  const data = yaml.load(raw);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`Config file ${path} must be a YAML mapping`);
  }
  return interpolateEnvVars(data as Record<string, unknown>) as Record<string, unknown>;
}

// ── Build config ────────────────────────────────────────

function readAestheticsFile(path: string): string {
  const resolved = resolve(path);
  if (!existsSync(resolved)) return "";
  return readFileSync(resolved, "utf-8").trim();
}

/** Extract YAML frontmatter from markdown. Returns { frontmatter, body }. */
function parseFrontmatter(md: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: md };
  try {
    return { frontmatter: (yaml.load(match[1]) as Record<string, unknown>) ?? {}, body: match[2].trim() };
  } catch {
    return { frontmatter: {}, body: md };
  }
}

/**
 * Auto-load AESTHETICS.md with priority merging.
 *
 * 1. ~/.spark/AESTHETICS.md — global rules (all projects)
 * 2. ./AESTHETICS.md        — project rules (overrides)
 *
 * Project frontmatter controls merge behavior:
 *   merge: append   (default) — project appended after global
 *   merge: replace            — project replaces global entirely
 *   merge: disable            — skip project, global only
 */
export function loadAesthetics(): { content: string; sources: string[] } {
  const globalPath = resolve(homedir(), ".spark", "AESTHETICS.md");
  const projectPath = resolve("AESTHETICS.md");

  const global = readAestheticsFile(globalPath);
  if (!global) {
    const project = readAestheticsFile(projectPath);
    return { content: project, sources: project ? [projectPath] : [] };
  }

  const project = readAestheticsFile(projectPath);
  if (!project) {
    return { content: global, sources: [globalPath] };
  }

  // Both exist — apply merge strategy from project frontmatter
  const { frontmatter, body: projectBody } = parseFrontmatter(project);
  const merge = (frontmatter.merge as string) ?? "append";

  if (merge === "replace") {
    return { content: projectBody, sources: [projectPath] };
  }
  if (merge === "disable") {
    return { content: global, sources: [globalPath] };
  }
  // default: append
  return {
    content: global + "\n\n" + projectBody,
    sources: [globalPath, projectPath],
  };
}

function applyYamlToConfig(config: Config, data: Record<string, unknown>): void {
  // browser.url kept for backward compat in config files
  const b = data.browser as Record<string, unknown> | undefined;
  if (b && typeof b.url === "string") (config.browser as Record<string, string>).url = b.url;

  const v = data.viewport as Record<string, unknown> | undefined;
  if (v) {
    if (typeof v.width === "number") config.viewport.width = v.width;
    if (typeof v.height === "number") config.viewport.height = v.height;
    if (typeof v.deviceScaleFactor === "number") config.viewport.deviceScaleFactor = v.deviceScaleFactor;
  }

  const vlm = data.vlm as Record<string, unknown> | undefined;
  if (vlm) {
    if (typeof vlm.api_key === "string") config.vlm.apiKey = vlm.api_key as string;
    if (typeof vlm.base_url === "string") config.vlm.baseUrl = vlm.base_url as string;
    if (typeof vlm.model === "string") config.vlm.model = vlm.model as string;
    if (typeof vlm.provider === "string") config.vlm.provider = vlm.provider as string;
    if (typeof vlm.thinking_budget === "number") config.vlm.thinkingBudget = vlm.thinking_budget as number;
  }

  const cv = data.css_variables as string[] | undefined;
  if (Array.isArray(cv)) config.cssVariables = cv.map(String);

  const p = data.prompts as Record<string, unknown> | undefined;
  if (p && typeof p.strictness === "string") {
    const s = p.strictness as string;
    if (s === "standard" || s === "strict" || s === "relaxed") {
      config.prompts.strictness = s;
    }
  }
}

function applyEnvVars(config: Config): void {
  const envMap: [string, "browser" | "vlm", string][] = [
    ["SPARK_E2E_URL", "browser", "url"],
    ["SPARK_E2E_API_KEY", "vlm", "apiKey"],
    ["SPARK_E2E_BASE_URL", "vlm", "baseUrl"],
    ["SPARK_E2E_MODEL", "vlm", "model"],
    ["SPARK_E2E_VLM_PROVIDER", "vlm", "provider"],
  ];

  for (const [envName, section, key] of envMap) {
    const val = process.env[envName];
    if (val) {
      const s = config[section] as Record<string, unknown>;
      if (s && key in s) (s as Record<string, string>)[key] = val;
    }
  }

  const thinkingVal = process.env.SPARK_E2E_THINKING_BUDGET;
  if (thinkingVal) {
    const n = parseInt(thinkingVal, 10);
    if (!isNaN(n) && n >= 0) config.vlm.thinkingBudget = n;
  }
}

function applyLegacyEnvVars(config: Config): void {
  if (!config.vlm.apiKey) config.vlm.apiKey = process.env.VLM_API_KEY ?? "";
  if (!config.vlm.baseUrl) config.vlm.baseUrl = process.env.VLM_BASE_URL ?? "";
  if (config.vlm.model === "gpt-4o") {
    const legacy = process.env.VLM_MODEL;
    if (legacy) config.vlm.model = legacy;
  }
}

function loadDotenv(): void {
  // 1. Explicit path via SPARK_E2E_ENV
  const explicitPath = process.env.SPARK_E2E_ENV;
  if (explicitPath && existsSync(explicitPath)) {
    dotenvConfig({ path: explicitPath });
    return;
  }

  // 2. Project-level .env
  if (existsSync(".env")) {
    dotenvConfig({ path: ".env" });
  }

  // 3. User-level global .env (always loaded as fallback)
  const globalEnv = resolve(homedir(), ".spark", "plugin", "e2e", ".env");
  if (existsSync(globalEnv)) {
    dotenvConfig({ path: globalEnv, override: false }); // don't override project values
  }
}

// ── Public API ──────────────────────────────────────────

export function load(configPath?: string): Config {
  const config: Config = { ...DEFAULT_CONFIG };

  // 1. Load .env first (so env vars available for interpolation)
  loadDotenv();

  // 2. YAML config file
  let path: string | null = null;
  if (configPath) {
    if (!existsSync(configPath)) throw new Error(`Config file not found: ${configPath}`);
    path = configPath;
  } else {
    path = findConfigFile();
  }

  if (path) {
    const data = loadYamlConfig(path);
    applyYamlToConfig(config, data);
  }

  // 3. SPARK_E2E_* env vars
  applyEnvVars(config);

  // 4. Legacy VLM_* env vars (fallback)
  applyLegacyEnvVars(config);

  // Validate
  log(`Config loaded: vlm=${config.vlm.provider}, model=${config.vlm.model}`);

  if (!config.vlm.apiKey) {
    log("WARNING: No VLM API key configured. Set SPARK_E2E_API_KEY or VLM_API_KEY.");
  }

  _config = config;
  return config;
}

export function getConfig(): Config {
  if (!_config) return load();
  return _config;
}

export function getVlmEnv(): [string, string] {
  const c = getConfig();
  return [c.vlm.apiKey, c.vlm.baseUrl];
}

export function getVlmModel(defaultModel = "gpt-4o"): string {
  const c = getConfig();
  return c.vlm.model || defaultModel;
}

export function getAesthetics(): string {
  return loadAesthetics().content;
}

export { findConfigFile, interpolateEnvVars, loadDotenv };

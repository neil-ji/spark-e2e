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

const BrowserConfigSchema = z.object({
  backend: z.string().default("browser-harness"),
  url: z.string().default("http://localhost:5173"),
});

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

const SelectorsConfigSchema = z.object({
  card: z.string().default('[class*="card"]'),
  progressFill: z.string().default('[class*="progress"][class*="fill"]'),
  activeNav: z.string().default('[aria-current="page"]'),
  sidebarItem: z
    .string()
    .default('[class*="sidebar"] [class*="item"], [class*="menu"] [class*="item"]'),
});

const PromptsConfigSchema = z.object({
  strictness: z.enum(["standard", "strict", "relaxed"]).default("standard"),
});

export const ConfigSchema = z.object({
  browser: BrowserConfigSchema.default({}),
  viewport: ViewportConfigSchema.default({}),
  vlm: VLMConfigSchema.default({}),
  selectors: SelectorsConfigSchema.default({}),
  prompts: PromptsConfigSchema.default({}),
  cssVariables: z.array(z.string()).default([]),
  aestheticsFile: z.string().default("AESTHETICS.md"),
});

export type Config = z.infer<typeof ConfigSchema>;

// ── Default config ─────────────────────────────────────

const DEFAULT_CONFIG: Config = {
  browser: { backend: "browser-harness", url: "http://localhost:5173" },
  viewport: { width: 1600, height: 1200, deviceScaleFactor: 1 },
  vlm: { apiKey: "", baseUrl: "", model: "gpt-4o", provider: "openai-compat", thinkingBudget: 4000 },
  selectors: {
    card: '[class*="card"]',
    progressFill: '[class*="progress"][class*="fill"]',
    activeNav: '[aria-current="page"]',
    sidebarItem: '[class*="sidebar"] [class*="item"], [class*="menu"] [class*="item"]',
  },
  prompts: { strictness: "standard" },
  cssVariables: [],
  aestheticsFile: "AESTHETICS.md",
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
  // Resolve relative to cwd
  const resolved = resolve(path);
  if (!existsSync(resolved)) return "";
  return readFileSync(resolved, "utf-8").trim();
}

function applyYamlToConfig(config: Config, data: Record<string, unknown>): void {
  const b = data.browser as Record<string, unknown> | undefined;
  if (b) {
    if (typeof b.backend === "string") config.browser.backend = b.backend;
    if (typeof b.url === "string") config.browser.url = b.url;
  }

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

  const sel = data.selectors as Record<string, unknown> | undefined;
  if (sel) {
    for (const [k, v] of Object.entries(sel)) {
      if (typeof v === "string" && k in config.selectors) {
        (config.selectors as Record<string, string>)[k] = v;
      }
    }
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

  if (typeof data.aesthetics_file === "string") {
    config.aestheticsFile = data.aesthetics_file as string;
  }
}

function applyEnvVars(config: Config): void {
  const envMap: [string, "browser" | "vlm", "backend" | "url" | "apiKey" | "baseUrl" | "model" | "provider"][] = [
    ["SPARK_E2E_BACKEND", "browser", "backend"],
    ["SPARK_E2E_URL", "browser", "url"],
    ["SPARK_E2E_API_KEY", "vlm", "apiKey"],
    ["SPARK_E2E_BASE_URL", "vlm", "baseUrl"],
    ["SPARK_E2E_MODEL", "vlm", "model"],
    ["SPARK_E2E_VLM_PROVIDER", "vlm", "provider"],
  ];

  for (const [envName, section, key] of envMap) {
    const val = process.env[envName];
    if (val) {
      (config[section] as Record<string, string>)[key] = val;
    }
  }

  // thinkingBudget is numeric — handle separately
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
  const globalEnv = resolve(homedir(), ".spark-e2e", ".env");
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
  log(
    `Config loaded: backend=${config.browser.backend}, ` +
      `url=${config.browser.url}, vlm=${config.vlm.provider}, model=${config.vlm.model}`
  );

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
  const c = getConfig();
  return readAestheticsFile(c.aestheticsFile);
}

export { findConfigFile };

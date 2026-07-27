/**
 * MCP server — 7 VLM-powered visual E2E testing tools.
 *
 * Tools:
 * - navigate          Load a page
 * - visual_snapshot   Capture a screenshot
 * - visual_inspect    Free-form VLM analysis
 * - visual_assert     Verify a visual condition (pass/fail)
 * - visual_compare    Compare page against expected state
 * - visual_review     Comprehensive UI audit
 * - dom_verify        Batch DOM verification
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getConfig, type Config } from "./config.js";
import { getReviewPrompt, getAssertPrompt } from "./prompts.js";
import { getBackend, type BrowserBackend } from "./browser/index.js";
import { toDataUrl } from "./browser/browser-harness.js";
import { getProvider } from "./vlm/index.js";
import type { VLMProvider } from "./vlm/index.js";
import { extractJson } from "./vlm/openai-compat.js";
import { registerBackend } from "./browser/index.js";
import { BrowserHarnessBackend } from "./browser/browser-harness.js";
import { registerProvider } from "./vlm/index.js";
import { OpenAICompatProvider } from "./vlm/openai-compat.js";

// Register built-ins
registerBackend("browser-harness", BrowserHarnessBackend);
registerProvider("openai-compat", OpenAICompatProvider);

// Lazy try Playwright
try {
  const { PlaywrightBackend } = await import("./browser/playwright.js");
  registerBackend("playwright", PlaywrightBackend);
} catch {
  // Playwright not available
}

function log(msg: string): void {
  process.stderr.write(`[spark-e2e] ${msg}\n`);
}

// ── Lazy init ───────────────────────────────────────────

let _backend: BrowserBackend | null = null;
let _provider: VLMProvider | null = null;
let _strictness = "standard";
let _config: Config | null = null;

function getCfg(): Config {
  if (!_config) _config = getConfig();
  return _config;
}

function getBackend_(): BrowserBackend {
  if (!_backend) {
    const cfg = getCfg();
    _backend = getBackend(cfg.browser.backend);
  }
  return _backend;
}

function getProvider_(): VLMProvider {
  if (!_provider) {
    const cfg = getCfg();
    _provider = getProvider(cfg.vlm.provider);
    _strictness = cfg.prompts.strictness;
  }
  return _provider;
}

async function captureAndEncode(opts?: {
  viewport?: { width: number; height: number; deviceScaleFactor?: number };
  reload?: boolean;
  delay?: number;
}): Promise<string> {
  const backend = getBackend_();
  const png = await backend.captureScreenshot(opts);
  return toDataUrl(Buffer.isBuffer(png) ? png : Buffer.from(png as ArrayBuffer));
}

// ── DOM discovery JS builder ────────────────────────────

function buildDiscoveryJs(cssVarNames: string[]): string {
  return `(function() {
  var root = document.getElementById('root') || document.querySelector('#app, [class*="app"]');
  var main = root ? root.firstElementChild : null;
  var layout = Array.from(main ? main.children : document.body.children).map(function(c) {
    var r = c.getBoundingClientRect();
    return {tag: c.tagName, classes: (c.className || '').slice(0, 60), role: c.getAttribute('role')||'', top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), text: (c.textContent || '').trim().slice(0, 40)};
  });
  var classPrefixes = new Set();
  var all = Array.from(document.querySelectorAll('[class]'));
  for (var i = 0; i < Math.min(200, all.length); i++) {
    var names = all[i].className.split(/\\\\s+/);
    for (var j = 0; j < names.length; j++) {
      if (names[j] && !names[j].startsWith('_')) classPrefixes.add(names[j].split('__')[0].split('--')[0]);
    }
  }
  var rootStyle = getComputedStyle(document.documentElement);
  var cssVars = {};
  ${JSON.stringify(cssVarNames)}.forEach(function(v) {
    var val = rootStyle.getPropertyValue(v).trim();
    if (val) cssVars[v] = val;
  });
  return {layout: layout, classPrefixes: Array.from(classPrefixes).sort().slice(0, 30), cssVars: cssVars};
})()`;
}

// ── MCP Server ──────────────────────────────────────────

export function createServer(): McpServer {
  const server = new McpServer({
    name: "spark-e2e",
    version: "0.1.0",
  });

  // ── navigate ──
  server.tool(
    "navigate",
    "Navigate the browser to a URL, optionally setting viewport first.",
    {
      url: z.string().describe("URL to navigate to (e.g. http://localhost:5173/dashboard)"),
      viewport: z
        .object({
          width: z.number().default(1600),
          height: z.number().default(1200),
          deviceScaleFactor: z.number().default(1),
        })
        .optional()
        .describe("Optional viewport override"),
    },
    async ({ url, viewport }) => {
      const backend = getBackend_();
      if (viewport) {
        await backend.captureScreenshot({ viewport, reload: false });
      }
      await backend.navigate(url);
      const info = await backend.getPageInfo();
      log(`Navigated to ${info.url}, title=${info.title}`);
      return {
        content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
      };
    }
  );

  // ── visual_snapshot ──
  server.tool(
    "visual_snapshot",
    "Capture a screenshot of the current browser page and return it as an image.",
    {
      viewport: z
        .object({
          width: z.number().default(1600),
          height: z.number().default(1200),
          deviceScaleFactor: z.number().default(1),
        })
        .optional(),
      reload: z.boolean().default(false).describe("Reload page before capture"),
      delay: z.number().default(0.3).describe("Delay after reload (seconds)"),
    },
    async ({ viewport, reload, delay }) => {
      const backend = getBackend_();
      log(`visual_snapshot viewport=${JSON.stringify(viewport)} reload=${reload}`);
      const png = await backend.captureScreenshot({ viewport, reload, delay });
      const b64 = Buffer.isBuffer(png) ? png.toString("base64") : Buffer.from(png as ArrayBuffer).toString("base64");
      return {
        content: [{ type: "image", data: b64, mimeType: "image/png" }],
      };
    }
  );

  // ── visual_inspect ──
  server.tool(
    "visual_inspect",
    "Take a browser screenshot and analyze it with a Vision Language Model. Use to inspect the current page state visually.",
    {
      instruction: z.string().describe("What to look for in the screenshot"),
      model: z.string().optional().describe("VLM model override"),
      viewport: z
        .object({
          width: z.number().default(1600),
          height: z.number().default(1200),
          deviceScaleFactor: z.number().default(1),
        })
        .optional(),
      reload: z.boolean().default(false),
      delay: z.number().default(0.3),
    },
    async ({ instruction, model, viewport, reload, delay }) => {
      const provider = getProvider_();
      log(`visual_inspect: ${instruction.slice(0, 100)}...`);
      const dataUrl = await captureAndEncode({ viewport, reload, delay });
      const prompt = [
        "You are a visual inspection tool for automated E2E testing.",
        "Analyze this webpage screenshot carefully and thoroughly.",
        "",
        `INSTRUCTION: ${instruction}`,
        "",
        "Be specific and precise. Describe exact positions, colors, text content,",
        "and visual states you observe. If you cannot determine something confidently,",
        "say so rather than guessing.",
        "",
        getReviewPrompt(_strictness),
      ].join("\n");

      const response = await provider.chat(prompt, dataUrl, model);
      return { content: [{ type: "text", text: response }] };
    }
  );

  // ── visual_assert ──
  server.tool(
    "visual_assert",
    "Verify that a visual condition is true on the current browser page. Returns structured pass/fail.",
    {
      assertion: z.string().describe("Visual condition to verify (natural language)"),
      model: z.string().optional(),
      viewport: z
        .object({
          width: z.number().default(1600),
          height: z.number().default(1200),
          deviceScaleFactor: z.number().default(1),
        })
        .optional(),
      reload: z.boolean().default(true),
      delay: z.number().default(0.3),
    },
    async ({ assertion, model, viewport, reload, delay }) => {
      const provider = getProvider_();
      log(`visual_assert: ${assertion.slice(0, 100)}...`);
      const dataUrl = await captureAndEncode({ viewport, reload, delay });
      const prompt = [
        "You are a visual E2E test verifier. Your job is to determine whether",
        "an assertion about a webpage screenshot is TRUE or FALSE.",
        "",
        "Examine the screenshot carefully. Compare the assertion to",
        "what you actually observe. Be objective — only mark pass=true",
        "when the evidence is clearly visible.",
        "",
        `ASSERTION: ${assertion}`,
        "",
        getAssertPrompt(_strictness),
        "",
        "Respond with ONLY a JSON object (no markdown, no other text):",
        '{"pass": true|false, "confidence": "high"|"medium"|"low",',
        '"observation": "what you actually see, exact text/numbers quoted",',
        '"reasoning": "why it passes or fails, referencing specific visible evidence"}',
      ].join("\n");

      const raw = await provider.chat(prompt, dataUrl, model);
      try {
        return { content: [{ type: "text", text: JSON.stringify(extractJson(raw), null, 2) }] };
      } catch {
        log(`Failed to parse VLM JSON, returning raw: ${raw.slice(0, 200)}`);
        return { content: [{ type: "text", text: raw }] };
      }
    }
  );

  // ── visual_compare ──
  server.tool(
    "visual_compare",
    "Compare the current page visually against an expected description.",
    {
      expected: z.string().describe("Expected visual state description"),
      afterAction: z.string().optional().describe("Action that was performed before comparison"),
      model: z.string().optional(),
      viewport: z
        .object({
          width: z.number().default(1600),
          height: z.number().default(1200),
          deviceScaleFactor: z.number().default(1),
        })
        .optional(),
      reload: z.boolean().default(false),
      delay: z.number().default(0.3),
    },
    async ({ expected, afterAction, model, viewport, reload, delay }) => {
      const provider = getProvider_();
      log(`visual_compare: expected=${expected.slice(0, 80)}...`);
      const dataUrl = await captureAndEncode({ viewport, reload, delay });

      const actionContext = afterAction
        ? `CONTEXT — Action performed: ${afterAction}\n\n`
        : "";

      const prompt = [
        "You are a visual regression tester. Compare this webpage screenshot",
        "against the expected state.",
        "",
        actionContext,
        `EXPECTED STATE: ${expected}`,
        "",
        getReviewPrompt(_strictness),
        "",
        "Respond with ONLY a JSON object (no markdown, no other text):",
        '{"match": true|false,',
        '"differences": ["specific things that differ from expected, with exact text"],',
        '"matches": ["specific things that match the expected state"],',
        '"overall_assessment": "brief summary"}',
      ].join("\n");

      const raw = await provider.chat(prompt, dataUrl, model);
      try {
        return { content: [{ type: "text", text: JSON.stringify(extractJson(raw), null, 2) }] };
      } catch {
        return { content: [{ type: "text", text: raw }] };
      }
    }
  );

  // ── visual_review ──
  server.tool(
    "visual_review",
    "Do a comprehensive visual review of the current page, returning structured findings.",
    {
      focus: z
        .enum(["comprehensive", "layout", "typography", "charts", "interactive"])
        .default("comprehensive")
        .describe("Review focus area"),
      model: z.string().optional(),
      viewport: z
        .object({
          width: z.number().default(1600),
          height: z.number().default(1200),
          deviceScaleFactor: z.number().default(1),
        })
        .optional(),
      reload: z.boolean().default(false),
      delay: z.number().default(0.3),
    },
    async ({ focus, model, viewport, reload, delay }) => {
      const provider = getProvider_();
      log(`visual_review: focus=${focus}`);
      const dataUrl = await captureAndEncode({ viewport, reload, delay });

      const focusPrompts: Record<string, string> = {
        comprehensive:
          "Review ALL aspects: layout, alignment, spacing, color consistency, typography, text truncation, visual artifacts, rendering defects.",
        layout:
          "Focus on layout: card heights, grid alignment, spacing between elements, uneven gaps, overlapping content, empty regions that look broken.",
        typography:
          "Focus on typography: text truncation (… ellipsis), contrast issues, font size inconsistencies, overlapping text, cut-off labels.",
        charts:
          "Focus on charts and data viz: gauge arc colors, donut label clipping, axis/legend artifacts, label positioning, number formatting issues.",
        interactive:
          "Focus on interactive elements: button states, hover feedback, menu highlighting, tooltip visibility, click targets that appear too small.",
      };

      const prompt = [
        "You are a senior UI quality reviewer. Do a thorough visual audit",
        "of this webpage screenshot.",
        "",
        `FOCUS AREA: ${focusPrompts[focus]}`,
        "",
        "For each issue found, describe:",
        "- What is wrong (be specific: location, element type, exact text if cut off)",
        "- Why it matters (layout/alignment, readability, functional impact)",
        "- How severe it is (critical/major/minor)",
        "",
        getReviewPrompt(_strictness),
        "",
        "Respond with ONLY a JSON object (no markdown, no other text):",
        '{"findings": [{"description": "...", "location": "...",',
        '"severity": "critical"|"major"|"minor", "category": "layout"|"typography"|"color"|"spacing"|"rendering"}],',
        '"summary": "one-sentence overall assessment",',
        '"no_issues_found": false}',
      ].join("\n");

      const raw = await provider.chat(prompt, dataUrl, model);
      try {
        return { content: [{ type: "text", text: JSON.stringify(extractJson(raw), null, 2) }] };
      } catch {
        return { content: [{ type: "text", text: raw }] };
      }
    }
  );

  // ── dom_verify ──
  server.tool(
    "dom_verify",
    "Discover page structure and key CSS facts in one batch call. Returns page layout, class name prefixes, and CSS variable values.",
    {
      url: z.string().optional().describe("Optional URL to navigate to first"),
      viewport: z
        .object({
          width: z.number().default(1600),
          height: z.number().default(1200),
          deviceScaleFactor: z.number().default(1),
        })
        .optional(),
    },
    async ({ url, viewport }) => {
      const backend = getBackend_();
      if (url) {
        if (viewport) {
          await backend.captureScreenshot({ viewport, reload: false });
        }
        await backend.navigate(url);
      }

      const cfg = getCfg();
      const cssVarList =
        cfg.cssVariables.length > 0
          ? cfg.cssVariables
          : [
              "--color-accent", "--color-text", "--color-text-secondary",
              "--color-text-muted", "--color-border", "--color-primary",
              "--color-positive", "--color-negative", "--color-warning",
            ];

      const jsCode = buildDiscoveryJs(cssVarList);
      try {
        const result = await backend.executeJs(jsCode);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: String(e) }) }],
        };
      }
    }
  );

  return server;
}

// ── Entry point ─────────────────────────────────────────

export async function main(): Promise<void> {
  const cfg = getConfig();
  log(
    `spark-e2e MCP server starting: backend=${cfg.browser.backend}, ` +
      `vlm=${cfg.vlm.provider}, model=${cfg.vlm.model}`
  );

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

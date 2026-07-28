/**
 * Browser backend using the browser-harness CLI tool (CDP-based).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserBackend, PageInfo, ScrollOptions, Viewport } from "./index.js";

function log(msg: string): void {
  process.stderr.write(`[spark-e2e] ${msg}\n`);
}

function runBrowserHarness(script: string, timeout = 30): { stdout: string; stderr: string } {
  const result = spawnSync("browser-harness", [], {
    input: script,
    encoding: "utf-8",
    timeout: timeout * 1000,
    maxBuffer: 50 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`browser-harness failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `browser-harness exited with code ${result.status}: ${(result.stderr ?? "").trim()}`
    );
  }
  return { stdout: result.stdout ?? "", stderr: (result.stderr ?? "").trim() };
}

export class BrowserHarnessBackend implements BrowserBackend {
  private timeout: number;

  constructor(timeout = 30) {
    this.timeout = timeout;
  }

  async captureScreenshot(opts?: {
    viewport?: Viewport;
    reload?: boolean;
    delay?: number;
    maxDim?: number;
    fullPage?: boolean;
    format?: "png" | "jpeg";
    quality?: number;
  }): Promise<Buffer> {
    const tmpDir = mkdtempSync(join(tmpdir(), "spark-e2e-"));
    const tmpPath = join(tmpDir, "screenshot.png");

    const commands: string[] = [];

    if (opts?.viewport) {
      const { width, height } = opts.viewport;
      const scale = opts.viewport.deviceScaleFactor ?? 1;
      commands.push(
        `cdp("Emulation.setDeviceMetricsOverride", ` +
          `width=${width}, height=${height}, deviceScaleFactor=${scale}, mobile=False)`
      );
    }

    // reload defaults to true unless explicitly disabled with --no-reload
    if (opts?.reload !== false) {
      commands.push('js("window.location.reload()")');
      commands.push("wait_for_load()");
    }
    // delay is independent of reload — always applied when set
    if ((opts?.delay ?? 0) > 0) {
      commands.push(`import time; time.sleep(${opts!.delay})`);
    }

    const maxDim = opts?.maxDim ?? 1800;
    const fullArg = opts?.fullPage ? ", full=True" : "";
    commands.push(`capture_screenshot('${tmpPath}', max_dim=${maxDim}${fullArg})`);

    if (opts?.viewport) {
      commands.push("cdp('Emulation.clearDeviceMetricsOverride')");
    }

    const script = commands.join("\n");
    log(`Capturing screenshot (viewport=${opts?.viewport ? JSON.stringify(opts.viewport) : "default"}, reload=${opts?.reload})`);

    runBrowserHarness(script, this.timeout);

    const png = readFileSync(tmpPath);
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore cleanup errors
    }

    if (png.length === 0) {
      throw new Error("Screenshot is empty — browser may not be connected");
    }
    return png;
  }

  async executeJs(jsCode: string): Promise<unknown> {
    const tmpDir = mkdtempSync(join(tmpdir(), "spark-e2e-"));
    const tmpPath = join(tmpDir, "script.js");
    writeFileSync(tmpPath, jsCode, "utf-8");

    try {
      const pyLines = [
        "import json",
        `with open(${JSON.stringify(tmpPath)}) as f: code = f.read()`,
        "result = js(code)",
        'print("__BH_RESULT__" + json.dumps(result, default=str) + "__BH_END__")',
      ];
      const { stdout } = runBrowserHarness(pyLines.join("\n"), this.timeout);

      const start = stdout.indexOf("__BH_RESULT__");
      const end = stdout.indexOf("__BH_END__");
      if (start >= 0 && end > start) {
        return JSON.parse(stdout.slice(start + 14, end));
      }
      return null;
    } finally {
      try {
        unlinkSync(tmpPath);
      } catch {
        // ignore
      }
    }
  }

  async navigate(url: string): Promise<void> {
    log(`Navigating to ${url}`);
    runBrowserHarness(`new_tab(${JSON.stringify(url)})\nwait_for_load()`, this.timeout);
  }

  async getPageInfo(): Promise<PageInfo> {
    const script = [
      "import json",
      "info = page_info()",
      'print("__BH_RESULT__" + json.dumps(info) + "__BH_END__")',
    ].join("\n");

    const { stdout } = runBrowserHarness(script, this.timeout);
    const start = stdout.indexOf("__BH_RESULT__");
    const end = stdout.indexOf("__BH_END__");
    if (start >= 0 && end > start) {
      return JSON.parse(stdout.slice(start + 14, end)) as PageInfo;
    }
    return { url: "", title: "", width: 0, height: 0, scroll_x: 0, scroll_y: 0 };
  }

  async scroll(opts?: ScrollOptions): Promise<PageInfo> {
    let scrollJs: string;
    if (opts?.selector) {
      scrollJs = [
        `var el = document.querySelector(${JSON.stringify(opts.selector)});`,
        "if (el) el.scrollIntoView({behavior: 'instant', block: 'nearest'});",
      ].join("\n");
    } else {
      const x = opts?.x ?? 0;
      const y = opts?.y ?? 0;
      scrollJs = `window.scrollTo({top: ${y}, left: ${x}, behavior: 'instant'});`;
    }

    const pyLines = [
      "import json",
      `js(${JSON.stringify(scrollJs)})`,
      "info = page_info()",
      'print("__BH_RESULT__" + json.dumps(info, default=str) + "__BH_END__")',
    ];

    const { stdout } = runBrowserHarness(pyLines.join("\n"), this.timeout);
    const start = stdout.indexOf("__BH_RESULT__");
    const end = stdout.indexOf("__BH_END__");
    if (start >= 0 && end > start) {
      return JSON.parse(stdout.slice(start + 14, end)) as PageInfo;
    }
    return { url: "", title: "", width: 0, height: 0, scroll_x: 0, scroll_y: 0 };
  }

  async getElementRect(selector: string): Promise<import("./index.js").ElementRect | null> {
    const jsCode = [
      `var el = document.querySelector(${JSON.stringify(selector)});`,
      "if (!el) return null;",
      "var r = el.getBoundingClientRect();",
      "return {x: r.x, y: r.y, width: r.width, height: r.height,",
      "  top: r.top, right: r.right, bottom: r.bottom, left: r.left};",
    ].join("\n");

    const result = await this.executeJs(jsCode);
    return result && typeof result === "object" ? (result as import("./index.js").ElementRect) : null;
  }

  async waitForSelector(selector: string, timeoutMs = 10000): Promise<void> {
    const safe = JSON.stringify(selector);
    const jsCode = `(function(){var el=document.querySelector(${safe});if(el)return true;return new Promise(function(resolve,reject){var t=setTimeout(function(){reject(new Error("Timeout: ${safe}"))},${timeoutMs});new MutationObserver(function(_,obs){var el=document.querySelector(${safe});if(el){obs.disconnect();clearTimeout(t);resolve(true);}}).observe(document.documentElement,{childList:true,subtree:true})})})()`;
    await this.executeJs(jsCode);
  }

  async waitForTimeout(ms: number): Promise<void> {
    const seconds = ms / 1000;
    runBrowserHarness(`import time; time.sleep(${seconds})`, Math.ceil(seconds) + 2);
  }

  toDataUrl(bytes: Buffer): string {
    return "data:image/png;base64," + bytes.toString("base64");
  }

  async close(): Promise<void> {
    // No-op for CLI-based backend — browser lifecycle is managed externally
  }
}

// ── Utility ─────────────────────────────────────────────

export function toDataUrl(pngBytes: Buffer): string {
  return "data:image/png;base64," + pngBytes.toString("base64");
}

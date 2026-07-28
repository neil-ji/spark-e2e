/**
 * Playwright browser backend — the one and only.
 */
import type { Viewport, PageInfo, ElementRect, ScrollOptions } from "./index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlaywrightAny = any;

function log(msg: string): void {
  process.stderr.write(`[spark-e2e] ${msg}\n`);
}

export class PlaywrightBrowser {
  private pw: PlaywrightAny = null;
  private browser: PlaywrightAny = null;
  private page: PlaywrightAny = null;
  private module: PlaywrightAny = null;

  // ── Lifecycle ────────────────────────────────────────

  async ensurePage(): Promise<PlaywrightAny> {
    if (this.page) return this.page;

    this.module = await this.resolvePlaywright();
    log("Starting Chromium (headless)");
    this.browser = await this.module.chromium.launch({ headless: true });
    this.page = await this.browser.newPage();
    return this.page;
  }

  async close(): Promise<void> {
    try { if (this.page) await this.page.close(); } catch {}
    try { if (this.browser) await this.browser.close(); } catch {}
    try { if (this.pw) await this.pw.stop?.(); } catch {}
    this.page = null;
    this.browser = null;
    this.module = null;
  }

  // ── Screenshot ───────────────────────────────────────

  async captureScreenshot(opts?: {
    viewport?: Viewport;
    reload?: boolean;
    delay?: number;
    maxDim?: number;
    fullPage?: boolean;
    format?: "png" | "jpeg";
    quality?: number;
  }): Promise<Buffer> {
    const page = await this.ensurePage();

    if (opts?.viewport) {
      await page.setViewportSize({
        width: opts.viewport.width,
        height: opts.viewport.height,
        deviceScaleFactor: opts.viewport.deviceScaleFactor ?? 1,
      });
    }

    if (opts?.reload !== false) {
      await page.reload();
      await page.waitForLoadState("networkidle");
    }

    if ((opts?.delay ?? 0) > 0) {
      await new Promise((r) => setTimeout(r, opts!.delay! * 1000));
    }

    const screenshotOpts: Record<string, unknown> = { type: opts?.format ?? "png" };
    if (opts?.format === "jpeg" && opts?.quality) screenshotOpts.quality = opts.quality;
    if (opts?.fullPage) screenshotOpts.fullPage = true;

    const buf = await page.screenshot(screenshotOpts);

    if (opts?.maxDim) {
      return this.resize(buf, opts.maxDim, opts.format ?? "png", opts.quality);
    }
    return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  }

  // ── Navigation ───────────────────────────────────────

  async navigate(url: string): Promise<void> {
    const page = await this.ensurePage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    log(`Navigated to ${url}`);
  }

  // ── JS execution ─────────────────────────────────────

  async executeJs(script: string): Promise<unknown> {
    const page = await this.ensurePage();
    return page.evaluate(script);
  }

  // ── Page info ────────────────────────────────────────

  async getPageInfo(): Promise<PageInfo> {
    const page = await this.ensurePage();
    return page.evaluate(() => {
      return {
        url: window.location.href,
        title: document.title,
        scrollY: window.scrollY,
        viewportHeight: window.innerHeight,
        contentHeight: document.documentElement.scrollHeight,
      };
    });
  }

  async getElementRect(selector: string): Promise<ElementRect | null> {
    const page = await this.ensurePage();
    return page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, right: r.right, bottom: r.bottom, left: r.left };
    }, selector);
  }

  // ── Scroll ───────────────────────────────────────────

  async scroll(opts?: ScrollOptions): Promise<PageInfo> {
    const page = await this.ensurePage();
    if (opts) {
      await page.evaluate((o: ScrollOptions) => {
        window.scrollBy(o.deltaX ?? 0, o.deltaY ?? 0);
      }, opts);
    }
    return this.getPageInfo();
  }

  // ── Wait ─────────────────────────────────────────────

  async waitForSelector(selector: string, timeoutMs = 10000): Promise<void> {
    const page = await this.ensurePage();
    await page.waitForSelector(selector, { timeout: timeoutMs });
  }

  async waitForTimeout(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  // ── Helpers ──────────────────────────────────────────

  toDataUrl(bytes: Buffer): string {
    return "data:image/png;base64," + bytes.toString("base64");
  }

  private async resize(buf: Buffer, maxDim: number, format: string, quality?: number): Promise<Buffer> {
    // Resize requires sharp or canvas — for now just return the original.
    // In the future this can use sharp or the Playwright viewport to resize.
    log(`Resize not implemented — maxDim=${maxDim} ignored`);
    return buf;
  }

  // ── Playwright module resolution ─────────────────────

  /**
   * Resolve playwright from multiple locations:
   * 1. Project CWD — for npx spark-e2e with project-local playwright
   * 2. Global npm prefix — for globally installed both
   * 3. Bare specifier — for spark-e2e installed as project dependency
   */
  private async resolvePlaywright(): Promise<PlaywrightAny> {
    const { createRequire } = await import("node:module");
    const { join } = await import("node:path");

    const candidates: string[] = [];

    // 1. Project CWD
    try {
      const req = createRequire(join(process.cwd(), "package.json"));
      candidates.push(req.resolve("playwright"));
    } catch { /* not in project */ }

    // 2. Global npm
    try {
      const { execSync } = await import("node:child_process");
      const globalRoot = execSync("npm root -g", { encoding: "utf-8", timeout: 5000 }).trim();
      if (globalRoot) {
        const req = createRequire(join(globalRoot, "package.json"));
        candidates.push(req.resolve("playwright"));
      }
    } catch { /* no global npm */ }

    // 3. Bare specifier
    candidates.push("playwright");

    const errors: string[] = [];
    for (const c of candidates) {
      try {
        return await import(c);
      } catch (e) {
        errors.push(`${c}: ${(e as Error).message}`);
      }
    }

    throw new Error(
      `Playwright not found. Run \`spark-e2e setup\` to install it,\n` +
      `or manually: npm install -g playwright && npx playwright install chromium\n` +
      `Resolution attempts:\n${errors.map(e => "  - " + e).join("\n")}`
    );
  }
}

/**
 * Browser backend using Playwright (native Node.js).
 *
 * Install: ``npm install playwright && npx playwright install chromium``.
 * Set ``browser.backend: playwright`` in config.
 */
import type { BrowserBackend, ElementRect, PageInfo, ScrollOptions, Viewport } from "./index.js";

function log(msg: string): void {
  process.stderr.write(`[spark-e2e] ${msg}\n`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlaywrightAny = any;

export class PlaywrightBackend implements BrowserBackend {
  private pw: PlaywrightAny = null;
  private browser: PlaywrightAny = null;
  private page: PlaywrightAny = null;

  private async ensureBrowser(): Promise<PlaywrightAny> {
    if (this.page) return this.page;

    const mod = await this.loadPlaywright();
    log("Starting Playwright browser (Chromium, headless)");
    this.pw = { stop: async () => { await mod.chromium.stop?.(); } };
    this.browser = await mod.chromium.launch({ headless: true });
    this.page = await this.browser.newPage();
    return this.page;
  }

  /**
   * Resolve playwright from multiple locations:
   * 1. Project CWD (for npx / global spark-e2e + local playwright)
   * 2. Global npm prefix (for global spark-e2e + global playwright)
   * 3. Bare specifier (for spark-e2e installed as project dependency)
   */
  private async loadPlaywright(): Promise<PlaywrightAny> {
    const { createRequire } = await import("node:module");
    const { join } = await import("node:path");

    const candidates: string[] = [];

    // 1. Project CWD — covers npx spark-e2e with project-local playwright
    try {
      const req = createRequire(join(process.cwd(), "package.json"));
      candidates.push(req.resolve("playwright"));
    } catch { /* not in project */ }

    // 2. Global npm — covers global spark-e2e + global playwright
    try {
      const { execSync } = await import("node:child_process");
      const globalRoot = execSync("npm root -g", { encoding: "utf-8", timeout: 5000 }).trim();
      if (globalRoot) {
        const req = createRequire(join(globalRoot, "package.json"));
        candidates.push(req.resolve("playwright"));
      }
    } catch { /* no global npm or no playwright there */ }

    // 3. Bare specifier — covers spark-e2e installed as project dep
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
      `Playwright not found. Install it:\n` +
      `  npm install playwright && npx playwright install chromium\n` +
      `Resolution attempts:\n${errors.map(e => "  - " + e).join("\n")}`
    );
  }

  async captureScreenshot(opts?: {
    viewport?: Viewport;
    reload?: boolean;
    delay?: number;
    maxDim?: number;
    fullPage?: boolean;
  }): Promise<Buffer> {
    const page = await this.ensureBrowser();

    if (opts?.viewport) {
      await page.setViewportSize({ width: opts.viewport.width, height: opts.viewport.height });
    }

    // reload defaults to true unless explicitly disabled with --no-reload
    if (opts?.reload !== false) {
      await page.reload();
      await page.waitForLoadState("networkidle");
    }
    // delay is independent of reload — always applied when set (seconds → ms)
    if ((opts?.delay ?? 0) > 0) {
      await new Promise((r) => setTimeout(r, opts!.delay! * 1000));
    }

    return page.screenshot({ type: "png", fullPage: opts?.fullPage ?? false }) as Promise<Buffer>;
  }

  async executeJs(script: string): Promise<unknown> {
    const page = await this.ensureBrowser();
    return page.evaluate(`(${script})`);
  }

  async navigate(url: string): Promise<void> {
    const page = await this.ensureBrowser();
    log(`Navigating to ${url}`);
    await page.goto(url, { waitUntil: "networkidle" });
  }

  async getPageInfo(): Promise<PageInfo> {
    const page = await this.ensureBrowser();
    return page.evaluate(() => ({
      url: window.location.href,
      title: document.title,
      width: window.innerWidth,
      height: window.innerHeight,
      scroll_x: window.scrollX,
      scroll_y: window.scrollY,
    })) as Promise<PageInfo>;
  }

  async scroll(opts?: ScrollOptions): Promise<PageInfo> {
    const page = await this.ensureBrowser();

    if (opts?.selector) {
      await page.evaluate((sel: string) => {
        const el = document.querySelector(sel);
        if (el) el.scrollIntoView({ behavior: "instant", block: "nearest" });
      }, opts.selector);
    } else {
      const x = opts?.x ?? 0;
      const y = opts?.y ?? 0;
      await page.evaluate(
        ({ px, py }: { px: number; py: number }) =>
          window.scrollTo({ top: py, left: px, behavior: "instant" } as ScrollToOptions),
        { px: x, py: y }
      );
    }

    return this.getPageInfo();
  }

  async getElementRect(selector: string): Promise<ElementRect | null> {
    const page = await this.ensureBrowser();
    try {
      const box = await page.locator(selector).boundingBox();
      if (!box) return null;
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        top: box.y,
        right: box.x + box.width,
        bottom: box.y + box.height,
        left: box.x,
      };
    } catch {
      return null;
    }
  }

  async waitForSelector(selector: string, timeoutMs = 10000): Promise<void> {
    const page = await this.ensureBrowser();
    await page.waitForSelector(selector, { timeout: timeoutMs });
  }

  async waitForTimeout(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  toDataUrl(bytes: Buffer): string {
    return "data:image/png;base64," + bytes.toString("base64");
  }

  async close(): Promise<void> {
    if (this.browser) await this.browser.close();
    if (this.pw) await this.pw.stop();
  }
}

/**
 * Browser backend using Playwright (native Node.js).
 *
 * Install: ``npm install playwright && npx playwright install chromium``.
 * Set ``browser.backend: playwright`` in config.
 */
import type { BrowserBackend, ElementRect, PageInfo, Viewport } from "./index.js";

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

    let mod;
    try {
      // playwright is an optional peer dependency
      mod = await import("playwright");
    } catch {
      throw new Error(
        "Playwright is not installed. Run: npm install playwright && npx playwright install chromium"
      );
    }

    log("Starting Playwright browser (Chromium, headless)");
    this.pw = { stop: async () => { await mod.chromium.stop?.(); } };
    this.browser = await mod.chromium.launch({ headless: true });
    this.page = await this.browser.newPage();
    return this.page;
  }

  async captureScreenshot(opts?: {
    viewport?: Viewport;
    reload?: boolean;
    delay?: number;
    maxDim?: number;
  }): Promise<Buffer> {
    const page = await this.ensureBrowser();

    if (opts?.viewport) {
      await page.setViewportSize({ width: opts.viewport.width, height: opts.viewport.height });
    }

    if (opts?.reload) {
      await page.reload();
      await page.waitForLoadState("networkidle");
      if ((opts.delay ?? 0) > 0) {
        await new Promise((r) => setTimeout(r, (opts.delay ?? 0) * 1000));
      }
    }

    return page.screenshot({ type: "png", fullPage: false }) as Promise<Buffer>;
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

  async close(): Promise<void> {
    if (this.browser) await this.browser.close();
    if (this.pw) await this.pw.stop();
  }

  static toDataUrl(pngBytes: Buffer): string {
    return "data:image/png;base64," + pngBytes.toString("base64");
  }
}

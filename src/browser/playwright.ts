/**
 * Playwright browser backend — the one and only.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Viewport, PageInfo, ElementRect, ScrollOptions } from "./index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlaywrightAny = any;

function log(msg: string): void {
  process.stderr.write(`[spark-e2e] ${msg}\n`);
}

export class PlaywrightBrowser {
  private pw: PlaywrightAny = null;
  private browser: PlaywrightAny = null;
  private context: PlaywrightAny = null;
  private page: PlaywrightAny = null;
  private module: PlaywrightAny = null;
  private storageStatePath: string | null = null;

  /** Set the path for persistent browser session storage (cookies, localStorage). */
  setStorageStatePath(path: string): void {
    this.storageStatePath = path;
  }

  // ── Lifecycle ────────────────────────────────────────

  async ensurePage(): Promise<PlaywrightAny> {
    if (this.page) return this.page;

    this.module = await this.resolvePlaywright();
    // ESM bundles (Playwright 1.60+) wrap exports in .default
    const pw = this.module.default ?? this.module;
    log("Starting Chromium (headless)");

    // Load persisted session if available
    const storageState = this.storageStatePath && existsSync(this.storageStatePath)
      ? JSON.parse(readFileSync(this.storageStatePath, "utf-8"))
      : undefined;

    this.browser = await pw.chromium.launch({ headless: true });
    this.context = await this.browser.newContext(
      storageState ? { storageState } : {}
    );
    this.page = await this.context.newPage();
    return this.page;
  }

  async close(): Promise<void> {
    // Save session state before closing
    if (this.context && this.storageStatePath) {
      try {
        const state = await this.context.storageState();
        writeFileSync(this.storageStatePath, JSON.stringify(state), "utf-8");
      } catch { /* best effort */ }
    }
    try { if (this.page) await this.page.close(); } catch {}
    try { if (this.context) await this.context.close(); } catch {}
    try { if (this.browser) await this.browser.close(); } catch {}
    try { if (this.pw) await this.pw.stop?.(); } catch {}
    this.page = null;
    this.context = null;
    this.browser = null;
    this.module = null;
  }

  // ── Security: sensitive field masking ──────────────────

  /**
   * Mask sensitive fields (passwords, secrets, tokens) before screenshot capture.
   * Replaces input values with "***" and clears text content matching credential patterns.
   * Selectors are configurable via security.mask_selectors in .spark-e2e.yaml.
   */
  async maskSensitiveFields(maskSelectors: string[]): Promise<void> {
    const page = await this.ensurePage();
    const selectors = maskSelectors.length > 0
      ? maskSelectors
      : ['input[type="password"]'];

    try {
      await page.evaluate((sels: string[]) => {
        // 1. Mask matched input fields
        for (const sel of sels) {
          try {
            document.querySelectorAll(sel).forEach((el) => {
              const input = el as HTMLInputElement;
              if (input.value) input.value = "***";
              // Also mask placeholder if it looks like a credential hint
              if (input.placeholder && /secret|token|key|password/i.test(input.placeholder)) {
                input.placeholder = "***";
              }
            });
          } catch {
            // Invalid CSS selector — skip
          }
        }

        // 2. Mask text nodes containing likely API key / secret patterns
        const credentialPatterns = [
          /\bAKID[A-Za-z0-9]{16,}\b/g,        // AWS Access Key ID
          /\bsk-[A-Za-z0-9]{20,}\b/g,          // OpenAI / Anthropic-style keys
          /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT tokens
          /\b[a-zA-Z0-9+/]{40,}={0,2}\b/g,     // Base64-encoded secrets
        ];

        // Walk text nodes in the body and replace matching text
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode: (node) => {
              // Skip password fields, script/style tags, and empty text
              const parent = node.parentElement;
              if (!parent) return NodeFilter.FILTER_REJECT;
              const tag = parent.tagName.toLowerCase();
              if (tag === "script" || tag === "style" || tag === "input") {
                return NodeFilter.FILTER_REJECT;
              }
              return (node.textContent?.trim().length ?? 0) > 0
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_REJECT;
            },
          }
        );

        let node: Text | null;
        while ((node = walker.nextNode() as Text | null)) {
          let text = node.textContent ?? "";
          let changed = false;
          for (const pattern of credentialPatterns) {
            if (pattern.test(text)) {
              text = text.replace(pattern, "[credential redacted]");
              changed = true;
            }
          }
          if (changed) {
            node.textContent = text;
          }
        }
      }, selectors);
    } catch {
      // Masking is best-effort — never fail a screenshot over it
    }
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
    maskSelectors?: string[];
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

    // Mask sensitive fields before capture to prevent credential leakage
    if (opts?.maskSelectors) {
      await this.maskSensitiveFields(opts.maskSelectors);
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

  // ── Visual interaction ───────────────────────────────

  async clickAt(x: number, y: number): Promise<void> {
    const page = await this.ensurePage();
    log(`Click at (${Math.round(x)}, ${Math.round(y)})`);
    await page.mouse.click(x, y);
  }

  async typeText(text: string): Promise<void> {
    const page = await this.ensurePage();
    log(`Type: "${text.slice(0, 40)}${text.length > 40 ? "..." : ""}"`);
    await page.keyboard.type(text);
  }

  async clearAndType(text: string): Promise<void> {
    // After clicking into a field, clear any existing content and type new text.
    const page = await this.ensurePage();
    // Select all existing text (works cross-platform: tries both shortcuts)
    await page.keyboard.press("Meta+a");
    await page.keyboard.press("Control+a");
    // Replace with new text
    await page.keyboard.type(text);
    log(`Cleared field → typed: "${text.slice(0, 40)}${text.length > 40 ? "..." : ""}"`);
  }

  async hoverAt(x: number, y: number): Promise<void> {
    const page = await this.ensurePage();
    log(`Hover at (${Math.round(x)}, ${Math.round(y)})`);
    await page.mouse.move(x, y);
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

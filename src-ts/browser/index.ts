/**
 * Abstract browser backend interface.
 */
export interface Viewport {
  width: number;
  height: number;
  deviceScaleFactor?: number;
}

export interface PageInfo {
  url: string;
  title: string;
  width: number;
  height: number;
  scroll_x: number;
  scroll_y: number;
}

export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ScrollOptions {
  /** Absolute horizontal scroll position (px). */
  x?: number;
  /** Absolute vertical scroll position (px). */
  y?: number;
  /** CSS selector to scroll into view (takes priority over x/y). */
  selector?: string;
}

export interface BrowserBackend {
  /** Capture screenshot as PNG bytes. */
  captureScreenshot(opts?: {
    viewport?: Viewport;
    reload?: boolean;
    delay?: number;
    maxDim?: number;
    fullPage?: boolean;
  }): Promise<Buffer>;

  /** Execute JavaScript in the page context. */
  executeJs(script: string): Promise<unknown>;

  /** Navigate to a URL. */
  navigate(url: string): Promise<void>;

  /** Get current page info. */
  getPageInfo(): Promise<PageInfo>;

  /** Get element bounding rect, or null if not found. */
  getElementRect(selector: string): Promise<ElementRect | null>;

  /** Scroll the page. Returns updated PageInfo. */
  scroll(opts?: ScrollOptions): Promise<PageInfo>;

  /** Clean up resources. */
  close(): Promise<void>;
}

// ── Registry ────────────────────────────────────────────

const backends = new Map<string, new () => BrowserBackend>();

export function registerBackend(name: string, cls: new () => BrowserBackend): void {
  backends.set(name, cls);
}

export function getBackend(name = "browser-harness"): BrowserBackend {
  const Cls = backends.get(name);
  if (!Cls) {
    const available = [...backends.keys()];
    throw new Error(
      `Unknown browser backend: '${name}'. Available: ${available.length ? available.join(", ") : "(none registered)"}.`
    );
  }
  return new Cls();
}

export function listBackends(): string[] {
  return [...backends.keys()];
}

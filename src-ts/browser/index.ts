/**
 * Browser — Playwright backend.
 *
 * This is the only browser backend.  It needs ``playwright`` available.
 * Run ``spark-e2e setup`` to install it automatically.
 */

// ── Types ─────────────────────────────────────────────────

export interface Viewport {
  width: number;
  height: number;
  deviceScaleFactor?: number;
}

export interface PageInfo {
  url: string;
  title: string;
  scrollY: number;
  viewportHeight: number;
  contentHeight: number;
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
  x?: number;
  y?: number;
  deltaX?: number;
  deltaY?: number;
  /** CSS selector to scroll into view. */
  selector?: string;
}

// ── Backend ───────────────────────────────────────────────

export { PlaywrightBrowser } from "./playwright.js";

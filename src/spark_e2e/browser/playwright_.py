"""Browser backend using Playwright.

This is a Phase 2 implementation.  Install with ``pip install spark-e2e[playwright]``
and set ``browser.backend: playwright`` in your config.
"""

from __future__ import annotations

import sys
from base64 import b64encode

from .base import BrowserBackend


def _log(msg: str) -> None:
    print(f"[spark-e2e] {msg}", file=sys.stderr, flush=True)


class PlaywrightBackend(BrowserBackend):
    """Browser automation via Playwright's sync API.

    Requires ``playwright`` to be installed and browsers to be downloaded:
    ``pip install playwright && playwright install chromium``.
    """

    def __init__(self) -> None:
        self._browser = None
        self._page = None

    def _ensure_browser(self) -> None:
        """Lazy-init the Playwright browser and page."""
        if self._page is not None:
            return

        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            raise ImportError(
                "Playwright is not installed. "
                "Install it with: pip install spark-e2e[playwright]"
            )

        _log("Starting Playwright browser (Chromium, headless)")
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=True)
        self._page = self._browser.new_page()

    # ── BrowserBackend interface ─────────────────────────────────────

    def capture_screenshot(
        self,
        viewport: dict | None = None,
        reload: bool = False,
        delay: float = 0.3,
        max_dim: int = 1800,
    ) -> bytes:
        self._ensure_browser()

        if viewport:
            self._page.set_viewport_size({
                "width": viewport["width"],
                "height": viewport["height"],
            })

        if reload:
            self._page.reload()
            self._page.wait_for_load_state("networkidle")
            if delay > 0:
                import time
                time.sleep(delay)

        png_bytes = self._page.screenshot(type="png", full_page=False)

        # Scale down if needed (simple PIL-free approach: just return as-is for now)
        return png_bytes

    def execute_js(self, script: str) -> object:
        self._ensure_browser()
        return self._page.evaluate(script)

    def navigate(self, url: str) -> None:
        self._ensure_browser()
        _log(f"Navigating to {url}")
        self._page.goto(url, wait_until="networkidle")

    def get_page_info(self) -> dict:
        self._ensure_browser()
        return self._page.evaluate("""() => ({
            url: window.location.href,
            title: document.title,
            width: window.innerWidth,
            height: window.innerHeight,
            scroll_x: window.scrollX,
            scroll_y: window.scrollY,
        })""")

    def get_element_rect(self, selector: str) -> dict | None:
        self._ensure_browser()
        try:
            box = self._page.locator(selector).bounding_box()
            if box is None:
                return None
            return {
                "x": box["x"],
                "y": box["y"],
                "width": box["width"],
                "height": box["height"],
                "top": box["y"],
                "right": box["x"] + box["width"],
                "bottom": box["y"] + box["height"],
                "left": box["x"],
            }
        except Exception:
            return None

    def close(self) -> None:
        if self._browser:
            self._browser.close()
        if hasattr(self, "_pw") and self._pw:
            self._pw.stop()

    # ── Utility ──────────────────────────────────────────────────────

    @staticmethod
    def to_data_url(png_bytes: bytes) -> str:
        """Encode PNG bytes as a ``data:image/png;base64,...`` URL."""
        return "data:image/png;base64," + b64encode(png_bytes).decode("ascii")

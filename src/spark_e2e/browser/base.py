"""Abstract browser backend interface."""

from abc import ABC, abstractmethod
from typing import Any


class BrowserBackend(ABC):
    """Abstract interface for browser automation backends.

    Implement this class to add support for a new browser automation tool
    (Playwright, Puppeteer, Selenium, etc.).

    Subclasses must implement all 7 abstract methods.
    """

    @abstractmethod
    def capture_screenshot(
        self,
        viewport: dict | None = None,
        reload: bool = False,
        delay: float = 0.3,
        max_dim: int = 1800,
        full_page: bool = False,
    ) -> bytes:
        """Capture the current page as PNG bytes.

        Args:
            viewport: Optional ``{width, height, deviceScaleFactor?}`` dict.
                      Viewport is set before capture and restored afterwards.
            reload: If True, reload the page before capturing.
            delay: Seconds to wait after reload for layout to settle.
            max_dim: If the image exceeds this size on any axis, scale it down.
            full_page: If True, capture the entire scrollable page.

        Returns:
            PNG image bytes.
        """
        ...

    @abstractmethod
    def execute_js(self, script: str) -> Any:
        """Execute arbitrary JavaScript in the browser page.

        Args:
            script: JavaScript source code to evaluate.

        Returns:
            The JSON-serializable result of the script evaluation.
        """
        ...

    @abstractmethod
    def navigate(self, url: str) -> None:
        """Navigate the browser to a URL and wait for the page to load.

        Args:
            url: The target URL to navigate to.
        """
        ...

    @abstractmethod
    def get_page_info(self) -> dict:
        """Return information about the current page.

        Returns:
            A dict with keys: url, title, width, height, scroll_x, scroll_y.
        """
        ...

    @abstractmethod
    def get_element_rect(self, selector: str) -> dict | None:
        """Get the bounding client rect of an element.

        Args:
            selector: CSS selector for the target element.

        Returns:
            A dict with x, y, width, height, top, right, bottom, left,
            or None if the element was not found.
        """
        ...

    @abstractmethod
    def scroll(
        self,
        x: int | None = None,
        y: int | None = None,
        selector: str | None = None,
    ) -> dict:
        """Scroll the page to a position or element.

        Args:
            x: Horizontal scroll target in pixels.
            y: Vertical scroll target in pixels.
            selector: CSS selector for element to scroll into view.

        Returns:
            A dict with keys: url, title, width, height, scroll_x, scroll_y.
        """
        ...

    @abstractmethod
    def close(self) -> None:
        """Clean up resources (close tabs, stop browser, etc.)."""
        ...

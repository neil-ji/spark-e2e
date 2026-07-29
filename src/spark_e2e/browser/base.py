"""Abstract browser backend interface."""

from abc import ABC, abstractmethod
from typing import Any


class BrowserBackend(ABC):
    """Abstract interface for browser automation backends.

    Implement this class to add support for a new browser automation tool
    (Playwright, Puppeteer, Selenium, etc.).

    Subclasses must implement all 10 abstract methods.
    """

    @abstractmethod
    def capture_screenshot(
        self,
        viewport: dict | None = None,
        reload: bool = True,
        delay: float = 0.5,
        max_dim: int = 1800,
        full_page: bool = False,
        format: str = "png",
        quality: int = 80,
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
    def wait_for_selector(self, selector: str, timeout_ms: int = 10000) -> None:
        """Wait for a CSS selector to appear in the DOM.

        Args:
            selector: CSS selector to wait for.
            timeout_ms: Maximum wait time in milliseconds.

        Raises:
            TimeoutError: If the selector does not appear within the timeout.
        """
        ...

    @abstractmethod
    def wait_for_timeout(self, ms: int) -> None:
        """Pause execution for a fixed duration.

        Args:
            ms: Duration to wait in milliseconds.
        """
        ...

    @abstractmethod
    def to_data_url(self, image_bytes: bytes) -> str:
        """Convert image bytes to a base64 data URL.

        Args:
            image_bytes: Raw image bytes (PNG or JPEG).

        Returns:
            A ``data:image/...;base64,...`` string.
        """
        ...

    @abstractmethod
    def close(self) -> None:
        """Clean up resources (close tabs, stop browser, etc.)."""
        ...

    @abstractmethod
    def click_at(self, x: float, y: float) -> None:
        """Click at pixel coordinates on the page.

        Args:
            x: Horizontal pixel coordinate.
            y: Vertical pixel coordinate.
        """
        ...

    @abstractmethod
    def type_text(self, text: str) -> None:
        """Type text using the keyboard (assumes target field is focused).

        Args:
            text: The text to type.
        """
        ...

    @abstractmethod
    def clear_and_type(self, text: str) -> None:
        """Clear the focused field and type new text.

        Args:
            text: The replacement text.
        """
        ...

    @abstractmethod
    def hover_at(self, x: float, y: float) -> None:
        """Move the mouse to pixel coordinates (hover, no click).

        Args:
            x: Horizontal pixel coordinate.
            y: Vertical pixel coordinate.
        """
        ...

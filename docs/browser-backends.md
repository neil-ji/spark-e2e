# Browser Backends

spark-e2e supports pluggable browser automation backends.
Two backends are built-in, and you can register custom ones.

## Built-in Backends

### browser-harness (default)

Uses the [browser-harness](https://github.com/browser-use/browser-harness) CLI
tool for CDP-based Chrome automation.

**Install:** `brew install browser-use/tap/browser-harness`

**Requirements:**
- Chrome/Chromium with remote debugging enabled (`chrome://inspect/#remote-debugging`)
- `browser-harness` on PATH

**Configuration:**
```yaml
browser:
  backend: browser-harness
```

### Playwright

Uses Playwright's sync Python API for cross-browser automation.

**Install:** `pip install spark-e2e[playwright] && playwright install chromium`

**Configuration:**
```yaml
browser:
  backend: playwright
```

## Custom Backends

Implement the `BrowserBackend` abstract class to add a new backend:

```python
from spark_e2e.browser import BrowserBackend, register_backend

class SeleniumBackend(BrowserBackend):
    def capture_screenshot(self, viewport=None, reload=False, delay=0.3, max_dim=1800):
        # Return PNG bytes
        ...

    def execute_js(self, script: str):
        # Execute JS and return result
        ...

    def navigate(self, url: str):
        # Navigate to URL
        ...

    def get_page_info(self) -> dict:
        # Return {url, title, width, height, scroll_x, scroll_y}
        ...

    def get_element_rect(self, selector: str):
        # Return {x, y, width, height, top, right, bottom, left} or None
        ...

    def close(self):
        # Cleanup
        ...

register_backend("selenium", SeleniumBackend)
```

Set `browser.backend: selenium` in your config to use it.

## Interface Reference

### `capture_screenshot(viewport=None, reload=False, delay=0.3, max_dim=1800) → bytes`

Take a screenshot of the current page. Return raw PNG bytes.

If `viewport` is provided (`{width, height, deviceScaleFactor?}`), it should
be applied before capture and restored afterwards.

### `execute_js(script: str) → Any`

Execute arbitrary JavaScript in the page context. Return the JSON-serializable
result of the evaluation.

### `navigate(url: str) → None`

Navigate to a URL and wait for the page to be ready.

### `get_page_info() → dict`

Return `{url, title, width, height, scroll_x, scroll_y}` for the current page.

### `get_element_rect(selector: str) → dict | None`

Return the `getBoundingClientRect()` of the first element matching the
CSS selector, or None if not found.

### `close() → None`

Clean up resources. Called at the end of a CLI session.

"""Browser backend using the browser-harness CLI tool (CDP-based)."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from base64 import b64encode
from pathlib import Path

from .base import BrowserBackend


def _log(msg: str) -> None:
    print(f"[spark-e2e] {msg}", file=sys.stderr, flush=True)


class BrowserHarnessBackend(BrowserBackend):
    """Browser automation via the ``browser-harness`` CLI.

    browser-harness is a CDP-based browser control tool by Browser Use.
    It must be installed separately (``brew install browser-use/tap/browser-harness``
    or ``pip install browser-harness``).

    This backend spawns ``browser-harness`` as a subprocess and pipes Python
    snippets to stdin.  The daemon pre-imports helpers like ``cdp()``, ``js()``,
    ``new_tab()``, ``wait_for_load()``, ``capture_screenshot()``, and ``page_info()``.
    """

    def __init__(self, timeout: int = 30) -> None:
        self._timeout = timeout

    # ── BrowserBackend interface ─────────────────────────────────────

    def capture_screenshot(
        self,
        viewport: dict | None = None,
        reload: bool = True,
        delay: float = 0.5,
        max_dim: int = 1800,
        full_page: bool = False,
    ) -> bytes:
        tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
        tmp_path = tmp.name
        tmp.close()

        commands: list[str] = []

        # Set viewport before capture
        if viewport:
            w = viewport["width"]
            h = viewport["height"]
            scale = viewport.get("deviceScaleFactor", 1)
            commands.append(
                f'cdp("Emulation.setDeviceMetricsOverride", '
                f"width={w}, height={h}, deviceScaleFactor={scale}, mobile=False)"
            )

        # Reload page to pick up latest code changes (defaults to True)
        if reload:
            commands.append('js("window.location.reload()")')
            commands.append("wait_for_load()")
        # delay is independent of reload — always applied when set
        if delay > 0:
            commands.append(f"import time; time.sleep({delay})")

        # Capture screenshot
        full_arg = ", full=True" if full_page else ""
        commands.append(f"capture_screenshot('{tmp_path}', max_dim={max_dim}{full_arg})")

        # Restore viewport
        if viewport:
            commands.append("cdp('Emulation.clearDeviceMetricsOverride')")

        script = "\n".join(commands)
        _log(f"Capturing screenshot (viewport={viewport}, reload={reload})")

        result = subprocess.run(
            ["browser-harness"],
            input=script,
            capture_output=True,
            text=True,
            timeout=self._timeout,
        )

        if result.returncode != 0:
            raise RuntimeError(
                f"browser-harness exited with code {result.returncode}: "
                f"{result.stderr.strip()}"
            )

        png_bytes = Path(tmp_path).read_bytes()
        Path(tmp_path).unlink(missing_ok=True)

        if not png_bytes:
            raise RuntimeError("Screenshot file is empty — browser may not be connected")
        return png_bytes

    def execute_js(self, script: str) -> object:
        """Execute JavaScript in the browser and return the JSON-serialized result.

        Writes the JS to a temp file to avoid escaping issues, then has
        the browser-harness Python runtime read it back.
        """
        # Write JS to temp file
        tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".js", delete=False)
        tmp_path = Path(tmp.name)
        tmp.write(script)
        tmp.close()

        try:
            # Python snippet: read the JS file, evaluate it, print result as JSON
            py_lines = [
                "import json",
                f"with open({tmp_path.as_posix()!r}) as f: code = f.read()",
                "result = js(code)",
                'print("__BH_RESULT__" + json.dumps(result, default=str) + "__BH_END__")',
            ]
            py_script = "\n".join(py_lines)

            result = subprocess.run(
                ["browser-harness"],
                input=py_script,
                capture_output=True,
                text=True,
                timeout=self._timeout,
            )

            if result.returncode != 0:
                raise RuntimeError(
                    f"browser-harness exited with code {result.returncode}: "
                    f"{result.stderr.strip()}"
                )

            # Extract the marked result from stdout
            output = result.stdout
            start = output.find("__BH_RESULT__")
            end = output.find("__BH_END__")
            if start >= 0 and end > start:
                return json.loads(output[start + 14 : end])
            return None
        finally:
            tmp_path.unlink(missing_ok=True)

    def navigate(self, url: str) -> None:
        _log(f"Navigating to {url}")
        script = f'new_tab("{url}")\nwait_for_load()'
        result = subprocess.run(
            ["browser-harness"],
            input=script,
            capture_output=True,
            text=True,
            timeout=self._timeout,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"browser-harness navigate failed with code {result.returncode}: "
                f"{result.stderr.strip()}"
            )

    def get_page_info(self) -> dict:
        script = (
            "import json\n"
            "info = page_info()\n"
            'print("__BH_RESULT__" + json.dumps(info) + "__BH_END__")'
        )
        result = subprocess.run(
            ["browser-harness"],
            input=script,
            capture_output=True,
            text=True,
            timeout=self._timeout,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"browser-harness page_info failed: {result.stderr.strip()}"
            )
        output = result.stdout
        start = output.find("__BH_RESULT__")
        end = output.find("__BH_END__")
        if start >= 0 and end > start:
            return json.loads(output[start + 14 : end])
        return {"error": "could not parse page_info output"}

    def scroll(
        self,
        x: int | None = None,
        y: int | None = None,
        selector: str | None = None,
    ) -> dict:
        """Scroll the page via JS and return updated page info."""
        if selector:
            scroll_js = (
                f"var el = document.querySelector({selector!r});"
                "if (el) el.scrollIntoView({behavior: 'instant', block: 'nearest'});"
            )
        else:
            _x = x or 0
            _y = y or 0
            scroll_js = f"window.scrollTo({{top: {_y}, left: {_x}, behavior: 'instant'}});"

        py_lines = [
            "import json",
            f"js({json.dumps(scroll_js)})",
            "info = page_info()",
            'print("__BH_RESULT__" + json.dumps(info, default=str) + "__BH_END__")',
        ]
        py_script = "\n".join(py_lines)

        result = subprocess.run(
            ["browser-harness"],
            input=py_script,
            capture_output=True,
            text=True,
            timeout=self._timeout,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"browser-harness scroll failed with code {result.returncode}: "
                f"{result.stderr.strip()}"
            )
        output = result.stdout
        start = output.find("__BH_RESULT__")
        end = output.find("__BH_END__")
        if start >= 0 and end > start:
            return json.loads(output[start + 14 : end])
        return {"error": "could not parse scroll page_info output"}

    def get_element_rect(self, selector: str) -> dict | None:
        js_code = (
            f"var el = document.querySelector({selector!r});"
            "if (!el) return null;"
            "var r = el.getBoundingClientRect();"
            "return {x: r.x, y: r.y, width: r.width, height: r.height, "
            "top: r.top, right: r.right, bottom: r.bottom, left: r.left};"
        )
        result = self.execute_js(js_code)
        return result if isinstance(result, dict) else None

    def wait_for_selector(self, selector: str, timeout_ms: int = 10000) -> None:
        """Wait for a CSS selector to appear via MutationObserver."""
        safe = json.dumps(selector)
        code = (
            f"(function(){{var el=document.querySelector({safe});if(el)return true;"
            f"return new Promise(function(resolve,reject){{"
            f"var t=setTimeout(function(){{reject(new Error('Timeout: {safe}'))}},{timeout_ms});"
            f"new MutationObserver(function(_,obs){{"
            f"var el=document.querySelector({safe});if(el){{obs.disconnect();clearTimeout(t);resolve(true);}}"
            f"}}).observe(document.documentElement,{{childList:true,subtree:true}})"
            f"}})}})()"
        )
        self.execute_js(code)

    def wait_for_timeout(self, ms: int) -> None:
        """Pause for a fixed duration."""
        import time
        time.sleep(ms / 1000)

    def to_data_url(self, image_bytes: bytes) -> str:
        """Convert image bytes to base64 data URL."""
        return "data:image/png;base64," + b64encode(image_bytes).decode("ascii")

    def close(self) -> None:
        """No-op for CLI-based backend — browser lifecycle is managed externally."""
        pass

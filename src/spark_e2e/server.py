"""MCP server — VLM-powered visual E2E testing tools.

Exposes 7 MCP tools:
- ``navigate`` — load a page (NEW)
- ``visual_snapshot`` — capture screenshot
- ``visual_inspect`` — VLM analysis with free-form instruction
- ``visual_assert`` — verify a visual condition (pass/fail)
- ``visual_compare`` — compare page against expected state
- ``visual_review`` — comprehensive UI audit
- ``dom_verify`` — batch DOM verification (NEW)
"""

from __future__ import annotations

import json
import sys

from mcp.server.fastmcp import FastMCP, Image

from . import config as config_mod, prompts
from .browser import BrowserBackend, get_backend
from .vlm import get_provider
from .vlm.openai_compat import extract_json

# ── stderr logger ───────────────────────────────────────────────────


def _log(msg: str) -> None:
    print(f"[spark-e2e] {msg}", file=sys.stderr, flush=True)


# ── Lazy init (backend/provider are created on first use) ───────────

_backend: BrowserBackend | None = None
_provider = None
_strictness: str = "standard"


def _get_backend() -> BrowserBackend:
    global _backend
    if _backend is None:
        cfg = config_mod.get_config()
        _backend = get_backend(cfg.browser.backend)
    return _backend


def _get_provider():
    global _provider, _strictness
    if _provider is None:
        cfg = config_mod.get_config()
        _provider = get_provider(cfg.vlm.provider)
        _strictness = cfg.prompts.strictness
    return _provider


# ── MCP server ──────────────────────────────────────────────────────

mcp = FastMCP("spark-e2e")


# ═══════════════════════════════════════════════════════════════════════
# NEW: Navigation tool
# ═══════════════════════════════════════════════════════════════════════


@mcp.tool()
def navigate(
    url: str,
    viewport: dict | None = None,
) -> str:
    """Navigate the browser to a URL and optionally set the viewport.

    Use this before visual reviews or assertions to load the target page.

    Args:
        url: The target URL to navigate to (e.g. http://localhost:5173/dashboard).
        viewport: Optional viewport dict, e.g. {"width": 1600, "height": 1200,
                  "deviceScaleFactor": 1}. Set before navigation.
    """
    backend = _get_backend()
    # Set viewport if provided (via screenshot trick — capture a tiny shot to set viewport)
    if viewport:
        backend.capture_screenshot(viewport=viewport, reload=False)

    backend.navigate(url)
    info = backend.get_page_info()
    _log(f"Navigated to {info.get('url', url)}, title={info.get('title', '?')}")
    return json.dumps(info, ensure_ascii=False)


# ═══════════════════════════════════════════════════════════════════════
# NEW: DOM verification tool
# ═══════════════════════════════════════════════════════════════════════


@mcp.tool()
def dom_verify(
    url: str | None = None,
    viewport: dict | None = None,
) -> str:
    """Discover page structure and key CSS facts in one batch call.

    Returns page layout, class name prefixes, and CSS variable values.
    Use this before fixing code to confirm VLM findings are real.

    Args:
        url: Optional URL to navigate to first.
        viewport: Optional viewport override.
    """
    backend = _get_backend()

    if url:
        if viewport:
            backend.capture_screenshot(viewport=viewport, reload=False)
        backend.navigate(url)

    cfg = config_mod.get_config()
    css_var_list = cfg.css_variables if cfg.css_variables else [
        "--color-accent", "--color-text", "--color-text-secondary",
        "--color-text-muted", "--color-border", "--color-primary",
        "--color-positive", "--color-negative", "--color-warning",
    ]

    js_code = _build_discovery_js(css_var_list)
    try:
        result = backend.execute_js(js_code)
        return json.dumps(result, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"error": str(e)})


def _build_discovery_js(css_var_names: list[str]) -> str:
    """Build the page-structure discovery JS snippet."""
    vars_json = json.dumps(css_var_names)
    return f"""(function() {{
  var root = document.getElementById('root') || document.querySelector('#app, [class*="app"]');
  var main = root && root.firstElementChild;

  // Page structure
  var layout = Array.from(main ? main.children : document.body.children).map(function(c) {{
    var r = c.getBoundingClientRect();
    return {{tag: c.tagName, classes: (c.className || '').slice(0, 60), role: c.getAttribute('role')||'', top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), text: (c.textContent || '').trim().slice(0, 40)}};
  }});

  // Class name prefixes (identify component library)
  var classPrefixes = new Set();
  var all = Array.from(document.querySelectorAll('[class]'));
  for (var i = 0; i < Math.min(200, all.length); i++) {{
    var names = all[i].className.split(/\\s+/);
    for (var j = 0; j < names.length; j++) {{
      if (names[j] && !names[j].startsWith('_')) classPrefixes.add(names[j].split('__')[0].split('--')[0]);
    }}
  }}

  // Key CSS variables on :root
  var rootStyle = getComputedStyle(document.documentElement);
  var cssVars = {{}};
  var varNames = {vars_json};
  varNames.forEach(function(v) {{
    var val = rootStyle.getPropertyValue(v).trim();
    if (val) cssVars[v] = val;
  }});

  return {{layout: layout, classPrefixes: Array.from(classPrefixes).sort().slice(0, 30), cssVars: cssVars}};
}})()"""


# ═══════════════════════════════════════════════════════════════════════
# Existing tools (preserved signatures, adapted to use backends)
# ═══════════════════════════════════════════════════════════════════════


@mcp.tool()
def visual_snapshot(
    viewport: dict | None = None,
    reload: bool = False,
    delay: float = 0.3,
) -> Image:
    """Capture a screenshot of the current browser page and return it as an image.

    Use this to see what the browser is currently displaying.
    Returns the screenshot as a viewable image directly.

    Args:
        viewport: Optional viewport override dict, e.g. {"width": 1600, "height": 1200,
                  "deviceScaleFactor": 1}. Set before capture, restored afterwards.
        reload: If True, reload the page and wait for layout settle before capturing.
                Use this after code changes to ensure the latest build is shown.
        delay: Seconds to wait after reload before capturing (default 0.3).
    """
    backend = _get_backend()
    _log(f"visual_snapshot viewport={viewport} reload={reload}")
    png = backend.capture_screenshot(viewport=viewport, reload=reload, delay=delay)
    return Image(data=png)


@mcp.tool()
def visual_inspect(
    instruction: str,
    model: str | None = None,
    viewport: dict | None = None,
    reload: bool = False,
    delay: float = 0.3,
) -> str:
    """Take a browser screenshot and analyze it with a Vision Language Model.

    Use this to inspect the current page state visually.
    The VLM will describe what it sees according to your instruction.

    Examples:
    - "Describe the main content and layout of this page"
    - "What interactive elements (buttons, links, forms) are visible?"
    - "Is there any error message or warning displayed on the page?"
    - "Describe the navigation bar and its menu items"
    - "What data is shown in the table or chart?"

    Args:
        instruction: Detailed description of what to look for or analyze.
        model: Optional VLM model override (default: VLM_MODEL env or gpt-4o).
        viewport: Optional viewport override dict.
        reload: If True, reload the page before capturing to pick up latest code.
        delay: Seconds to wait after reload before capturing (default 0.3).
    """
    backend = _get_backend()
    provider = _get_provider()
    _log(f"visual_inspect: {instruction[:100]}... reload={reload}")

    png = backend.capture_screenshot(viewport=viewport, reload=reload, delay=delay)
    data_url = backend.to_data_url(png)

    prompt = (
        "You are a visual inspection tool for automated E2E testing. "
        "Analyze this webpage screenshot carefully and thoroughly.\n\n"
        f"INSTRUCTION: {instruction}\n\n"
        "Be specific and precise. Describe exact positions, colors, text content, "
        "and visual states you observe. If you cannot determine something confidently, "
        "say so rather than guessing.\n\n"
        + prompts.get_review_prompt(_strictness)
    )

    return provider.chat(prompt, data_url, model)


@mcp.tool()
def visual_assert(
    assertion: str,
    model: str | None = None,
    viewport: dict | None = None,
    reload: bool = True,
    delay: float = 0.3,
) -> str:
    """Verify that a visual condition is true on the current browser page.

    Takes a screenshot and asks the VLM to verify the assertion.
    Returns a structured pass/fail result with detailed reasoning and confidence level.
    Use this for automated visual E2E assertions after browser actions.

    Examples:
    - "The page title heading says 'Welcome Back' in large text"
    - "A blue 'Submit' button is visible and not disabled"
    - "The navigation sidebar is collapsed (shows only icons)"
    - "A red error banner appears at the top with the text 'Invalid email'"
    - "The dashboard shows 4 stat cards in a row"
    - "A modal dialog is open with 'Are you sure?' as the title"

    Args:
        assertion: The visual condition to verify in natural language.
        model: Optional VLM model override.
        viewport: Optional viewport override dict.
        reload: If True (default), reload the page before capturing so the latest
                code changes are reflected. Set False only for quick checks after
                browser actions that don't involve code changes.
        delay: Seconds to wait after reload before capturing (default 0.3).
    """
    backend = _get_backend()
    provider = _get_provider()
    _log(f"visual_assert: {assertion[:100]}... reload={reload}")

    png = backend.capture_screenshot(viewport=viewport, reload=reload, delay=delay)
    data_url = backend.to_data_url(png)

    prompt = (
        "You are a visual E2E test verifier. Your job is to determine whether "
        "an assertion about a webpage screenshot is TRUE or FALSE.\n\n"
        "Examine the screenshot carefully. Compare the assertion with "
        "what you actually observe. Be objective — only mark pass=true "
        "when the evidence is clearly visible.\n\n"
        f"ASSERTION: {assertion}\n\n"
        + prompts.get_assert_prompt(_strictness) + "\n\n"
        "Respond with ONLY a JSON object (no markdown, no other text):\n"
        '{"pass": true|false, "confidence": "high"|"medium"|"low", '
        '"observation": "what you actually see, exact text/numbers quoted", '
        '"reasoning": "why it passes or fails, referencing specific visible evidence"}'
    )

    raw = provider.chat(prompt, data_url, model)
    try:
        return json.dumps(extract_json(raw), ensure_ascii=False, indent=2)
    except (json.JSONDecodeError, KeyError):
        _log(f"Failed to parse VLM JSON, returning raw: {raw[:200]}")
        return raw


@mcp.tool()
def visual_compare(
    expected: str,
    after_action: str | None = None,
    model: str | None = None,
    viewport: dict | None = None,
    reload: bool = False,
    delay: float = 0.3,
) -> str:
    """Compare the current page visually against an expected description.

    Use this to verify the page looks correct after performing actions.
    The VLM compares what it sees against your description and reports any
    differences found.

    This is useful for:
    - Verifying form state after filling fields
    - Checking that a dropdown or menu shows correct items
    - Confirming a success/error state after form submission
    - Validating that a page section matches design specs

    Args:
        expected: Description of the expected visual state, e.g.:
                 "A form with 'Name', 'Email' fields and a disabled 'Save' button"
        after_action: Optional description of what action was just performed,
                      for context (e.g. "Clicked the 'Edit Profile' button").
        model: Optional VLM model override.
        viewport: Optional viewport override dict.
        reload: If True, reload the page before capturing.
        delay: Seconds to wait after reload (default 0.3).
    """
    backend = _get_backend()
    provider = _get_provider()
    _log(f"visual_compare: expected={expected[:80]}...")

    png = backend.capture_screenshot(viewport=viewport, reload=reload, delay=delay)
    data_url = backend.to_data_url(png)

    action_context = (
        f"CONTEXT — Action just performed: {after_action}\n\n"
        if after_action
        else ""
    )
    prompt = (
        "You are a visual regression tester. Compare this webpage screenshot "
        "against the expected state.\n\n"
        f"{action_context}"
        f"EXPECTED STATE: {expected}\n\n"
        + prompts.get_review_prompt(_strictness) + "\n\n"
        "Respond with ONLY a JSON object (no markdown, no other text):\n"
        '{"match": true|false, '
        '"differences": ["specific things that differ from expected, with exact text"], '
        '"matches": ["specific things that match the expected state"], '
        '"overall_assessment": "brief summary"}'
    )

    raw = provider.chat(prompt, data_url, model)
    try:
        return json.dumps(extract_json(raw), ensure_ascii=False, indent=2)
    except (json.JSONDecodeError, KeyError):
        _log(f"Failed to parse VLM JSON, returning raw: {raw[:200]}")
        return raw


@mcp.tool()
def visual_review(
    focus: str = "comprehensive",
    model: str | None = None,
    viewport: dict | None = None,
    reload: bool = False,
    delay: float = 0.3,
) -> str:
    """Do a comprehensive visual review of the current page, returning structured findings.

    This is the recommended tool for initial UI quality assessment.
    It systematically checks layout, alignment, color contrast, typography,
    spacing, and visual defects.

    Use this when the user asks to "review the UI", "find visual issues",
    "check for problems", or "screenshot and analyze".

    Args:
        focus: What to focus on — "comprehensive" (everything), "layout" (spacing,
               alignment, card heights), "typography" (text truncation, contrast,
               readability), "charts" (gauge/donut rendering, label clipping,
               color artifacts), or "interactive" (buttons, links, hover states).
        model: Optional VLM model override.
        viewport: Optional viewport override dict.
        reload: If True, reload the page before capturing to pick up latest code.
        delay: Seconds to wait after reload (default 0.3).
    """
    backend = _get_backend()
    provider = _get_provider()
    _log(f"visual_review: focus={focus} reload={reload}")

    png = backend.capture_screenshot(viewport=viewport, reload=reload, delay=delay)
    data_url = backend.to_data_url(png)

    focus_prompts = {
        "comprehensive": "Review ALL aspects: layout, alignment, spacing, color consistency, typography, text truncation, visual artifacts, rendering defects.",
        "layout": "Focus on layout: card heights, grid alignment, spacing between elements, uneven gaps, overlapping content, empty regions that look broken.",
        "typography": "Focus on typography: text truncation (… ellipsis), contrast issues (text too light to read), font size inconsistencies, overlapping text, cut-off labels.",
        "charts": "Focus on charts and data viz: gauge arc colors (any unexpected gray/black segments), donut label clipping, axis/legend artifacts, label positioning, number formatting issues.",
        "interactive": "Focus on interactive elements: button states, hover feedback, menu highlighting, tooltip visibility, click targets that appear too small.",
    }
    focus_instruction = focus_prompts.get(focus, focus_prompts["comprehensive"])

    prompt = (
        "You are a senior UI quality reviewer. Do a thorough visual audit "
        "of this webpage screenshot.\n\n"
        f"FOCUS AREA: {focus_instruction}\n\n"
        "For each issue found, describe:\n"
        "- What is wrong (be specific: location, element type, exact text if cut off)\n"
        "- Why it matters (layout/alignment, readability, functional impact)\n"
        "- How severe it is (critical/major/minor)\n\n"
        + prompts.get_review_prompt(_strictness) + "\n\n"
        "Respond with ONLY a JSON object (no markdown, no other text):\n"
        '{"findings": [{"description": "...", "location": "top-right corner near KPI card", '
        '"severity": "critical"|"major"|"minor", "category": '
        '"layout"|"typography"|"color"|"spacing"|"rendering"|"interactive"}, ...], '
        '"summary": "one-sentence overall assessment", '
        '"no_issues_found": false}'
    )

    raw = provider.chat(prompt, data_url, model)
    try:
        return json.dumps(extract_json(raw), ensure_ascii=False, indent=2)
    except (json.JSONDecodeError, KeyError):
        _log(f"Failed to parse VLM JSON, returning raw: {raw[:200]}")
        return raw


# ── Entry point ─────────────────────────────────────────────────────


def main() -> None:
    """Run the MCP server on stdio."""
    # Preload config so errors surface early
    cfg = config_mod.get_config()
    _log(f"spark-e2e MCP server starting — backend={cfg.browser.backend}, "
         f"vlm_provider={cfg.vlm.provider}, model={cfg.vlm.model}")
    mcp.run()

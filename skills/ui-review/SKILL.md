---
description: Visual UI review using screenshots and DOM verification. Use when the user asks to review the UI, find visual issues, check rendering, screenshot a page, or inspect layout/typography/charts interactively.
argument-hint: "[url] — e.g. http://localhost:5173/dashboard"
---

Browser-based visual UI review using spark-e2e MCP tools.
Systematic "screenshot → VLM review → DOM verify → code fix → VLM assert" loop.

## Arguments

`$ARGUMENTS` is the target URL. If omitted, fall back to `browser.url` from `.spark-e2e.yaml`.

## When to use

- User says "review the UI", "find visual issues", "screenshot this page"
- After making UI code changes, to verify fixes visually
- Before committing, as a quick visual regression check

## Prerequisites

- `spark-e2e` MCP server running (configured in `.mcp.json`)
- `browser-harness` CLI installed and Chrome remote debugging enabled
- VLM API key configured (`.env` or environment)

## Workflow

### Phase 0 — Navigate & Set Viewport

Use the `navigate` MCP tool to load the page. Pass `$ARGUMENTS` as the URL, or use the default from `.spark-e2e.yaml`.

```
navigate:
  url: "$ARGUMENTS"
  viewport: {"width": 1600, "height": 1200, "deviceScaleFactor": 1}
```

### Phase 1 — Broad Inspect

Use `visual_review` for a comprehensive first pass. The tool has a built-in
viewport parameter — no separate screenshot step needed.

```
visual_review:
  focus: "comprehensive"
  viewport: {"width": 1600, "height": 1200, "deviceScaleFactor": 1}
```

If the user already named a specific concern, narrow the focus:
`"layout"` | `"typography"` | `"charts"` | `"interactive"`

### Phase 2 — DOM Verify

**Delegate to `dom-verify` skill.** It batch-verifies every VLM finding in at
most 2 browser-harness calls (discover + verify), instead of one call per finding.

```
Skill("dom-verify", { findings: [...Phase 1 output], url: "$ARGUMENTS" })
```

If invoking the skill is impractical, use the `dom_verify` MCP tool:
- One call returns page structure, class prefixes, and CSS variable values
- Follow up with `browser-harness` `js()` calls for targeted checks

**Golden rules for DOM verification**:
- For CSS variable overrides, read the component library's CSS source file
  before guessing the variable name.  Use `getComputedStyle()` to confirm.
- Check computed values, not declared values — CSS inheritance and SVG contexts
  can change what a variable resolves to.
- Grep the component library's CSS file (in `node_modules/` or equivalent)
  rather than guessing variable names.

### Phase 3 — Code Fix

After root cause is confirmed via DOM, make the minimal code change.

**Before touching any file**, capture a baseline:

```
visual_snapshot:
  viewport: {"width": 1600, "height": 1200, "deviceScaleFactor": 1}
```

This gives you a before image to compare against if something goes wrong.

### Phase 4 — Visual Assert

After each fix (or batch of independent fixes), verify with `visual_assert`.
It defaults to `reload: true` so the latest code is always captured.
Keep assertions narrow and data-independent.

**Good assertions (narrow, data-independent):**

```
visual_assert:
  assertion: "Two adjacent cards have the same height and their bottom edges align"
  viewport: {"width": 1600, "height": 1200, "deviceScaleFactor": 1}
visual_assert:
  assertion: "The gauge arc has exactly three colored segments — green, yellow, red — with no dark gray region"
visual_assert:
  assertion: "Only the current page's menu item is highlighted in the sidebar"
```

**Bad assertions (too broad, data-dependent):**

```
visual_assert: "TTFB shows 0.56s with dark black color"  // value changes!
visual_assert: "The page looks perfect, no issues"         // too vague
```

## Screenshot Patterns

For the rare case where you need a manual screenshot (not covered by the VLM tools):

**Full page via browser-harness:**
```python
result = cdp("Page.captureScreenshot", format="png", fromSurface=True)
```

**Specific element:**
```python
rect = js("return document.querySelector('{{ELEMENT_SELECTOR}}').getBoundingClientRect()")
result = cdp("Page.captureScreenshot", format="png", fromSurface=True,
    clip={"x": rect['x'], "y": rect['y'], "width": rect['width'], "height": rect['height'], "scale": 1})
```

**Save to /tmp/:**
```python
import base64
with open("/tmp/shot.png", "wb") as f:
    f.write(base64.b64decode(result["data"]))
```

## Common Gotchas

1. **Inline styles beat CSS**: Some chart and animation libraries set inline
   styles (e.g. `animation: none` or `overflow: hidden`) on SVG elements.
   Your CSS rules may need `!important` to override.

2. **CSS variables resolve differently in SVG**: A variable like `--color-text`
   may resolve to `--color-text-secondary` inside an SVG context. Always check
   computed values with `getComputedStyle()`.

3. **VLM hallucinations**: VLM can "see" text that doesn't exist or interpret
   visual artifacts incorrectly. **Always DOM-verify critical findings**
   before making code changes.

4. **Viewport state persists**: When using browser-harness directly,
   `setDeviceMetricsOverride` survives page reloads. Reset with
   `clearDeviceMetricsOverride`.  The VLM tools' built-in `viewport`
   parameter auto-restores — prefer that.

5. **SVG viewBox clipping**: SVG defaults to `overflow: hidden`. Labels at
   negative y coordinates are invisible. Either clamp positions or use
   `overflow: visible`.

6. **Dynamic grid/flex heights**: CSS Grid `align-items: stretch` (default)
   should equalize row heights. If items are still different heights, check
   for animation library wrappers (framer-motion, etc.) that render as
   `display: block` with `height: auto` — add `height: 100%` or equivalent
   to both the wrapper and the inner container.

7. **CSS variable names differ across component libraries**: Don't guess.
   Read the component's CSS file in `node_modules/` or equivalent.
   A 10-second grep saves two fix attempts.

8. **`aria-current` can have multiple sources**: When a component library's
   nav item wraps a router link, both may independently set `aria-current`.
   Check that they agree.  Use exact-path matching where available.

## Configuration

Project-specific selectors and CSS variables can be set in `.spark-e2e.yaml`:

```yaml
selectors:
  card: '[class*="card"]'                          # your card component class
  progress_fill: '[class*="progress"][class*="fill"]'
  active_nav: '[aria-current="page"]'

css_variables:
  - "--color-accent"
  - "--color-text"
  - "--color-positive"
```

See the project's `spark-e2e.yaml.example` for full documentation.

## Session Gotchas

*Populated during a session when new pitfalls are discovered.  Review before
Phase 3 to avoid repeating mistakes from earlier in the same session.*

<!-- SESSION_GOTCHAS_START -->
<!-- SESSION_GOTCHAS_END -->

---
description: Visual UI review using browser screenshots and VLM analysis. Systematic screenshot → review → DOM verify → code fix → assert loop. Use when the user asks to review the UI, find visual issues, check rendering, or inspect layout/typography/charts.
argument-hint: "[url] — e.g. http://localhost:5173/dashboard"
---

Browser-based visual UI review using the `spark-e2e` CLI.
The CLI handles browser automation and VLM analysis — no MCP server needed.

## Arguments

`$ARGUMENTS` is the target URL. Falls back to `browser.url` from `.spark-e2e.yaml`.

## Prerequisites

```bash
# One-time setup
npx spark-e2e setup         # interactive wizard (config + skill install)
export SPARK_E2E_API_KEY="your-key"
export SPARK_E2E_BASE_URL="https://your-vlm/v1"
```

Verify setup: `spark-e2e doctor`

## Workflow

### Phase 0 — Navigate & Baseline

Load the page and optionally capture a baseline screenshot:

```bash
spark-e2e navigate "$ARGUMENTS"
spark-e2e snapshot --output /tmp/baseline.png --url "$ARGUMENTS"
```

For pages with scrollable content, scroll before capturing to ensure lazy-loaded sections are visible:

```bash
# Scroll to bottom (triggers lazy loading), then back to top
spark-e2e scroll --y 9999
spark-e2e scroll --y 0
# Or capture the full page in one shot
spark-e2e snapshot --full-page --output /tmp/baseline.png --url "$ARGUMENTS"
```

### Phase 1 — Broad Inspect

Run a comprehensive visual review. Choose focus based on the user's concern:

| Command | When to use |
|---|---|
| `spark-e2e review --focus comprehensive --url "$ARGUMENTS"` | Full page check, new page, pre-merge |
| `spark-e2e review --focus layout --url "$ARGUMENTS"` | Card heights, grid, spacing |
| `spark-e2e review --focus typography --url "$ARGUMENTS"` | Text truncation, contrast |
| `spark-e2e review --focus charts --url "$ARGUMENTS"` | Gauges, donut labels, axes |
| `spark-e2e review --focus interactive --url "$ARGUMENTS"` | Buttons, hover, menus |

Or for a targeted check of a specific element:

```bash
spark-e2e inspect "Is the sidebar highlight color consistent?" --url "$ARGUMENTS"
```

The command returns structured JSON: `{"findings": [...], "summary": "...", "no_issues_found": false}`.

### Phase 2 — DOM Verify

**Before fixing anything, verify VLM findings are real.** VLMs can hallucinate.

Batch-discover the page structure in one command:

```bash
spark-e2e dom-verify --url "$ARGUMENTS"
```

Returns `{layout, classPrefixes, cssVars}` — page structure, component library prefix, and design token values.

For targeted DOM checks (card heights, computed styles, text content), use `dom-verify` output to build specific selectors, then grep the component library's CSS source rather than guessing variable names.

### Phase 3 — Code Fix

After confirming root cause via DOM:

1. **Capture a baseline** before touching any file:
   ```bash
   spark-e2e snapshot --output /tmp/before-fix.png --url "$ARGUMENTS"
   ```
2. Make the minimal code change.
3. Run the build/dev server to pick up changes.

### Phase 4 — Visual Assert

After each fix, verify with narrow assertions:

**Good assertions (narrow, data-independent):**
```bash
spark-e2e assert "Two adjacent cards have the same height and their bottom edges align" --url "$ARGUMENTS"
spark-e2e assert "The gauge arc has exactly three colored segments — green, yellow, red" --url "$ARGUMENTS"
spark-e2e assert "Only the current page's menu item is highlighted in the sidebar" --url "$ARGUMENTS"
```

**Bad assertions (too broad, data-dependent):**
```bash
spark-e2e assert "The page looks perfect"           # too vague
spark-e2e assert "TTFB shows 0.56s"                  # value changes
```

Assert returns `{"pass": true|false, "confidence": "high"|"medium"|"low", "observation": "...", "reasoning": "..."}`.

## Aesthetic Principles

`AESTHETICS.md` at the project root defines project-specific UI conventions (spacing, colors, typography, component specs). It is **auto-injected** into every `spark-e2e review` prompt.

Run `/style-init` to generate it from the actual codebase — it scans Tailwind config, CSS variables, and components to extract real values. Re-run when the design system changes.

## Common Gotchas

1. **Inline styles beat CSS**: Chart/animation libraries set inline styles on SVG elements. Your CSS may need `!important`.

2. **CSS variables resolve differently in SVG**: `--color-text` may resolve to `--color-text-secondary` inside SVG. Check with `dom-verify` output, not by guessing.

3. **VLM hallucinations**: Always DOM-verify before making code changes. A 10-second grep of the component CSS saves two fix attempts.

4. **Animation wrappers break grid/flex**: Framer-motion etc. render as `display: block` with `height: auto`. Add `height: 100%` to both wrapper and inner card.

5. **`aria-current` dual sources**: Component library nav + router link may independently set `aria-current`. Check they agree.

6. **SVG viewBox clipping**: SVG defaults to `overflow: hidden`. Labels at negative y are invisible.

7. **Scrollable content / lazy loading**: Use `spark-e2e scroll --y 0` or `spark-e2e scroll --selector <css>` before screenshot to bring content into viewport. Use `spark-e2e snapshot --full-page` to capture everything at once.

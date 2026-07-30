---
description: Visual E2E testing and UI review using Playwright CLI + spark-e2e. Use for UI review, visual regression, DOM linting, or any browser-based page check.
argument-hint: "[url] — e.g. http://localhost:5173/dashboard"
---

## Architecture

spark-e2e is a **VLM + DOM dual-engine visual audit tool**. It does NOT control the browser — Playwright CLI handles all browser interaction. spark-e2e handles visual analysis.

```
Playwright CLI  →  browser control (navigate, click, type, screenshot, DOM dump)
spark-e2e       →  visual analysis (review, assert, dom-lint, baseline compare)
```

## Two review engines

| Engine | What it checks | How |
|--------|---------------|-----|
| **VLM review** | Visual issues (layout, color, typography, spacing, charts) | Screenshot → VLM analysis |
| **dom-lint** | Deterministic rules (token compliance, font-weight, a11y) | DOM dump → rule matching |

Use both — they complement each other. VLM catches what the eye sees; dom-lint catches what only the DOM knows.

## Quick start

```bash
# 1. Playwright captures the page
playwright-cli open --browser=chrome
playwright-cli goto http://localhost:5173/dashboard

# 2. Playwright takes a screenshot and DOM dump
#    (use page.screenshot() + page.evaluate() in a script, or playwright-cli snapshot)
playwright-cli snapshot --filename /tmp/dom.json

# 3. spark-e2e reviews the screenshot
spark-e2e review --screenshot /tmp/screenshot.png --dom /tmp/dom.json --mode strict

# 4. spark-e2e checks DOM rules
spark-e2e dom-lint --dom /tmp/dom.json
spark-e2e dom-get @button-3 --dom /tmp/dom.json
```

## Commands

### review — Visual audit

```bash
spark-e2e review --screenshot /tmp/shot.png [--dom /tmp/dom.json] [--mode light|strict] [--focus layout|typography|color|charts|interactive|comprehensive]
```

| Mode | Behavior | Cost |
|------|----------|------|
| `light` | 1 comprehensive VLM call | 1× |
| `strict` | N parallel dimension-specific calls → intersect | N× |

Output is structured findings JSON with `source` tags:
- `source: vlm` — VLM visual analysis
- `source: dom` — confirmed by DOM cross-reference
- `source: vlm_contested` — found by only 1 dimension in strict mode

### assert — Single condition check

```bash
spark-e2e assert "sidebar highlight matches current page" --screenshot /tmp/shot.png
```

```json
{"pass": true, "confidence": "high", "observation": "...", "reasoning": "..."}
```

### dom-lint — Deterministic DOM checks

```bash
spark-e2e dom-lint --dom /tmp/dom.json [--rules /path/to/dom-rules.json] [--enable no-hardcoded-px,font-weight-audit]
```

Built-in rules:
- `no-hardcoded-px` — margin/padding with px instead of var(--space-*)
- `no-raw-colors` — hex/rgb colors instead of var(--*)
- `font-weight-audit` — computed weight vs dom-rules.json spec
- `token-usage` — unknown CSS variable references
- `missing-alt` — `<img>` without alt
- `empty-button` — `<button>` without text/label

### dom-get — Element lookup

```bash
spark-e2e dom-get @button-3 --dom /tmp/dom.json
```

Returns: tag, classes, computed styles, attributes, text.

Use this when a VLM finding mentions an element — cross-reference to confirm or refute.

### baseline — Visual regression

```bash
spark-e2e baseline save --name "dashboard-v1" --screenshot /tmp/shot.png
spark-e2e baseline compare --name "dashboard-v1" --screenshot /tmp/shot.png
spark-e2e baseline list
spark-e2e baseline delete --name "dashboard-v1"
```

Baseline compare sends BOTH screenshots to VLM for semantic diff — not pixel diff.

### inspect — Free-form analysis

```bash
spark-e2e inspect "check gauge labels are readable" --screenshot /tmp/shot.png
```

### doctor — Environment check

```bash
spark-e2e doctor
```

## Common workflow

```
1. Agent uses Playwright CLI to navigate, interact, screenshot
2. Agent calls spark-e2e review → gets structured findings
3. For each VLM finding: agent calls dom-get to cross-validate
4. Agent calls dom-lint → gets deterministic DOM issues
5. Agent reports combined findings to user
```

## init → review loop

```
Code changes → spark-e2e-init rescans → AESTHETICS.md + dom-rules.json update
                    ↓
          spark-e2e review auto-uses latest specs
                    ↓
          VLM has grounded expectations ("expected: #F0824C from AESTHETICS.md")
                    ↓
          dom-lint uses same source ("expected: font-weight 500 from dom-rules.json")
```

## Gotchas

1. **VLM hallucinations** — always DOM-verify before reporting. `dom-get` confirms or refutes.
2. **Disabled elements** — VLM may flag a disabled button's color as "wrong". dom-get reveals `disabled` + low opacity. Not a bug.
3. **Narrow assertions** — "two cards equal height" not "page looks perfect".
4. **Credentials via ${ENV_VAR}** — never hardcode in commands. Use .env files.
5. **Screenshot first, review second** — spark-e2e only analyzes. Playwright captures.

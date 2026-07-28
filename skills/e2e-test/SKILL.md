---
description: Full-cycle visual E2E testing. Navigate, review, verify, assert, and report — all via spark-e2e CLI. Use for automated visual regression testing, CI/CD quality gates, or when the user asks to run E2E tests, check for regressions, or verify a page visually.
argument-hint: "[url] — page URL, e.g. http://localhost:5173/dashboard"
---

Full-cycle visual E2E testing using the `spark-e2e` CLI.
Runs: Navigate → Snapshot → Review → DOM Verify → Assert → Report.

## Arguments

`$ARGUMENTS` is the target URL. Falls back to `browser.url` from `.spark-e2e.yaml`.

## Prerequisites

```bash
spark-e2e doctor       # verify: Node.js ✓, browser-harness ✓, API key ✓
```

## Workflow

### Phase 1 — Navigate & Baseline

```bash
spark-e2e navigate "$ARGUMENTS"
# Scroll to trigger lazy content, then capture full page
spark-e2e scroll --y 9999 --selector ".content"
spark-e2e scroll --y 0
spark-e2e snapshot --output /tmp/e2e-baseline.png --url "$ARGUMENTS"
# Or capture full scrollable page in one shot:
spark-e2e snapshot --full-page --output /tmp/e2e-baseline.png --url "$ARGUMENTS"
```

### Phase 2 — Visual Review

Choose focus based on what's being tested:

```bash
# Full page check
spark-e2e review --focus comprehensive --url "$ARGUMENTS"

# Or focused:
spark-e2e review --focus layout --url "$ARGUMENTS"
spark-e2e review --focus typography --url "$ARGUMENTS"
spark-e2e review --focus charts --url "$ARGUMENTS"
spark-e2e review --focus interactive --url "$ARGUMENTS"
```

Returns `{"findings": [...], "summary": "...", "no_issues_found": false}`.

### Phase 3 — DOM Verification

For each VLM finding, confirm it's real before reporting:

```bash
spark-e2e dom-verify --url "$ARGUMENTS"
```

Cross-reference findings with actual DOM structure. Only include confirmed findings in the report. Mark VLM hallucinations as false positives.

### Phase 4 — Targeted Assertions

**Structural assertions** (always valid):
```bash
spark-e2e assert "All stat cards in the top row have equal height" --url "$ARGUMENTS"
spark-e2e assert "No text is truncated or clipped in the KPI labels" --url "$ARGUMENTS"
spark-e2e assert "The sidebar highlights only one active menu item" --url "$ARGUMENTS"
```

**State assertions** (valid for current app state):
```bash
spark-e2e assert "The Submit button is visible and not disabled" --url "$ARGUMENTS"
spark-e2e assert "A success toast is displayed at top-right" --url "$ARGUMENTS"
```

Avoid asserting specific data values — they change between runs. If a critical assertion is inconsistent, run it 2-3 times and require majority agreement.

### Phase 5 — Compare (optional)

For before/after comparison after code changes:

```bash
spark-e2e compare "Sidebar shows 5 menu items with Dashboard highlighted" --after "navigated to dashboard" --url "$ARGUMENTS"
```

Returns `{"match": true|false, "differences": [...], "matches": [...], "overall_assessment": "..."}`.

### Phase 6 — Report

Compile findings into a structured report:

```markdown
## E2E Visual Test Report — $ARGUMENTS

**Date**: $(date +%Y-%m-%d)
**CLI**: spark-e2e $(spark-e2e --version 2>/dev/null || echo "latest")

### Summary
- Issues found: N (Critical: X, Major: Y, Minor: Z)
- Assertions passed: P / Q
- False positives (VLM hallucinations): F

### Confirmed Findings
| # | Severity | Location | Description | DOM Evidence |
|---|----------|----------|-------------|--------------|
| 1 | major | top-right KPI area | Card heights uneven | Grid cells equal height, animation wrappers add 2px |

### False Positives
| # | VLM Claim | Why Dismissed |
|---|-----------|---------------|
| 1 | "red error text in footer" | DOM shows gray disclaimer text |

### Recommendations
[Actionable next steps]
```

## Quick Examples

**Minimal test (one page):**
```bash
spark-e2e navigate "$ARGUMENTS"
spark-e2e review --focus comprehensive --url "$ARGUMENTS"
```

**Focused regression check:**
```bash
spark-e2e review --focus charts --url "$ARGUMENTS"
spark-e2e assert "Donut chart has no overlapping labels" --url "$ARGUMENTS"
spark-e2e assert "All gauge arcs use correct color segments" --url "$ARGUMENTS"
```

**Pre-merge gate:**
```bash
spark-e2e review --focus comprehensive --url "$ARGUMENTS"
spark-e2e dom-verify --url "$ARGUMENTS"
spark-e2e assert "All 4 KPI cards have equal height" --url "$ARGUMENTS"
spark-e2e assert "Sidebar has exactly one active item" --url "$ARGUMENTS"
spark-e2e assert "No error messages or blank areas visible" --url "$ARGUMENTS"
```

## Configuration

Create `.spark-e2e.yaml` in your project root:

```yaml
browser:
  url: http://localhost:5173

viewport:
  width: 1600
  height: 1200
  deviceScaleFactor: 1

selectors:
  card: '[class*="card"]'
  active_nav: '[aria-current="page"]'

css_variables:
  - "--color-accent"
  - "--color-text"
  - "--color-positive"
  - "--color-negative"
```

With config in place, `--url` becomes optional.

## Common Pitfalls

1. **Dynamic data changes** — Assert on structure (labels, layout, visibility), not specific values.
2. **Animation timing** — Wait for transitions; use `--delay 0.5` for animated pages.
3. **Lazy loading** — Use `spark-e2e scroll --y 9999` to trigger lazy content before review. Wait with `--delay 1` if needed. Use `spark-e2e snapshot --full-page` to capture the full document.
4. **Dark mode** — Test both themes if applicable.
5. **VLM inconsistency** — Run critical assertions 2-3 times and require majority agreement.
6. **Page not loaded** — Always `spark-e2e navigate` before review/assert/snapshot if the browser session is fresh.

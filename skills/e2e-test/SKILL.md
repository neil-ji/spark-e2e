---
description: Full-cycle visual E2E automation testing. Navigate, review, verify, assert, and report. Use for automated visual regression testing, CI/CD quality gates, or when the user asks to run E2E tests on a page, check for visual regressions, or verify a page looks correct.
argument-hint: "[url] — page URL to test, e.g. http://localhost:5173/dashboard"
---

Full-cycle visual E2E testing using spark-e2e MCP tools.
Runs: Navigate → Visual Review → DOM Verify → Visual Assert → Report.

## Arguments

`$ARGUMENTS` is the target URL. If omitted, fall back to `browser.url` from `.spark-e2e.yaml`.

## When to use

- "Run E2E tests on this page"
- "Check this page for visual regressions"
- "Verify the dashboard looks correct"
- Automated CI/CD visual quality gates
- Before merging, as a comprehensive visual check

## Prerequisites

- `spark-e2e` MCP server running (configured in `.mcp.json`)
- `browser-harness` CLI installed and Chrome remote debugging enabled
- VLM API key configured
- Optional: `.spark-e2e.yaml` config file for project-specific selectors

## Workflow

### Phase 1 — Navigate & Setup

Load the target page with the desired viewport. Use `$ARGUMENTS` as the URL,
or the default from `.spark-e2e.yaml` → `browser.url`.

```
navigate:
  url: "$ARGUMENTS"
  viewport: {"width": 1600, "height": 1200, "deviceScaleFactor": 1}
```

Wait for the page to fully render before proceeding.

### Phase 2 — Baseline Snapshot

Capture a reference screenshot before any checks. This is useful for comparison
if something goes wrong during the test run.

```
visual_snapshot:
  viewport: {"width": 1600, "height": 1200, "deviceScaleFactor": 1}
```

Note the result — it serves as the "before" reference.

### Phase 3 — Visual Review

Run a comprehensive (or focused) review. Choose the focus based on what
changed or what you're testing:

| Focus | When to use |
|---|---|
| `comprehensive` | Full-page quality check, new page, pre-merge gate |
| `layout` | Layout changes, responsive fixes, grid/flex work |
| `typography` | Font changes, text truncation fixes, contrast work |
| `charts` | Chart/dashboard changes, data viz updates |
| `interactive` | Button/form/menu changes, hover/active states |

```
visual_review:
  focus: "comprehensive"
  viewport: {"width": 1600, "height": 1200, "deviceScaleFactor": 1}
```

The tool returns structured findings with severity and category tags.

### Phase 4 — DOM Verification

For each VLM finding, confirm it's real (not a hallucination) via DOM queries.

**Batch approach** (preferred): Delegate to the `dom-verify` skill:

```
Skill("dom-verify", { findings: [...Phase 3 findings], url: "$ARGUMENTS" })
```

**Single-check approach** (for quick verifications):

```
dom_verify:
  url: "$ARGUMENTS"
```

Then inspect specific elements with targeted `browser-harness js()` calls.

**Critical rule**: Always DOM-verify before making code changes.
VLM may "see" artifacts that don't exist in the DOM.

### Phase 5 — Targeted Assertions

After confirming findings are real (and optionally fixing them), run narrow
assertions to verify the expected state. Keep assertions data-independent:

**Structural assertions** (always valid):
```
visual_assert:
  assertion: "All stat cards in the top row have equal height"
visual_assert:
  assertion: "The sidebar highlights only one active menu item"
visual_assert:
  assertion: "No text is truncated or clipped in the KPI labels"
```

**State assertions** (valid for current app state):
```
visual_assert:
  assertion: "The 'Submit' button is visible and not disabled"
visual_assert:
  assertion: "A success toast is displayed at the top-right corner"
```

Avoid asserting specific data values (TTFB=0.56s, "$1,234.56") — those change.

### Phase 6 — Report

Compile a test report from the findings:

```markdown
## E2E Visual Test Report — $ARGUMENTS

**Date**: {{DATE}}
**Viewport**: 1600×1200 @1x
**VLM Model**: {{VLM_MODEL}}

### Summary
- Issues found: N
  - Critical: X
  - Major: Y
  - Minor: Z
- Assertions passed: P / Q

### Findings
[List each confirmed finding with location, severity, and DOM evidence]

### False Positives (VLM hallucinations dismissed by DOM verify)
[List any]

### Recommendations
[Actionable next steps]
```

## Quick-start Examples

### Minimal test (one page, comprehensive review):
```
navigate: url="$ARGUMENTS"
visual_review: focus="comprehensive"
// Review findings manually
```

### Focused test (specific component after changes):
```
navigate: url="$ARGUMENTS"
visual_review: focus="charts"
visual_assert: assertion="The donut chart has no overlapping labels"
```

### Regression gate (before merge):
```
navigate: url="$ARGUMENTS"
visual_review: focus="comprehensive"
dom_verify: url="$ARGUMENTS"
visual_assert: assertion="All 4 KPI cards have equal height"
visual_assert: assertion="Sidebar has exactly one active item"
visual_assert: assertion="No error messages or blank areas visible"
```

## Configuration

Create `.spark-e2e.yaml` in your project root for reusable settings:

```yaml
browser:
  url: http://localhost:5173

viewport:
  width: 1600
  height: 1200
  deviceScaleFactor: 1

selectors:
  card: '[class*="card"]'           # your card component
  active_nav: '[aria-current="page"]'
  sidebar_item: '[class*="sidebar"] a, [class*="menu"] a'
```

With config in place, the URL parameter becomes optional.

## Common Pitfalls

1. **Dynamic data changes**: Don't assert on specific numbers — assert on
   structure (labels, layout, visibility).
2. **Animation timing**: Wait for transitions to finish before capturing.
   Use `delay: 0.5` or higher if the page has entrance animations.
3. **Lazy loading**: Scroll to trigger lazy images/components before review.
4. **Dark mode**: If your app supports themes, test both. Set up separate
   configs or navigate with theme query params.
5. **VLM inconsistency**: Run critical assertions 2-3 times and require
   majority agreement before acting on the result.

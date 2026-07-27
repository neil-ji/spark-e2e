---
description: Batch DOM verification of VLM findings in one command. Use when confirming visual review findings before making code changes, or when ui-review delegates Phase 2 verification.
argument-hint: "[url or findings JSON]"
---

Systematic DOM verification using the `spark-e2e dom-verify` CLI command.

## Arguments

`$ARGUMENTS` — URL to verify, or a list of VLM findings to check.

## Prerequisites

```bash
spark-e2e doctor   # verify browser-harness is available
```

The target page must already be loaded in the browser, or use `--url` flag.

## Workflow

### Step 1 — Discover (one command)

```bash
spark-e2e dom-verify --url "$ARGUMENTS"
```

Returns a single JSON object with three sections:

| Field | Content |
|---|---|
| `layout` | Direct children of the app root: `{tag, classes, role, top, left, w, h, text}` |
| `classPrefixes` | Unique CSS class name prefixes (identifies the component library) |
| `cssVars` | Values of configured CSS custom properties on `:root` |

Use the `classPrefixes` to identify the component library (e.g., `spark`, `tw`, `css`).
Use `layout` to find element positions and dimensions without guessing selectors.

### Step 2 — Targeted Verification

For each VLM finding, use the discovered class prefixes and layout info to build targeted queries. The skill provides pre-built patterns:

**Check CSS variable values on a specific element:**
```javascript
// Use these selectors derived from dom-verify output + .spark-e2e.yaml
var el = document.querySelector('YOUR_SELECTOR');
var cs = getComputedStyle(el);
return { backgroundColor: cs.backgroundColor, color: cs.color };
```
Run via browser-harness: `js(…)` with the snippet above.

**Check if animation wrappers break grid/flex alignment:**
```javascript
var cells = Array.from(document.querySelectorAll('.grid > *, [class*="grid"] > *'));
return cells.map(function(cell) {
  var card = cell.querySelector('[class*="card"]');
  return {
    cellH: Math.round(cell.getBoundingClientRect().height),
    cardH: card ? Math.round(card.getBoundingClientRect().height) : 0,
    match: cell.getBoundingClientRect().height === (card ? card.getBoundingClientRect().height : 0)
  };
});
```

**Verify active nav state (dual-source aria-current):**
```javascript
var items = Array.from(document.querySelectorAll('SIDEBAR_ITEM_SELECTOR'));
return items.map(function(el) {
  return {
    text: el.textContent.trim().slice(0, 20),
    elAria: el.getAttribute('aria-current'),
    childAria: (el.querySelector('a') || {}).getAttribute?.('aria-current') || 'none'
  };
});
```

**Check if text is actually visible:**
```javascript
var el = document.querySelector('YOUR_SELECTOR');
var r = el.getBoundingClientRect();
var cs = getComputedStyle(el);
return {
  visible: r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden',
  rect: {w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y)}
};
```

## Configuration

Customize selectors in `.spark-e2e.yaml` to match your component library:

```yaml
selectors:
  card: '[class*="card"]'
  active_nav: '[aria-current="page"]'
  sidebar_item: '[class*="sidebar"] a, [class*="menu"] a'
  progress_fill: '[class*="progress"][class*="fill"]'

css_variables:
  - "--color-accent"
  - "--color-text"
  - "--color-positive"
  - "--color-negative"
```

## Gotchas

1. **CSS variable names differ across libraries** — use `dom-verify` to discover actual names, then grep the component CSS file.
2. **Grid stretch doesn't reach through animation wrappers** — `align-items: stretch` stops at `display: block` wrappers.
3. **`aria-current` from multiple sources** — component lib `active` prop + router matching may both set it independently.
4. **Computed ≠ declared** — `getComputedStyle()` is authoritative. Declared values don't account for inheritance or SVG context.

---
description: Batch DOM verification for VLM visual review findings in at most 2 browser-harness calls. Use when confirming findings are real before making code changes, or when the ui-review skill delegates Phase 2 verification.
argument-hint: "[findings JSON or URL]"
---

Systematic DOM verification of VLM UI review findings. Merges what would
otherwise be 5–10 separate browser-harness calls into at most 2.

## Arguments

`$ARGUMENTS` — URL to verify, a JSON array of VLM findings, or both. If a URL is provided, use it as the target. If omitted, fall back to `browser.url` from `.spark-e2e.yaml`.

## When to use

- Called by `ui-review` Phase 2 after `visual_review` returns findings
- Any time you need to batch-verify multiple DOM facts about a page
- Before fixing code, to confirm VLM findings are real (not hallucinations)

## Prerequisites

- `spark-e2e` MCP server running
- `browser-harness` CLI available
- Page already loaded (navigate first if needed)

## Workflow

### Step 1 — Discover (one call)

Map the page structure so subsequent queries target the right selectors.
Use the `dom_verify` MCP tool, or run this as a single `browser-harness js()` call:

```js
(function() {
  var root = document.getElementById('root') || document.querySelector('#app, [class*="app"]');
  var main = root && root.firstElementChild;

  // Page structure — direct children of the app container
  var layout = Array.from(main ? main.children : document.body.children).map(function(c) {
    var r = c.getBoundingClientRect();
    return {tag: c.tagName, classes: c.className.slice(0, 60), role: c.getAttribute('role')||'', top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), text: c.textContent.trim().slice(0, 40)};
  });

  // All distinct class name prefixes (helps identify component library)
  var classPrefixes = new Set();
  var all = Array.from(document.querySelectorAll('[class]'));
  for (var i = 0; i < Math.min(200, all.length); i++) {
    var names = all[i].className.split(/\\s+/);
    for (var j = 0; j < names.length; j++) {
      if (names[j] && !names[j].startsWith('_')) classPrefixes.add(names[j].split('__')[0].split('--')[0]);
    }
  }

  // Key CSS variables on :root
  var rootStyle = getComputedStyle(document.documentElement);
  var cssVars = {};
  ['--color-accent','--color-text','--color-text-secondary','--color-text-muted','--color-border','--color-primary','--color-positive','--color-negative','--color-warning'].forEach(function(v) {
    var val = rootStyle.getPropertyValue(v).trim();
    if (val) cssVars[v] = val;
  });

  return {layout: layout, classPrefixes: Array.from(classPrefixes).sort().slice(0, 30), cssVars: cssVars};
})()
```

### Step 2 — Batch Verify (one call)

Build a single `js()` call that checks every VLM finding. Use the selectors
discovered in Step 1 and from the project's `.spark-e2e.yaml` config. Template:

```js
(function() {
  var results = {};

  // ── Finding: sidebar/nav active state ──
  results.activeNavItems = Array.from(document.querySelectorAll(
    '{{ACTIVE_NAV_SELECTOR}}'
  )).filter(function(el) {
    return el.tagName === 'A';
  }).map(function(a) {
    return {href: a.getAttribute('href'), text: a.textContent.trim(), ariaCurrent: a.getAttribute('aria-current')};
  });

  // ── Finding: card heights ──
  // Use the card selector from your config — default: [class*="card"]
  results.cardHeights = Array.from(document.querySelectorAll(
    '{{CARD_SELECTOR}}'
  )).map(function(c) {
    var r = c.getBoundingClientRect();
    return {h: Math.round(r.height), top: Math.round(r.top), text: c.textContent.trim().slice(0, 30)};
  });

  // ── Finding: progress bar fill colors ──
  // Use the progress fill selector from your config
  results.progressFills = Array.from(document.querySelectorAll(
    '{{PROGRESS_FILL_SELECTOR}}'
  )).map(function(f) {
    return {bg: getComputedStyle(f).backgroundColor, w: getComputedStyle(f).width};
  });

  // ── Finding: text content verification ──
  results.percentValues = [];
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    var t = walker.currentNode.textContent.trim();
    if (/%/.test(t) && t.length < 20) results.percentValues.push(t);
  }

  return results;
})()
```

**Configuration variables**: The `{{VAR}}` placeholders above are resolved from
`.spark-e2e.yaml` → `selectors:` section. Defaults are shown in the template.

### Common verification patterns

**Check which CSS variable a component actually uses:**
```js
// Don't guess the variable name — check computed styles
var fill = document.querySelector('{{PROGRESS_FILL_SELECTOR}}');
var cs = getComputedStyle(fill);
return {
  bg: cs.backgroundColor,
  // Then grep the component library CSS source for the real variable name:
  // grep -r "background" node_modules/your-ui-lib/components/
  hint: 'Read the component CSS file to find the exact variable name'
};
```

**Check if animation wrappers break grid/flex alignment:**
```js
// Grid cells vs visual cards — animation wrappers may prevent stretch
var gridCells = Array.from(document.querySelectorAll('.grid > *, [class*="grid"] > *'));
return gridCells.map(function(cell) {
  var card = cell.querySelector('[class*="card"]');
  return {
    cellH: Math.round(cell.getBoundingClientRect().height),
    cardH: card ? Math.round(card.getBoundingClientRect().height) : 0,
    match: cell.getBoundingClientRect().height === (card ? card.getBoundingClientRect().height : 0)
  };
});
```

**Verify text is actually visible (not 0×0, not off-screen, not display:none):**
```js
var el = document.querySelector('{{SUSPECT_SELECTOR}}');
var r = el.getBoundingClientRect();
var cs = getComputedStyle(el);
return {
  visible: r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden',
  rect: {w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y)},
  text: el.textContent.trim().slice(0, 40)
};
```

**Check for dual-source aria-current (component lib + router):**
```js
// When using a component library nav with a router, both may set aria-current
var items = Array.from(document.querySelectorAll('{{SIDEBAR_ITEM_SELECTOR}}'));
return items.map(function(el) {
  return {
    text: el.textContent.trim().slice(0, 20),
    ariaCurrent: el.getAttribute('aria-current'),
    // Check if a child anchor also has aria-current
    childAria: (el.querySelector('a') || {}).getAttribute?.('aria-current') || 'none'
  };
});
```

## Gotchas

1. **CSS variable names differ across libraries**: Each component library has
   its own naming convention. Use `getComputedStyle()` to check actual values,
   then grep the library's CSS source for the variable name.

2. **Component libraries may set `aria-current` independently**: When a
   component library nav item is rendered `as={RouterLink}`, both the
   component library's `active` prop AND the router's matching may
   independently set `aria-current`. Check both.

3. **Grid/flex cells can be equal height while visual cards aren't**:
   CSS Grid `align-items: stretch` makes grid items equal, but animation
   library wrapper divs render as `display: block` with `height: auto`.
   The inner card sizes to content, not to the grid cell.
   Fix: add `height: 100%` (or `h-full` in Tailwind) to both the wrapper
   and the card.

4. **`js()` needs IIFE wrapping**: browser-harness `js()` passes raw JS to
   `eval()`. Always wrap in `(function(){ ... })()` to avoid `return`-statement
   syntax errors.

5. **HMR may not propagate immediately**: after code changes, the VLM
   inspector's `reload` parameter ensures the page is refreshed. Without it,
   screenshots capture the pre-change state.

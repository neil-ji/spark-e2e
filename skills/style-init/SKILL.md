---
description: Scan frontend UI code to generate a style conventions file used by spark-e2e review. Use when setting up spark-e2e in a project, when the design system changes, or when UI review results are inconsistent.
argument-hint: "[project root directory]"
---

Generate or update `AESTHETICS.md` by scanning the frontend codebase for UI conventions.
This file is automatically injected into every `spark-e2e review` VLM prompt.

## Size Limits (HARD)

The output file MUST satisfy ALL of:
- **≤ 80 lines**
- **≤ 600 words** (count with `wc -w`)
- **≤ 4 KB** (count with `wc -c`)

If the scan finds more conventions than will fit, prioritize by **usage frequency**: the most common patterns first, edge cases last. Per-section rules below tell you which sections to trim first when approaching limits.

## Workflow

### Phase 1 — Discover Stack

Identify the frontend framework and tooling:

1. Check `package.json` for dependencies: React, Vue, Next.js, Nuxt, Svelte, Tailwind, etc.
2. Find the source directory (common patterns: `src/`, `app/`, `components/`, `pages/`).
3. Locate design-system config files:
   - `tailwind.config.*` — spacing scale, colors, font sizes, breakpoints
   - `theme.{ts,js,json}` — theme tokens
   - Global CSS files (`globals.css`, `index.css`, `app.css`, `main.css`) — CSS custom properties
   - Design token files (`tokens.{ts,js,json}`, `theme.ts`)
4. Find layout-defining files: root layout, page wrappers, sidebar/nav components.

### Phase 2 — Extract Conventions (comprehensive)

Scan the codebase for **concrete, quantifiable** values. Each finding should have a verifiable source (file + line or Tailwind class). For each category:

#### Global Layout (highest priority — keep even when trimming)
- Read the root layout file (`layout.tsx`, `_app.tsx`, `App.vue`, `+layout.svelte`, etc.).
- Identify page-level structure: header + sidebar + main + footer, or centered single-column.
- Check max-width containers: `max-w-{size}`, `container`, explicit `max-width` in CSS.
- Check sidebar: fixed width? collapsible? what width?
- Check header/footer: fixed or scrolls? height?
- Check responsive behavior: when does sidebar collapse? when does layout go single-column?
- Check content alignment: is main content centered? left-aligned? does it use `mx-auto`?
- Check page-level padding: what `px-{n}` or `p-{n}` is on the main container?
- Check if there's a consistent content area width (e.g., `max-w-7xl mx-auto px-6`).
- Output patterns:
  - Page shell: {header, sidebar, main, footer} or {centered single-column}
  - Container: max-w-{size} + px-{n} (value: {computed px})
  - Sidebar: {width}, {collapsed width if applicable}, breaks at {breakpoint}
  - Header: {height}, {fixed|static}
  - Content alignment: {centered|left|stretch}
  - Page min-height: {value} (if explicit)

#### Spacing System
- Read Tailwind config → `theme.extend.spacing` or default scale.
- Scan component JSX/TSX for padding/margin/gap patterns: `p-{n}`, `m-{n}`, `gap-{n}`, `space-{n}`.
- Check global CSS for `--spacing-*` or similar CSS custom properties.
- Determine the **base spacing unit** (4px / 8px / 10px) from the Tailwind scale.
- Count common padding values across components — report top 3 most-used.
- Output: base unit, top 2-3 padding values, common gaps.

#### Color Palette
- Read Tailwind config → `theme.extend.colors` or `theme.colors`.
- Read CSS custom properties: `--color-*`, `--c-*`, `--*-color` on `:root`.
- Read any theme/color JSON or TS files.
- Categorize colors by semantic role (not just by name — by how they're used in components).
- Check for usage: which color is used for primary buttons? which for destructive?
- Output: color name + hex + semantic role (1 line per color). Skip rarely-used colors.

#### Typography Scale
- Read Tailwind config → `theme.extend.fontSize`, `theme.extend.fontFamily`.
- Scan component code for text size patterns: `text-{size}`, `font-{weight}`, `leading-{n}`.
- Check global CSS for `--font-*` vars, `@font-face` declarations, or imported fonts.
- Determine heading hierarchy (H1-H4 sizes with actual computed px) and body text size.
- Note: report actual computed values (e.g., "text-2xl = 24px"), not just Tailwind class names.
- Output: font family, H1-H3 + body + caption with size/line-height/weight.

#### Component Specs (auto-detect which components exist)
- Scan the component directory to identify which of these actually exist: Card, Button, Input/TextField, Select/Dropdown, Modal/Dialog, Table/DataGrid, Nav/Sidebar, Badge/Tag, Tooltip, Toast/Notification, Avatar, Tabs, Breadcrumb, Pagination.
- For each component type that EXISTS, extract from its source file:
  - Dimensions (height, width, min/max)
  - Padding (all sides if different)
  - Border-radius
  - Border width + color
  - Shadow
  - Background color
  - Font size + weight
  - Hover/active/focus states (if consistent pattern found)
- Also check for layout-related component patterns:
  - Form layout: are labels above or beside inputs? are inputs full-width or fixed?
  - List/grid patterns: do cards use grid with `grid-cols-{n}`? at what breakpoints?
  - Empty states: are there consistent empty-state components?
- Include only components that have ≥ 3 instances in the codebase (skip one-offs).

### Phase 3 — Generate AESTHETICS.md

Write `AESTHETICS.md` at the project root using this exact template. **Enforce size limits strictly.**

```markdown
# UI Style Conventions
<!-- Generated by /style-init — re-run after design-system changes -->
<!-- ⚠️  Size limits: ≤80 lines, ≤600 words, ≤4 KB — this file is injected into every VLM prompt -->

## Global Layout
<!-- Page-level structure — keep even when trimming -->
- Page shell: {description}
- Max-width: {value} (container class: {name})
- Content area: {value} wide, {center|left}-aligned
- Header: {height}, {fixed|static}
- Sidebar: {width}, collapses at {breakpoint}
- Page padding: {horizontal}px horizontal, {vertical}px vertical
- Responsive: {description of key breakpoint behavior}

## Spacing
- Base unit: {n}px ({scale description})
- Common padding: {top 2-3 values with usage context}
- Section gaps: {top 2 values}

## Color Palette
<!-- Only colors with clear semantic roles. Max 12 colors. -->
- {role}: `{hex}` ({name}) — {where used, ≤8 words}

## Typography
- Font: {family}, {fallback}
- H1: {size} / {line-height}, {weight}
- H2: {size} / {line-height}, {weight}
- H3: {size} / {line-height}, {weight}
- Body: {size} / {line-height}, {weight}
- Caption: {size} / {line-height}, {weight}

## Component Specs
<!-- Only components with ≥3 instances. 1 line per property. -->
### {Component name}
- {property}: {value}
```

**Size limit enforcement — do this BEFORE writing the file:**

1. Assemble the full content in memory first.
2. Count lines, words, bytes.
3. If over ANY limit, trim in this order until within limits:
   a. Remove the least-used color from Color Palette (repeat until ≤12 colors or within limits).
   b. Merge similar component specs (e.g., combine "Badge" and "Tag").
   c. Remove the least-common component from Component Specs (keep Card, Button, Input as minimum set).
   d. Shorten descriptions: remove usage contexts from colors, collapse multi-line specs to single-line.
   e. Remove the Caption line from Typography.
   f. ONLY if still over limits: drop component sections one at a time (least impactful first).
4. Write the trimmed content to `AESTHETICS.md`.

### Phase 4 — Verify

1. Run `wc -l AESTHETICS.md && wc -w AESTHETICS.md && wc -c AESTHETICS.md` — confirm all within limits.
2. Cross-check 2-3 values against the source code to ensure accuracy.
3. Report: which files were scanned, how many components sampled, and what was trimmed (if anything).

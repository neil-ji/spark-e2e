# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

spark-e2e is a VLM-powered visual E2E testing tool for the web. It takes browser screenshots and sends them to a Vision Language Model (GPT-4o, Qwen-VL, etc.) for visual analysis — reviewing layout, asserting conditions, comparing against expected states, and verifying DOM facts.

It runs as both a **CLI** (`spark-e2e`) and an **MCP server** (for Claude Code integration). Three Claude Code skills are bundled in `skills/` and define the canonical workflows for using the MCP tools.

## Commands

```bash
# Install (editable, with dev deps and optional Playwright backend)
pip install -e ".[dev,playwright]"
playwright install chromium

# Run all tests
pytest

# Run a single test
pytest tests/test_core.py::TestConfig::test_default_config

# MCP server (for Claude Code integration)
spark-e2e serve

# CLI — diagnose setup
spark-e2e doctor

# CLI — capture a screenshot
spark-e2e snapshot --url http://localhost:5173

# CLI — run a visual assertion
spark-e2e assert "The sidebar shows 5 menu items" --url http://localhost:5173

# CLI — run a comprehensive visual review
spark-e2e review --focus layout --url http://localhost:5173
```

## Architecture

```
src/spark_e2e/
├── cli.py          # CLI entry point (argparse, 5 subcommands)
├── server.py       # MCP server (FastMCP, 7 tools: navigate, visual_snapshot,
│                   #   visual_inspect, visual_assert, visual_compare,
│                   #   visual_review, dom_verify)
├── config.py       # 5-layer config system (CLI > env > YAML > legacy > defaults)
├── prompts.py      # Anti-hallucination guardrail prompts (3 strictness levels)
├── __init__.py     # Package metadata
├── __main__.py     # Enables `python -m spark_e2e`
├── browser/
│   ├── __init__.py         # Backend registry (register_backend, get_backend, list_backends)
│   ├── base.py             # BrowserBackend ABC (6 abstract methods)
│   ├── browser_harness.py  # CDP-based backend via browser-harness CLI subprocess
│   └── playwright_.py      # Playwright sync API backend
└── vlm/
    ├── __init__.py         # Provider registry (register_provider, get_provider, list_providers)
    ├── base.py             # VLMProvider ABC (1 abstract method: chat)
    └── openai_compat.py    # OpenAI-compatible provider + extract_json() utility
```

### Plugin Architecture

Both browser backends and VLM providers use the same registry pattern:

- **Browser backends**: Implement `BrowserBackend` (6 methods: `capture_screenshot`, `execute_js`, `navigate`, `get_page_info`, `get_element_rect`, `close`), call `register_backend("name", YourClass)`. Built-in: `browser-harness` (default, CDP-based, spawns CLI subprocess), `playwright` (optional dep, sync API).

- **VLM providers**: Implement `VLMProvider` (1 method: `chat(prompt, image_data_url)`), call `register_provider("name", YourClass)`. Built-in: `openai-compat` (uses OpenAI SDK, works with any `/v1/chat/completions` endpoint).

Both registries auto-register built-in implementations on import. The `playwright` backend is wrapped in a try/except and only registered if the `playwright` package is installed.

### Config System

5-layer priority (highest first):
1. CLI arguments
2. `SPARK_E2E_*` environment variables
3. `.spark-e2e.yaml` config file (auto-discovered in cwd)
4. Legacy `VLM_*` environment variables
5. Hardcoded defaults

**`.env` is loaded first** (before YAML), so `${ENV_VAR}` interpolation in YAML resolves against `.env` values. Config is a `Config` dataclass containing `BrowserConfig`, `ViewportConfig`, `VLMConfig`, `SelectorsConfig`, and `PromptsConfig`.

The `selectors` section maps to project-specific CSS selectors (card, progress_fill, active_nav, sidebar_item) and `css_variables` lists design tokens for discovery. Example configs for different component libraries are in `examples/`.

### MCP Server Tool Design

The server lazily initializes the backend and VLM provider on first use. Each VLM tool captures a fresh screenshot internally — no separate snapshot step needed. The `viewport` parameter is built into every tool: it sets viewport before capture and restores the original afterward, avoiding persistent state issues. Tools that return structured data use `extract_json()` from `vlm/openai_compat.py` to handle markdown fences and truncated/malformed JSON.

The `dom_verify` tool sends a single JS snippet that discovers page layout (direct children of the app root), distinct CSS class name prefixes (for identifying the component library), and CSS variable values from `:root` — all in one batch call.

<details>
<summary>MCP tool signatures</summary>

| Tool | Key params | Returns |
|---|---|---|
| `navigate` | `url`, `viewport?` | Page info JSON |
| `visual_snapshot` | `viewport?`, `reload?`, `delay?` | PNG Image |
| `visual_inspect` | `instruction`, `model?`, `viewport?`, `reload?` | VLM text response |
| `visual_assert` | `assertion`, `model?`, `viewport?`, `reload?` | `{pass, confidence, observation, reasoning}` |
| `visual_compare` | `expected`, `after_action?`, `model?`, `viewport?` | `{match, differences[], matches[], overall_assessment}` |
| `visual_review` | `focus?`, `model?`, `viewport?`, `reload?` | `{findings[], summary, no_issues_found}` |
| `dom_verify` | `url?`, `viewport?` | `{layout, classPrefixes, cssVars}` |

</details>

### Prompt System (`prompts.py`)

Anti-hallucination prompts are appended to every VLM request. Two base prompts exist — one for review/inspect, one for assert — each with three strictness variants (`standard`, `strict`, `relaxed`) controlled by `prompts.strictness` in the config file. Strict mode requires 95%+ confidence; relaxed mode allows reporting plausible issues with lower confidence.

### Testing

Tests are in `tests/test_core.py` using pytest. Test categories: config defaults and loading, browser backend registry (registration, instantiation, unknown backend error), VLM provider registry, and `extract_json()` edge cases (markdown fences, balanced brackets, empty input).

## Skills

The three skills in `skills/` are Claude Code skills per the [official skill spec](https://code.claude.com/docs/en/skills). To install them in a project:

```bash
cp -r skills/* .claude/skills/
```

### Skill Mechanics (per official Claude Code docs)

**Directory structure**: Each skill is a directory under `.claude/skills/` containing a `SKILL.md` entry point. The directory name becomes the slash command: `skills/ui-review/SKILL.md` → `/ui-review`.

**Frontmatter conventions**: Each `SKILL.md` uses YAML frontmatter with two fields:

- `description` — **Drives auto-invocation.** At session start, Claude loads all skill descriptions and matches user queries against them. Must describe both what the skill does AND when to use it. Vague or overlapping descriptions cause incorrect skill loading. Keep descriptions concise — they have a character budget that scales with the model's context window, and long descriptions may be truncated, losing keyword matches.
- `argument-hint` — Shown in the UI when the user types `/<name>`, indicating what argument to pass.

**Arguments**: Each skill accepts a URL via `$ARGUMENTS`. When invoked manually (`/ui-review http://localhost:5173/dashboard`), `$ARGUMENTS` is set to the URL. When auto-invoked (no arguments), Claude falls back to `browser.url` from `.spark-e2e.yaml`. The official string substitutions (`${CLAUDE_SKILL_DIR}`, `${CLAUDE_PROJECT_DIR}`, etc.) are also available.

**Invocation modes**: Skills are invoked manually (`/<name>`) or automatically by Claude when the user's query matches the `description`. None of the spark-e2e skills set `disable-model-invocation`, so Claude can auto-invoke all three.

### Skill Workflows

When performing visual testing tasks, follow the skill-defined workflows rather than ad-hoc tool usage.

### ui-review — Visual Review Loop

A 5-phase loop for finding and fixing visual issues: **Navigate → Review → DOM Verify → Code Fix → Assert**.

**Phase 0 — Navigate**: Use the `navigate` MCP tool to load the target URL with the desired viewport. If the user already named a specific concern, narrow the review focus accordingly.

**Phase 1 — Broad Inspect**: Use `visual_review` for a comprehensive first pass. Focus options:

| Focus | When to use |
|---|---|
| `comprehensive` | Full-page quality check, new page, pre-merge gate |
| `layout` | Card heights, grid alignment, spacing, overlapping content |
| `typography` | Text truncation, contrast, font inconsistencies, cut-off labels |
| `charts` | Gauge arc colors, donut label clipping, axis/legend artifacts |
| `interactive` | Button states, hover feedback, menu highlighting, tooltip visibility |

**Phase 2 — DOM Verify**: Delegate to the `dom-verify` skill. It batch-verifies every VLM finding in at most 2 calls (discover + verify). **Always DOM-verify critical findings before making code changes** — VLMs can hallucinate elements, misread text, and misattribute visual artifacts.

**Phase 3 — Code Fix**: **Before touching any file, capture a baseline** with `visual_snapshot`. After root cause is confirmed via DOM verification, make the minimal code change.

**Phase 4 — Visual Assert**: After each fix, verify with `visual_assert` (defaults to `reload: true`, so latest code is always captured). Keep assertions narrow and data-independent.

### dom-verify — Batch DOM Verification

Merges what would otherwise be 5–10 separate browser-harness calls into at most 2.

**Step 1 — Discover** (one call): The `dom_verify` MCP tool returns page layout (direct children of the app container with tag, classes, position, dimensions), CSS class name prefixes (identifies the component library), and CSS variable values on `:root`.

**Step 2 — Batch Verify** (one call): Build a single `js()` call that checks every VLM finding, using selectors discovered in Step 1 and from `.spark-e2e.yaml`. The skill provides pre-built JS templates for: active nav state verification, card height comparison, progress bar fill color inspection, text content verification, CSS variable resolution, animation wrapper detection, visibility checks, and dual-source `aria-current` checks.

**Golden rules for DOM verification**:
- When investigating CSS variable issues, read the component library's CSS source file before guessing the variable name. Use `getComputedStyle()` to confirm. Check computed values, not declared values — CSS inheritance and SVG contexts can change what a variable resolves to.
- Grep the component library's CSS file (in `node_modules/` or equivalent) rather than guessing. A 10-second grep saves two fix attempts.

### e2e-test — Full-Cycle Automation

A 6-phase cycle designed for CI/CD quality gates: **Navigate → Baseline Snapshot → Visual Review → DOM Verify → Targeted Assertions → Report**.

**Phase 1 — Navigate & Setup**: Load the target page with the desired viewport.

**Phase 2 — Baseline Snapshot**: Capture a reference screenshot with `visual_snapshot` before any checks.

**Phase 3 — Visual Review**: Run `visual_review` with the appropriate focus.

**Phase 4 — DOM Verification**: Delegate to the `dom-verify` skill to confirm VLM findings are real.

**Phase 5 — Targeted Assertions**: Run narrow, structural assertions. Distinguish two kinds:

- **Structural assertions** (always valid): "All stat cards in the top row have equal height", "The sidebar highlights only one active menu item", "No text is truncated or clipped in the KPI labels".
- **State assertions** (valid for current app state): "The Submit button is visible and not disabled", "A success toast is displayed at the top-right corner".

Avoid asserting specific data values (e.g. "TTFB shows 0.56s") — dynamic data changes between captures. If the assertion mentions a specific value but the live value has changed, that is NOT a failure — check structural conditions, not exact instantaneous values.

If an assertion is critical, run it 2–3 times and require majority agreement before acting on the result, since VLMs can be inconsistent.

**Phase 6 — Report**: Compile a structured report with summary, confirmed findings (with DOM evidence), false positives (VLM hallucinations dismissed by DOM verify), and actionable recommendations.

## Common Gotchas

These are derived from the skills documentation and apply across all visual testing workflows.

1. **VLM hallucinations are real**: VLMs can "see" text that doesn't exist, interpret visual artifacts incorrectly, or invent elements that logically might be there but aren't. Always DOM-verify critical findings before making code changes.

2. **Prefer the built-in `viewport` parameter**: All MCP VLM tools accept a `viewport` dict. It sets viewport before capture and auto-restores afterward. Don't use raw CDP/browser-harness for viewport changes unless necessary.

3. **Narrow, data-independent assertions work best**: "Two adjacent cards have the same height and their bottom edges align" is a good assertion. "The page looks perfect, no issues" is too vague. "TTFB shows 0.56s" will break when the data changes.

4. **Inline styles beat CSS**: Some chart and animation libraries set inline styles on SVG elements. Your CSS rules may need `!important` to override.

5. **CSS variables resolve differently in SVG**: A variable like `--color-text` may resolve to `--color-text-secondary` inside an SVG context. Always check computed values with `getComputedStyle()`.

6. **Animation wrappers break grid/flex alignment**: CSS Grid `align-items: stretch` should equalize row heights, but animation library wrappers (framer-motion, etc.) render as `display: block` with `height: auto`. The inner card sizes to content, not the grid cell. Fix: add `height: 100%` (or `h-full` in Tailwind) to both the wrapper and the card.

7. **CSS variable names differ across component libraries**: Don't guess. Read the component's CSS file in `node_modules/` or equivalent.

8. **Dual-source `aria-current`**: When a component library nav item wraps a router link, both may independently set `aria-current`. Check that they agree. Use exact-path matching where available.

9. **SVG viewBox clipping**: SVG defaults to `overflow: hidden`. Labels at negative y coordinates are invisible. Either clamp positions or use `overflow: visible`.

10. **`reload` is your friend**: The MCP tools' `reload` parameter ensures the latest code is captured. Without it, screenshots show the pre-change state. `visual_assert` defaults to `reload: true`; `visual_review` and `visual_inspect` default to `reload: false`.

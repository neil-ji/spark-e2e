# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

spark-e2e is a VLM-powered visual E2E testing CLI. Each command is a complete, self-contained action — open browser → navigate → screenshot → VLM analysis → return JSON. No persistent server needed.

Two language implementations share the same protocol:
- **`src-ts/`** — TypeScript CLI (primary, npm channel)
- **`src/spark_e2e/`** — Python CLI (pip channel)
- **`skills/`** — Shared Claude Code skills (Markdown, both CLI channels use the same skills)

## Commands

```bash
# Quick setup (interactive wizard)
spark-e2e setup

# Install (TypeScript — primary)
npm install && npm run build
npm link                       # global link for development

# Install (Python)
pip install -e ".[dev]"
playwright install chromium    # optional Playwright backend

# Test
pytest                        # Python tests
npx tsc --noEmit              # TypeScript type-check
```

## Architecture

```
skills/                          ← Claude Code skills (Markdown)
├── ui-review/SKILL.md           ← /ui-review — review loop
├── dom-verify/SKILL.md          ← /dom-verify — DOM checks
└── e2e-test/SKILL.md            ← /e2e-test — full test cycle

src-ts/                          ← TypeScript CLI (primary)
├── cli.ts                       ← Commander, 9 subcommands
├── config.ts                    ← js-yaml + dotenv + zod, 5-layer priority
├── prompts.ts                   ← Anti-hallucination prompts, 3 strictness levels
├── browser/
│   ├── index.ts                 ← Registry pattern (registerBackend, getBackend)
│   ├── browser-harness.ts       ← CDP backend (spawns browser-harness CLI)
│   └── playwright.ts            ← Playwright native (optional peer dep)
└── vlm/
    ├── index.ts                 ← Registry pattern (registerProvider, getProvider)
    └── openai-compat.ts          ← OpenAI SDK + extractJson()

src/spark_e2e/                   ← Python CLI (pip channel)
├── cli.py                       ← argparse, 6 subcommands
├── config.py                    ← PyYAML + dataclasses, same 5-layer priority
├── prompts.py                   ← Same anti-hallucination prompts
├── browser/
│   ├── __init__.py              ← Registry pattern
│   ├── base.py                  ← BrowserBackend ABC
│   ├── browser_harness.py       ← CDP via subprocess
│   └── playwright_.py           ← Playwright sync API
└── vlm/
    ├── __init__.py              ← Registry pattern
    ├── base.py                  ← VLMProvider ABC
    └── openai_compat.py         ← OpenAI SDK + extract_json()
```

### Plugin Architecture

Both browser backends and VLM providers use the same registry pattern in both languages:

- **Browser backends**: TypeScript `BrowserBackend` interface (6 methods), Python `BrowserBackend` ABC (6 methods). Built-in: `browser-harness` (default, spawns CLI subprocess), `playwright` (optional).

- **VLM providers**: TypeScript `VLMProvider` interface (1 method: `chat`), Python `VLMProvider` ABC (1 method). Built-in: `openai-compat` (OpenAI SDK, works with any `/v1/chat/completions` endpoint).

### Config System (both languages)

5-layer priority (highest first):
1. CLI arguments (`--url`, `--model`, etc.)
2. `SPARK_E2E_*` environment variables
3. `.spark-e2e.yaml` config file (auto-discovered in cwd)
4. Legacy `VLM_*` environment variables
5. Hardcoded defaults

**`.env` is loaded first** (before YAML), so `${ENV_VAR}` interpolation in YAML resolves against `.env` values.

### Style Conventions (`AESTHETICS.md`)

`AESTHETICS.md` is a **generated** file that defines project-specific UI conventions (spacing, colors, typography, component specs). It is automatically injected into every `spark-e2e review` VLM prompt.

Run `/style-init` to scan the frontend codebase and regenerate this file. Re-run whenever the design system changes. The conventions are concrete and quantifiable — real pixel values, hex colors, and font sizes extracted from the actual codebase.

### Skills as Slash Commands

The three skills in `skills/` are Claude Code skills per the [official spec](https://code.claude.com/docs/en/skills). They describe CLI command workflows for Claude to execute via Bash.

**Skill mechanics**:
- **`description`** frontmatter — drives auto-invocation. Claude matches user queries against it at session start.
- **`argument-hint`** — shown in UI when typing `/<name>`. `$ARGUMENTS` is the target URL.
- **Invocation**: manual (`/ui-review`) or automatic when query matches description.
- **Directory name** = slash command name (`skills/ui-review/SKILL.md` → `/ui-review`)

**CLI-first pattern**: Skills describe `spark-e2e` CLI commands for Claude to run via Bash. Each command is self-contained (navigate → screenshot → VLM → JSON output). Claude reads the JSON output and decides next steps.

### Distribution Channels

| Channel | Command | What you get |
|---|---|---|
| npx | `npx spark-e2e` | Native TypeScript CLI (zero install) |
| npm | `npm install -g spark-e2e` | Global TypeScript CLI |
| pip | `pip install spark-e2e` | Python CLI |
| Plugin Marketplace | `/plugin marketplace add neilji/spark-e2e` | 3 Claude Code skills |
| Setup Wizard | `spark-e2e setup` | Interactive config + skill install |

The plugin marketplace (`.claude-plugin/marketplace.json`) lists `spark-e2e-skills` with `source: "./"` (relative path), pointing `skills: ["skills"]` to auto-discover all three skill directories.

### Testing

**Python**: `pytest tests/` — 13 tests: config defaults/loading, browser registry, VLM registry, extractJson edge cases.

**TypeScript**: `npx tsc --noEmit` — full type checking. No runtime test suite yet.

### Common Gotchas

1. **VLM hallucinations are real** — always DOM-verify before making code changes.
2. **Inline styles beat CSS** — chart/animation libraries set inline styles. `!important` may be needed.
3. **CSS variables resolve differently in SVG** — check `getComputedStyle()`, not declared values.
4. **Animation wrappers break grid/flex** — add `height: 100%` to wrapper + inner container.
5. **Narrow, data-independent assertions work best** — "two cards equal height" not "TTFB shows 0.56s".
6. **TypeScript compile is required before running** — `npm run build` or `npx tsc` after source changes.

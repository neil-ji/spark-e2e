# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

spark-e2e is a **VLM + DOM dual-engine visual audit CLI**. It does NOT control the browser — Playwright CLI/MCP handles that. spark-e2e analyzes screenshots and DOM dumps: PNG + JSON in, Findings out.

- **`src/`** — TypeScript CLI + engine
- **`skills/`** — Claude Code skills (Markdown)

## Commands

```bash
# Quick setup (interactive wizard)
spark-e2e setup

# Core analysis (all accept --screenshot <path>)
spark-e2e review --screenshot /tmp/shot.png [--dom /tmp/dom.json] [--mode light|strict]
spark-e2e assert "sidebar has 5 items" --screenshot /tmp/shot.png
spark-e2e inspect "check gauge labels" --screenshot /tmp/shot.png
spark-e2e test "cards equal height" --screenshot /tmp/shot.png

# DOM analysis (consume DOM dumps from Playwright)
spark-e2e dom-lint --dom /tmp/dom.json
spark-e2e dom-get @button-3 --dom /tmp/dom.json

# Baselines
spark-e2e baseline save --name "v1" --screenshot /tmp/shot.png
spark-e2e baseline compare --name "v1" --screenshot /tmp/shot.png

# Install
npm install && npm run build
npm link                       # global link for development

# Test
npm test                       # vitest, 93 tests
npx tsc --noEmit               # type-check
```

## Architecture

```text
skills/                          ← Claude Code skills (Markdown)
├── spark-e2e/SKILL.md           ← /spark-e2e — Playwright-first visual review
└── spark-e2e-init/SKILL.md      ← /spark-e2e-init — AESTHETICS.md + dom-rules.json

src/                          ← TypeScript CLI + engine
├── cli.ts                       ← Commander, 9 subcommands
├── config.ts                    ← js-yaml + dotenv + zod, 5-layer priority
├── baselines.ts                 ← Visual regression baseline CRUD
├── schemas.ts                   ← Shared type definitions (DomDump, Findings, etc.)
├── migrate.ts                   ← Versioned migration engine (spark-e2e update)
├── setup.ts                     ← Interactive setup wizard
├── engine/
│   ├── index.ts                 ← Engine entry point
│   ├── review.ts                ← VLM review (light/strict modes, DOM cross-validation)
│   ├── dom-lint.ts              ← Deterministic DOM rule checker (6 built-in rules)
│   ├── dom-get.ts               ← Element property lookup by @ref
│   ├── rules.ts                 ← Lint rule registry + dom-rules.json loader
│   └── prompts/
│       ├── safety.ts            ← Anti-hallucination + credential safety rules
│       ├── review.ts            ← Dimension-specific review prompts
│       ├── assert.ts            ← Assertion verification prompt
│       ├── locate.ts            ← Element location prompt
│       └── baseline.ts          ← Baseline comparison prompt
└── vlm/
    ├── index.ts                 ← VLMProvider interface + registry
    └── openai-compat.ts         ← OpenAI SDK + extractJson()
```

### Two engines

| Engine | What it checks | How |
|--------|---------------|-----|
| **VLM review** | Visual issues (layout, color, typography, spacing, charts) | Screenshot → VLM analysis |
| **dom-lint** | Deterministic rules (token compliance, font-weight, a11y) | DOM dump → rule matching |

### Config System

5-layer priority (highest first):
1. CLI arguments (`--model`, `--mode`, etc.)
2. `SPARK_E2E_*` environment variables
3. `.spark-e2e.yaml` config file (auto-discovered in cwd)
4. Legacy `VLM_*` environment variables
5. Hardcoded defaults

**`.env` is loaded first** (before YAML), so `${ENV_VAR}` interpolation in YAML resolves against `.env` values.

### Style Conventions (`AESTHETICS.md` + `dom-rules.json`)

`/spark-e2e-init` scans the frontend codebase and generates TWO files from a single scan:
- **`AESTHETICS.md`** — Human/VLM-readable conventions (injected into review prompts)
- **`.spark/plugin/e2e/dom-rules.json`** — Machine-readable rules (consumed by dom-lint)

Both share the same source of truth — run `/spark-e2e-init` whenever the design system changes.

### Skills as Slash Commands

The two skills in `skills/` are Claude Code skills per the [official spec](https://code.claude.com/docs/en/skills).

**Playwright-first workflow**: The spark-e2e skill instructs Claude to use Playwright CLI/MCP for browser control, and spark-e2e for visual analysis. They are complementary:

```
Playwright CLI  →  navigate, click, screenshot, DOM dump
spark-e2e       →  review, assert, dom-lint, baseline compare
```

### Testing

```bash
npm test                       # vitest, 93 tests across 9 files
npx tsc --noEmit               # type-check
```

### Release

Release is fully automated via GitHub Actions + OIDC (trusted publishing). No local credentials needed.

**How to release:**
```bash
# 1. Bump version
npm version <version> --no-git-tag-version

# 2. Commit, tag, push — CI handles the rest
git add -A && git commit -m "chore: bump version to <new>"
git tag v<new> && git push origin master v<new>
```

**What CI does:**
- `v*` tag triggers `.github/workflows/publish.yml`
- Runs verify (build + quick smoke), then `npm publish --provenance`

**Gotchas:**
- npm does NOT allow republishing the same version. If a publish fails mid-flight, bump to the next patch.
- `package.json` `repository.url` must match the GitHub repo exactly (`neil-ji/spark-e2e`, not `neilji/...`) or OIDC provenance validation fails.
- Never commit `.spark-e2e.yaml`, `.claude/skills/`, or `.spark/skills/` — they're generated and gitignored.

### Common Gotchas

1. **VLM hallucinations are real** — always DOM-verify before making code changes. Use `dom-get` to cross-reference.
2. **Disabled elements** — VLM may flag a disabled button's color as "wrong". `dom-get` reveals the disabled attribute + low opacity. Not a bug.
3. **Inline styles beat CSS** — chart/animation libraries set inline styles. `!important` may be needed.
4. **CSS variables resolve differently in SVG** — check `getComputedStyle()`, not declared values.
5. **Animation wrappers break grid/flex** — add `height: 100%` to wrapper + inner container.
6. **Narrow, data-independent assertions work best** — "two cards equal height" not "TTFB shows 0.56s".
7. **spark-e2e does NOT control the browser** — use Playwright CLI/MCP for navigation and screenshots.
8. **TypeScript compile is required before running** — `npm run build` or `npx tsc` after source changes.

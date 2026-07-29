# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

spark-e2e is a VLM-powered visual E2E testing CLI. Each command is a complete, self-contained action — open browser → navigate → screenshot → VLM analysis → return JSON. No persistent server needed.

- **`src/`** — TypeScript CLI
- **`skills/`** — Shared Claude Code skills (Markdown)

## Commands

```bash
# Quick setup (interactive wizard)
spark-e2e setup

# Install
npm install && npm run build
npm link                       # global link for development

# Test
npm test                       # vitest
npx tsc --noEmit               # type-check
```

## Architecture

```
skills/                          ← Claude Code skills (Markdown)
├── ui-review/SKILL.md           ← /ui-review — review loop
├── dom-verify/SKILL.md          ← /dom-verify — DOM checks
└── e2e-test/SKILL.md            ← /e2e-test — full test cycle

src/                          ← TypeScript CLI
├── cli.ts                       ← Commander, 13 subcommands
├── config.ts                    ← js-yaml + dotenv + zod, 5-layer priority
├── prompts.ts                   ← Anti-hallucination prompts, 3 strictness levels
├── baselines.ts                 ← Visual regression baseline CRUD
├── runner.ts                    ← YAML test scenario runner
├── browser/
│   ├── index.ts                 ← Registry pattern (registerBackend, getBackend)
│   └── playwright.ts            ← Playwright native
└── vlm/
    ├── index.ts                 ← Registry pattern (registerProvider, getProvider)
    └── openai-compat.ts         ← OpenAI SDK + extractJson()
```

### Plugin Architecture

**Browser**: Playwright is the only backend. It auto-resolves from project `node_modules`, global npm, or bare specifier (in that order). Run `spark-e2e setup` to install it automatically.

**VLM providers**: `VLMProvider` interface (1 method: `chat`). Built-in: `openai-compat` (OpenAI SDK, works with any `/v1/chat/completions` endpoint). Supports single or multiple images per call.

### Config System

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
| npm (recommended) | `npm install -g spark-e2e` | Global CLI — fast, always available |
| npx (fallback) | `npx spark-e2e` | On-demand download — slower, may hit cache issues |
| Plugin Marketplace | `/plugin marketplace add neilji/spark-e2e` | 3 Claude Code skills |
| Setup Wizard | `spark-e2e setup` | Interactive config + skill install |

**Always prefer global install (`npm install -g`).** Local installs in project `node_modules` cause confusion — the npx resolver picks the local version (possibly stale) over the latest, and users must configure npm scripts to call it. The setup wizard detects npx usage and prompts users to install globally.

The plugin marketplace (`.claude-plugin/marketplace.json`) lists `spark-e2e-skills` with `source: "./"` (relative path), pointing `skills: ["skills"]` to auto-discover all three skill directories.

### Testing

```bash
npm test                       # vitest, 62 tests across 7 files
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

1. **Credentials must use env vars** — Never hardcode passwords/keys in YAML files. Use `${ENV_VAR}` in `type.text` values and create a `.env` file (gitignored) with the actual values. The runner auto-interpolates at load time.
2. **VLM hallucinations are real** — always DOM-verify before making code changes.
3. **Inline styles beat CSS** — chart/animation libraries set inline styles. `!important` may be needed.
4. **CSS variables resolve differently in SVG** — check `getComputedStyle()`, not declared values.
5. **Animation wrappers break grid/flex** — add `height: 100%` to wrapper + inner container.
6. **Narrow, data-independent assertions work best** — "two cards equal height" not "TTFB shows 0.56s".
7. **TypeScript compile is required before running** — `npm run build` or `npx tsc` after source changes.

# spark-e2e

VLM-powered visual E2E testing CLI. Each command is self-contained — open browser → screenshot → VLM analysis → JSON output. No persistent server needed.

## Install

```bash
# Global install (recommended)
npm install -g spark-e2e

# Or on-demand via npx (slower, may hit cache issues)
npx spark-e2e <command>
```

**Always prefer global install.** Local `node_modules` installs cause version conflicts and require npm script setup. The setup wizard warns you if it detects npx usage.

## Quick Start

```bash
# Interactive setup — pick provider, configure VLM, install skills
spark-e2e setup

# Verify your setup
spark-e2e doctor

# Run your first review
spark-e2e review --url https://example.com
```

## Commands

### Core

| Command | Description |
|---|---|
| `spark-e2e setup` | Interactive wizard — provider, API key, auto-detection |
| `spark-e2e doctor` | Diagnose environment (Node, Playwright, API key, config) |
| `spark-e2e update` | Migrate local data from older versions (`--dry-run` to preview) |

### Visual Testing

| Command | Description |
|---|---|
| `spark-e2e review --url <url>` | Comprehensive UI audit — returns findings as JSON |
| `spark-e2e assert "<condition>" --url <url>` | Verify a visual condition (pass/fail) |
| `spark-e2e test "<expectations>" --url <url>` | Verify multiple expectations in one call |
| `spark-e2e inspect "<prompt>" --url <url>` | Free-form VLM analysis of the page |
| `spark-e2e compare "<expected>" --url <url>` | Compare page against expected state |

### Browser Interaction

| Command | Description |
|---|---|
| `spark-e2e navigate <url>` | Load a page (handles lazy-loaded content) |
| `spark-e2e snapshot --url <url>` | Capture a screenshot to file |
| `spark-e2e click "<target>" --url <url>` | Click an element via VLM targeting |
| `spark-e2e type "<text>" --url <url>` | Type text into a field via VLM targeting |
| `spark-e2e hover "<target>" --url <url>` | Hover over an element via VLM targeting |
| `spark-e2e scroll [--x px] [--y px] [--selector css]` | Scroll the page |
| `spark-e2e dom-verify --url <url>` | DOM structure + CSS token discovery (`--save` for @ref lookups) |

### Regression

| Command | Description |
|---|---|
| `spark-e2e baseline save <name>` | Save current page as visual baseline |
| `spark-e2e baseline compare <name>` | AI-powered visual diff against baseline |
| `spark-e2e baseline list` | List saved baselines |
| `spark-e2e baseline delete <name>` | Delete a baseline |

### YAML Runner

```bash
spark-e2e run tests/*.yaml    # Run YAML test scenarios
```

Example `.yaml`:

```yaml
scenarios:
  - name: login flow
    steps:
      - navigate: https://app.example.com/login
      - type: { text: "${TEST_PASSWORD}", into: "password field" }
      - click: "Sign In button"
      - assert: "Dashboard is visible"
```

## Configuration

### Setup Wizard (recommended)

```bash
spark-e2e setup
```

Picks a provider (OpenAI / Anthropic / Gemini / Ollama / Custom), auto-fills URL and model, and writes config for you.

### Manual — `.spark-e2e.yaml`

```yaml
vlm:
  provider: openai-compat
  api_key: "${SPARK_E2E_API_KEY}"
  base_url: "${SPARK_E2E_BASE_URL}"
  model: gpt-4o

viewport:
  width: 1600
  height: 1200

selectors:
  card: '[class*="card"]'
  active_nav: '[aria-current="page"]'

prompts:
  strictness: standard       # standard | strict | relaxed

# Sensitive field masking (defaults shown)
security:
  mask_selectors:
    - 'input[type="password"]'
    - 'input[name*="secret" i]'
    - '.api-key-display'
```

### Environment Variables

```bash
export SPARK_E2E_API_KEY="sk-..."
export SPARK_E2E_BASE_URL="https://api.openai.com/v1"
export SPARK_E2E_MODEL="gpt-4o"
```

Config priority: CLI args > env vars > YAML > defaults.

## Security

- **Credential safety**: VLM prompts include anti-leak rules — the model is instructed never to transcribe passwords, API keys, or tokens it sees on screen
- **Field masking**: Password fields and configurable selectors are masked before screenshots are captured
- **Env var interpolation**: Use `${VAR}` in YAML test steps instead of hardcoded passwords
- **File permissions**: `~/.spark/plugin/e2e/.env` is `chmod 600` (owner-only)
- **No logging**: API keys are never written to logs or JSON output

See `spark-e2e update` to migrate local data from older versions.

## Architecture

```
skills/                       ← Claude Code slash commands
├── spark-e2e/SKILL.md          ← /spark-e2e — all-in-one testing
└── spark-e2e-init/SKILL.md     ← /spark-e2e-init — style conventions

src/                       ← TypeScript CLI
├── cli.ts                 ← Commander, 15 subcommands
├── config.ts              ← 5-layer config (cli → env → yaml → legacy → default)
├── prompts.ts             ← Anti-hallucination + credential safety prompts
├── migrate.ts             ← Versioned migration engine (spark-e2e update)
├── setup.ts               ← Interactive setup wizard
├── runner.ts              ← YAML test scenario runner
├── baselines.ts           ← Visual regression baseline CRUD
├── browser/
│   └── playwright.ts      ← Playwright native (only backend)
└── vlm/
    └── openai-compat.ts   ← OpenAI SDK (any /v1/chat/completions endpoint)
```

## Skills as Slash Commands

spark-e2e ships 2 Claude Code skills:

| Skill | Trigger |
|---|---|
| `/spark-e2e` | Visual UI review, E2E testing, DOM verification |
| `/spark-e2e-init` | Scan frontend codebase → generate style conventions |

Install via `spark-e2e setup` or the Plugin Marketplace.

## License

MIT

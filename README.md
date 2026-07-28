# spark-e2e

VLM-powered visual E2E testing for the web.  
**One command per action.** No MCP server needed.

## Quick Start

```bash
# Install
npx spark-e2e init                    # auto-detect agent, project scope

# Configure VLM (saved globally to ~/.spark-e2e/.env)
spark-e2e init --api-key "sk-..." --base-url "https://api.openai.com/v1"

# Verify
spark-e2e doctor

# Use
spark-e2e review --focus comprehensive --url http://localhost:5173
spark-e2e assert "Two cards have equal height" --url http://localhost:5173
```

## Commands

| Command | What it does |
|---|---|
| `spark-e2e init` | Set up skills + config for AI agents |
| `spark-e2e init --all --scope user` | Install for all agents globally |
| `spark-e2e init --agent codex` | Install for a specific agent |
| `spark-e2e init --agent spark-hub` | Install for spark-hub (~/.spark/config/custom-skills/) |
| `spark-e2e init --api-key <k> --base-url <u>` | Configure VLM credentials |
| `spark-e2e navigate <url>` | Load a page in the browser |
| `spark-e2e snapshot --url <url>` | Capture a screenshot |
| `spark-e2e inspect "<prompt>" --url <url>` | Ask a VLM about the page |
| `spark-e2e assert "<condition>" --url <url>` | Verify a visual condition (pass/fail) |
| `spark-e2e compare "<expected>" --url <url>` | Compare page against expected state |
| `spark-e2e review --focus <f> --url <url>` | Comprehensive UI audit (JSON findings) |
| `spark-e2e dom-verify --url <url>` | Batch DOM structure + CSS token discovery |
| `spark-e2e doctor` | Diagnose the environment |

All VLM commands return structured JSON. Stdout is the result — pipeable and scriptable.

## How It Works

Each command:
1. Opens the browser (via **browser-harness** CDP protocol, or **Playwright**)
2. Navigates to the URL
3. Captures a screenshot
4. Sends it to a **Vision Language Model** (GPT-4o, Qwen-VL, etc.)
5. Returns the VLM's analysis as JSON

No persistent server. No long-running process. Each command is a complete, self-contained action.

## Install

```bash
# npm (Node.js users — zero install via npx, or global)
npx spark-e2e
npm install -g spark-e2e

# pip (Python users)
pip install spark-e2e

# spark-hub (install skills to ~/.spark/config/custom-skills/)
spark-e2e init --agent spark-hub
```

## Configuration

Create `.spark-e2e.yaml` in your project root (optional — defaults work without it):

```yaml
browser:
  backend: browser-harness   # or playwright
  url: http://localhost:5173

viewport:
  width: 1600
  height: 1200

vlm:
  api_key: "${SPARK_E2E_API_KEY}"
  base_url: "${SPARK_E2E_BASE_URL}"
  model: gpt-4o

selectors:
  card: '[class*="card"]'
  active_nav: '[aria-current="page"]'

css_variables:
  - "--color-accent"
  - "--color-text"
  - "--color-positive"
  - "--color-negative"

prompts:
  strictness: standard       # standard | strict | relaxed
```

Or use environment variables:

```bash
export SPARK_E2E_API_KEY="..."
export SPARK_E2E_BASE_URL="https://..."
export SPARK_E2E_MODEL="gpt-4o"
```

## Architecture

```
skills/                    ← Claude Code skills (Markdown)
├── ui-review/SKILL.md     ← /ui-review — review loop
├── dom-verify/SKILL.md    ← /dom-verify — DOM checks
└── e2e-test/SKILL.md      ← /e2e-test — full test cycle

src-ts/                    ← TypeScript CLI (primary)
├── cli.ts                 ← All 9 commands
├── config.ts              ← YAML + env config
├── prompts.ts             ← Anti-hallucination prompts
├── browser/               ← browser-harness + Playwright
└── vlm/                   ← OpenAI-compatible provider

src/spark_e2e/             ← Python CLI (pip channel)
├── cli.py                 ← Same commands
├── config.py
├── prompts.py
├── browser/
└── vlm/
```

## Extending

### Add a browser backend

```typescript
// TypeScript
import { BrowserBackend, registerBackend } from "spark-e2e/browser";
class MyBackend implements BrowserBackend { /* ... */ }
registerBackend("my-backend", MyBackend);
```

```python
# Python
from spark_e2e.browser import BrowserBackend, register_backend
class MyBackend(BrowserBackend): ...
register_backend("my-backend", MyBackend)
```

### Add a VLM provider

```typescript
import { VLMProvider, registerProvider } from "spark-e2e/vlm";
class MyProvider implements VLMProvider { /* chat(prompt, imageUrl): Promise<string> */ }
registerProvider("my-provider", MyProvider);
```

## License

MIT

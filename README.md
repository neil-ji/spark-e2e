# spark-e2e

VLM-powered visual E2E testing for the web.  
Use with **Claude Code** as a skill, or as a **standalone CLI**.

🌐 Browser backends: **browser-harness** (CDP) and **Playwright**  
👁️ VLM providers: Any **OpenAI-compatible** API (GPT-4o, Qwen-VL, etc.)  
🧪 Test types: Visual review, assertion, comparison, DOM verification

## Install

Choose the channel that fits your workflow:

### pip (Python users)

```bash
pip install spark-e2e

# Optional: Playwright backend
pip install spark-e2e[playwright]
playwright install chromium
```

Then install the Claude Code skills:

```bash
spark-e2e init
```

### npx (Node.js users — zero install)

```bash
npx spark-e2e doctor
npx spark-e2e init
```

The npx wrapper auto-installs the Python package on first run.

### Plugin Marketplace (Claude Code users)

From inside Claude Code:

```
/plugin marketplace add neilji/spark-e2e
/plugin install spark-e2e-skills@spark-e2e
```

Skills are available as slash commands: `/ui-review`, `/dom-verify`, `/e2e-test`.

## Quick Start

### 1. Configure

```bash
# Set VLM credentials (or create a .env file)
export SPARK_E2E_API_KEY="your-api-key"
export SPARK_E2E_BASE_URL="https://your-vlm.example.com/v1"

# Optional: create a project config
cp spark-e2e.yaml.example .spark-e2e.yaml
```

### 2. Use

**As a Claude Code skill** — after `spark-e2e init` or plugin marketplace install:

```
/ui-review http://localhost:5173/dashboard
/dom-verify
/e2e-test http://localhost:5173/dashboard
```

The MCP server can be run directly (skills invoke it automatically):

```bash
spark-e2e serve
```

**As a standalone CLI**:

```bash
# Diagnose your setup
spark-e2e doctor

# Capture a screenshot
spark-e2e snapshot --url http://localhost:5173

# Run a visual assertion
spark-e2e assert "The sidebar shows 5 menu items" --url http://localhost:5173

# Run a comprehensive review
spark-e2e review --focus layout --url http://localhost:5173
```

## Architecture

```
┌─────────────────────────────────────────────┐
│  Claude Code Skills (SKILL.md)              │
│  ui-review / dom-verify / e2e-test          │
├─────────────────────────────────────────────┤
│  MCP Server (server.py)                     │
│  navigate, visual_review, visual_assert,    │
│  visual_compare, visual_inspect,            │
│  visual_snapshot, dom_verify                │
├──────────────────┬──────────────────────────┤
│  Browser Backend │  VLM Provider            │
│  ┌────────────┐  │  ┌────────────────────┐  │
│  │browser-    │  │  │ OpenAI-compat API  │  │
│  │harness     │  │  │ (GPT-4o, Qwen,     │  │
│  │(CDP)       │  │  │  Llama Vision...)  │  │
│  ├────────────┤  │  └────────────────────┘  │
│  │Playwright  │  │                          │
│  │(headless)  │  │                          │
│  └────────────┘  │                          │
├──────────────────┴──────────────────────────┤
│  CLI (cli.py)                               │
│  serve / init / doctor / snapshot /         │
│  assert / review                            │
└─────────────────────────────────────────────┘
```

## How It Works

spark-e2e takes **screenshots** of your web app and sends them to a **Vision Language Model** (VLM) for analysis. The VLM acts as a visual QA engineer — it can:

- **Review** a page for layout, typography, color, and rendering issues
- **Assert** that specific visual conditions are true (e.g., "two cards are equal height")
- **Compare** a page against an expected description
- **Inspect** a page with free-form questions

All findings are verified through **DOM queries** to filter out VLM hallucinations before any code changes are made.

## Extending

### Add a browser backend

```python
from spark_e2e.browser import BrowserBackend, register_backend

class MyBackend(BrowserBackend):
    def capture_screenshot(self, ...): ...
    def execute_js(self, script): ...
    def navigate(self, url): ...
    def get_page_info(self): ...
    def get_element_rect(self, selector): ...
    def close(self): ...

register_backend("my-backend", MyBackend)
```

### Add a VLM provider

```python
from spark_e2e.vlm import VLMProvider, register_provider

class MyProvider(VLMProvider):
    def chat(self, prompt, image_data_url): ...

register_provider("my-provider", MyProvider)
```

See `docs/` for detailed guides.

## Distribution Channels

| Channel | Command | What you get |
|---|---|---|
| pip | `pip install spark-e2e` | CLI + MCP server + skills (via `spark-e2e init`) |
| npx | `npx spark-e2e` | CLI + MCP server (auto-installs pip package) + skills |
| Plugin Marketplace | `/plugin marketplace add neilji/spark-e2e` | 3 Claude Code skills as slash commands |

## Configuration Reference

| Setting | Default | Description |
|---|---|---|
| `browser.backend` | `browser-harness` | Browser automation backend |
| `browser.url` | `http://localhost:5173` | Default target URL |
| `viewport.width` | `1600` | Screenshot width |
| `viewport.height` | `1200` | Screenshot height |
| `vlm.model` | `gpt-4o` | VLM model name |
| `vlm.provider` | `openai-compat` | VLM provider type |
| `selectors.card` | `[class*="card"]` | Card component selector |
| `prompts.strictness` | `standard` | Anti-hallucination level |

## Environment Variables

| Variable | Legacy (backward compat) | Purpose |
|---|---|---|
| `SPARK_E2E_API_KEY` | `VLM_API_KEY` | VLM API key |
| `SPARK_E2E_BASE_URL` | `VLM_BASE_URL` | VLM API base URL |
| `SPARK_E2E_MODEL` | `VLM_MODEL` | VLM model name |
| `SPARK_E2E_BACKEND` | — | Browser backend choice |
| `SPARK_E2E_URL` | — | Default target URL |
| `SPARK_E2E_CONFIG` | — | Config file path |

## License

MIT — see [LICENSE](LICENSE).

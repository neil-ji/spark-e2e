# Configuration Reference

spark-e2e is configured through a layered system: YAML file, environment
variables, and CLI arguments.

## Config File

By default, spark-e2e looks for `.spark-e2e.yaml` (or `.spark-e2e.yml`)
in the current working directory. You can specify a different file with
`SPARK_E2E_CONFIG` or `--config`.

### Full Schema

```yaml
# ── Browser automation ──
browser:
  backend: browser-harness       # "browser-harness" | "playwright"
  url: http://localhost:5173      # default target URL (used when --url is omitted)

# ── Default viewport ──
viewport:
  width: 1600
  height: 1200
  deviceScaleFactor: 1

# ── VLM settings ──
vlm:
  provider: openai-compat        # VLM provider type
  api_key: "${SPARK_E2E_API_KEY}" # use ${ENV_VAR} for env var references
  base_url: "${SPARK_E2E_BASE_URL}"
  model: gpt-4o

# ── Project selectors (optional) ──
selectors:
  card: '[class*="card"]'
  progress_fill: '[class*="progress"][class*="fill"]'
  active_nav: '[aria-current="page"]'
  sidebar_item: '[class*="sidebar"] a, [class*="menu"] a'

# ── CSS variables for token discovery (optional) ──
css_variables:
  - "--color-accent"
  - "--color-text"
  # ... add your design tokens

# ── Anti-hallucination strictness ──
prompts:
  strictness: standard           # "standard" | "strict" | "relaxed"
```

## Environment Variables

| Variable | Config Path | Purpose |
|---|---|---|
| `SPARK_E2E_BACKEND` | `browser.backend` | Browser backend name |
| `SPARK_E2E_URL` | `browser.url` | Default target URL |
| `SPARK_E2E_API_KEY` | `vlm.api_key` | VLM API key |
| `SPARK_E2E_BASE_URL` | `vlm.base_url` | VLM API base URL |
| `SPARK_E2E_MODEL` | `vlm.model` | VLM model name |
| `SPARK_E2E_VLM_PROVIDER` | `vlm.provider` | VLM provider type |
| `SPARK_E2E_CONFIG` | — | Path to config file |
| `SPARK_E2E_ENV` | — | Path to .env file |

### Legacy Compatibility

The old `VLM_*` environment variables are still supported as fallbacks:

| Legacy Variable | Equivalent |
|---|---|
| `VLM_API_KEY` | `SPARK_E2E_API_KEY` |
| `VLM_BASE_URL` | `SPARK_E2E_BASE_URL` |
| `VLM_MODEL` | `SPARK_E2E_MODEL` |

## Priority

Higher number = higher priority:

5. Hardcoded defaults
4. Legacy env vars (`VLM_*`)
3. Config file (`.spark-e2e.yaml`)
2. Environment variables (`SPARK_E2E_*`)
1. CLI arguments

## .env File

spark-e2e loads `.env` from the current directory (or `SPARK_E2E_ENV`).
This happens before config file loading, so `${ENV_VAR}` interpolation
in YAML works with values from `.env`.

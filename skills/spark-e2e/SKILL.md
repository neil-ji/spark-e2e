---
description: Visual E2E testing and UI review using the spark-e2e CLI. Use for UI review, visual regression, E2E test automation, DOM verification, or any browser-based page check.
argument-hint: "[url] — e.g. http://localhost:5173/dashboard"
---

Two modes:

| Mode | When | Output |
|------|------|--------|
| **Quick check** | "review this page", "is the sidebar aligned?" | Problem list |
| **YAML runner** | "run login flow", "verify checkout E2E" | Pass/fail report |

Output is a **findings list or pass/fail result** — this skill does not fix code.

## Output formats

### review (open-ended)

```json
{
  "findings": [
    {
      "severity": "critical | major | minor",
      "category": "layout | typography | color | spacing | alignment | interactive | chart",
      "description": "Sidebar highlight color is inconsistent with current page",
      "location": "Top nav, third item from left",
      "evidence": "actual: #3B82F6, expected: #1D4ED8 (from active_nav selector)",
      "confidence": "high | medium | low"
    }
  ],
  "summary": "3 issues found: 1 layout, 1 spacing, 1 color",
  "no_issues_found": false
}
```

### assert (single condition)

```json
{
  "pass": true,
  "confidence": "high",
  "observation": "Sidebar 'Dashboard' item highlighted, all others default",
  "reasoning": "Checked aria-current on nav items — only Dashboard has aria-current='page'"
}
```

### test (multi-expectation)

```json
{
  "pass": false,
  "confidence": "medium",
  "checks": [
    {
      "expectation": "two cards have equal height",
      "pass": false,
      "confidence": "high",
      "observation": "Left card 320px, right card 380px",
      "reasoning": "Measured bounding rects — right card taller due to extra description text"
    }
  ],
  "summary": "1/3 checks failed: card height mismatch"
}
```

### YAML runner report

```json
[
  {
    "name": "login flow",
    "pass": true,
    "steps": [
      { "type": "navigate", "pass": true, "detail": "/login", "durationMs": 1200 },
      { "type": "type", "pass": true, "detail": "[masked] into (420, 310)", "durationMs": 800 },
      { "type": "click", "pass": true, "detail": "(500, 400)", "durationMs": 600 },
      { "type": "assert", "pass": true, "detail": "Dashboard is visible", "durationMs": 2100 }
    ],
    "durationMs": 4700
  }
]
```

### inspect (free-form)

VLM returns unstructured text answering the prompt. No fixed schema — parse key claims from the response.

## Before starting

Verify the environment is ready:

```bash
spark-e2e doctor
```

Confirm the output shows:
- `✓` for Node, Playwright, and API key
- AESTHETICS.md sources listed (global + project) — or a hint if missing
- Project `.env` check — used for `${ENV_VAR}` credentials in YAML steps

If anything is missing, report it to the user. Do NOT run `spark-e2e setup` or `npm install`.

## Mode 1: Quick Check (single page)

```bash
spark-e2e navigate "$ARGUMENTS"
spark-e2e scroll --y 0                   # ensure lazy content loaded

# Open-ended review
spark-e2e review --url "$ARGUMENTS"

# Targeted assertions
spark-e2e assert "sidebar highlight matches current page" --url "$ARGUMENTS"
spark-e2e test "cards equal height, all KPIs visible" --url "$ARGUMENTS"

# Free-form inspection
spark-e2e inspect "check gauge labels are readable" --url "$ARGUMENTS"
```

## Mode 2: YAML Runner (multi-step flows)

For login, checkout, multi-page workflows — write a YAML file, then execute:

```yaml
# tests/login.yaml
scenarios:
  - name: login flow
    steps:
      - navigate: https://app.example.com/login
      - wait: 1
      - type: { text: "${TEST_EMAIL}", into: "email field" }
      - type: { text: "${TEST_PASSWORD}", into: "password field" }
      - click: "Sign In button"
      - wait: 2
      - assert: "Dashboard is visible"
```

```bash
spark-e2e run tests/login.yaml
```

**Credentials**: Never hardcode in YAML. Put secrets in `.env` (gitignored) and reference with `${VAR}`.

**Available steps**: `navigate`, `click`, `type`, `hover`, `scroll`, `wait`, `snapshot`, `assert`, `test`

## DOM Verification

Before reporting VLM findings as issues, verify they're real:

```bash
spark-e2e dom-verify --url "$ARGUMENTS"           # full page structure
spark-e2e dom-verify --url "$ARGUMENTS" --save     # save @refs for later lookups
```

Returns `{layout, classPrefixes, cssVars}`. Use selectors from the output to grep component CSS — never guess variable names.

## Common Gotchas

1. **Credentials via `${ENV_VAR}`** — never hardcode passwords/keys in YAML. Create `.env`, reference with `${VAR}`.
2. **VLM hallucinations** — always DOM-verify before reporting. A 10s grep saves false findings.
3. **Inline styles beat CSS** — chart/animation libs set inline styles, `!important` may be needed.
4. **CSS vars in SVG** — resolve differently than in HTML. Check `getComputedStyle()`.
5. **Animation wrappers break grid/flex** — add `height: 100%` to wrapper + inner container.
6. **Narrow assertions** — "two cards equal height" not "page looks perfect".
7. **Scroll before review** — lazy-loaded content may be off-screen. `spark-e2e scroll --y 0` first.

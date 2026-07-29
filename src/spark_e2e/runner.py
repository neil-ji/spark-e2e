"""YAML test runner — runs test scenarios defined in YAML files sequentially.

Usage:
    spark-e2e run                    # runs tests/*.yaml
    spark-e2e run path/to/test.yaml  # runs a single file
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import yaml


# ── Types ──────────────────────────────────────────────────


def _load_yaml(path: str) -> dict[str, Any]:
    with open(path) as f:
        return yaml.safe_load(f)


def _find_test_files(pattern: str | None = None) -> list[str]:
    """Find YAML test files. If pattern is given, use it directly or scan dir."""
    if pattern:
        resolved = os.path.abspath(pattern)
        if os.path.isfile(resolved):
            return [resolved]
        if os.path.isdir(resolved):
            return _scan_dir(resolved)
        print(f"No test files found at: {pattern}")
        return []

    # Default: scan tests/
    tests_dir = os.path.join(os.getcwd(), "tests")
    if not os.path.isdir(tests_dir):
        return []
    return _scan_dir(tests_dir)


def _scan_dir(directory: str) -> list[str]:
    files: list[str] = []
    try:
        for entry in sorted(os.listdir(directory)):
            full = os.path.join(directory, entry)
            if os.path.isdir(full):
                files.extend(_scan_dir(full))
            elif os.path.isfile(full) and os.path.splitext(entry)[1] in (".yaml", ".yml"):
                files.append(full)
    except OSError:
        pass
    return files


# ── Step execution ─────────────────────────────────────────


def _run_steps(
    scenarios: list[dict],
    browser: Any,
    provider: Any,
    cfg: Any,
    base_url: str,
    output_dir: str,
) -> list[dict]:
    """Execute all scenarios and return results."""
    from spark_e2e.vlm.openai_compat import extract_json
    from spark_e2e import prompts as prompts_mod

    scenario_results: list[dict] = []

    for scenario in scenarios:
        name = scenario.get("name", "(unnamed)")
        if not name:
            scenario_results.append({"name": "(unnamed)", "pass": False, "steps": []})
            continue

        print(f"\n  Scenario: {name}")
        step_results: list[dict] = []

        for step in scenario.get("steps", []):
            started = time.time()
            result = _exec_step(step, browser, provider, cfg, base_url, output_dir, extract_json, prompts_mod)
            result["durationMs"] = int((time.time() - started) * 1000)

            icon = "✓" if result["pass"] else "✗"
            detail = str(result.get("detail", ""))[:80]
            print(f"    {icon} {result['type']}: {detail}")
            step_results.append(result)

        all_pass = all(r["pass"] for r in step_results)
        scenario_results.append({"name": name, "pass": all_pass, "steps": step_results})

    return scenario_results


def _exec_step(
    step: dict,
    browser: Any,
    provider: Any,
    cfg: Any,
    base_url: str,
    output_dir: str,
    extract_json: Any,
    prompts_mod: Any,
) -> dict:
    """Execute a single step and return its result dict."""

    def _capture():
        png = browser.capture_screenshot(reload=False)
        return browser.to_data_url(png)

    def _locate(target: str) -> dict:
        data_url = _capture()
        prompt = prompts_mod.get_locate_prompt(target)
        raw = provider.chat(prompt, data_url, None, cfg.vlm.thinking_budget)
        try:
            return extract_json(raw)
        except Exception:
            return {"found": False, "reasoning": "VLM parse error"}

    # ── navigate ──
    if "navigate" in step:
        url = step["navigate"]
        if not url.startswith("http"):
            url = base_url.rstrip("/") + "/" + url.lstrip("/")
        browser.navigate(url)
        return {"step": step, "pass": True, "type": "navigate", "detail": url}

    # ── wait ──
    if "wait" in step:
        browser.wait_for_timeout(int(step["wait"] * 1000))
        return {"step": step, "pass": True, "type": "wait", "detail": f"{step['wait']}s"}

    # ── snapshot ──
    if "snapshot" in step:
        png = browser.capture_screenshot(reload=False)
        os.makedirs(output_dir, exist_ok=True)
        filename = "".join(c if c.isalnum() or c in "_-" else "_" for c in step["snapshot"]) + ".png"
        out_path = os.path.join(output_dir, filename)
        with open(out_path, "wb") as f:
            f.write(png)
        return {"step": step, "pass": True, "type": "snapshot", "detail": out_path}

    # ── click ──
    if "click" in step:
        loc = _locate(step["click"])
        if not loc.get("found"):
            return {"step": step, "pass": False, "type": "click", "detail": f"Not found: {loc.get('reasoning', '?')}"}
        browser.click_at(float(loc["x"]), float(loc["y"]))
        return {"step": step, "pass": True, "type": "click", "detail": f"({loc['x']}, {loc['y']})"}

    # ── type ──
    if "type" in step:
        target = step["type"]["into"]
        text = step["type"]["text"]
        loc = _locate(target)
        if not loc.get("found"):
            return {"step": step, "pass": False, "type": "type", "detail": f"Target not found: {loc.get('reasoning', '?')}"}
        browser.click_at(float(loc["x"]), float(loc["y"]))
        browser.wait_for_timeout(150)
        browser.clear_and_type(text)
        return {"step": step, "pass": True, "type": "type", "detail": f'"{text}" into ({loc["x"]}, {loc["y"]})'}

    # ── hover ──
    if "hover" in step:
        loc = _locate(step["hover"])
        if not loc.get("found"):
            return {"step": step, "pass": False, "type": "hover", "detail": f"Not found: {loc.get('reasoning', '?')}"}
        browser.hover_at(float(loc["x"]), float(loc["y"]))
        return {"step": step, "pass": True, "type": "hover", "detail": f"({loc['x']}, {loc['y']})"}

    # ── test ──
    if "test" in step:
        data_url = _capture()
        prompt = prompts_mod.get_test_prompt(step["test"], cfg.prompts.strictness)
        raw = provider.chat(prompt, data_url, None, cfg.vlm.thinking_budget)
        try:
            result = extract_json(raw)
            passed = result.get("pass") is True
            detail = result.get("summary", "passed" if passed else "failed")
        except Exception:
            passed = False
            detail = str(raw)[:200]
        return {"step": step, "pass": passed, "type": "test", "detail": str(detail)}

    # ── assert ──
    if "assert" in step:
        data_url = _capture()
        prompt_lines = [
            "You are a visual E2E test verifier. Determine whether this assertion is TRUE or FALSE.",
            f"ASSERTION: {step['assert']}",
            "",
            prompts_mod.get_assert_prompt(cfg.prompts.strictness),
            "",
            'Respond ONLY with JSON: {"pass": true|false, "confidence": "high"|"medium"|"low", "observation": "...", "reasoning": "..."}',
        ]
        raw = provider.chat("\n".join(prompt_lines), data_url, None, cfg.vlm.thinking_budget)
        try:
            result = extract_json(raw)
            passed = result.get("pass") is True
            detail = result.get("reasoning", result.get("summary", "passed" if passed else "failed"))
        except Exception:
            passed = False
            detail = str(raw)[:200]
        return {"step": step, "pass": passed, "type": "assert", "detail": str(detail)}

    return {"step": step, "pass": False, "type": "unknown", "detail": "Unknown step type"}


# ── Public API ─────────────────────────────────────────────


def run_tests(pattern: str | None = None) -> list[dict]:
    """Run YAML test files and return a list of file reports."""
    from spark_e2e.config import load
    from spark_e2e.browser import get_backend
    from spark_e2e.vlm import get_provider

    files = _find_test_files(pattern)

    if not files:
        print("No test files found. Create tests/*.yaml files or specify a path.")
        print("Example: spark-e2e run tests/login.test.yaml")
        return []

    reports: list[dict] = []
    for filepath in files:
        print(f"\n📄 {filepath}")
        try:
            suite = _load_yaml(filepath)
            scenarios = suite.get("scenarios", [])
            if not isinstance(scenarios, list) or not scenarios:
                print("  ✗ ERROR: no 'scenarios' list found")
                reports.append({"file": filepath, "pass": False, "scenarios": [], "durationMs": 0})
                continue

            cfg = load()
            backend = get_backend(cfg.browser.backend)
            provider = get_provider(cfg.vlm.provider)
            base_url = suite.get("config", {}).get("url", cfg.browser.url)

            # Apply viewport if specified in YAML
            vp = suite.get("config", {}).get("viewport", {})
            if vp.get("width") and vp.get("height"):
                backend._ensure_browser()
                backend._page.set_viewport_size({"width": vp["width"], "height": vp["height"]})

            basename = os.path.splitext(os.path.basename(filepath))[0]
            output_dir = os.path.join(os.getcwd(), ".spark-e2e", "runs", basename)

            started = time.time()
            scenario_results = _run_steps(scenarios, backend, provider, cfg, base_url, output_dir)
            duration_ms = int((time.time() - started) * 1000)

            all_pass = all(s["pass"] for s in scenario_results)
            status = "✓ PASS" if all_pass else "✗ FAIL"
            print(f"  {status} ({duration_ms / 1000:.1f}s)")

            reports.append({
                "file": filepath,
                "pass": all_pass,
                "scenarios": scenario_results,
                "durationMs": duration_ms,
            })

            backend.close()

        except Exception as e:
            print(f"  ✗ ERROR: {e}")
            reports.append({"file": filepath, "pass": False, "scenarios": [], "durationMs": 0})

    return reports

"""CLI entry point for spark-e2e.

Commands:
    setup      Interactive configuration wizard (TS CLI only — run `spark-e2e setup`)
    navigate   Load a URL in the browser
    snapshot   Capture a browser screenshot
    inspect    Free-form VLM screenshot analysis
    assert     Run a visual assertion (pass/fail)
    compare    Compare page against expected state
    test       Natural language E2E test (navigate → review → assert in one call)
    baseline   Visual regression baselines (save, compare, list, delete)
    review     Comprehensive visual UI audit
    dom-verify Batch DOM structure + CSS discovery
    doctor     Diagnose the environment
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def cmd_doctor(args: argparse.Namespace) -> None:
    """Diagnose the environment."""
    print("spark-e2e doctor — Environment Diagnostic")
    print("=" * 50)

    # 1. Check Python version
    py_ver = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    print(f"✓ Python {py_ver}" if sys.version_info >= (3, 12) else f"✗ Python {py_ver} (need ≥3.12)")

    # 2. Check config
    from spark_e2e.config import load, _find_config_file
    print()
    print("─ Configuration ─")
    cfg_path = _find_config_file()
    if cfg_path:
        print(f"✓ Config file: {cfg_path}")
    else:
        print("⚠ No config file found (using defaults + env vars)")

    try:
        cfg = load()
        print(f"  Backend: {cfg.browser.backend}")
        print(f"  URL: {cfg.browser.url}")
        print(f"  VLM provider: {cfg.vlm.provider}")
        print(f"  VLM model: {cfg.vlm.model}")
        has_key = bool(cfg.vlm.api_key)
        print(f"  API key: {'***' if has_key else '(not set)'}")
    except Exception as e:
        print(f"✗ Config error: {e}")

    # 3. Check browser backend
    print()
    print("─ Browser Backend ─")
    from spark_e2e.browser import list_backends, get_backend
    backends = list_backends()
    if not backends:
        print("✗ No browser backends registered")
    else:
        print(f"✓ Registered backends: {', '.join(backends)}")

    # Check browser-harness
    import subprocess
    result = subprocess.run(["browser-harness", "--version"], capture_output=True, text=True)
    if result.returncode == 0:
        print(f"✓ browser-harness: {result.stdout.strip()}")
    else:
        print("⚠ browser-harness not found on PATH (install: brew install browser-use/tap/browser-harness)")

    # 4. Check Playwright (optional)
    print()
    print("─ Playwright (optional) ─")
    try:
        import playwright  # noqa: F401
        print("✓ playwright Python package installed")
    except ImportError:
        print("⚠ playwright not installed (pip install spark-e2e[playwright])")

    # 5. Check VLM connectivity (skip by default — requires API key)
    print()
    if not args.quick:
        print("─ VLM Connectivity ─")
        if cfg.vlm.api_key:
            print("  API key is set. Run with --quick to skip connectivity test.")
            print("  To test: spark-e2e snapshot (requires browser-harness running)")
        else:
            print("  ⚠ Set SPARK_E2E_API_KEY to enable VLM features")
    print()
    print("Done.")


def cmd_scroll(args: argparse.Namespace) -> None:
    """Scroll the page via CLI."""
    import json as _json

    from spark_e2e.browser import get_backend
    from spark_e2e.config import load

    cfg = load()
    backend = get_backend(cfg.browser.backend)

    info = backend.scroll(x=args.x, y=args.y, selector=args.selector)
    print(_json.dumps(info, ensure_ascii=False, indent=2))


def cmd_snapshot(args: argparse.Namespace) -> None:
    """Capture a screenshot via CLI."""
    from spark_e2e.browser import get_backend
    from spark_e2e.config import load

    cfg = load()
    url = args.url or cfg.browser.url
    backend = get_backend(cfg.browser.backend)

    print(f"Navigating to {url} ...")
    backend.navigate(url)

    viewport = None
    if args.width and args.height:
        viewport = {"width": args.width, "height": args.height, "deviceScaleFactor": 1}

    print("Capturing screenshot ...")
    png = backend.capture_screenshot(
        viewport=viewport, reload=args.reload, delay=args.delay,
        full_page=args.full_page or False,
    )

    output = args.output or "/tmp/spark-e2e-snapshot.png"
    Path(output).write_bytes(png)
    print(f"Saved to {output} ({len(png)} bytes)")


def cmd_assert(args: argparse.Namespace) -> None:
    """Run a visual assertion via CLI."""
    import json as _json

    from spark_e2e.vlm import get_provider
    from spark_e2e.browser import get_backend
    from spark_e2e.config import load

    cfg = load()
    backend = get_backend(cfg.browser.backend)
    provider = get_provider(cfg.vlm.provider)

    url = args.url or cfg.browser.url
    print(f"Navigating to {url} ...")
    backend.navigate(url)

    viewport = None
    if args.width and args.height:
        viewport = {"width": args.width, "height": args.height, "deviceScaleFactor": 1}

    png = backend.capture_screenshot(viewport=viewport, reload=args.reload, delay=args.delay)
    data_url = backend.to_data_url(png)

    from spark_e2e import prompts as prompts_mod
    prompt = (
        "You are a visual E2E test verifier.\n"
        f"ASSERTION: {args.assertion}\n\n"
        + prompts_mod.get_assert_prompt() + "\n\n"
        'Respond ONLY JSON: {"pass": true|false, "confidence": "high"|"medium"|"low", '
        '"observation": "...", "reasoning": "..."}'
    )

    print("Asking VLM ...")
    raw = provider.chat(prompt, data_url, args.model, cfg.vlm.thinking_budget)
    try:
        from spark_e2e.vlm.openai_compat import extract_json
        result = extract_json(raw)
        print(_json.dumps(result, ensure_ascii=False, indent=2))
    except Exception:
        print(raw)

    backend.close()


def cmd_review(args: argparse.Namespace) -> None:
    """Run a visual review via CLI."""
    import json as _json

    from spark_e2e.vlm import get_provider
    from spark_e2e.browser import get_backend
    from spark_e2e.config import load

    cfg = load()
    backend = get_backend(cfg.browser.backend)
    provider = get_provider(cfg.vlm.provider)

    url = args.url or cfg.browser.url
    print(f"Navigating to {url} ...")
    backend.navigate(url)

    viewport = None
    if args.width and args.height:
        viewport = {"width": args.width, "height": args.height, "deviceScaleFactor": 1}

    png = backend.capture_screenshot(viewport=viewport, reload=args.reload, delay=args.delay)
    data_url = backend.to_data_url(png)

    from spark_e2e import prompts as prompts_mod
    from spark_e2e.config import get_aesthetics

    focus_map = {
        "comprehensive": "Review ALL aspects: layout, alignment, spacing, color consistency, typography, text truncation, visual artifacts, rendering defects.",
        "layout": "Focus on layout: card heights, grid alignment, spacing between elements, uneven gaps, overlapping content.",
        "typography": "Focus on typography: text truncation, contrast issues, font size inconsistencies, overlapping text, cut-off labels.",
        "charts": "Focus on charts/data viz: gauge arc colors, donut label clipping, axis/legend artifacts, label positioning, number formatting.",
        "interactive": "Focus on interactive elements: button states, hover feedback, menu highlighting, tooltip visibility.",
    }

    aesthetics_prompt = prompts_mod.get_aesthetics_prompt(get_aesthetics())
    prompt = (
        "You are a senior UI quality reviewer.\n"
        f"FOCUS: {focus_map.get(args.focus, focus_map['comprehensive'])}\n\n"
        + prompts_mod.get_review_prompt() + "\n"
        + aesthetics_prompt + "\n\n"
        'Respond ONLY JSON: {"findings": [...], "summary": "...", "no_issues_found": false}'
    )

    print(f"Reviewing (focus={args.focus}) ...")
    raw = provider.chat(prompt, data_url, args.model, cfg.vlm.thinking_budget)
    try:
        from spark_e2e.vlm.openai_compat import extract_json
        result = extract_json(raw)
        print(_json.dumps(result, ensure_ascii=False, indent=2))
    except Exception:
        print(raw)

    # Save report if requested
    if args.output:
        Path(args.output).write_text(raw, encoding="utf-8")
        print(f"Report saved to {args.output}")

    backend.close()


def cmd_test(args: argparse.Namespace) -> None:
    """Run a natural language E2E test via CLI."""
    import json as _json

    from spark_e2e.vlm import get_provider
    from spark_e2e.browser import get_backend
    from spark_e2e.config import load

    cfg = load()
    backend = get_backend(cfg.browser.backend)
    provider = get_provider(cfg.vlm.provider)

    url = args.url or cfg.browser.url
    print(f"Navigating to {url} ...")
    backend.navigate(url)

    viewport = None
    if args.width and args.height:
        viewport = {"width": args.width, "height": args.height, "deviceScaleFactor": 1}

    png = backend.capture_screenshot(viewport=viewport, reload=args.reload, delay=args.delay)
    data_url = backend.to_data_url(png)

    expectations_text = args.expectations
    print(f"Testing: {expectations_text[:80]}{'...' if len(expectations_text) > 80 else ''}")

    from spark_e2e import prompts as prompts_mod
    prompt = prompts_mod.get_test_prompt(expectations_text)

    print("Asking VLM ...")
    raw = provider.chat(prompt, data_url, args.model, cfg.vlm.thinking_budget)
    try:
        from spark_e2e.vlm.openai_compat import extract_json
        result = extract_json(raw)
        print(_json.dumps(result, ensure_ascii=False, indent=2))
    except Exception:
        print(raw)

    backend.close()


def cmd_baseline_save(args: argparse.Namespace) -> None:
    """Save current page as a named baseline."""
    import json as _json

    from spark_e2e.config import load
    from spark_e2e.browser import get_backend
    from spark_e2e.baselines import save_baseline

    cfg = load()
    backend = get_backend(cfg.browser.backend)
    url = args.url or cfg.browser.url
    print(f"Navigating to {url} ...")
    backend.navigate(url)

    viewport = cfg.viewport
    vp = {
        "width": args.width if args.width else viewport.width,
        "height": args.height if args.height else viewport.height,
        "deviceScaleFactor": 1,
    }

    png = backend.capture_screenshot(viewport=vp, reload=True, delay=0.3)
    d = save_baseline(args.name, png, url, vp, model=cfg.vlm.model)
    print(_json.dumps({"saved": args.name, "path": d}, indent=2))
    backend.close()


def cmd_baseline_compare(args: argparse.Namespace) -> None:
    """Compare current page against a saved baseline."""
    import base64
    import json as _json

    from spark_e2e.config import load
    from spark_e2e.browser import get_backend
    from spark_e2e.vlm import get_provider
    from spark_e2e.baselines import load_baseline, read_baseline_screenshot

    cfg = load()
    entry = load_baseline(args.name)
    if entry is None:
        print(f'Baseline "{args.name}" not found. Use `spark-e2e baseline list` to see available baselines.')
        raise SystemExit(1)

    meta, _ = entry
    backend = get_backend(cfg.browser.backend)
    provider = get_provider(cfg.vlm.provider)

    url = args.url or meta.url
    print(f"Navigating to {url} ...")
    backend.navigate(url)

    vp = {
        "width": args.width if args.width else meta.viewport["width"],
        "height": args.height if args.height else meta.viewport["height"],
        "deviceScaleFactor": 1,
    }

    current_png = backend.capture_screenshot(viewport=vp, reload=True, delay=0.3)

    baseline_png = read_baseline_screenshot(args.name)
    if baseline_png is None:
        print(f'Baseline "{args.name}" screenshot missing. Re-save it.')
        raise SystemExit(1)

    baseline_data_url = "data:image/png;base64," + base64.b64encode(baseline_png).decode()
    current_data_url = "data:image/png;base64," + base64.b64encode(current_png).decode()

    print(f'Comparing against baseline "{args.name}" ({meta.timestamp}) ...')

    from spark_e2e import prompts as prompts_mod
    prompt = prompts_mod.get_baseline_compare_prompt(args.name)

    print("Asking VLM ...")
    raw = provider.chat(prompt, [baseline_data_url, current_data_url], args.model, cfg.vlm.thinking_budget)
    try:
        from spark_e2e.vlm.openai_compat import extract_json
        result = extract_json(raw)
        print(_json.dumps(result, ensure_ascii=False, indent=2))
    except Exception:
        print(raw)

    backend.close()


def cmd_baseline_list(args: argparse.Namespace) -> None:
    """List saved baselines."""
    import json as _json

    from spark_e2e.baselines import list_baselines

    baselines = list_baselines()
    if not baselines:
        print("No baselines saved yet. Use `spark-e2e baseline save --name <name>` to create one.")
        return

    print(_json.dumps(
        [
            {
                "name": b.name,
                "url": b.url,
                "viewport": f"{b.viewport['width']}x{b.viewport['height']}",
                "timestamp": b.timestamp,
                "model": b.model,
            }
            for b in baselines
        ],
        indent=2,
    ))


def cmd_baseline_delete(args: argparse.Namespace) -> None:
    """Delete a saved baseline."""
    from spark_e2e.baselines import delete_baseline

    ok = delete_baseline(args.name)
    if ok:
        print(f'Deleted baseline "{args.name}".')
    else:
        print(f'Baseline "{args.name}" not found.')
        raise SystemExit(1)


# ── CLI definition ──────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="spark-e2e",
        description="VLM-powered visual E2E testing CLI",
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # doctor
    p_doctor = subparsers.add_parser("doctor", help="Diagnose environment")
    p_doctor.add_argument("--quick", action="store_true", help="Skip connectivity tests")
    p_doctor.set_defaults(func=cmd_doctor)

    # snapshot
    p_snap = subparsers.add_parser("snapshot", help="Capture a screenshot")
    p_snap.add_argument("--url", help="Target URL")
    p_snap.add_argument("--output", "-o", help="Output file path")
    p_snap.add_argument("--width", type=int, help="Viewport width")
    p_snap.add_argument("--height", type=int, help="Viewport height")
    p_snap.add_argument("--reload", action="store_true", default=True, help="Reload page before capture")
    p_snap.add_argument("--delay", type=float, default=0.3, help="Delay after reload (seconds)")
    p_snap.add_argument("--full-page", action="store_true", help="Capture the entire scrollable page")
    p_snap.set_defaults(func=cmd_snapshot)

    # scroll
    p_scroll = subparsers.add_parser("scroll", help="Scroll the page")
    p_scroll.add_argument("--x", type=int, help="Horizontal scroll position (px)")
    p_scroll.add_argument("--y", type=int, help="Vertical scroll position (px)")
    p_scroll.add_argument("--selector", help="CSS selector to scroll into view")
    p_scroll.set_defaults(func=cmd_scroll)

    # assert
    p_assert = subparsers.add_parser("assert", help="Run a visual assertion")
    p_assert.add_argument("assertion", help="The assertion to verify")
    p_assert.add_argument("--url", help="Target URL")
    p_assert.add_argument("--model", help="VLM model override")
    p_assert.add_argument("--width", type=int, help="Viewport width")
    p_assert.add_argument("--height", type=int, help="Viewport height")
    p_assert.add_argument("--reload", action="store_true", default=True, help="Reload before capture")
    p_assert.add_argument("--delay", type=float, default=0.3, help="Delay after reload")
    p_assert.set_defaults(func=cmd_assert)

    # review
    p_review = subparsers.add_parser("review", help="Run a visual review")
    p_review.add_argument("--url", help="Target URL")
    p_review.add_argument("--focus", default="comprehensive",
                          choices=["comprehensive", "layout", "typography", "charts", "interactive"])
    p_review.add_argument("--model", help="VLM model override")
    p_review.add_argument("--output", "-o", help="Save report to file")
    p_review.add_argument("--width", type=int, help="Viewport width")
    p_review.add_argument("--height", type=int, help="Viewport height")
    p_review.add_argument("--reload", action="store_true", default=True, help="Reload before capture")
    p_review.add_argument("--delay", type=float, default=0.3, help="Delay after reload")
    p_review.set_defaults(func=cmd_review)

    # test
    p_test = subparsers.add_parser("test", help="Natural language E2E test (navigate → review → assert in one call)")
    p_test.add_argument("expectations", help="What you expect to see (natural language)")
    p_test.add_argument("--url", help="Target URL")
    p_test.add_argument("--model", help="VLM model override")
    p_test.add_argument("--width", type=int, help="Viewport width")
    p_test.add_argument("--height", type=int, help="Viewport height")
    p_test.add_argument("--reload", action="store_true", default=True, help="Reload before capture")
    p_test.add_argument("--delay", type=float, default=0.3, help="Delay after reload")
    p_test.set_defaults(func=cmd_test)

    # baseline
    p_baseline = subparsers.add_parser("baseline", help="Visual regression baselines")
    baseline_subs = p_baseline.add_subparsers(dest="baseline_cmd")

    p_bl_save = baseline_subs.add_parser("save", help="Save current page as a named baseline")
    p_bl_save.add_argument("--name", required=True, help="Baseline name (e.g. 'dashboard-v1')")
    p_bl_save.add_argument("--url", help="Target URL")
    p_bl_save.add_argument("--width", type=int, help="Viewport width")
    p_bl_save.add_argument("--height", type=int, help="Viewport height")
    p_bl_save.set_defaults(func=cmd_baseline_save)

    p_bl_compare = baseline_subs.add_parser("compare", help="Compare current page against a baseline")
    p_bl_compare.add_argument("--name", required=True, help="Baseline name to compare against")
    p_bl_compare.add_argument("--url", help="Target URL")
    p_bl_compare.add_argument("--model", help="VLM model override")
    p_bl_compare.add_argument("--width", type=int, help="Viewport width")
    p_bl_compare.add_argument("--height", type=int, help="Viewport height")
    p_bl_compare.set_defaults(func=cmd_baseline_compare)

    p_bl_list = baseline_subs.add_parser("list", help="List all saved baselines")
    p_bl_list.set_defaults(func=cmd_baseline_list)

    p_bl_delete = baseline_subs.add_parser("delete", help="Delete a saved baseline")
    p_bl_delete.add_argument("--name", required=True, help="Baseline name to delete")
    p_bl_delete.set_defaults(func=cmd_baseline_delete)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)

    args.func(args)

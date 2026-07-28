"""CLI entry point for spark-e2e.

Commands:
    init       Copy skills to .claude/skills/
    navigate   Load a URL in the browser
    snapshot   Capture a browser screenshot
    inspect    Free-form VLM screenshot analysis
    assert     Run a visual assertion (pass/fail)
    compare    Compare page against expected state
    review     Comprehensive visual UI audit
    dom-verify Batch DOM structure + CSS discovery
    doctor     Diagnose the environment
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

AGENTS = [
    {"name": "claude", "label": "Claude Code", "dir": ".claude/skills", "detect_dirs": [".claude"]},
    {"name": "codex", "label": "OpenAI Codex", "dir": ".agents/skills", "detect_dirs": [".agents", ".codex"]},
    {"name": "qoder", "label": "Qoder", "dir": ".qoder/skills", "detect_dirs": [".qoder"]},
    {"name": "trae", "label": "Trae", "dir": ".trae/skills", "detect_dirs": [".trae", ".traecli"]},
    {"name": "spark-hub", "label": "Spark Hub", "dir": ".spark/config/custom-skills", "detect_dirs": [".spark"], "home_dir_only": True},
]


def cmd_init(args: argparse.Namespace) -> None:
    """Copy spark-e2e skills into an AI coding agent's skills directory."""
    import shutil

    home = Path.home()
    cwd = Path.cwd()
    is_user = getattr(args, "scope", "project") == "user"

    # Find skills source — check multiple locations
    skills_src = None
    candidates = [
        # 1. Repo layout (editable install or clone): skills/ next to src/
        Path(__file__).resolve().parent.parent.parent / "skills",
        # 2. Installed package data (wheel install)
        Path(__file__).resolve().parent / "_skills",
        # 3. CWD (user running from repo root)
        cwd / "skills",
    ]
    for candidate in candidates:
        if candidate.is_dir():
            skills_src = candidate
            break

    if skills_src is None:
        print("ERROR: Cannot find spark-e2e skills source.")
        print("Install with: pip install spark-e2e")
        print("Or clone the repo and run from the project root.")
        print("Or use the plugin marketplace:")
        print("  /plugin marketplace add neilji/spark-e2e")
        print("  /plugin install spark-e2e-skills@spark-e2e")
        sys.exit(1)

    # Determine targets — same logic as the TypeScript CLI
    targets: list[dict] = []

    if args.dir:
        targets.append({"label": "custom", "dir": Path(args.dir)})
    elif getattr(args, "all", False):
        for a in AGENTS:
            home_only = a.get("home_dir_only", False)
            base = home / a["dir"] if (is_user or home_only) else cwd / a["dir"]
            targets.append({"label": a["label"], "dir": base})
    elif args.agent:
        a = next((x for x in AGENTS if x["name"] == args.agent), None)
        if a is None:
            print(f"Unknown agent: {args.agent}. Supported: {', '.join(x['name'] for x in AGENTS)}")
            sys.exit(1)
        home_only = a.get("home_dir_only", False)
        base = home / a["dir"] if (is_user or home_only) else cwd / a["dir"]
        targets.append({"label": a["label"], "dir": base})
    else:
        # Auto-detect: check which agent dirs exist in the project
        detected = [
            a for a in AGENTS
            if any((cwd / d).is_dir() for d in a.get("detect_dirs", []))
        ]
        if detected:
            for a in detected:
                home_only = a.get("home_dir_only", False)
                base = home / a["dir"] if (is_user or home_only) else cwd / a["dir"]
                targets.append({"label": a["label"], "dir": base})
        else:
            # Default: Claude Code
            base = (home / ".claude/skills") if is_user else (cwd / ".claude/skills")
            targets.append({"label": "Claude Code (default)", "dir": base})

    # Collect skill names
    skill_names = sorted(
        e.name for e in skills_src.iterdir()
        if e.is_dir() and (e / "SKILL.md").exists()
    )

    if not skill_names:
        print("No skills found in source directory.")
        sys.exit(1)

    # Install
    print(f"spark-e2e init")
    print(f"Source: {skills_src}")
    if is_user:
        print("Scope: user (installing to home directory)")

    for t in targets:
        print(f"── {t['label']} ──")
        print(f"   {t['dir']}/")
        t["dir"].mkdir(parents=True, exist_ok=True)
        for name in skill_names:
            src = skills_src / name
            dest = t["dir"] / name
            if dest.exists():
                shutil.rmtree(str(dest))
            shutil.copytree(str(src), str(dest))
            print(f"   ✓ {name}")
        print()

    scope_label = "globally (all projects)" if is_user else f"in {cwd}"
    print(f"Done. {len(skill_names)} skills installed {scope_label}.")
    print()
    print("Skills available as slash commands:")
    for name in skill_names:
        print(f"  /{name}")


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


# ── CLI definition ──────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="spark-e2e",
        description="VLM-powered visual E2E testing CLI",
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # init
    p_init = subparsers.add_parser("init", help="Set up spark-e2e skills for AI coding agents")
    p_init.add_argument("--agent", help=f"Target a specific agent: {', '.join(a['name'] for a in AGENTS)}")
    p_init.add_argument("--all", action="store_true", help="Install for all supported agents")
    p_init.add_argument("--scope", choices=["project", "user"], default="project",
                        help="Install scope: project (default) or user")
    p_init.add_argument("--dir", help="Custom target directory (overrides agent detection)")
    p_init.set_defaults(func=cmd_init)

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

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)

    args.func(args)

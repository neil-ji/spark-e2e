"""Baseline storage — reference screenshots for visual regression comparison.

Storage layout:
  .spark-e2e/baselines/<name>/
    screenshot.png   — reference screenshot
    meta.json        — { name, url, viewport, timestamp, model, findings? }
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


# ── Types ──────────────────────────────────────────────────


@dataclass
class BaselineMeta:
    name: str
    url: str
    viewport: dict  # {width, height, deviceScaleFactor}
    timestamp: str  # ISO 8601
    model: str | None = None
    findings: dict[str, Any] | None = None


# ── Paths ──────────────────────────────────────────────────


def _baselines_dir() -> str:
    d = os.path.join(os.getcwd(), ".spark-e2e", "baselines")
    os.makedirs(d, exist_ok=True)
    return d


def _baseline_path(name: str) -> str:
    return os.path.join(_baselines_dir(), name)


# ── CRUD ───────────────────────────────────────────────────


def save_baseline(
    name: str,
    screenshot: bytes,
    url: str,
    viewport: dict,
    model: str | None = None,
    findings: dict[str, Any] | None = None,
) -> str:
    """Save a baseline screenshot and metadata. Returns the directory path."""
    d = _baseline_path(name)
    os.makedirs(d, exist_ok=True)

    with open(os.path.join(d, "screenshot.png"), "wb") as f:
        f.write(screenshot)

    meta = BaselineMeta(
        name=name,
        url=url,
        viewport=viewport,
        timestamp=datetime.now(timezone.utc).isoformat(),
        model=model,
        findings=findings,
    )
    with open(os.path.join(d, "meta.json"), "w") as f:
        json.dump(meta.__dict__, f, indent=2, default=str)

    return d


def load_baseline(name: str) -> tuple[BaselineMeta, str] | None:
    """Load a baseline by name. Returns (meta, screenshot_path) or None."""
    d = _baseline_path(name)
    ss_path = os.path.join(d, "screenshot.png")
    meta_path = os.path.join(d, "meta.json")
    if not os.path.exists(ss_path) or not os.path.exists(meta_path):
        return None

    with open(meta_path) as f:
        data = json.load(f)
    meta = BaselineMeta(**data)
    return meta, ss_path


def list_baselines() -> list[BaselineMeta]:
    """List all saved baselines, newest first."""
    root = _baselines_dir()
    entries: list[BaselineMeta] = []
    if not os.path.exists(root):
        return entries

    for name in sorted(os.listdir(root)):
        meta_path = os.path.join(root, name, "meta.json")
        if os.path.isfile(meta_path):
            try:
                with open(meta_path) as f:
                    data = json.load(f)
                entries.append(BaselineMeta(**data))
            except (json.JSONDecodeError, TypeError):
                pass

    entries.sort(key=lambda m: m.timestamp, reverse=True)
    return entries


def delete_baseline(name: str) -> bool:
    """Delete a baseline. Returns True if it existed."""
    import shutil

    d = _baseline_path(name)
    if not os.path.exists(d):
        return False
    shutil.rmtree(d)
    return True


def read_baseline_screenshot(name: str) -> bytes | None:
    """Read the screenshot file for a baseline."""
    ss_path = os.path.join(_baseline_path(name), "screenshot.png")
    if not os.path.exists(ss_path):
        return None
    with open(ss_path, "rb") as f:
        return f.read()

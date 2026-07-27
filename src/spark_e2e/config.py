"""Configuration system — YAML file + env vars + defaults.

Priority (highest first):
1. CLI arguments (passed directly to functions)
2. Environment variables (``SPARK_E2E_*`` prefix)
3. Config file (``.spark-e2e.yaml`` in cwd)
4. Legacy env vars (``VLM_*`` — backward compat)
5. Hardcoded defaults
"""

from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


def _log(msg: str) -> None:
    print(f"[spark-e2e] {msg}", file=sys.stderr, flush=True)


# ── Config data class ───────────────────────────────────────────────


@dataclass
class BrowserConfig:
    backend: str = "browser-harness"
    url: str = "http://localhost:5173"


@dataclass
class ViewportConfig:
    width: int = 1600
    height: int = 1200
    deviceScaleFactor: int = 1


@dataclass
class VLMConfig:
    api_key: str = ""
    base_url: str = ""
    model: str = "gpt-4o"
    provider: str = "openai-compat"


@dataclass
class SelectorsConfig:
    card: str = '[class*="card"]'
    progress_fill: str = '[class*="progress"][class*="fill"]'
    active_nav: str = '[aria-current="page"]'
    sidebar_item: str = '[class*="sidebar"] [class*="item"], [class*="menu"] [class*="item"]'


@dataclass
class PromptsConfig:
    strictness: str = "standard"


@dataclass
class Config:
    browser: BrowserConfig = field(default_factory=BrowserConfig)
    viewport: ViewportConfig = field(default_factory=ViewportConfig)
    vlm: VLMConfig = field(default_factory=VLMConfig)
    selectors: SelectorsConfig = field(default_factory=SelectorsConfig)
    css_variables: list[str] = field(default_factory=list)
    prompts: PromptsConfig = field(default_factory=PromptsConfig)


# ── Config loading ──────────────────────────────────────────────────

_VAR_INTERPOLATION = re.compile(r"\$\{(\w+)\}")


def _interpolate_env_vars(value: str) -> str:
    """Replace ``${VAR}`` patterns with environment variable values."""

    def _replace(match: re.Match) -> str:
        var_name = match.group(1)
        return os.environ.get(var_name, match.group(0))

    return _VAR_INTERPOLATION.sub(_replace, value)


def _interpolate_dict(data: dict) -> dict:
    """Recursively interpolate env vars in string values."""
    result: dict = {}
    for key, value in data.items():
        if isinstance(value, str):
            result[key] = _interpolate_env_vars(value)
        elif isinstance(value, dict):
            result[key] = _interpolate_dict(value)
        elif isinstance(value, list):
            result[key] = [
                _interpolate_env_vars(v) if isinstance(v, str) else v for v in value
            ]
        else:
            result[key] = value
    return result


def _find_config_file() -> Path | None:
    """Locate the config file.

    Checks:
    1. ``SPARK_E2E_CONFIG`` env var
    2. ``.spark-e2e.yaml`` in cwd
    3. ``.spark-e2e.yml`` in cwd
    """
    env_path = os.environ.get("SPARK_E2E_CONFIG", "")
    if env_path:
        p = Path(env_path)
        if p.is_file():
            return p

    for name in (".spark-e2e.yaml", ".spark-e2e.yml", "spark-e2e.yaml", "spark-e2e.yml"):
        p = Path(name)
        if p.is_file():
            return p

    return None


def _load_yaml_config(path: Path) -> dict[str, Any]:
    """Load and parse a YAML config file."""
    try:
        import yaml
    except ImportError:
        raise ImportError(
            "PyYAML is required to read config files. "
            "Install it with: pip install pyyaml"
        )

    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)

    if not isinstance(data, dict):
        raise ValueError(f"Config file {path} must be a YAML mapping, got {type(data).__name__}")

    return _interpolate_dict(data)


def _apply_yaml_to_config(config: Config, data: dict[str, Any]) -> None:
    """Merge YAML data into a Config dataclass."""
    if "browser" in data:
        b = data["browser"]
        if isinstance(b, dict):
            if "backend" in b:
                config.browser.backend = str(b["backend"])
            if "url" in b:
                config.browser.url = str(b["url"])

    if "viewport" in data:
        v = data["viewport"]
        if isinstance(v, dict):
            if "width" in v:
                config.viewport.width = int(v["width"])
            if "height" in v:
                config.viewport.height = int(v["height"])
            if "deviceScaleFactor" in v:
                config.viewport.deviceScaleFactor = int(v["deviceScaleFactor"])

    if "vlm" in data:
        v = data["vlm"]
        if isinstance(v, dict):
            if "api_key" in v:
                config.vlm.api_key = str(v["api_key"])
            if "base_url" in v:
                config.vlm.base_url = str(v["base_url"])
            if "model" in v:
                config.vlm.model = str(v["model"])
            if "provider" in v:
                config.vlm.provider = str(v["provider"])

    if "selectors" in data:
        s = data["selectors"]
        if isinstance(s, dict):
            for key in ("card", "progress_fill", "active_nav", "sidebar_item"):
                if key in s:
                    setattr(config.selectors, key, str(s[key]))

    if "css_variables" in data:
        cv = data["css_variables"]
        if isinstance(cv, list):
            config.css_variables = [str(v) for v in cv]

    if "prompts" in data:
        p = data["prompts"]
        if isinstance(p, dict) and "strictness" in p:
            config.prompts.strictness = str(p["strictness"])


def _apply_env_vars(config: Config) -> None:
    """Apply SPARK_E2E_* env vars on top of config."""
    for env_name, attr_path in [
        ("SPARK_E2E_BACKEND", ("browser", "backend")),
        ("SPARK_E2E_URL", ("browser", "url")),
        ("SPARK_E2E_API_KEY", ("vlm", "api_key")),
        ("SPARK_E2E_BASE_URL", ("vlm", "base_url")),
        ("SPARK_E2E_MODEL", ("vlm", "model")),
        ("SPARK_E2E_VLM_PROVIDER", ("vlm", "provider")),
    ]:
        val = os.environ.get(env_name, "")
        if val:
            obj, attr = attr_path
            target = getattr(config, obj)
            setattr(target, attr, val)


def _apply_legacy_env_vars(config: Config) -> None:
    """Apply legacy VLM_* env vars as fallback (backward compat)."""
    if not config.vlm.api_key:
        config.vlm.api_key = os.environ.get("VLM_API_KEY", "")
    if not config.vlm.base_url:
        config.vlm.base_url = os.environ.get("VLM_BASE_URL", "")
    if config.vlm.model == "gpt-4o":
        legacy_model = os.environ.get("VLM_MODEL", "")
        if legacy_model:
            config.vlm.model = legacy_model


def _load_dotenv() -> None:
    """Load .env file if present in cwd or via SPARK_E2E_ENV."""
    env_file = os.environ.get("SPARK_E2E_ENV", ".env")
    env_path = Path(env_file)
    if not env_path.is_file():
        return

    try:
        from dotenv import load_dotenv
        load_dotenv(env_path, override=False)
    except ImportError:
        # Manual fallback parser
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key, val = key.strip(), val.strip().strip('"').strip("'")
                if key not in os.environ:
                    os.environ[key] = val


# ── Public API ──────────────────────────────────────────────────────

_config: Config | None = None


def load(config_path: str | Path | None = None) -> Config:
    """Load configuration from all sources.

    Args:
        config_path: Optional explicit path to a config YAML file.
                     Overrides auto-discovery.

    Returns:
        A fully resolved ``Config`` instance.
    """
    global _config

    # 1. Start with defaults
    config = Config()

    # 2. Load .env first (so env vars are available for interpolation)
    _load_dotenv()

    # 3. YAML config file
    if config_path:
        path = Path(config_path)
        if not path.is_file():
            raise FileNotFoundError(f"Config file not found: {path}")
    else:
        path = _find_config_file()

    if path:
        _log(f"Loading config from {path}")
        data = _load_yaml_config(path)
        _apply_yaml_to_config(config, data)

    # 4. SPARK_E2E_* env vars
    _apply_env_vars(config)

    # 5. Legacy VLM_* env vars (fallback)
    _apply_legacy_env_vars(config)

    # Validate
    if not config.vlm.api_key:
        _log("WARNING: No VLM API key configured. Set SPARK_E2E_API_KEY or VLM_API_KEY.")

    _config = config
    return config


def get_config() -> Config:
    """Return the cached config, loading it if not already loaded."""
    global _config
    if _config is None:
        _config = load()
    return _config


def get_vlm_env() -> tuple[str, str]:
    """Return (api_key, base_url) from the current config."""
    c = get_config()
    return c.vlm.api_key, c.vlm.base_url


def get_vlm_model(default: str = "gpt-4o") -> str:
    """Return the VLM model name from config, falling back to *default*."""
    c = get_config()
    return c.vlm.model or default

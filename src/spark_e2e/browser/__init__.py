"""Browser backend registry and factory."""

from __future__ import annotations

from .base import BrowserBackend

__all__ = ["BrowserBackend", "get_backend", "register_backend", "list_backends"]


_backends: dict[str, type[BrowserBackend]] = {}


def register_backend(name: str, cls: type[BrowserBackend]) -> None:
    """Register a browser backend implementation.

    Args:
        name: Short identifier for the backend (e.g. ``"playwright"``).
        cls: A ``BrowserBackend`` subclass.

    Example:
        >>> from spark_e2e.browser import register_backend
        >>> from my_playwright import PlaywrightBackend
        >>> register_backend("playwright", PlaywrightBackend)
    """
    if not issubclass(cls, BrowserBackend):
        raise TypeError(f"{cls.__name__} must be a BrowserBackend subclass")
    _backends[name] = cls


def get_backend(name: str = "browser-harness") -> BrowserBackend:
    """Create a browser backend instance by name.

    Args:
        name: Backend identifier (e.g. ``"browser-harness"``, ``"playwright"``).

    Returns:
        An instance of the requested ``BrowserBackend`` subclass.

    Raises:
        ValueError: If the backend name is not registered.
    """
    if name not in _backends:
        available = list(_backends.keys()) if _backends else ["(none registered)"]
        raise ValueError(
            f"Unknown browser backend: {name!r}. "
            f"Available: {available}. "
            "Import the backend module to register it, "
            "or see docs/browser-backends.md to add your own."
        )
    return _backends[name]()


def list_backends() -> list[str]:
    """Return the names of all registered browser backends."""
    return list(_backends.keys())


# ── Register built-in backends ──────────────────────────────────────

from .browser_harness import BrowserHarnessBackend  # noqa: E402

register_backend("browser-harness", BrowserHarnessBackend)

# Playwright is optional — register if importable
try:
    from .playwright_ import PlaywrightBackend  # noqa: E402

    register_backend("playwright", PlaywrightBackend)
except ImportError:
    pass

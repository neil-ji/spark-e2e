"""Browser — Playwright backend (the only one)."""

from .base import BrowserBackend
from .playwright_ import PlaywrightBackend

__all__ = ["BrowserBackend", "PlaywrightBackend", "get_backend", "list_backends"]

_backends: dict[str, type[BrowserBackend]] = {}


def register_backend(name: str, cls: type[BrowserBackend]) -> None:
    _backends[name] = cls


def get_backend(name: str = "playwright") -> BrowserBackend:
    if name not in _backends:
        available = list(_backends.keys()) if _backends else ["(none)"]
        raise ValueError(f"Unknown: {name!r}. Available: {available}.")
    return _backends[name]()


def list_backends() -> list[str]:
    return list(_backends.keys())


register_backend("playwright", PlaywrightBackend)

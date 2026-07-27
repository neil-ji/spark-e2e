"""VLM provider registry and factory."""

from __future__ import annotations

from .base import VLMProvider

__all__ = ["VLMProvider", "get_provider", "register_provider", "list_providers"]


_providers: dict[str, type[VLMProvider]] = {}


def register_provider(name: str, cls: type[VLMProvider]) -> None:
    """Register a VLM provider implementation.

    Args:
        name: Short identifier (e.g. ``"openai-compat"``, ``"anthropic"``).
        cls: A ``VLMProvider`` subclass.
    """
    if not issubclass(cls, VLMProvider):
        raise TypeError(f"{cls.__name__} must be a VLMProvider subclass")
    _providers[name] = cls


def get_provider(name: str = "openai-compat") -> VLMProvider:
    """Create a VLM provider instance by name.

    Args:
        name: Provider identifier.

    Returns:
        An instance of the requested ``VLMProvider`` subclass.

    Raises:
        ValueError: If the provider name is not registered.
    """
    if name not in _providers:
        available = list(_providers.keys()) if _providers else ["(none registered)"]
        raise ValueError(
            f"Unknown VLM provider: {name!r}. "
            f"Available: {available}. "
            "Import the provider module to register it."
        )
    return _providers[name]()


def list_providers() -> list[str]:
    """Return the names of all registered VLM providers."""
    return list(_providers.keys())


# ── Register built-in provider ──────────────────────────────────────

from .openai_compat import OpenAICompatProvider  # noqa: E402

register_provider("openai-compat", OpenAICompatProvider)

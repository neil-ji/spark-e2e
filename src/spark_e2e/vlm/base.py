"""VLM provider interface."""

from abc import ABC, abstractmethod


class VLMProvider(ABC):
    """Abstract interface for Vision Language Model providers.

    Implement this class to add support for a new VLM backend
    (Anthropic, Gemini, local models via Ollama, etc.).
    """

    @abstractmethod
    def chat(
        self,
        prompt: str,
        image_data_url: str | list[str],
        model: str | None = None,
        thinking_budget: int = 0,
    ) -> str:
        """Send a text + image(s) prompt to the VLM and return its text response.

        Args:
            prompt: The text instruction for the VLM.
            image_data_url: Single data URL or list of data URLs for multi-image
                comparisons (e.g. baseline vs. current screenshot).
            model: Optional model override.
            thinking_budget: Max tokens for extended thinking (0 = off, default).
                Only works with models that support extended thinking.

        Returns:
            The model's text response (may be JSON-formatted for structured tools).
        """
        ...

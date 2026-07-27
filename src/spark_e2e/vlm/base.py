"""VLM provider interface."""

from abc import ABC, abstractmethod


class VLMProvider(ABC):
    """Abstract interface for Vision Language Model providers.

    Implement this class to add support for a new VLM backend
    (Anthropic, Gemini, local models via Ollama, etc.).
    """

    @abstractmethod
    def chat(self, prompt: str, image_data_url: str) -> str:
        """Send a text + image prompt to the VLM and return its text response.

        Args:
            prompt: The text instruction for the VLM.
            image_data_url: The screenshot as a ``data:image/png;base64,...`` URL.

        Returns:
            The model's text response (may be JSON-formatted for structured tools).
        """
        ...

"""OpenAI-compatible VLM provider (GPT-4o, Qwen-VL, Llama Vision, etc.)."""

from __future__ import annotations

import json
import sys
from typing import Any

from .base import VLMProvider


def _log(msg: str) -> None:
    print(f"[spark-e2e] {msg}", file=sys.stderr, flush=True)


class OpenAICompatProvider(VLMProvider):
    """VLM provider for any OpenAI-compatible chat completions API.

    Works with OpenAI, Azure OpenAI, Anthropic (via proxy), Ollama, vLLM,
    Together AI, and any other service that exposes a ``/v1/chat/completions``
    endpoint supporting image_url content parts.
    """

    def __init__(self, api_key: str | None = None, base_url: str | None = None, model: str | None = None) -> None:
        self._api_key = api_key
        self._base_url = base_url
        self._model = model

    def chat(self, prompt: str, image_data_url: str, model: str | None = None) -> str:
        """Send a text + image prompt to the VLM.

        Uses the OpenAI Python SDK.  API key and base URL are read from
        the instance config, falling back to environment variables.
        """
        from openai import OpenAI  # type: ignore[import-untyped]

        api_key = self._api_key
        base_url = self._base_url
        resolved_model = model or self._model

        if not api_key or not base_url:
            from spark_e2e.config import get_vlm_env
            env_key, env_url = get_vlm_env()
            api_key = api_key or env_key
            base_url = base_url or env_url

        if not resolved_model:
            from spark_e2e.config import get_vlm_model
            resolved_model = get_vlm_model()

        _log(f"VLM model={resolved_model} base_url={base_url}")

        client = OpenAI(api_key=api_key, base_url=base_url)
        response = client.chat.completions.create(
            model=resolved_model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": image_data_url}},
                    ],
                }
            ],
            max_tokens=16384,
        )

        content = response.choices[0].message.content or ""
        _log(f"VLM response ({len(content)} chars)")
        return content


# ── JSON extraction utilities (not provider-specific) ────────────────


def extract_json(text: str) -> dict[str, Any]:
    """Best-effort JSON extraction from model output.

    Handles `` ```json `` fences, trailing text, model commentary,
    and truncated objects (missing closing braces/brackets).
    """
    t = text.strip()

    # Strip markdown code fences
    if t.startswith("```"):
        newline = t.find("\n")
        t = t[newline + 1 :] if newline != -1 else t[3:]
    if t.endswith("```"):
        t = t[:-3].strip()

    # Strip leading/trailing non-JSON text
    start = t.find("{")
    end = t.rfind("}")
    if start != -1 and end != -1:
        t = t[start : end + 1]

    try:
        return json.loads(t)
    except json.JSONDecodeError:
        pass

    try:
        balanced, _ = _balance_json(t.strip())
        return json.loads(balanced)
    except json.JSONDecodeError:
        pass

    _log(f"Failed to extract JSON from: {t[:200]}...")
    return {}


def _balance_json(s: str) -> tuple[str, int]:
    """Close unclosed braces and brackets in a JSON string.

    Returns ``(balanced_string, remaining_depth)``.
    """
    # Track opener stack so we can close them in correct reverse order
    stack: list[str] = []
    in_string = False
    escape = False

    for ch in s:
        if escape:
            escape = False
            continue
        if ch == "\\" and in_string:
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch in "{[":
            stack.append(ch)
        elif ch == "}":
            if stack and stack[-1] == "{":
                stack.pop()
        elif ch == "]":
            if stack and stack[-1] == "[":
                stack.pop()

    # Close in reverse order: { → }, [ → ]
    suffix = ""
    # If we end inside a string, close it first
    if in_string:
        suffix += '"'
    for opener in reversed(stack):
        suffix += "}" if opener == "{" else "]"

    return s + suffix, len(stack)

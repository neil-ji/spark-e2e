"""Basic smoke tests for spark-e2e."""

import json
import pytest
from spark_e2e.config import Config, load
from spark_e2e.browser import list_backends, get_backend, BrowserBackend
from spark_e2e.vlm import list_providers, get_provider, VLMProvider
from spark_e2e.vlm.openai_compat import extract_json


class TestConfig:
    def test_default_config(self):
        cfg = Config()
        assert cfg.browser.backend == "browser-harness"
        assert cfg.viewport.width == 1600
        assert cfg.vlm.model == "gpt-4o"
        assert cfg.prompts.strictness == "standard"

    def test_load_defaults(self, monkeypatch):
        """Load should work even without env vars or config file."""
        # Ensure no env vars leak
        monkeypatch.delenv("SPARK_E2E_API_KEY", raising=False)
        monkeypatch.delenv("SPARK_E2E_BASE_URL", raising=False)
        monkeypatch.delenv("VLM_API_KEY", raising=False)
        monkeypatch.delenv("VLM_BASE_URL", raising=False)

        cfg = load()
        assert isinstance(cfg, Config)
        assert cfg.browser.backend == "browser-harness"


class TestBrowserRegistry:
    def test_browser_harness_registered(self):
        backends = list_backends()
        assert "browser-harness" in backends

    def test_get_browser_harness(self):
        backend = get_backend("browser-harness")
        assert isinstance(backend, BrowserBackend)

    def test_unknown_backend(self):
        with pytest.raises(ValueError, match="Unknown browser backend"):
            get_backend("nonexistent")


class TestVLMRegistry:
    def test_openai_compat_registered(self):
        providers = list_providers()
        assert "openai-compat" in providers

    def test_get_openai_compat(self):
        provider = get_provider("openai-compat")
        assert isinstance(provider, VLMProvider)

    def test_unknown_provider(self):
        with pytest.raises(ValueError, match="Unknown VLM provider"):
            get_provider("nonexistent")


class TestJSONExtraction:
    def test_plain_json(self):
        result = extract_json('{"pass": true, "confidence": "high"}')
        assert result["pass"] is True
        assert result["confidence"] == "high"

    def test_json_with_fences(self):
        result = extract_json('```json\n{"pass": true}\n```')
        assert result["pass"] is True

    def test_json_with_commentary(self):
        result = extract_json('Here is the result: {"pass": false} Hope that helps.')
        assert result["pass"] is False

    def test_truncated_json(self):
        result = extract_json('{"pass": true, "findings": [{"desc": "test')
        assert result["pass"] is True

    def test_empty_string(self):
        result = extract_json("")
        assert result == {}

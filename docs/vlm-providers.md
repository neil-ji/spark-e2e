# VLM Providers

spark-e2e uses Vision Language Models to analyze screenshots.
One provider is built-in, and you can register custom ones.

## Built-in Provider

### openai-compat (default)

Uses the OpenAI Chat Completions API format. Works with any endpoint that
supports `image_url` content parts.

**Compatible services:**
- OpenAI (GPT-4o, GPT-4o-mini)
- Azure OpenAI
- Anthropic (via proxy)
- Ollama (llava, minicpm-v, etc.)
- vLLM / SGLang (open-source VLMs)
- Together AI, Fireworks, Groq

**Configuration:**
```yaml
vlm:
  provider: openai-compat
  api_key: "${SPARK_E2E_API_KEY}"
  base_url: "${SPARK_E2E_BASE_URL}"
  model: gpt-4o
```

## Custom Providers

Implement the `VLMProvider` abstract class to add a new provider:

```python
from spark_e2e.vlm import VLMProvider, register_provider

class AnthropicProvider(VLMProvider):
    def chat(self, prompt: str, image_data_url: str) -> str:
        # Use Anthropic SDK to send prompt + image
        # Return the model's text response
        ...

register_provider("anthropic", AnthropicProvider)
```

Set `vlm.provider: anthropic` in your config to use it.

## Interface Reference

### `chat(prompt: str, image_data_url: str) → str`

Send a text prompt and a base64-encoded PNG image (`data:image/png;base64,...`)
to the VLM. Return the model's complete text response.

The response may be:
- Raw text (for `visual_inspect`)
- JSON (for `visual_assert`, `visual_compare`, `visual_review`)

The `extract_json()` utility handles JSON parsing from model output,
including markdown fence removal and bracket balancing for truncated responses.

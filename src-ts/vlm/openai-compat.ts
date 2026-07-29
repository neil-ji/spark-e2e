/**
 * OpenAI-compatible VLM provider (GPT-4o, Qwen-VL, Llama Vision, etc.).
 */
import OpenAI from "openai";
import { getVlmEnv, getVlmModel } from "../config.js";
import type { VLMProvider } from "./index.js";

function log(msg: string): void {
  process.stderr.write(`[spark-e2e] ${msg}\n`);
}

export class OpenAICompatProvider implements VLMProvider {
  async chat(
    prompt: string,
    imageDataUrl: string | string[],
    model?: string,
    thinkingBudget?: number,
  ): Promise<string> {
    let [apiKey, baseUrl] = getVlmEnv();
    const resolvedModel = model ?? getVlmModel();

    if (!apiKey || !baseUrl) {
      // Fallback to env vars directly
      apiKey = apiKey || process.env.OPENAI_API_KEY || "";
      baseUrl = baseUrl || process.env.OPENAI_BASE_URL || "";
    }

    const thinking = (thinkingBudget ?? 0) > 0;
    const images = Array.isArray(imageDataUrl) ? imageDataUrl : [imageDataUrl];
    log(
      `VLM model=${resolvedModel} base_url=${baseUrl || "(default)"}` +
        (thinking ? ` thinking_budget=${thinkingBudget}` : "") +
        (images.length > 1 ? ` images=${images.length}` : ""),
    );

    const client = new OpenAI({ apiKey, baseURL: baseUrl || undefined });

    const response = await client.chat.completions.create(
      {
        model: resolvedModel,
        messages: [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: prompt },
              ...images.map((url) => ({
                type: "image_url" as const,
                image_url: { url },
              })),
            ],
          },
        ],
        max_tokens: 16384,
        ...(thinking
          ? {
              extra_body: {
                thinking: { budget_tokens: thinkingBudget, type: "enabled" },
              },
            }
          : {}),
      },
    );

    const content = response.choices[0]?.message?.content ?? "";
    log(`VLM response (${content.length} chars)`);
    return content;
  }
}

// ── JSON extraction utilities ───────────────────────────

interface JsonObject {
  [key: string]: unknown;
}

export function balanceJson(s: string): [string, number] {
  const stack: string[] = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}") { if (stack[stack.length - 1] === "{") stack.pop(); }
    else if (ch === "]") { if (stack[stack.length - 1] === "[") stack.pop(); }
  }

  let suffix = "";
  if (inString) suffix += '"';
  for (let i = stack.length - 1; i >= 0; i--) {
    suffix += stack[i] === "{" ? "}" : "]";
  }

  return [s + suffix, stack.length];
}

export function extractJson(text: string): JsonObject {
  let t = text.trim();

  // Strip markdown code fences
  if (t.startsWith("```")) {
    const newline = t.indexOf("\n");
    t = newline !== -1 ? t.slice(newline + 1) : t.slice(3);
  }
  if (t.endsWith("```")) {
    t = t.slice(0, -3).trim();
  }

  // Strip leading/trailing non-JSON text
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1) {
    t = t.slice(start, end + 1);
  }

  try {
    return JSON.parse(t) as JsonObject;
  } catch {
    // continue
  }

  try {
    const [balanced] = balanceJson(t.trim());
    return JSON.parse(balanced) as JsonObject;
  } catch {
    // continue
  }

  log(`Failed to extract JSON from: ${t.slice(0, 200)}...`);
  return {};
}

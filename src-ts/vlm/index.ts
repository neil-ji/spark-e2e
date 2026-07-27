/**
 * VLM provider registry and base interface.
 */
export interface VLMProvider {
  /** Send a prompt + image to the VLM, return its text response. */
  chat(prompt: string, imageDataUrl: string, model?: string): Promise<string>;
}

// ── Registry ────────────────────────────────────────────

const providers = new Map<string, new () => VLMProvider>();

export function registerProvider(name: string, cls: new () => VLMProvider): void {
  providers.set(name, cls);
}

export function getProvider(name = "openai-compat"): VLMProvider {
  const Cls = providers.get(name);
  if (!Cls) {
    const available = [...providers.keys()];
    throw new Error(
      `Unknown VLM provider: '${name}'. Available: ${available.length ? available.join(", ") : "(none registered)"}.`
    );
  }
  return new Cls();
}

export function listProviders(): string[] {
  return [...providers.keys()];
}

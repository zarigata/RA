// src/ollama.ts — Ollama client (cloud OpenAI-compat + LAN/local native)

export interface OllamaConfig {
  baseURL: string;
  apiKey: string;
  kind: "cloud" | "local";
  /** Force OpenAI-compatible /chat/completions even for local servers (LM Studio, llama.cpp). */
  openaiCompat?: boolean;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatResult {
  content: string;
  model: string;
  usage: ChatUsage | null;
}

export class OllamaClient {
  availableModels: string[] = [];

  constructor(private cfg: OllamaConfig) {}

  get kind(): "cloud" | "local" {
    return this.cfg.kind;
  }

  get baseURL(): string {
    return this.cfg.baseURL;
  }

  static fromEnv(env: Record<string, string | undefined>): OllamaClient {
    const apiKey = env.OLLAMA_API_KEY;
    const baseURL = env.OLLAMA_BASE_URL ?? "https://ollama.com/v1";
    if (!apiKey) throw new Error("OLLAMA_API_KEY not set");
    return new OllamaClient({ baseURL, apiKey, kind: "cloud" });
  }

  /** LAN/local ollama — .251 is the preferred "small" box */
  static fromLocal(baseURL: string): OllamaClient {
    const url = baseURL.endsWith("/v1") ? baseURL : `${baseURL.replace(/\/$/, "")}/v1`;
    return new OllamaClient({ baseURL: url, apiKey: "ollama", kind: "local" });
  }

  /** OpenAI-compatible local server (LM Studio, llama.cpp server) — no key needed. */
  static fromOpenAI(baseURL: string): OllamaClient {
    const url = baseURL.endsWith("/v1") ? baseURL : `${baseURL.replace(/\/$/, "")}/v1`;
    return new OllamaClient({ baseURL: url, apiKey: "local", kind: "local", openaiCompat: true });
  }

  async probe(timeoutMs = 3000): Promise<boolean> {
    try {
      if (this.cfg.kind === "cloud" || this.cfg.openaiCompat) {
        this.availableModels = await this.listModels();
        return this.availableModels.length > 0;
      }
      const base = this.cfg.baseURL.replace(/\/v1$/, "");
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(`${base}/api/tags`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return false;
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      this.availableModels = (data.models ?? []).map((m) => m.name);
      return this.availableModels.length > 0;
    } catch {
      return false;
    }
  }

  async listNativeModels(): Promise<string[]> {
    const base = this.cfg.baseURL.replace(/\/v1$/, "");
    const res = await fetch(`${base}/api/tags`);
    if (!res.ok) throw new Error(`listNativeModels ${res.status}`);
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.cfg.baseURL}/models`, {
      headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
    });
    if (!res.ok) throw new Error(`listModels ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    return (data.data ?? []).map((m) => m.id);
  }

  async chat(model: string, messages: ChatMessage[], opts: { maxTokens?: number; timeoutMs?: number; temperature?: number } = {}): Promise<ChatResult> {
    const timeoutMs = opts.timeoutMs ?? 180_000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.cfg.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.cfg.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: ctrl.signal,
        body: JSON.stringify({
          model,
          messages,
          max_tokens: opts.maxTokens,
          ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
        }),
      });
      if (!res.ok) throw new Error(`chat ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as {
        choices: Array<{ message: { content: string } }>;
        model: string;
        usage?: ChatUsage;
      };
      return {
        content: data.choices[0]?.message?.content ?? "",
        model: data.model,
        usage: data.usage ?? null,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("abort") || (e as { name?: string })?.name === "TimeoutError") {
        throw new Error(`chat timeout after ${timeoutMs}ms model=${model}`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async nativeChat(
    model: string,
    messages: ChatMessage[],
    opts: { timeoutMs?: number; temperature?: number } = {},
  ): Promise<ChatResult> {
    if (this.cfg.kind === "cloud" || this.cfg.openaiCompat) return this.chat(model, messages, opts);
    const base = this.cfg.baseURL.replace(/\/v1$/, "");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const timeoutMs = opts.timeoutMs ?? 180_000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers,
        signal: ctrl.signal,
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          ...(opts.temperature != null ? { options: { temperature: opts.temperature } } : {}),
        }),
      });
      if (!res.ok) throw new Error(`nativeChat ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as {
        message?: { content: string };
        model: string;
        prompt_eval_count?: number;
        eval_count?: number;
      };
      return {
        content: data.message?.content ?? "",
        model: data.model,
        usage: {
          prompt_tokens: data.prompt_eval_count ?? 0,
          completion_tokens: data.eval_count ?? 0,
          total_tokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("abort") || msg.includes("Timeout") || (e as { name?: string })?.name === "TimeoutError") {
        throw new Error(`nativeChat timeout after ${timeoutMs}ms model=${model}`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

const MODEL_FALLBACKS = ["qwen3.8:latest", "qwen3:8b", "qwen3.8", "gemma4:12b", "gemma:latest", "gemma2:2b"];
const CLOUD_FALLBACKS = ["glm-5.2", "gemma4:31b", "gpt-oss:20b"];

function bareModel(configured: string): string {
  return configured.includes("/") ? configured.split("/").pop()! : configured;
}

function isCloudModel(configured: string): boolean {
  return configured.startsWith("ollama-cloud/") || configured.startsWith("cloud/");
}

/** Small Ollama: .251 LAN first, then localhost gemma fallback */
export function smallOllamaUrls(env: Record<string, string | undefined>): string[] {
  const urls = [
    env.OLLAMA_LAN_URL ?? "http://192.168.1.251:11434",
    env.OLLAMA_LOCAL_URL ?? "http://localhost:11434",
    "http://localhost:11434",
  ];
  return [...new Set(urls)];
}

/** Small models: always .251 first (user's "local" box) */
export async function pickOllamaEndpoint(
  env: Record<string, string | undefined>,
): Promise<OllamaClient> {
  for (const url of smallOllamaUrls(env)) {
    const client = OllamaClient.fromLocal(url);
    if (await client.probe(2000)) return client;
  }
  throw new Error("No reachable small Ollama (tried .251 and localhost)");
}

/**
 * Auto-discover local OpenAI-compatible servers (LM Studio @1234, llama.cpp @8080).
 * Returns the first reachable client with models, or null.
 */
export async function discoverLocalOpenAI(
  env: Record<string, string | undefined>,
  urls: string[] = [
    env.LM_STUDIO_URL ?? "http://localhost:1234",
    env.LLAMACPP_URL ?? "http://localhost:8080",
  ],
): Promise<OllamaClient | null> {
  for (const url of [...new Set(urls)]) {
    const client = OllamaClient.fromOpenAI(url);
    if (await client.probe(1500)) return client;
  }
  return null;
}

export interface ProviderDef {
  name?: string;
  options?: { baseURL?: string; apiKey?: string };
  models?: Record<string, unknown>;
}

/**
 * Resolve a `provider/model` string to an OpenAI-compatible client using the
 * `provider` config block. Supports `{env:VAR}` templating for the API key.
 * Returns null if the provider is not configured (caller falls back to Ollama).
 */
export function resolveProviderClient(
  configured: string,
  providers: Record<string, ProviderDef> | undefined,
  env: Record<string, string | undefined>,
): OllamaClient | null {
  const slash = configured.indexOf("/");
  if (slash <= 0) return null;
  const provider = configured.slice(0, slash);
  // Built-in Ollama providers are handled by the dedicated Ollama path below;
  // only resolve genuinely custom providers here (e.g. zai, anthropic, google).
  if (/^ollama/i.test(provider)) return null;
  const def = providers?.[provider];
  if (!def?.options?.baseURL) return null;
  const baseURL = def.options.baseURL;
  const rawKey = def.options.apiKey ?? "";
  const apiKey = rawKey.startsWith("{env:") && rawKey.endsWith("}")
    ? (env[rawKey.slice(5, -1)] ?? "")
    : rawKey;
  const kind: "cloud" | "local" = /localhost|127\.0\.0\.1|192\.168\./.test(baseURL) ? "local" : "cloud";
  return new OllamaClient({ baseURL, apiKey, kind });
}

/**
 * Route by provider prefix:
 * - a configured `provider/*` (from the `provider` config block) → OpenAI-compatible client
 * - ollama-cloud/* → Ollama Cloud (BIG) with OLLAMA_API_KEY
 * - everything else → .251 LAN as small/local
 */
export async function pickClientForModel(
  configured: string,
  env: Record<string, string | undefined>,
  providers?: Record<string, ProviderDef>,
): Promise<{ client: OllamaClient; model: string }> {
  const bare = bareModel(configured);

  const custom = resolveProviderClient(configured, providers, env);
  if (custom) {
    try {
      await custom.probe(5000);
    } catch {
      /* key may still chat */
    }
    const model =
      custom.availableModels.length > 0
        ? pickModel(bare, custom.availableModels, CLOUD_FALLBACKS)
        : bare;
    return { client: custom, model };
  }

  if (isCloudModel(configured)) {
    const client = OllamaClient.fromEnv(env);
    try {
      await client.probe(5000);
    } catch {
      /* key may still chat */
    }
    const model =
      client.availableModels.length > 0
        ? pickModel(bare, client.availableModels, CLOUD_FALLBACKS)
        : bare;
    return { client, model };
  }

  // Small / "local" = .251 qwen, then localhost gemma if needed
  for (const url of smallOllamaUrls(env)) {
    const client = OllamaClient.fromLocal(url);
    if (!(await client.probe(2000))) continue;
    // Prefer qwen3.8 on .251; gemma:* only if configured or qwen missing
    if (/gemma/i.test(bare) && !client.availableModels.some((m) => /gemma/i.test(m))) {
      continue; // configured gemma but this host has none — keep probing
    }
    const model = pickModel(configured, client.availableModels);
    return { client, model };
  }
  // Last resort: local OpenAI-compatible servers (LM Studio, llama.cpp).
  const openai = await discoverLocalOpenAI(env);
  if (openai) {
    const model = pickModel(configured, openai.availableModels);
    return { client: openai, model };
  }
  throw new Error("No reachable small Ollama at .251 (or localhost gemma fallback)");
}

export function pickModel(
  configured: string,
  available: string[],
  fallbacks: string[] = MODEL_FALLBACKS,
): string {
  const bare = bareModel(configured);
  if (available.length === 0) return bare;
  if (available.includes(bare)) return bare;
  for (const fb of fallbacks) {
    if (available.includes(fb)) return fb;
    const match = available.find((m) => m === fb || m.startsWith(fb.split(":")[0]));
    if (match) return match;
  }
  return available[0] ?? bare;
}

/**
 * Ordered fallback chain for a configured model.
 * - cloud (BIG) → .251 qwen → localhost gemma
 * - small/local → .251 qwen → localhost gemma → cloud glm-5.2
 */
export function fallbackChain(configured: string): string[] {
  const chain = [configured];
  if (isCloudModel(configured)) {
    chain.push("ollama-lan/qwen3.8:latest", "ollama/gemma:latest");
  } else {
    chain.push("ollama-lan/qwen3.8:latest", "ollama/gemma:latest", "ollama-cloud/glm-5.2");
  }
  return [...new Set(chain)];
}

export interface FallbackAttempt {
  configured: string;
  model: string;
  host: string;
  ms: number;
  ok: boolean;
  error?: string;
}

/**
 * Run a chat request through the fallback chain, recording per-attempt
 * latency and host. Returns the first successful result plus the attempt log.
 * Throws if every candidate fails.
 */
export async function runWithFallback(
  configured: string,
  env: Record<string, string | undefined>,
  run: (client: OllamaClient, model: string) => Promise<ChatResult>,
  pick: (candidate: string, env: Record<string, string | undefined>) => Promise<{ client: OllamaClient; model: string }> = pickClientForModel,
): Promise<{ result: ChatResult; attempts: FallbackAttempt[] }> {
  const attempts: FallbackAttempt[] = [];
  let lastErr: Error | null = null;
  for (const candidate of fallbackChain(configured)) {
    const t0 = Date.now();
    try {
      const { client, model } = await pick(candidate, env);
      const result = await run(client, model);
      attempts.push({
        configured: candidate,
        model: result.model,
        host: hostTag(client.baseURL, client.kind),
        ms: Date.now() - t0,
        ok: true,
      });
      return { result, attempts };
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      attempts.push({
        configured: candidate,
        model: candidate,
        host: "down",
        ms: Date.now() - t0,
        ok: false,
        error: lastErr.message,
      });
    }
  }
  throw lastErr ?? new Error(`No fallback succeeded for ${configured}`);
}

function hostTag(baseURL: string, kind: "cloud" | "local"): string {
  if (kind === "cloud") return "cloud";
  if (baseURL.includes("192.168.1.251")) return "251";
  if (/localhost|127\.0\.0\.1/.test(baseURL)) return "local";
  return "lan";
}

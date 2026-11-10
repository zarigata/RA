// src/anthropic.ts — native Anthropic Messages API client (the `claude`
// cloud provider). Anthropic is NOT OpenAI-compatible: chat is
// POST /v1/messages with `x-api-key` + `anthropic-version` headers, a
// top-level `system` field, and content-block responses. AnthropicClient
// extends OllamaClient because that type is RA's universal provider
// contract — the agent loop, fallback runner and context probes all take
// OllamaClient; only the HTTP surface is overridden here.

import {
  OllamaClient,
  type ChatMessage,
  type ChatResult,
  type ChatUsage,
  type ProviderDef,
  type StreamChatOptions,
} from "./ollama.ts";

export const ANTHROPIC_API_VERSION = "2023-06-01";
export const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";

/** Default Claude models (models.dev naming), registered by key alone. */
export const DEFAULT_ANTHROPIC_MODELS = ["claude-sonnet-4-5", "claude-haiku-4-5"];

/** max_tokens is REQUIRED on every Messages request; RA callers usually
 * leave it unset, so default to a generous mid cap.
 * ponytail: fixed 8192 — long-generation jobs should pass maxTokens
 * explicitly; revisit when per-model output caps get wired into profiles. */
const DEFAULT_MAX_TOKENS = 8192;

/** A usable key: set and not the .env.example placeholder. */
export function hasAnthropicKey(env: Record<string, string | undefined>): boolean {
  const k = env.ANTHROPIC_API_KEY ?? "";
  return Boolean(k) && k !== "sk-ant-" && k !== "sk-ant-...";
}

/** Expand `{env:VAR}` placeholders (same rule as resolveProviderClient). */
function expandEnv(raw: string | undefined, env: Record<string, string | undefined>): string | null {
  if (!raw) return null;
  const missing = [...raw.matchAll(/\{env:([A-Z0-9_]+)\}/g)].some((m) => !env[m[1]!]);
  if (missing) return null;
  return raw.replace(/\{env:([A-Z0-9_]+)\}/g, (_, k) => env[k]!);
}

/**
 * Map RA chat messages onto the Anthropic Messages shape (pure, unit-tested):
 * system messages collapse into the top-level `system` field, consecutive
 * same-role turns merge (roles must alternate), empty contents drop (the API
 * rejects empty text blocks), and a user-first transcript is guaranteed.
 */
export function toAnthropicPayload(
  messages: ChatMessage[],
): { system?: string; messages: Array<{ role: "user" | "assistant"; content: string }> } {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n") || undefined;
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of messages) {
    if (m.role === "system" || !m.content.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else out.push({ role: m.role, content: m.content });
  }
  // ponytail: the API demands a user-first alternating transcript; a neutral
  // nudge turn is enough for RA's tool-loop histories, which otherwise
  // alternate naturally — no full conversation-repair pass.
  if (!out.length || out[0].role !== "user") out.unshift({ role: "user", content: "(continue)" });
  return { system, messages: out };
}

export interface AnthropicRequest {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    max_tokens: number;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    system?: string;
    temperature?: number;
    stream?: boolean;
  };
}

/** Build a /v1/messages request (pure, unit-tested). */
export function buildAnthropicRequest(
  baseURL: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number; stream?: boolean } = {},
): AnthropicRequest {
  const { system, messages: mapped } = toAnthropicPayload(messages);
  return {
    url: `${baseURL.replace(/\/$/, "")}/messages`,
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
      "Content-Type": "application/json",
    },
    body: {
      model,
      max_tokens: opts.maxTokens != null && opts.maxTokens > 0 ? Math.floor(opts.maxTokens) : DEFAULT_MAX_TOKENS,
      ...(system ? { system } : {}),
      messages: mapped,
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      ...(opts.stream ? { stream: true } : {}),
    },
  };
}

export interface AnthropicMessagesResponse {
  content?: Array<{ type?: string; text?: string }>;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string | null;
  error?: { type?: string; message?: string };
}

/** Tag bare model id with the native claude provider prefix for pricing. */
function claudeModelId(requestedModel: string): string {
  return requestedModel.includes("/") ? requestedModel : `claude/${requestedModel}`;
}

/** Map a non-streaming /v1/messages response onto RA's ChatResult (pure). */
export function mapAnthropicResponse(data: AnthropicMessagesResponse, requestedModel: string): ChatResult {
  const content = (data.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text!)
    .join("");
  const u = data.usage;
  return {
    content,
    // The API echoes a dated snapshot id (claude-sonnet-4-5-2025…); keying
    // usage/cost on the requested id keeps the price + usage tables matching.
    model: claudeModelId(requestedModel),
    usage:
      u && (u.input_tokens != null || u.output_tokens != null)
        ? {
            prompt_tokens: u.input_tokens ?? 0,
            completion_tokens: u.output_tokens ?? 0,
            total_tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
          }
        : null,
  };
}

export interface AnthropicStreamPart {
  token: string;
  done: boolean;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Parse one SSE data payload from a /v1/messages stream (pure, unit-tested;
 * same contract as parseSSEFrame: null for blank/unknown events, throws on
 * provider error events).
 */
export function parseAnthropicEvent(data: string): AnthropicStreamPart | null {
  const d = data.trim();
  if (!d || d === "[DONE]") return null;
  let j: {
    type?: string;
    message?: { model?: string; usage?: { input_tokens?: number } };
    delta?: { type?: string; text?: string };
    usage?: { output_tokens?: number };
    error?: { message?: string } | string;
  };
  try {
    j = JSON.parse(d);
  } catch {
    return null;
  }
  if (j.error) {
    const msg = typeof j.error === "string" ? j.error : (j.error.message ?? JSON.stringify(j.error));
    throw new Error(`Provider stream error: ${msg}`);
  }
  switch (j.type) {
    case "content_block_delta":
      return { token: j.delta?.type === "text_delta" ? j.delta.text ?? "" : "", done: false };
    case "message_start":
      return { token: "", done: false, model: j.message?.model, inputTokens: j.message?.usage?.input_tokens };
    case "message_delta":
      return { token: "", done: false, outputTokens: j.usage?.output_tokens };
    case "message_stop":
      return { token: "", done: true };
    default:
      return null; // ping, content_block_start/stop, …
  }
}

export class AnthropicClient extends OllamaClient {
  // The parent keeps `cfg` private; keep our own copy for header building.
  constructor(private acfg: { baseURL: string; apiKey: string }) {
    super({ baseURL: acfg.baseURL, apiKey: acfg.apiKey, kind: "cloud" });
  }

  /**
   * Key resolution: provider config apiKey (with {env:VAR} templating) wins,
   * then ANTHROPIC_API_KEY. Returns null when no usable key exists — callers
   * treat that as "provider not configured".
   */
  static fromEnv(env: Record<string, string | undefined>, def?: ProviderDef): AnthropicClient | null {
    const apiKey = expandEnv(def?.options?.apiKey, env) ?? (hasAnthropicKey(env) ? env.ANTHROPIC_API_KEY! : "");
    if (!apiKey || apiKey === "sk-ant-" || apiKey === "sk-ant-...") return null;
    const baseURL = expandEnv(def?.options?.baseURL, env) ?? env.ANTHROPIC_BASE_URL ?? DEFAULT_ANTHROPIC_BASE_URL;
    return new AnthropicClient({ baseURL: baseURL.replace(/\/$/, ""), apiKey });
  }

  private headers(): Record<string, string> {
    return {
      "x-api-key": this.acfg.apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
      "Content-Type": "application/json",
    };
  }

  /** Anthropic's /v1/models answers the OpenAI {data:[{id}]} shape. */
  async listModels(timeoutMs = 5000): Promise<string[]> {
    const res = await fetch(`${this.baseURL}/models`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`listModels ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    return (data.data ?? []).map((m) => m.id);
  }

  /** No live context probe endpoint — the static table (claude → 200k) is it. */
  async showContext(_model: string, _timeoutMs = 3000): Promise<number | null> {
    return null;
  }

  async chat(
    model: string,
    messages: ChatMessage[],
    opts: { maxTokens?: number; timeoutMs?: number; temperature?: number } = {},
  ): Promise<ChatResult> {
    const timeoutMs = opts.timeoutMs ?? 180_000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const req = buildAnthropicRequest(this.acfg.baseURL, this.acfg.apiKey, model, messages, opts);
      const res = await fetch(req.url, {
        method: "POST",
        headers: req.headers,
        signal: ctrl.signal,
        body: JSON.stringify(req.body),
      });
      if (!res.ok) throw new Error(`anthropic chat ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as AnthropicMessagesResponse;
      if (data.error) throw new Error(`anthropic chat: ${data.error.message ?? data.error.type}`);
      return mapAnthropicResponse(data, model);
    } catch (e) {
      throw this.wrapError(e, "chat", timeoutMs, model);
    } finally {
      clearTimeout(timer);
    }
  }

  /** SSE streaming over /v1/messages — same contract as OllamaClient streams.
   * ponytail: native Anthropic tool_use blocks are not mapped — RA's tool
   * grammar is text-based (normalizeToolText), which Claude follows from the
   * system prompt; wire content_block tool deltas in only if agent prompts
   * ever adopt Anthropic-native tool schemas. */
  async nativeChatStream(model: string, messages: ChatMessage[], opts: StreamChatOptions = {}): Promise<ChatResult> {
    opts.signal?.throwIfAborted();
    const timeoutMs = opts.timeoutMs ?? 180_000;
    const ctrl = new AbortController();
    if (opts.signal) opts.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let content = "";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    try {
      const req = buildAnthropicRequest(this.acfg.baseURL, this.acfg.apiKey, model, messages, { ...opts, stream: true });
      const res = await fetch(req.url, {
        method: "POST",
        headers: req.headers,
        signal: ctrl.signal,
        body: JSON.stringify(req.body),
      });
      if (!res.ok) throw new Error(`anthropic chatStream ${res.status}: ${await res.text()}`);
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const apply = (line: string) => {
        if (!line.startsWith("data:")) return;
        const part = parseAnthropicEvent(line.slice(5));
        if (!part) return;
        if (part.inputTokens != null) inputTokens = part.inputTokens;
        if (part.outputTokens != null) outputTokens = part.outputTokens;
        if (part.token) {
          content += part.token;
          opts.onToken?.(part.token);
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split(/\r?\n\r?\n/);
        buf = frames.pop() ?? "";
        for (const frame of frames) for (const line of frame.split(/\r?\n/)) apply(line);
      }
      for (const line of buf.split(/\r?\n/)) apply(line); // tail without trailing blank line
      if (!content.trim()) {
        throw new Error(`Empty response from ${model} (anthropic); type=${res.headers.get("content-type")}`);
      }
      const usage: ChatUsage | null =
        inputTokens != null || outputTokens != null
          ? {
              prompt_tokens: inputTokens ?? 0,
              completion_tokens: outputTokens ?? 0,
              total_tokens: (inputTokens ?? 0) + (outputTokens ?? 0),
            }
          : null;
      return { content, model: claudeModelId(model), usage };
    } catch (e) {
      // A bare local-timeout abort carries no reason; user/run cancellations carry one.
      if (opts.signal?.aborted) {
        throw new Error(opts.signal.reason ? String(opts.signal.reason) : `model call aborted after ${timeoutMs}ms timeout (model=${model})`);
      }
      throw this.wrapError(e, "chatStream", timeoutMs, model);
    } finally {
      clearTimeout(timer);
    }
  }

  async chatStream(model: string, messages: ChatMessage[], opts: StreamChatOptions = {}): Promise<ChatResult> {
    return this.nativeChatStream(model, messages, opts);
  }

  private wrapError(e: unknown, what: string, timeoutMs: number, model: string): Error {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("abort") || msg.includes("Timeout") || (e as { name?: string })?.name === "TimeoutError") {
      return new Error(`anthropic ${what} timeout after ${timeoutMs}ms model=${model}`);
    }
    return e instanceof Error ? e : new Error(msg);
  }
}

/**
 * Resolve a `claude/*` or `anthropic/*` model id to a native client using
 * the provider config block when present, else ANTHROPIC_API_KEY. Returns
 * null when the id is not a Claude id or no usable key exists.
 */
export function resolveAnthropicClient(
  configured: string,
  providers: Record<string, ProviderDef> | undefined,
  env: Record<string, string | undefined>,
): AnthropicClient | null {
  const slash = configured.indexOf("/");
  if (slash <= 0) return null;
  const provider = configured.slice(0, slash).toLowerCase();
  if (provider !== "claude" && provider !== "anthropic") return null;
  return AnthropicClient.fromEnv(env, providers?.[provider]);
}

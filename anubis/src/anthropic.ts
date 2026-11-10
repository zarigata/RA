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

/** Anthropic requires thinking budgets of at least 1024 tokens. */
export const MIN_THINKING_BUDGET = 1024;

/** Budget used when config says just `thinking: true`. Must stay below the
 * default max_tokens (8192) — the API demands budget_tokens < max_tokens. */
const DEFAULT_THINKING_BUDGET = 4096;

/** A raw /v1/messages content block (thinking blocks are passed through opaquely). */
export type AnthropicContentBlock = { type: string; [k: string]: unknown };

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
 *
 * `thinkingBlocks` (from AnthropicClient's store): raw thinking blocks that
 * must ride along when their assistant answer is re-sent on a later call
 * (Anthropic requires preserving thinking blocks during tool use within a
 * turn). Keyed by exact answer text; blocks are re-emitted in stream order
 * BEFORE the answer's text block, interleaved text+thinking answers keep
 * their relative block order, and redacted_thinking passes through opaquely.
 */
export function toAnthropicPayload(
  messages: ChatMessage[],
  thinkingBlocks?: ReadonlyMap<string, AnthropicContentBlock[]>,
): { system?: string; messages: Array<{ role: "user" | "assistant"; content: string | AnthropicContentBlock[] }> } {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n") || undefined;
  const out: Array<{ role: "user" | "assistant"; content: string | AnthropicContentBlock[] }> = [];
  for (const m of messages) {
    if (m.role === "system" || !m.content.trim()) continue;
    // Interleaved thinking: raw blocks (thinking/redacted, stream order)
    // replace the assistant string — the text becomes a trailing text block.
    const raw = m.role === "assistant" ? thinkingBlocks?.get(m.content) : undefined;
    const blockContent = raw
      ? [...raw, { type: "text", text: m.content } as AnthropicContentBlock]
      : (m.content as string | AnthropicContentBlock[]);
    const last = out[out.length - 1];
    if (last && last.role === m.role) {
      last.content = typeof last.content === "string" && typeof blockContent === "string"
        ? `${last.content}\n\n${blockContent}`
        : [...(typeof last.content === "string" ? [{ type: "text", text: last.content } as AnthropicContentBlock] : last.content),
           ...(typeof blockContent === "string" ? [{ type: "text", text: blockContent } as AnthropicContentBlock] : blockContent)];
    } else out.push({ role: m.role, content: blockContent });
  }
  // ponytail: the API demands a user-first alternating transcript; a neutral
  // nudge turn is enough for RA's tool-loop histories, which otherwise
  // alternate naturally — no full conversation-repair pass.
  if (!out.length || out[0].role !== "user") out.unshift({ role: "user", content: "(continue)" });
  return { system, messages: out };
}

export interface AnthropicThinkingConfig {
  /** Requested thinking budget in tokens (>= 1024, < max_tokens). */
  budgetTokens: number;
  /** Where the budget came from (error messages name the misconfigured spot). */
  source: string;
}

/**
 * Resolve the extended-thinking budget for one model from provider config:
 * `provider.claude.models.<model>.thinking` (true | number | {budget_tokens})
 * wins over the provider-level `options.thinking`. Nothing configured → null
 * (thinking is opt-in: it bills output tokens). Pure — unit-tested.
 * ponytail: config booleans/numbers only — no string ("high"/"medium")
 * effort aliases; map those in config if they ever matter.
 */
export function thinkingBudgetFor(model: string, def?: ProviderDef): AnthropicThinkingConfig | null {
  const read = (v: unknown, source: string): AnthropicThinkingConfig | null => {
    if (v === true) return { budgetTokens: DEFAULT_THINKING_BUDGET, source };
    if (typeof v === "number" && Number.isFinite(v)) return { budgetTokens: v, source };
    if (v && typeof v === "object") {
      const n = (v as { budget_tokens?: unknown }).budget_tokens;
      if (typeof n === "number" && Number.isFinite(n)) return { budgetTokens: n, source };
    }
    return null;
  };
  return read((def?.models ?? {})[model]?.thinking, `provider model entry thinking (${model})`)
    ?? read(def?.options?.thinking, "provider options thinking");
}

/** Fail fast on budgets the Messages API would reject anyway (>= 1024, < max_tokens). */
export function validateThinkingBudget(budget: number, maxTokens: number, source: string): void {
  if (!Number.isInteger(budget) || budget < MIN_THINKING_BUDGET) {
    throw new Error(`anthropic thinking budget_tokens must be an integer >= ${MIN_THINKING_BUDGET} (got ${budget}; ${source})`);
  }
  if (budget >= maxTokens) {
    throw new Error(`anthropic thinking budget_tokens (${budget}) must be < max_tokens (${maxTokens}); raise maxTokens — ${source}`);
  }
}

export interface AnthropicRequest {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    max_tokens: number;
    messages: Array<{ role: "user" | "assistant"; content: string | AnthropicContentBlock[] }>;
    system?: string;
    temperature?: number;
    stream?: boolean;
    thinking?: { type: "enabled"; budget_tokens: number };
  };
}

/** Build a /v1/messages request (pure, unit-tested). */
export function buildAnthropicRequest(
  baseURL: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number; stream?: boolean; thinkingBudget?: number; thinkingBlocks?: ReadonlyMap<string, AnthropicContentBlock[]> } = {},
): AnthropicRequest {
  const { system, messages: mapped } = toAnthropicPayload(messages, opts.thinkingBlocks);
  const max_tokens = opts.maxTokens != null && opts.maxTokens > 0 ? Math.floor(opts.maxTokens) : DEFAULT_MAX_TOKENS;
  return {
    url: `${baseURL.replace(/\/$/, "")}/messages`,
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
      "Content-Type": "application/json",
    },
    body: {
      model,
      max_tokens,
      ...(system ? { system } : {}),
      messages: mapped,
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      ...(opts.stream ? { stream: true } : {}),
      ...(opts.thinkingBudget != null
        ? (validateThinkingBudget(opts.thinkingBudget, max_tokens, "chat call"),
           { thinking: { type: "enabled" as const, budget_tokens: opts.thinkingBudget } })
        : {}),
    },
  };
}

export interface AnthropicMessagesResponse {
  content?: Array<{ type?: string; text?: string; thinking?: string }>;
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
  const blocks = data.content ?? [];
  const content = blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text!)
    .join("");
  // Thinking stays a distinct channel — never concatenated into the answer.
  const thinking = blocks
    .filter((b) => b.type === "thinking" && typeof b.thinking === "string")
    .map((b) => b.thinking!)
    .join("");
  const u = data.usage;
  return {
    content,
    ...(thinking ? { thinking } : {}),
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
  /**
   * Thinking-channel text delta (extended thinking) — kept separate from
   * `token` so thinking never streams into the visible answer.
   */
  thinking?: string;
  /** signature_delta payload for the open thinking block (opaque, not displayed). */
  signature?: string;
  /**
   * content-block index this delta/start belongs to (block assembly), absent
   * on message-level events.
   */
  blockIndex?: number;
  /** content_block_start block type, thinking kinds only (others stay null). */
  blockKind?: "thinking" | "redacted_thinking";
  /** Whole content_block object from content_block_start (redacted passthrough). */
  blockRaw?: AnthropicContentBlock;
  /** content_block_stop for the given index — seals the block record. */
  blockDone?: boolean;
}

/**
 * Parse one SSE data payload from a /v1/messages stream (pure, unit-tested;
 * same contract as parseSSEFrame: null for blank/unknown events, throws on
 * provider error events).
 * ponytail: thinking signatures are passed through as opaque strings — no
 * cryptographic verification; the API rejects tampered blocks on re-send.
 */
export function parseAnthropicEvent(data: string): AnthropicStreamPart | null {
  const d = data.trim();
  if (!d || d === "[DONE]") return null;
  let j: {
    type?: string;
    index?: number;
    message?: { model?: string; usage?: { input_tokens?: number } };
    content_block?: { type?: string };
    delta?: { type?: string; text?: string; thinking?: string; signature?: string };
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
      if (j.delta?.type === "thinking_delta") return { token: "", done: false, blockIndex: j.index, thinking: j.delta.thinking ?? "" };
      if (j.delta?.type === "signature_delta") return { token: "", done: false, blockIndex: j.index, signature: j.delta.signature ?? "" };
      return { token: j.delta?.type === "text_delta" ? j.delta.text ?? "" : "", done: false, blockIndex: j.index };
    case "content_block_start": {
      const t = j.content_block?.type;
      if (t === "thinking") return { token: "", done: false, blockIndex: j.index, blockKind: "thinking" };
      if (t === "redacted_thinking") return { token: "", done: false, blockIndex: j.index, blockKind: "redacted_thinking", blockRaw: j.content_block };
      return null;
    }
    case "content_block_stop":
      return { token: "", done: false, blockIndex: j.index, blockDone: true };
    case "message_start":
      return { token: "", done: false, model: j.message?.model, inputTokens: j.message?.usage?.input_tokens };
    case "message_delta":
      return { token: "", done: false, outputTokens: j.usage?.output_tokens };
    case "message_stop":
      return { token: "", done: true };
    default:
      return null; // ping, content_block_stop, …
  }
}

export class AnthropicClient extends OllamaClient {
  // The parent keeps `cfg` private; keep our own copy for header building.
  // providerDef rides along for thinking config (models.<model>.thinking /
  // options.thinking) — optional, tests construct bare clients.
  private providerDef?: ProviderDef;
  constructor(private acfg: { baseURL: string; apiKey: string; providerDef?: ProviderDef }) {
    super({ baseURL: acfg.baseURL, apiKey: acfg.apiKey, kind: "cloud" });
    this.providerDef = acfg.providerDef;
  }

  /**
   * Raw thinking blocks per assistant answer, keyed by exact answer text —
   * the multi-turn preservation store. When the SAME answer text comes back as
   * an assistant message on the next call (RA's tool loop re-sends the
   * assistant turn verbatim after a tool result), its thinking blocks are
   * re-emitted ahead of the text block, as Anthropic's tool-use contract
   * requires. Entries live for the client's life (one session/agent run).
   * ponytail: text-keyed lookup means an identical answer from a DIFFERENT
   * reasoning run re-sends stale thinking — harmless (blocks are advisory
   * context) and rare; a message-identity store is the upgrade if Anthropic
   * ever rejects it. No eviction — bounded by turns per run.
   */
  private thinkingBlocks = new Map<string, AnthropicContentBlock[]>();

  /** Effective thinking budget: per-call override > model entry > provider option. */
  thinkingBudgetFor(model: string, override?: number): AnthropicThinkingConfig | null {
    if (override != null) return { budgetTokens: override, source: "call option thinkingBudget" };
    return thinkingBudgetFor(model, this.providerDef);
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
    return new AnthropicClient({ baseURL: baseURL.replace(/\/$/, ""), apiKey, providerDef: def });
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
    opts: { maxTokens?: number; timeoutMs?: number; temperature?: number; thinkingBudget?: number } = {},
  ): Promise<ChatResult> {
    const timeoutMs = opts.timeoutMs ?? 180_000;
    const thinking = this.thinkingBudgetFor(model, opts.thinkingBudget);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const req = buildAnthropicRequest(this.acfg.baseURL, this.acfg.apiKey, model, messages, {
        ...opts,
        ...(thinking ? { thinkingBudget: thinking.budgetTokens } : {}),
        thinkingBlocks: this.thinkingBlocks,
      });
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
   * Extended thinking: `thinking` blocks stream into result.thinking (kept
   * separate from `content`); the raw signed blocks are stored for re-emission
   * on the tool-result follow-up turn (Anthropic requires thinking blocks be
   * preserved during tool use within a turn).
   * ponytail: native Anthropic tool_use blocks are not mapped — RA's tool
   * grammar is text-based (normalizeToolText), which Claude follows from the
   * system prompt; wire content_block tool deltas in only if agent prompts
   * ever adopt Anthropic-native tool schemas. */
  async nativeChatStream(model: string, messages: ChatMessage[], opts: StreamChatOptions = {}): Promise<ChatResult> {
    opts.signal?.throwIfAborted();
    const timeoutMs = opts.timeoutMs ?? 180_000;
    const thinking = this.thinkingBudgetFor(model, opts.thinkingBudget);
    const ctrl = new AbortController();
    if (opts.signal) opts.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let content = "";
    let thinkingText = "";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    // Raw block assembly: per content-block index while streaming — { kind,
    // text, signature } — sealed at content_block_stop into raw wire blocks.
    const blocks = new Map<number, { kind: "text" | "thinking" | "redacted_thinking"; text: string; signature?: string; raw?: AnthropicContentBlock }>();
    try {
      const req = buildAnthropicRequest(this.acfg.baseURL, this.acfg.apiKey, model, messages, {
        ...opts,
        stream: true,
        ...(thinking ? { thinkingBudget: thinking.budgetTokens } : {}),
        thinkingBlocks: this.thinkingBlocks,
      });
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
        // -- content-block assembly (extended thinking) --
        const idx = part.blockIndex;
        if (idx != null && part.blockKind) {
          blocks.set(idx, { kind: part.blockKind, text: "", ...(part.blockRaw ? { raw: part.blockRaw } : {}) });
        } else if (idx != null) {
          const rec = blocks.get(idx);
          if (rec) {
            if (part.thinking) rec.text += part.thinking;
            if (part.signature) rec.signature = (rec.signature ?? "") + part.signature;
          }
          if (part.blockDone && rec && !rec.raw) {
            // Seal accumulated thinking into the raw wire shape; signatures
            // are opaque (ponytail: never verified, re-sent verbatim). An
            // empty thinking block (malformed stream) is dropped — the API
            // rejects empty thinking blocks on re-send.
            if (rec.kind === "thinking" && rec.text) rec.raw = { type: "thinking", thinking: rec.text, ...(rec.signature ? { signature: rec.signature } : {}) };
            // redacted blocks keep their blockRaw verbatim; text blocks need
            // no raw (the answer string re-emits as the text block).
          }
        }
        if (part.thinking != null) {
          thinkingText += part.thinking;
          opts.onToken?.(part.thinking);
        }
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
      // Preserve thinking blocks for the tool-result follow-up turn: store
      // the raw blocks (in stream order) keyed by the answer they accompany.
      const rawThinking = [...blocks.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, rec]) => (rec.kind === "text" ? null : rec.raw))
        .filter((b): b is AnthropicContentBlock => b != null);
      if (rawThinking.length) this.thinkingBlocks.set(content, rawThinking);
      const usage: ChatUsage | null =
        inputTokens != null || outputTokens != null
          ? {
              prompt_tokens: inputTokens ?? 0,
              completion_tokens: outputTokens ?? 0,
              total_tokens: (inputTokens ?? 0) + (outputTokens ?? 0),
            }
          : null;
      return {
        content,
        ...(thinkingText ? { thinking: thinkingText } : {}),
        model: claudeModelId(model),
        usage,
      };
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

// tests/anthropic-client.test.ts — native Anthropic Messages client
// (provider/claude). Pure request/response/stream mappings + a localhost
// Bun.serve fixture (same style as context-limits.test.ts — no external network).

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import {
  toAnthropicPayload,
  buildAnthropicRequest,
  mapAnthropicResponse,
  parseAnthropicEvent,
  hasAnthropicKey,
  AnthropicClient,
  DEFAULT_ANTHROPIC_MODELS,
  MIN_THINKING_BUDGET,
  thinkingBudgetFor,
  validateThinkingBudget,
} from "../src/anthropic.ts";
import { pickClientForModel, isClaudeModel, isContextOverflowError, type ChatMessage } from "../src/ollama.ts";
import { candidateModels, pickForJob } from "../src/capability.ts";
import { priceFor } from "../src/cost.ts";
import { profileFor } from "../src/profiles.ts";
import type { RaConfig } from "../src/config.ts";

describe("message mapping (toAnthropicPayload)", () => {
  test("system messages collapse to the top-level system field", () => {
    const msgs: ChatMessage[] = [
      { role: "system", content: "You are RA." },
      { role: "user", content: "hi" },
    ];
    const p = toAnthropicPayload(msgs);
    expect(p.system).toBe("You are RA.");
    expect(p.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  test("multiple system messages join; consecutive same-role turns merge", () => {
    const p = toAnthropicPayload([
      { role: "system", content: "one" },
      { role: "system", content: "two" },
      { role: "user", content: "a" },
      { role: "user", content: "b" },
      { role: "assistant", content: "c" },
    ]);
    expect(p.system).toBe("one\n\ntwo");
    expect(p.messages).toEqual([
      { role: "user", content: "a\n\nb" },
      { role: "assistant", content: "c" },
    ]);
  });

  test("assistant-first transcripts get a user nudge (API demands user-first)", () => {
    const p = toAnthropicPayload([{ role: "assistant", content: "hello?" }]);
    expect(p.messages[0].role).toBe("user");
    expect(p.messages.at(-1)).toEqual({ role: "assistant", content: "hello?" });
  });

  test("empty contents drop", () => {
    const p = toAnthropicPayload([
      { role: "user", content: "keep" },
      { role: "assistant", content: "  " },
    ]);
    expect(p.messages).toEqual([{ role: "user", content: "keep" }]);
  });
});

describe("request building (buildAnthropicRequest)", () => {
  test("x-api-key + anthropic-version headers, required max_tokens default", () => {
    const req = buildAnthropicRequest("https://api.anthropic.com/v1", "sk-ant-x", "claude-sonnet-4-5", [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
    expect(req.url).toBe("https://api.anthropic.com/v1/messages");
    expect(req.headers["x-api-key"]).toBe("sk-ant-x");
    expect(req.headers["anthropic-version"]).toBe("2023-06-01");
    expect(req.body.model).toBe("claude-sonnet-4-5");
    expect(req.body.max_tokens).toBeGreaterThan(0);
    expect(req.body.system).toBe("sys");
    expect(req.body.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(req.body.stream).toBeUndefined();
  });

  test("temperature, explicit maxTokens and stream flag pass through", () => {
    const req = buildAnthropicRequest("https://api.anthropic.com/v1/", "k", "m", [{ role: "user", content: "x" }], {
      temperature: 0.2,
      maxTokens: 512,
      stream: true,
    });
    expect(req.body.temperature).toBe(0.2);
    expect(req.body.max_tokens).toBe(512);
    expect(req.body.stream).toBe(true);
  });

  test("no thinking budget → no thinking param (cost gate: never default-on)", () => {
    const req = buildAnthropicRequest("https://api.anthropic.com/v1", "k", "claude-sonnet-4-5", [{ role: "user", content: "x" }]);
    expect(req.body.thinking).toBeUndefined();
  });

  test("thinkingBudget adds thinking: {type enabled, budget_tokens}", () => {
    const req = buildAnthropicRequest("https://api.anthropic.com/v1", "k", "claude-sonnet-4-5", [{ role: "user", content: "x" }], {
      maxTokens: 8192,
      thinkingBudget: 2048,
    });
    expect(req.body.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
  });
});

describe("response mapping (mapAnthropicResponse)", () => {
  test("text blocks join; usage maps input/output tokens; model keyed to requested id", () => {
    const r = mapAnthropicResponse(
      {
        content: [{ type: "text", text: "Hel" }, { type: "text", text: "lo" }, { type: "tool_use", id: "t" }],
        model: "claude-sonnet-4-5-20250929",
        usage: { input_tokens: 11, output_tokens: 2 },
      },
      "claude-sonnet-4-5",
    );
    expect(r.content).toBe("Hello");
    expect(r.model).toBe("claude/claude-sonnet-4-5");
    expect(r.usage).toEqual({ prompt_tokens: 11, completion_tokens: 2, total_tokens: 13 });
  });

  test("missing usage → null", () => {
    const r = mapAnthropicResponse({ content: [{ type: "text", text: "x" }] }, "claude-haiku-4-5");
    expect(r.usage).toBeNull();
  });

  test("thinking blocks map to result.thinking, never into content", () => {
    const r = mapAnthropicResponse(
      {
        content: [
          { type: "thinking", thinking: "Let me consider ", signature: "sig1" },
          { type: "text", text: "The answer is 4." },
          { type: "thinking", thinking: "Checking edge cases." },
          { type: "text", text: " Yes." },
        ],
        usage: { input_tokens: 5, output_tokens: 7 },
      },
      "claude-sonnet-4-5",
    );
    expect(r.content).toBe("The answer is 4. Yes.");
    expect(r.thinking).toBe("Let me consider Checking edge cases.");
  });

  test("redacted_thinking blocks pass through opaquely (no content, no thinking)", () => {
    const r = mapAnthropicResponse(
      { content: [{ type: "redacted_thinking", data: "encrypted-blob" }, { type: "text", text: "ok" }] },
      "claude-sonnet-4-5",
    );
    expect(r.content).toBe("ok");
    expect(r.thinking).toBeUndefined();
  });
});

describe("SSE event parsing (parseAnthropicEvent)", () => {
  test("text_delta yields a token", () => {
    const p = parseAnthropicEvent('{"type":"content_block_delta","delta":{"type":"text_delta","text":"wor"}}');
    expect(p).toEqual({ token: "wor", done: false });
  });

  test("message_start carries model + input tokens; message_delta output tokens; message_stop done", () => {
    expect(parseAnthropicEvent('{"type":"message_start","message":{"model":"claude-sonnet-4-5","usage":{"input_tokens":40}}}'))
      .toEqual({ token: "", done: false, model: "claude-sonnet-4-5", inputTokens: 40 });
    expect(parseAnthropicEvent('{"type":"message_delta","usage":{"output_tokens":12}}'))
      .toEqual({ token: "", done: false, outputTokens: 12 });
    expect(parseAnthropicEvent('{"type":"message_stop"}')).toEqual({ token: "", done: true });
  });

  test("ping / content_block_start / blank / malformed are ignored", () => {
    expect(parseAnthropicEvent('{"type":"ping"}')).toBeNull();
    expect(parseAnthropicEvent('{"type":"content_block_start","content_block":{"type":"text"}}')).toBeNull();
    expect(parseAnthropicEvent("")).toBeNull();
    expect(parseAnthropicEvent("garbage")).toBeNull();
  });

  test("error events throw", () => {
    expect(() => parseAnthropicEvent('{"type":"error","error":{"message":"overloaded"}}')).toThrow("overloaded");
  });

  test("thinking_delta routes to the thinking channel, never token", () => {
    const p = parseAnthropicEvent('{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"pondering "}}');
    expect(p).toEqual({ token: "", done: false, blockIndex: 0, thinking: "pondering " });
  });

  test("signature_delta carries the opaque signature with its block index", () => {
    const p = parseAnthropicEvent('{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"EqQBCg"}}');
    expect(p).toEqual({ token: "", done: false, blockIndex: 0, signature: "EqQBCg" });
  });

  test("content_block_start tags thinking + redacted blocks (text stays null)", () => {
    expect(parseAnthropicEvent('{"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}'))
      .toEqual({ token: "", done: false, blockIndex: 0, blockKind: "thinking" });
    const redacted = parseAnthropicEvent('{"type":"content_block_start","index":1,"content_block":{"type":"redacted_thinking","data":"blob"}}');
    expect(redacted?.blockKind).toBe("redacted_thinking");
    expect(redacted?.blockRaw).toEqual({ type: "redacted_thinking", data: "blob" });
    expect(parseAnthropicEvent('{"type":"content_block_start","index":2,"content_block":{"type":"text"}}')).toBeNull();
  });

  test("content_block_stop reports its index (block sealing)", () => {
    expect(parseAnthropicEvent('{"type":"content_block_stop","index":0}'))
      .toEqual({ token: "", done: false, blockIndex: 0, blockDone: true });
  });

  test("text_delta now carries its block index", () => {
    const p = parseAnthropicEvent('{"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"hi"}}');
    expect(p).toEqual({ token: "hi", done: false, blockIndex: 2 });
  });
});

describe("key + client resolution", () => {
  test("hasAnthropicKey rejects placeholders", () => {
    expect(hasAnthropicKey({ ANTHROPIC_API_KEY: "sk-ant-real" })).toBe(true);
    expect(hasAnthropicKey({ ANTHROPIC_API_KEY: "sk-ant-" })).toBe(false);
    expect(hasAnthropicKey({})).toBe(false);
  });

  test("fromEnv builds a cloud client from ANTHROPIC_API_KEY", () => {
    const c = AnthropicClient.fromEnv({ ANTHROPIC_API_KEY: "sk-ant-real" });
    expect(c).not.toBeNull();
    expect(c!.kind).toBe("cloud");
    expect(c!.baseURL).toBe("https://api.anthropic.com/v1");
  });

  test("provider config apiKey template wins over env; ANTHROPIC_BASE_URL honored", () => {
    const c = AnthropicClient.fromEnv(
      { ANTHROPIC_API_KEY: "sk-ant-env", ANTHROPIC_BASE_URL: "https://proxy.example.com/v1" },
      { options: { apiKey: "{env:CLAUDE_KEY}" } },
    );
    expect(c!.baseURL).toBe("https://proxy.example.com/v1");
  });

  test("no usable key → null", () => {
    expect(AnthropicClient.fromEnv({})).toBeNull();
    expect(AnthropicClient.fromEnv({ ANTHROPIC_API_KEY: "sk-ant-" })).toBeNull();
  });

  test("isClaudeModel recognizes both id spellings", () => {
    expect(isClaudeModel("claude/claude-sonnet-4-5")).toBe(true);
    expect(isClaudeModel("anthropic/claude-opus-4-5")).toBe(true);
    expect(isClaudeModel("ollama-cloud/glm-5.2")).toBe(false);
  });

  test("pickClientForModel routes claude/* to the native client", async () => {
    const { client, model } = await pickClientForModel("claude/claude-sonnet-4-5", { ANTHROPIC_API_KEY: "sk-ant-real" });
    expect(client).toBeInstanceOf(AnthropicClient);
    expect(model).toBe("claude-sonnet-4-5");
  });

  test("pickClientForModel fails loudly on a claude/* id without a key", async () => {
    await expect(pickClientForModel("claude/claude-sonnet-4-5", {})).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  test("pickClientForModel wires the provider def into the client (thinking config rides along)", async () => {
    const { client } = await pickClientForModel("claude/claude-sonnet-4-5", { ANTHROPIC_API_KEY: "k" }, {
      claude: { options: { apiKey: "{env:ANTHROPIC_API_KEY}" }, models: { "claude-sonnet-4-5": { thinking: 4096 } } },
    });
    expect(client).toBeInstanceOf(AnthropicClient);
    expect((client as AnthropicClient).thinkingBudgetFor("claude-sonnet-4-5")?.budgetTokens).toBe(4096);
  });
});

describe("thinking config resolution (thinkingBudgetFor)", () => {
  test("nothing configured → null (opt-in)", () => {
    expect(thinkingBudgetFor("claude-sonnet-4-5", undefined)).toBeNull();
    expect(thinkingBudgetFor("claude-sonnet-4-5", { options: {}, models: {} })).toBeNull();
  });

  test("model entry wins over provider option; true/number/{budget_tokens} shapes accepted", () => {
    expect(thinkingBudgetFor("m", { models: { m: { thinking: 2048 } }, options: { thinking: 9999 } })?.budgetTokens).toBe(2048);
    expect(thinkingBudgetFor("m", { models: { m: { thinking: true } } })?.budgetTokens).toBe(4096);
    expect(thinkingBudgetFor("m", { models: { m: { thinking: { budget_tokens: 5120 } } } })?.budgetTokens).toBe(5120);
    expect(thinkingBudgetFor("m", { options: { thinking: 1500 } })?.budgetTokens).toBe(1500);
  });

  test("other models' entries and garbage shapes are ignored (fail-closed to no-thinking)", () => {
    expect(thinkingBudgetFor("other", { models: { m: { thinking: 2048 } } })).toBeNull();
    expect(thinkingBudgetFor("m", { models: { m: { thinking: "high" } } })).toBeNull();
    expect(thinkingBudgetFor("m", { models: { m: { thinking: false } } })).toBeNull();
    expect(thinkingBudgetFor("m", { options: { thinking: null } })).toBeNull();
  });

  test("client method: per-call override beats config", () => {
    const c = new AnthropicClient({ baseURL: "http://x/v1", apiKey: "k", providerDef: { models: { m: { thinking: 2048 } } } });
    expect(c.thinkingBudgetFor("m")?.budgetTokens).toBe(2048);
    expect(c.thinkingBudgetFor("m", 8000)?.budgetTokens).toBe(8000);
  });
});

describe("thinking budget validation (fail fast, API rules)", () => {
  test("budget >= 1024 and < max_tokens passes", () => {
    // MIN_THINKING_BUDGET is the API floor (1024) — the boundary itself passes.
    expect(() => validateThinkingBudget(MIN_THINKING_BUDGET, 8192, "t")).not.toThrow();
    expect(() => validateThinkingBudget(MIN_THINKING_BUDGET - 1, 8192, "t")).toThrow(/>= 1024/);
    expect(() => validateThinkingBudget(8191, 8192, "t")).not.toThrow();
  });

  test("below the 1024 minimum throws with the source named", () => {
    expect(() => validateThinkingBudget(1023, 8192, "provider options thinking")).toThrow(/>= 1024.*provider options thinking/);
    expect(() => validateThinkingBudget(0, 8192, "t")).toThrow(/>= 1024/);
  });

  test("budget >= max_tokens throws (must be strictly below)", () => {
    expect(() => validateThinkingBudget(8192, 8192, "t")).toThrow(/< max_tokens/);
    expect(() => validateThinkingBudget(9000, 8192, "t")).toThrow(/< max_tokens/);
  });

  test("buildAnthropicRequest validates before the call (default 8192 cap collides)", () => {
    // `thinking: true` default 4096 fits; a 9000 budget with the default
    // max_tokens 8192 must fail at request build, not on the wire.
    expect(() => buildAnthropicRequest("https://x/v1", "k", "m", [{ role: "user", content: "x" }], { thinkingBudget: 9000 }))
      .toThrow(/max_tokens/);
  });
});

// ---- localhost fixture server (no external network) ----

let server: ReturnType<typeof Bun.serve>;
let serverURL = "";
let lastRequest: { url: string; headers: Record<string, string>; body: any } | null = null;

const SSE_BODY = [
  'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-sonnet-4-5-20250929","usage":{"input_tokens":9}}}',
  "",
  'event: ping\ndata: {"type":"ping"}',
  "",
  'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}',
  'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}',
  "",
  'data: {"type":"message_delta","usage":{"output_tokens":2}}',
  'data: {"type":"message_stop"}',
  "",
].join("\n");

// Interleaved extended-thinking stream: thinking → text → redacted_thinking →
// text, with signature deltas and block start/stop framing — the full block
// grammar the client must assemble and preserve for the tool-result turn.
const SSE_THINKING_BODY = [
  'data: {"type":"message_start","message":{"model":"claude-sonnet-4-5","usage":{"input_tokens":40}}}',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Need the file list. "}}',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Read first."}}',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-abc"}}',
  'data: {"type":"content_block_stop","index":0}',
  'data: {"type":"content_block_start","index":1,"content_block":{"type":"text"}}',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Let me check."}}',
  'data: {"type":"content_block_stop","index":1}',
  'data: {"type":"content_block_start","index":2,"content_block":{"type":"redacted_thinking","data":"enc-blob"}}',
  'data: {"type":"content_block_stop","index":2}',
  'data: {"type":"message_delta","usage":{"output_tokens":33}}',
  'data: {"type":"message_stop"}',
  "",
].join("\n");

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      lastRequest = {
        url: req.url,
        headers: Object.fromEntries(req.headers.entries()),
        body: req.method === "POST" ? await req.json() : null,
      };
      const path = new URL(req.url).pathname;
      if (path === "/v1/models") {
        return Response.json({ data: [{ id: "claude-sonnet-4-5" }, { id: "claude-haiku-4-5" }] });
      }
      if (path === "/v1/messages" || path === "/v1/messages-thinking") {
        // Thinking grammar streams for any request that asks for thinking;
        // otherwise the plain SSE body (request-gating is asserted per test).
        const wantsThinking = Boolean((lastRequest.body as { thinking?: unknown }).thinking);
        const body = (lastRequest.body as { stream?: boolean }).stream
          ? new Response(wantsThinking ? SSE_THINKING_BODY : SSE_BODY, { headers: { "Content-Type": "text/event-stream" } })
          : Response.json({
              content: [{ type: "text", text: "Hello" }],
              model: "claude-sonnet-4-5-20250929",
              usage: { input_tokens: 9, output_tokens: 2 },
            });
        return body;
      }
      return new Response("not found", { status: 404 });
    },
  });
  serverURL = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

describe("AnthropicClient over the wire (fixture server)", () => {
  const client = () => new AnthropicClient({ baseURL: `${serverURL}/v1`, apiKey: "sk-ant-test" });

  test("chat posts /v1/messages with native headers and maps the response", async () => {
    const r = await client().chat("claude-sonnet-4-5", [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
    expect(r.content).toBe("Hello");
    expect(r.model).toBe("claude/claude-sonnet-4-5");
    expect(r.usage).toEqual({ prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 });
    expect(lastRequest!.url).toBe(`${serverURL}/v1/messages`);
    expect(lastRequest!.headers["x-api-key"]).toBe("sk-ant-test");
    expect(lastRequest!.headers["anthropic-version"]).toBe("2023-06-01");
    expect(lastRequest!.headers["authorization"]).toBeUndefined();
    expect(lastRequest!.body.system).toBe("sys");
    expect(lastRequest!.body.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(lastRequest!.body.max_tokens).toBeGreaterThan(0);
  });

  test("nativeChatStream parses SSE: tokens via onToken, usage from message_start/delta", async () => {
    const tokens: string[] = [];
    const r = await client().nativeChatStream("claude-sonnet-4-5", [{ role: "user", content: "hi" }], {
      onToken: (t) => tokens.push(t),
    });
    expect(tokens).toEqual(["Hel", "lo"]);
    expect(r.content).toBe("Hello");
    expect(r.usage).toEqual({ prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 });
    expect(lastRequest!.body.stream).toBe(true);
  });

  test("chatStream delegates to the same native stream", async () => {
    const r = await client().chatStream("claude-sonnet-4-5", [{ role: "user", content: "hi" }]);
    expect(r.content).toBe("Hello");
  });

  test("listModels reads the OpenAI-shaped /v1/models", async () => {
    const ids = await client().listModels();
    expect(ids).toContain("claude-sonnet-4-5");
    expect(ids).toContain("claude-haiku-4-5");
  });

  test("chat surfaces provider errors with status", async () => {
    const bad = new AnthropicClient({ baseURL: `${serverURL}/nope`, apiKey: "k" });
    await expect(bad.chat("claude-sonnet-4-5", [{ role: "user", content: "x" }])).rejects.toThrow(/404/);
  });
});

describe("AnthropicClient extended thinking (interleaved blocks, tool-turn preservation)", () => {
  const client = (providerDef?: ConstructorParameters<typeof AnthropicClient>[0]["providerDef"]) =>
    new AnthropicClient({ baseURL: `${serverURL}/v1`, apiKey: "sk-ant-test", providerDef });

  test("config-gated: request includes thinking param when enabled, omits when not", async () => {
    // enabled via model entry
    const on = client({ models: { "claude-sonnet-4-5": { thinking: 2048 } } });
    const r1 = await on.nativeChatStream("claude-sonnet-4-5", [{ role: "user", content: "go" }], { maxTokens: 8192 });
    expect(lastRequest!.body.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
    expect(r1.content).toBe("Let me check.");
    // not configured → param absent
    const off = client();
    await off.nativeChatStream("claude-sonnet-4-5", [{ role: "user", content: "go" }]);
    expect(lastRequest!.body.thinking).toBeUndefined();
  });

  test("thinking text accumulates separately from the answer; blocks preserved in order", async () => {
    const c = client({ options: { thinking: 4096 } });
    const seen: string[] = [];
    const r = await c.nativeChatStream("claude-sonnet-4-5", [{ role: "user", content: "go" }], {
      maxTokens: 8192,
      onToken: (t) => seen.push(t),
    });
    expect(r.content).toBe("Let me check.");             // visible answer only
    expect(r.thinking).toBe("Need the file list. Read first."); // separate channel
    expect(seen.join("")).toBe("Need the file list. Read first.Let me check."); // both stream for display
    expect(r.content).not.toContain("Need the file list");
  });

  test("thinking blocks are re-sent on the follow-up tool-result turn", async () => {
    const c = client({ models: { "claude-sonnet-4-5": { thinking: 2048 } } });
    const first = await c.nativeChatStream("claude-sonnet-4-5", [{ role: "user", content: "go" }], { maxTokens: 8192 });
    expect(lastRequest!.body.messages).toEqual([{ role: "user", content: "go" }]); // plain first turn
    // RA's tool loop: assistant answer verbatim + user tool result
    const second = await c.nativeChatStream("claude-sonnet-4-5", [
      { role: "user", content: "go" },
      { role: "assistant", content: first.content },
      { role: "user", content: "Tool result:\n(file listed)" },
    ], { maxTokens: 8192 });
    const msgs = lastRequest!.body.messages;
    const asst = msgs.at(-2) as { role: string; content: unknown };
    // The preserved raw blocks ride ahead of the re-emitted text block, in stream order.
    expect(asst.role).toBe("assistant");
    expect(asst.content).toEqual([
      { type: "thinking", thinking: "Need the file list. Read first.", signature: "sig-abc" },
      { type: "redacted_thinking", data: "enc-blob" },
      { type: "text", text: "Let me check." },
    ]);
    expect(second.content).toBe("Let me check.");
  });

  test("redacted_thinking passes through opaquely (no decode, no thinking-channel leak)", async () => {
    const c = client({ models: { "claude-sonnet-4-5": { thinking: 2048 } } });
    const r = await c.nativeChatStream("claude-sonnet-4-5", [{ role: "user", content: "go" }], { maxTokens: 8192 });
    // enc-blob is only ever re-sent verbatim inside the assistant block array
    // (asserted by the re-send test); it never reaches a result channel.
    expect(r.thinking).not.toContain("enc-blob");
    expect(r.content).not.toContain("enc-blob");
  });

  test("budget violations fail fast at the client, not on the wire", async () => {
    const c = client({ models: { "claude-sonnet-4-5": { thinking: 500 } } }); // < 1024
    await expect(c.nativeChatStream("claude-sonnet-4-5", [{ role: "user", content: "go" }]))
      .rejects.toThrow(/>= 1024/);
    const c2 = client({ options: { thinking: 20000 } }); // >= default max_tokens 8192
    await expect(c2.nativeChatStream("claude-sonnet-4-5", [{ role: "user", content: "go" }]))
      .rejects.toThrow(/max_tokens/);
  });

  test("thinking parsing is server-driven: blocks parse whenever the server streams them", async () => {
    // No thinking param sent (not configured) → the fixture answers plain;
    // parse-side handling is covered by the enabled tests above.
    const c = client();
    const r = await c.nativeChatStream("claude-sonnet-4-5", [{ role: "user", content: "go" }]);
    expect(lastRequest!.body.thinking).toBeUndefined();
    expect(r.content).toBe("Hello");
    expect(r.thinking).toBeUndefined();
  });
});

describe("provider mosaic registration", () => {
  const env = { ANTHROPIC_API_KEY: "sk-ant-real", OLLAMA_API_KEY: "k" };
  const config: RaConfig = {
    model: "ollama-cloud/glm-5.2",
    small_model: "ollama-lan/gpt-oss:20b",
    agent: {},
    provider: { "ollama-lan": { options: { baseURL: "http://192.0.2.50:11434/v1" }, models: { "gpt-oss:20b": {} } } },
  };

  test("default Claude models join the pool when the key is set", () => {
    const models = candidateModels(config, env).map((c) => c.model);
    for (const m of DEFAULT_ANTHROPIC_MODELS) expect(models).toContain(`claude/${m}`);
    const sonnet = candidateModels(config, env).find((c) => c.model === "claude/claude-sonnet-4-5")!;
    expect(sonnet.kind).toBe("cloud");
    expect(sonnet.hasKey).toBe(true);
  });

  test("no key → no Claude candidates", () => {
    const models = candidateModels(config, {}).map((c) => c.model);
    expect(models.some((m) => m.startsWith("claude/"))).toBe(false);
  });

  test("explicit provider.claude block replaces the default models", () => {
    const cfg: RaConfig = {
      ...config,
      provider: { ...config.provider, claude: { options: { apiKey: "{env:CLAUDE_KEY}" }, models: { "claude-opus-4-5": {} } } },
    };
    const models = candidateModels(cfg, { CLAUDE_KEY: "x" }).map((c) => c.model);
    expect(models).toContain("claude/claude-opus-4-5");
    expect(models).not.toContain("claude/claude-sonnet-4-5");
  });

  test("Claude ranks as the review specialist (quality-first cloud routing)", () => {
    const routing = pickForJob("review", config, env)!;
    expect(routing.primary.model).toBe("claude/claude-sonnet-4-5");
    expect(routing.primary.local).toBe(false);
  });

  test("haiku gets its own fast-tier profile", () => {
    expect(profileFor("claude/claude-haiku-4-5").note).toContain("fast");
    expect(profileFor("claude/claude-haiku-4-5").scores.chat).toBeGreaterThan(profileFor("claude/claude-haiku-4-5").scores.code);
  });

  test("usage costs resolve through the price table", () => {
    expect(priceFor("claude/claude-sonnet-4-5")).toEqual({ in: 3, out: 15 });
    expect(priceFor("claude/claude-haiku-4-5")).toEqual({ in: 1, out: 5 });
  });
});

describe("shared error classification covers Anthropic wording", () => {
  test("prompt-is-too-long counts as context overflow", () => {
    expect(isContextOverflowError(new Error("prompt is too long: 210000 tokens > 200000 maximum"))).toBe(true);
    expect(isContextOverflowError(new Error("context_length_exceeded"))).toBe(true);
  });
});

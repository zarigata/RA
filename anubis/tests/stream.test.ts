import { describe, expect, test } from "bun:test";
import { parseOllamaStreamLine, parseSSEFrame, keepAliveMs } from "../src/ollama.ts";

describe("ollama stream parsers", () => {
  test("content chunk yields a token", () => {
    const p = parseOllamaStreamLine('{"message":{"content":"hel"},"done":false}');
    expect(p).not.toBeNull();
    expect(p!.token).toBe("hel");
    expect(p!.done).toBe(false);
    expect(p!.usage).toBeUndefined();
  });

  test("final chunk carries usage", () => {
    const p = parseOllamaStreamLine('{"done":true,"model":"qwen3.8:latest","eval_count":12,"prompt_eval_count":40}');
    expect(p!.done).toBe(true);
    expect(p!.usage).toEqual({ prompt_tokens: 40, completion_tokens: 12, total_tokens: 52 });
    expect(p!.model).toBe("qwen3.8:latest");
  });

  test("blank and malformed lines are ignored", () => {
    expect(parseOllamaStreamLine("")).toBeNull();
    expect(parseOllamaStreamLine("   ")).toBeNull();
    expect(parseOllamaStreamLine("not json")).toBeNull();
  });

  test("thinking-only chunk yields empty token", () => {
    const p = parseOllamaStreamLine('{"message":{"thinking":"hmm"},"done":false}');
    expect(p!.token).toBe("");
  });
});

describe("SSE frame parser", () => {
  test("delta content yields a token", () => {
    const p = parseSSEFrame('{"choices":[{"delta":{"content":"wor"}}],"model":"glm-5.2"}');
    expect(p!.token).toBe("wor");
    expect(p!.model).toBe("glm-5.2");
  });

  test("[DONE] sentinel", () => {
    expect(parseSSEFrame("[DONE]")!.done).toBe(true);
  });

  test("usage-only frame", () => {
    const p = parseSSEFrame('{"usage":{"prompt_tokens":9,"completion_tokens":2,"total_tokens":11}}');
    expect(p!.usage).toEqual({ prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 });
    expect(p!.token).toBe("");
  });

  test("blank frames are ignored", () => {
    expect(parseSSEFrame("")).toBeNull();
    expect(parseSSEFrame("  ")).toBeNull();
    expect(parseSSEFrame("garbage")).toBeNull();
  });
});

describe("keepAliveMs", () => {
  test("units", () => {
    expect(keepAliveMs("30m")).toBe(1_800_000);
    expect(keepAliveMs("90s")).toBe(90_000);
    expect(keepAliveMs("2h")).toBe(7_200_000);
    expect(keepAliveMs("500ms")).toBe(500);
    expect(keepAliveMs("10")).toBe(10_000); // bare number = seconds
  });
  test("invalid → undefined", () => {
    expect(keepAliveMs(undefined)).toBeUndefined();
    expect(keepAliveMs("soon")).toBeUndefined();
    expect(keepAliveMs("-5m")).toBeUndefined();
  });
});

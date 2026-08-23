import { describe, expect, test } from "bun:test";
import { pickModel, smallOllamaUrls } from "../src/ollama.ts";

describe("small Ollama routing", () => {
  test(".251 first, localhost gemma second", () => {
    const urls = smallOllamaUrls({});
    expect(urls[0]).toBe("http://192.168.1.251:11434");
    expect(urls).toContain("http://localhost:11434");
    expect(urls.length).toBe(2);
  });

  test("OLLAMA_LOCAL_URL overrides localhost default", () => {
    const urls = smallOllamaUrls({
      OLLAMA_LAN_URL: "http://192.168.1.251:11434",
      OLLAMA_LOCAL_URL: "http://127.0.0.1:11434",
    });
    expect(urls).toEqual([
      "http://192.168.1.251:11434",
      "http://127.0.0.1:11434",
      "http://localhost:11434",
    ]);
  });

  test("pickModel prefers qwen3.8 over gemma when both present", () => {
    const available = ["gemma:latest", "qwen3.8:latest", "gemma2:2b"];
    expect(pickModel("ollama-lan/qwen3.8:latest", available)).toBe("qwen3.8:latest");
    expect(pickModel("missing", available)).toBe("qwen3.8:latest");
  });

  test("pickModel falls back to gemma when qwen absent", () => {
    const available = ["gemma:latest", "gemma2:2b"];
    expect(pickModel("ollama-lan/qwen3.8:latest", available)).toBe("gemma:latest");
  });
});

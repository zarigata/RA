import { describe, expect, test } from "bun:test";
import { redact, restore, hasSecret } from "../src/redact.ts";

describe("vibeguard redaction", () => {
  test("redacts OpenAI-style key", () => {
    const input = "key=sk-abcdefghijklmnopqrstuvwxyz123456";
    const r = redact(input);
    expect(r.count).toBe(1);
    expect(r.text).not.toContain("sk-abcdef");
    expect(restore(r.text, r.stash)).toBe(input);
  });
  test("redacts Anthropic key without partial match", () => {
    const input = "key=sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234";
    const r = redact(input);
    expect(r.count).toBe(1);
    expect(r.text).not.toContain("sk-ant");
    expect(restore(r.text, r.stash)).toBe(input);
  });
  test("redacts Google key", () => {
    const input = "key=AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
    const r = redact(input);
    expect(r.count).toBeGreaterThanOrEqual(1);
    expect(r.text).not.toContain("AIza");
    expect(restore(r.text, r.stash)).toBe(input);
  });
  test("redacts GitHub PAT", () => {
    const input = "token=ghp_abcdefghijklmnopqrstuvwxyz1234567890";
    const r = redact(input);
    expect(r.count).toBe(1);
    expect(restore(r.text, r.stash)).toBe(input);
  });
  test("redacts AWS access key", () => {
    const input = "aws=AKIAIOSFODNN7EXAMPLE";
    const r = redact(input);
    expect(r.count).toBe(1);
    expect(restore(r.text, r.stash)).toBe(input);
  });
  test("redacts Ollama-style token", () => {
    const input = "key=deadbeefdeadbeefdeadbeefdeadbeef.SYNTHETICtestToken123456";
    const r = redact(input);
    expect(r.count).toBeGreaterThanOrEqual(1);
    expect(restore(r.text, r.stash)).toBe(input);
  });
  test("no secrets → no redaction", () => {
    const input = "just normal text about code";
    const r = redact(input);
    expect(r.count).toBe(0);
    expect(r.text).toBe(input);
  });
  test("multiple secrets redacted", () => {
    const input = "a=sk-abcdefghijklmnopqrstuvwxyz123456 b=ghp_abcdefghijklmnopqrstuvwxyz1234567890";
    const r = redact(input);
    expect(r.count).toBe(2);
    expect(restore(r.text, r.stash)).toBe(input);
  });
  test("round-trip preserves nested content", () => {
    const input = 'config: {"token":"sk-abcdefghijklmnopqrstuvwxyz123456","x":1}';
    const r = redact(input);
    expect(restore(r.text, r.stash)).toBe(input);
  });
  test("hasSecret helper", () => {
    expect(hasSecret("sk-abcdefghijklmnopqrstuvwxyz123456")).toBe(true);
    expect(hasSecret("clean text")).toBe(false);
  });
});

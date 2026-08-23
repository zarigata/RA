import { describe, expect, test } from "bun:test";
import { truncate, truncateJson } from "../src/truncate.ts";

describe("dcp truncation", () => {
  test("keeps short output unchanged", () => {
    expect(truncate("short")).toBe("short");
    expect(truncate("x".repeat(20000))).toBe("x".repeat(20000));
  });
  test("truncates long output", () => {
    const long = "x".repeat(50000);
    const out = truncate(long);
    expect(out.length).toBeLessThan(50000);
    expect(out).toContain("truncated by dcp");
  });
  test("preserves head and tail", () => {
    const head = "HEAD".repeat(600);
    const tail = "TAIL".repeat(600);
    const long = head + "MIDDLE".repeat(1000) + tail;
    const out = truncate(long, 5000, 1250, 1250);
    expect(out.startsWith("HEAD")).toBe(true);
    expect(out.endsWith("TAIL")).toBe(true);
    expect(out).not.toContain("MIDDLE");
  });
  test("custom threshold", () => {
    expect(truncate("x".repeat(100), 50).length).toBeLessThan(101);
    expect(truncate("short", 50)).toBe("short");
  });
  test("truncateJson stringifies objects", () => {
    const out = truncateJson({ a: 1 });
    expect(out).toContain('"a"');
  });
});

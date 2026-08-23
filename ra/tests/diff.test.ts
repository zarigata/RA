import { describe, expect, test } from "bun:test";
import { diffLines, formatDiff } from "../src/diff.ts";

describe("diff", () => {
  test("identical text yields all context", () => {
    const d = diffLines("a\nb\nc", "a\nb\nc");
    expect(d.every((l) => l.type === "context")).toBe(true);
  });

  test("detects additions and removals", () => {
    const d = diffLines("a\nb", "a\nb\nc");
    expect(d.some((l) => l.type === "add" && l.text === "c")).toBe(true);

    const d2 = diffLines("a\nb\nc", "a\nb");
    expect(d2.some((l) => l.type === "remove" && l.text === "c")).toBe(true);
  });

  test("detects a replacement", () => {
    const d = diffLines("hello world", "hello RA");
    expect(d.some((l) => l.type === "remove" && l.text === "hello world")).toBe(true);
    expect(d.some((l) => l.type === "add" && l.text === "hello RA")).toBe(true);
  });

  test("formatDiff prefixes lines", () => {
    const d = diffLines("a", "b");
    const text = formatDiff(d);
    expect(text).toContain("- a");
    expect(text).toContain("+ b");
  });
});

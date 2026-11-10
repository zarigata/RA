// tests/tui-history.test.ts — prompt history state machine (parity row 42).
// Pins: readline-like up/down navigation, draft restore, dedup, bounding to
// 200, and persistence round-trip through an injected store.

import { describe, expect, test } from "bun:test";
import { createPromptHistory, HISTORY_LIMIT } from "../src/tui/history.ts";

function inMemory() {
  let stored: string[] = [];
  return {
    read: () => [...stored],
    write: (e: string[]) => { stored = [...e]; },
    snapshot: () => [...stored],
  };
}

describe("prompt history navigation", () => {
  test("up recalls newest→oldest; down walks back and restores the draft", () => {
    const h = createPromptHistory(["first", "second", "third"]);
    expect(h.up("my draft")).toBe("third");
    expect(h.up("third")).toBe("second");
    expect(h.up("second")).toBe("first");
    expect(h.up("first")).toBe("first"); // clamps at the oldest
    expect(h.down()).toBe("second");
    expect(h.down()).toBe("third");
    // down past the newest returns the saved draft (readline behavior)
    expect(h.down()).toBe("my draft");
  });

  test("draft is saved on the first up and restored after full navigation", () => {
    const h = createPromptHistory(["a"]);
    expect(h.up("half-typed")).toBe("a");
    expect(h.down()).toBe("half-typed");
    expect(h.browsing()).toBe(false);
  });

  test("empty history: up returns null (input keeps scrolling the transcript)", () => {
    const h = createPromptHistory([]);
    expect(h.up("")).toBeNull();
    expect(h.browsing()).toBe(false);
    expect(h.down()).toBeNull();
  });

  test("add: trims, skips empties and consecutive duplicates, resets navigation", () => {
    const h = createPromptHistory([], { read: () => [], write: () => {} });
    h.add("  hello  ");
    h.add("hello"); // consecutive dedup
    h.add("");
    h.add("world");
    expect(h.entries()).toEqual(["hello", "world"]);
    expect(h.up("")).toBe("world"); // fresh navigation after add
  });

  test("bounds to the last 200 entries", () => {
    const store = inMemory();
    const h = createPromptHistory([], store);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h.add(`p${i}`);
    const entries = h.entries();
    expect(entries.length).toBe(HISTORY_LIMIT);
    expect(entries[0]).toBe(`p${21}`);
    expect(entries[entries.length - 1]).toBe(`p${HISTORY_LIMIT + 20}`);
    // persistence got the same bounded list
    expect(store.snapshot()).toEqual(entries);
  });

  test("persists through the injected store and reloads on construction", () => {
    const store = inMemory();
    createPromptHistory(["saved-1", "saved-2"], store).add("saved-3");
    const reloaded = createPromptHistory([], store);
    expect(reloaded.entries()).toEqual(["saved-1", "saved-2", "saved-3"]);
    expect(reloaded.up("")).toBe("saved-3");
  });

  test("malformed persisted JSON falls back to empty", () => {
    const h = createPromptHistory([], { read: () => { throw new Error("corrupt"); }, write: () => {} });
    expect(h.entries()).toEqual([]);
    expect(h.up("")).toBeNull();
  });
});

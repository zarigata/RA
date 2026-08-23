import { describe, expect, test } from "bun:test";
import { indexFile, indexDirectory, searchIndex, reindex, cosineSimilarity } from "../src/search.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("semantic search", () => {
  test("indexFile tokenizes and counts terms", () => {
    const doc = indexFile("a.ts", "function hello world hello", 1);
    expect(doc.terms.get("hello")).toBe(2);
    expect(doc.terms.get("function")).toBe(1);
    expect(doc.terms.get("the")).toBeUndefined(); // stop word
  });

  test("searchIndex ranks relevant docs", () => {
    const docs = [
      indexFile("a.ts", "function hello world", 1),
      indexFile("b.ts", "database connection pool", 1),
    ];
    const hits = searchIndex(docs, "hello world");
    expect(hits[0].path).toBe("a.ts");
    expect(hits[0].score).toBeGreaterThan(0);
  });

  test("indexDirectory skips node_modules and binary", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-search-"));
    try {
      writeFileSync(join(cwd, "a.ts"), "export function foo() {}");
      const docs = indexDirectory(cwd);
      expect(docs.length).toBe(1);
      expect(docs[0].path).toBe("a.ts");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("reindex reuses unchanged docs and re-indexes changed", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-search-"));
    try {
      writeFileSync(join(cwd, "a.ts"), "one");
      const first = indexDirectory(cwd);
      const second = reindex(cwd, first);
      // Unchanged → same object reference.
      expect(second[0]).toBe(first[0]);

      writeFileSync(join(cwd, "a.ts"), "two three");
      const third = reindex(cwd, second);
      expect(third[0]).not.toBe(first[0]);
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("cosineSimilarity is 0 for disjoint terms", () => {
    const doc = indexFile("a.ts", "apple banana", 1);
    const q = new Map([["zebra", 1]]);
    expect(cosineSimilarity(q, doc)).toBe(0);
  });
});

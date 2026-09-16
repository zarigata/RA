// tests/tui-upgrade.test.ts — ra.76 TUI upgrades: styled diff viewer,
// markdown tables, and diff hunk math.

import { describe, expect, test } from "bun:test";
import { diffLines, intoHunks, renderDiffStyled, diffStats } from "../src/diff.ts";
import { renderMarkdown, renderTable, visibleWidth } from "../src/tui/markdown.ts";

describe("diff hunks + styling", () => {
  const oldText = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n");
  const newText = ["a", "b", "X", "d", "e", "f", "Y"].join("\n");

  test("hunks carry @@ headers with old/new counts", () => {
    const hunks = intoHunks(diffLines(oldText, newText), 1);
    expect(hunks.length).toBeGreaterThanOrEqual(1);
    for (const h of hunks) {
      expect(h.header).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@$/);
    }
  });

  test("far-apart changes produce separate hunks", () => {
    const hunks = intoHunks(diffLines(oldText, newText), 0);
    expect(hunks.length).toBe(2);
  });

  test("styled render colors adds green, removes red, truncates long diffs", () => {
    const style = {
      add: (s: string) => `\x1b[32m${s}\x1b[0m`,
      remove: (s: string) => `\x1b[31m${s}\x1b[0m`,
      context: (s: string) => `\x1b[2m${s}\x1b[0m`,
      hunk: (s: string) => `\x1b[36m${s}\x1b[0m`,
    };
    const out = renderDiffStyled(diffLines(oldText, newText), style);
    expect(out.some((l) => l.includes("\x1b[32m+"))).toBe(true);
    expect(out.some((l) => l.includes("\x1b[31m-"))).toBe(true);
    const big = renderDiffStyled(diffLines("", Array.from({ length: 1000 }, (_, i) => `l${i}`).join("\n")), style, 50);
    expect(big.length).toBeLessThanOrEqual(51);
    expect(big[big.length - 1]).toContain("truncated");
  });

  test("stats count adds and removes", () => {
    expect(diffStats(diffLines(oldText, newText))).toEqual({ added: 2, removed: 3 });
  });
});

describe("markdown tables (ra.76)", () => {
  test("renderTable aligns GFM tables with box borders", () => {
    const rows = [
      "| model | lane | tokens |",
      "| --- | :---: | ---: |",
      "| gpt-oss:20b | 251 | 4096 |",
      "| glm-5.2 | cloud | 98304 |",
    ];
    const table = renderTable(rows, undefined, 100);
    expect(table).not.toBeNull();
    expect(table![0]).toMatch(/^┌/);
    expect(table![table!.length - 1]).toMatch(/^└/);
    expect(table!.some((l) => l.includes("gpt-oss:20b"))).toBe(true);
    // aligned: every row has the same visible width
    const widths = new Set(table!.map(visibleWidth));
    expect(widths.size).toBe(1);
  });

  test("non-table rows return null", () => {
    expect(renderTable(["just text", "no pipes here"], undefined, 80)).toBeNull();
    expect(renderTable(["| a | b |", "| x | y |"], undefined, 80)).toBeNull(); // no separator
  });

  test("renderMarkdown renders embedded tables", () => {
    const md = [
      "Models:",
      "",
      "| name | lane |",
      "| --- | --- |",
      "| gpt-oss:20b | 251 |",
      "",
      "after",
    ].join("\n");
    const lines = renderMarkdown(md);
    expect(lines.some((l) => l.includes("┌"))).toBe(true);
    expect(lines.some((l) => l.includes("gpt-oss:20b"))).toBe(true);
    expect(lines[lines.length - 1]).toContain("after");
  });

  test("tables scale down to the terminal width", () => {
    const rows = [
      "| verylongcolumnname | anotherverylongcolumn |",
      "| --- | --- |",
      "| value | value2 |",
    ];
    const st = { accent: (s: string) => s, muted: (s) => s, strong: (s: string) => s, error: (s: string) => s };
    const table = renderTable(rows, st, 30)!;
    expect(visibleWidth(table[0])).toBeLessThanOrEqual(30 + 4); // truncation slack from min col width
  });
});

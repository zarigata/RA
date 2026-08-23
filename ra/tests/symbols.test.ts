import { describe, expect, test } from "bun:test";
import { outlineSymbols, formatOutline } from "../src/symbols.ts";

describe("symbol outline", () => {
  test("extracts Python functions and classes", () => {
    const src = `class Foo:\n    def bar(self):\n        pass\n\ndef baz():\n    return 1\n`;
    const syms = outlineSymbols(src);
    expect(syms).toContainEqual({ kind: "class", name: "Foo", line: 1 });
    expect(syms).toContainEqual({ kind: "function", name: "bar", line: 2 });
    expect(syms).toContainEqual({ kind: "function", name: "baz", line: 5 });
  });

  test("extracts TypeScript functions, classes, and consts", () => {
    const src = `export class Widget {}\nexport function make() {}\nconst x = 1;\n`;
    const syms = outlineSymbols(src);
    expect(syms).toContainEqual({ kind: "class", name: "Widget", line: 1 });
    expect(syms).toContainEqual({ kind: "function", name: "make", line: 2 });
    expect(syms).toContainEqual({ kind: "const", name: "x", line: 3 });
  });

  test("extracts Go functions and types", () => {
    const src = `package main\n\nfunc main() {\n}\n\ntype Config struct {\n}\n`;
    const syms = outlineSymbols(src);
    expect(syms).toContainEqual({ kind: "function", name: "main", line: 3 });
    expect(syms).toContainEqual({ kind: "type", name: "Config", line: 6 });
  });

  test("formatOutline renders line:kind name", () => {
    const out = formatOutline([{ kind: "function", name: "main", line: 3 }]);
    expect(out).toBe("3: function main");
  });

  test("empty source yields no symbols", () => {
    expect(outlineSymbols("")).toEqual([]);
    expect(formatOutline([])).toBe("(no symbols)");
  });
});

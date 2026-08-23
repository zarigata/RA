import { describe, expect, test } from "bun:test";
import { extractCodeFile } from "../src/runner.ts";

describe("hello.py guard", () => {
  test("replaces recursive hello with print", () => {
    const content = "```python\ndef hello():\n    hello()\n```";
    const file = extractCodeFile(content, "write a hello world function in one file");
    expect(file?.name).toBe("hello.py");
    expect(file?.body).toContain('print("Hello, World!")');
  });

  test("keeps valid print body", () => {
    const content = '```python\ndef hello():\n    print("hi")\n```';
    const file = extractCodeFile(content, "hello world");
    expect(file?.body).toContain('print("hi")');
    expect(file?.body).toContain('__main__');
  });

  test("appends __main__ when def hello has print but no entrypoint", () => {
    const content = '```python\ndef hello():\n    print("Hello, World!")\n```';
    const file = extractCodeFile(content, "write a hello world function in one file");
    expect(file?.body).toContain('print("Hello, World!")');
    expect(file?.body).toMatch(/if __name__ == ["']__main__["']:\s*\n\s*hello\(\)/);
  });

  test("extracts unfenced HTML", () => {
    const content = `<!DOCTYPE html><html><body><h1>Cookie</h1></body></html>`;
    const file = extractCodeFile(content, "cookie recipe website");
    expect(file?.name).toBe("index.html");
    expect(file?.body).toContain("Cookie");
  });

  test("wraps bare HTML fragment with doctype shell", async () => {
    const { ensureIndexHtmlBody } = await import("../src/runner.ts");
    const out = ensureIndexHtmlBody("<h1>Hello</h1>");
    expect(out).toMatch(/<!DOCTYPE html>/i);
    expect(out).toContain("<h1>Hello</h1>");
    expect(out).toMatch(/<\/html>/i);
  });

  test("adds doctype when html present without it", async () => {
    const { ensureIndexHtmlBody } = await import("../src/runner.ts");
    const out = ensureIndexHtmlBody("<html><body>x</body></html>");
    expect(out.startsWith("<!DOCTYPE html>")).toBe(true);
  });
});

describe("ensureTaskArtifacts", () => {
  test("writes cookie stub when empty", async () => {
    const { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { ensureTaskArtifacts } = await import("../src/runner.ts");
    const cwd = mkdtempSync(join(tmpdir(), "ra-ensure-"));
    try {
      const wrote = ensureTaskArtifacts(cwd, "Create a cookie recipe website", []);
      expect(wrote.length).toBe(1);
      expect(existsSync(join(cwd, "index.html"))).toBe(true);
      expect(readFileSync(join(cwd, "index.html"), "utf-8").toLowerCase()).toContain("cookie");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("repairs index.html missing doctype", async () => {
    const { mkdtempSync, rmSync, readFileSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { ensureTaskArtifacts } = await import("../src/runner.ts");
    const cwd = mkdtempSync(join(tmpdir(), "ra-html-"));
    try {
      writeFileSync(join(cwd, "index.html"), "<h1>Hello</h1>\n");
      ensureTaskArtifacts(cwd, "hello world website page", [join(cwd, "index.html")]);
      const body = readFileSync(join(cwd, "index.html"), "utf-8");
      expect(body).toMatch(/<!DOCTYPE html>/i);
      expect(body).toContain("<h1>Hello</h1>");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });
});

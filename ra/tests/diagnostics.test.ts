import { describe, expect, test } from "bun:test";
import { checkCommandFor, parseDiagnostics, formatDiagnostics, diagnoseFile, findLspServer, BUILTIN_LSP_SERVERS, hasLspServer, LspClient, type LspServerConfig } from "../src/diagnostics.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("diagnostics", () => {
  test("checkCommandFor maps extensions", () => {
    expect(checkCommandFor("a.ts")).not.toBeNull();
    expect(checkCommandFor("a.py")).not.toBeNull();
    expect(checkCommandFor("a.go")).not.toBeNull();
    expect(checkCommandFor("a.unknown")).toBeNull();
  });

  test("parseDiagnostics parses TypeScript errors", () => {
    const diags = parseDiagnostics("src/a.ts(12,3): error TS2304: Cannot find name 'x'.", "a.ts");
    expect(diags.length).toBe(1);
    expect(diags[0].file).toBe("src/a.ts");
    expect(diags[0].line).toBe(12);
    expect(diags[0].severity).toBe("error");
  });

  test("parseDiagnostics parses Python syntax errors", () => {
    const diags = parseDiagnostics('File "a.py", line 3\n    x =', "a.py");
    expect(diags.length).toBe(1);
    expect(diags[0].line).toBe(3);
  });

  test("formatDiagnostics renders and handles empty", () => {
    expect(formatDiagnostics([])).toBe("(no diagnostics)");
    expect(formatDiagnostics([{ file: "a.ts", line: 1, severity: "error", message: "x" }])).toContain("a.ts:1: error: x");
  });

  test("diagnoseFile returns diagnostics for a broken Python file", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-diag-"));
    try {
      writeFileSync(join(cwd, "bad.py"), "def foo(:\n    pass\n");
      const diags = await diagnoseFile(cwd, "bad.py");
      expect(diags.length).toBeGreaterThan(0);
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });
});

describe("LSP server protocol", () => {
  test("BUILTIN_LSP_SERVERS covers common languages", () => {
    const exts = BUILTIN_LSP_SERVERS.flatMap((s) => s.extensions);
    expect(exts).toContain("ts");
    expect(exts).toContain("py");
    expect(exts).toContain("go");
    expect(exts).toContain("rs");
  });

  test("findLspServer finds TypeScript server", () => {
    const server = findLspServer("foo.ts");
    expect(server).not.toBeNull();
    expect(server!.extensions).toContain("ts");
  });

  test("findLspServer finds Python server", () => {
    const server = findLspServer("foo.py");
    expect(server).not.toBeNull();
    expect(server!.extensions).toContain("py");
  });

  test("findLspServer returns null for unknown extension", () => {
    expect(findLspServer("foo.unknown")).toBeNull();
  });

  test("findLspServer with custom servers", () => {
    const custom: LspServerConfig[] = [
      { command: "my-lsp", extensions: ["xyz"] },
    ];
    expect(findLspServer("file.xyz", custom)).not.toBeNull();
    expect(findLspServer("file.ts", custom)).toBeNull();
  });

  test("hasLspServer returns boolean for known types", () => {
    // Just verify it doesn't throw
    const result = hasLspServer("foo.ts");
    expect(typeof result).toBe("boolean");
  });
  test("hasLspServer is false when the configured executable is missing", () => {
    const custom: LspServerConfig[] = [
      { command: "__ra_missing_lsp_binary__", extensions: ["xyz"] },
    ];
    expect(hasLspServer("file.xyz", custom)).toBe(false);
  });


  test("LSP byte framing handles Unicode JSON bodies", async () => {
    const client = new LspClient({ command: "unused", extensions: ["ts"] }, process.cwd()) as any;
    let resolved: unknown;
    client.pending.set(7, (result: unknown) => { resolved = result; });
    const body = JSON.stringify({ jsonrpc: "2.0", id: 7, result: { message: "café ✓" } });
    client.buffer = Buffer.concat([
      Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`, "ascii"),
      Buffer.from(body, "utf-8"),
    ]);
    client.parseLspMessages();
    expect(resolved).toEqual({ message: "café ✓" });
    expect(client.buffer.length).toBe(0);
  });

  test("LSP diagnostic line zero maps to user-facing line one", async () => {
    const client = new LspClient({ command: "unused", extensions: ["ts"] }, process.cwd()) as any;
    client.initialized = true;
    client.request = async () => ({
      items: [{ message: "first line", severity: 1, range: { start: { line: 0 } } }],
    });
    const out = await client.getDiagnostics("file.ts");
    expect(out[0]).toMatchObject({ line: 1, severity: "error", message: "first line" });
  });
});

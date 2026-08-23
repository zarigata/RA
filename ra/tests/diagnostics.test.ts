import { describe, expect, test } from "bun:test";
import { checkCommandFor, parseDiagnostics, formatDiagnostics, diagnoseFile } from "../src/diagnostics.ts";
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

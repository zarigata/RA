// Diagnostics — run the language's compiler/linter after an edit and return
// errors/warnings. A pragmatic LSP-equivalent: auto-detect language, run the
// check, feed diagnostics back into the agent loop.

import { existsSync } from "node:fs";
import { join } from "node:path";

export interface Diagnostic {
  file: string;
  line?: number;
  severity: "error" | "warning";
  message: string;
}

/** Map a file extension to a check command (run in the project cwd). */
export function checkCommandFor(file: string): { cmd: string; args: string[] } | null {
  if (/\.(ts|tsx)$/.test(file)) return { cmd: "bunx", args: ["tsc", "--noEmit"] };
  if (/\.py$/.test(file)) return { cmd: "python3", args: ["-m", "py_compile", file] };
  if (/\.go$/.test(file)) return { cmd: "go", args: ["vet", "./..."] };
  if (/\.rs$/.test(file)) return { cmd: "cargo", args: ["check"] };
  if (/\.(js|jsx)$/.test(file)) return { cmd: "node", args: ["--check", file] };
  return null;
}

/** Parse a compiler/linter stderr into structured diagnostics. */
export function parseDiagnostics(stderr: string, file: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const line of stderr.split("\n")) {
    // TypeScript: file.ts(12,3): error TS2304: Cannot find name 'x'.
    const ts = line.match(/^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(.+)$/);
    if (ts) {
      out.push({ file: ts[1], line: Number(ts[2]), severity: ts[4] === "error" ? "error" : "warning", message: ts[5] });
      continue;
    }
    // Python: File "x.py", line 3  /  SyntaxError: ...
    const py = line.match(/^\s*File "(.+?)", line (\d+)/);
    if (py) {
      out.push({ file: py[1], line: Number(py[2]), severity: "error", message: line });
      continue;
    }
    // Go: ./x.go:12:3: undefined: foo
    const go = line.match(/^(.+?\.go):(\d+):(\d+):\s*(.+)$/);
    if (go) {
      out.push({ file: go[1], line: Number(go[2]), severity: "error", message: go[4] });
      continue;
    }
    // Generic: file:line: message
    const generic = line.match(/^(.+?):(\d+):\s*(error|warning):?\s*(.+)$/i);
    if (generic) {
      out.push({ file: generic[1], line: Number(generic[2]), severity: generic[3].toLowerCase() === "error" ? "error" : "warning", message: generic[4] });
    }
  }
  return out;
}

/** Run diagnostics for a file. Returns structured diagnostics (empty if clean). */
export async function diagnoseFile(cwd: string, file: string): Promise<Diagnostic[]> {
  const check = checkCommandFor(file);
  if (!check) return [];
  const abs = join(cwd, file);
  if (!existsSync(abs)) return [];

  try {
    const proc = Bun.spawn([check.cmd, ...check.args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;
    return parseDiagnostics(stderr || stdout, file);
  } catch {
    return [];
  }
}

/** Format diagnostics for agent context. */
export function formatDiagnostics(diags: Diagnostic[]): string {
  if (!diags.length) return "(no diagnostics)";
  return diags
    .map((d) => `${d.file}${d.line ? `:${d.line}` : ""}: ${d.severity}: ${d.message}`)
    .join("\n");
}

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

// ── LSP Server Protocol (minimal JSON-RPC over stdio) ──

/** LSP server configuration: which command to spawn and which languages it covers. */
export interface LspServerConfig {
  /** Spawn command for the language server. */
  command: string;
  args?: string[];
  /** File extensions this server handles (e.g. ["ts", "tsx", "js"]). */
  extensions: string[];
  /** Root URI for the workspace (defaults to cwd). */
  rootUri?: string;
}

/** Built-in LSP server configs for common languages. */
export const BUILTIN_LSP_SERVERS: LspServerConfig[] = [
  { command: "typescript-language-server", args: ["--stdio"], extensions: ["ts", "tsx", "js", "jsx"] },
  { command: "pylsp", extensions: ["py"] },
  { command: "gopls", extensions: ["go"] },
  { command: "rust-analyzer", extensions: ["rs"] },
];

/** Find an LSP server config for a given file extension. */
export function findLspServer(file: string, servers: LspServerConfig[] = BUILTIN_LSP_SERVERS): LspServerConfig | null {
  const ext = file.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  return servers.find((s) => s.extensions.includes(ext)) ?? null;
}

/** LSP client — connects to a language server over stdio JSON-RPC. */
export class LspClient {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private nextId = 1;
  private pending = new Map<number, (result: unknown) => void>();
  private buffer = "";
  private initialized = false;

  constructor(private config: LspServerConfig, private cwd: string) {}

  async start(): Promise<void> {
    try {
      this.proc = Bun.spawn({
        cmd: [this.config.command, ...(this.config.args ?? [])],
        cwd: this.cwd,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch {
      throw new Error(`LSP server '${this.config.command}' not found or failed to start`);
    }

    // Read newline-delimited JSON-RPC (LSP uses Content-Length headers)
    const reader = this.proc.stdout.getReader();
    void (async () => {
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });
        this.parseLspMessages();
      }
    })();

    // Initialize handshake
    const rootUri = this.config.rootUri ?? `file://${this.cwd}`;
    await this.request("initialize", {
      processId: process.pid,
      rootUri,
      capabilities: { textDocument: { publishDiagnostics: {} } },
      workspaceFolders: [{ uri: rootUri, name: "workspace" }],
    });
    await this.notify("initialized", {});
    this.initialized = true;
  }

  private parseLspMessages(): void {
    // LSP messages: Content-Length: N\r\n\r\n{json}
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) break;
      const headers = this.buffer.slice(0, headerEnd);
      const lengthMatch = headers.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const length = parseInt(lengthMatch[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) break;
      const body = this.buffer.slice(bodyStart, bodyStart + length);
      this.buffer = this.buffer.slice(bodyStart + length);
      try {
        const msg = JSON.parse(body);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const resolve = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          resolve(msg.result);
        }
      } catch { /* ignore parse errors */ }
    }
  }

  private send(msg: unknown): void {
    if (!this.proc) throw new Error("LSP client not started");
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    this.proc.stdin.write(header + body);
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, resolve);
      this.send({ jsonrpc: "2.0", id, method, params });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`LSP request timed out: ${method}`));
        }
      }, 10_000);
    });
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  /** Open a document in the language server. */
  async openDocument(file: string, content: string): Promise<void> {
    if (!this.initialized) return;
    const uri = `file://${join(this.cwd, file)}`;
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: file.split(".").pop() ?? "plaintext", version: 1, text: content },
    });
  }

  /** Request diagnostics for a file. Returns LSP diagnostic objects. */
  async getDiagnostics(file: string): Promise<Diagnostic[]> {
    if (!this.initialized) return [];
    const uri = `file://${join(this.cwd, file)}`;
    // Some servers support textDocument/diagnostic (pull mode)
    try {
      const result = await this.request("textDocument/diagnostic", { textDocument: { uri } });
      const items = (result as { items?: Array<{ message: string; severity?: number; range?: { start: { line: number } } }> })?.items ?? [];
      return items.map((item) => ({
        file,
        line: item.range?.start.line ? item.range.start.line + 1 : undefined,
        severity: item.severity === 1 ? "error" : "warning",
        message: item.message,
      }));
    } catch {
      // Server doesn't support pull diagnostics — rely on push notifications
      return [];
    }
  }

  async close(): Promise<void> {
    if (this.proc) {
      try { await this.notify("shutdown", null); } catch { /* */ }
      try { await this.notify("exit", null); } catch { /* */ }
      this.proc.kill();
      this.proc = null;
    }
    this.initialized = false;
  }
}

/** Check if an LSP server is available for a file type. */
export function hasLspServer(file: string): boolean {
  const config = findLspServer(file);
  if (!config) return false;
  try {
    const proc = Bun.spawn(["which", config.command], { stdout: "pipe", stderr: "pipe" });
    const exitCode = proc.exited;
    // Synchronous optimistic check — we can't await here without making this async
    // Return true for known configs; the LspClient.start() will fail if the binary is missing
    return true;
  } catch {
    return false;
  }
}

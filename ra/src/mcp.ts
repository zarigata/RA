// Minimal MCP (Model Context Protocol) stdio client.
// Spawns a server process, performs the JSON-RPC handshake, lists and calls tools.

import { spawn, type Subprocess } from "bun";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class McpClient {
  private proc: Subprocess | null = null;
  private nextId = 1;
  private pending = new Map<number, (r: JsonRpcResponse) => void>();
  private buffer = "";

  constructor(private config: McpServerConfig) {}

  async start(): Promise<void> {
    this.proc = spawn({
      cmd: [this.config.command, ...(this.config.args ?? [])],
      env: { ...process.env, ...(this.config.env ?? {}) },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Accumulate newline-delimited JSON-RPC messages from stdout.
    const reader = this.proc.stdout.getReader();
    void (async () => {
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, idx).trim();
          this.buffer = this.buffer.slice(idx + 1);
          if (!line) continue;
          try {
            const msg = JSON.parse(line) as JsonRpcResponse;
            const resolve = this.pending.get(msg.id);
            if (resolve) {
              this.pending.delete(msg.id);
              resolve(msg);
            }
          } catch {
            /* ignore non-JSON lines (e.g. server logs) */
          }
        }
      }
    })();

    // Handshake: initialize.
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "ra", version: "1.0.0" },
    });
    await this.notify("notifications/initialized", {});
  }

  private send(msg: unknown): void {
    if (!this.proc) throw new Error("MCP client not started");
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  private request(method: string, params: unknown): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, resolve);
      this.send({ jsonrpc: "2.0", id, method, params });
      // Timeout guard.
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request timed out: ${method}`));
        }
      }, 10_000);
    });
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  async listTools(): Promise<McpTool[]> {
    const res = await this.request("tools/list", {});
    if (res.error) throw new Error(`MCP tools/list error: ${res.error.message}`);
    const tools = (res.result as { tools?: McpTool[] })?.tools ?? [];
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const res = await this.request("tools/call", { name, arguments: args });
    if (res.error) throw new Error(`MCP tools/call error: ${res.error.message}`);
    const result = res.result as { content?: Array<{ type: string; text?: string }> };
    const text = (result.content ?? [])
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join("\n");
    return text || JSON.stringify(result);
  }

  async close(): Promise<void> {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }
}

/**
 * Connect to all configured MCP servers and return their tools, tagged with
 * the server name. Servers that fail to start are skipped (logged to stderr).
 */
export async function loadMcpTools(
  servers: Record<string, McpServerConfig>,
): Promise<Array<McpTool & { server: string }>> {
  const out: Array<McpTool & { server: string }> = [];
  for (const [name, cfg] of Object.entries(servers)) {
    const client = new McpClient(cfg);
    try {
      await client.start();
      const tools = await client.listTools();
      for (const t of tools) out.push({ ...t, server: name });
    } catch (e) {
      console.error(`MCP server '${name}' failed to start: ${String(e)}`);
    } finally {
      await client.close();
    }
  }
  return out;
}

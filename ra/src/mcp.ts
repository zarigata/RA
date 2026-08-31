// Minimal MCP (Model Context Protocol) stdio client.
// Spawns a server process, performs the JSON-RPC handshake, lists and calls tools.

import { spawnCommand, type ManagedCommand, type CommandContext } from "./sandbox.ts";

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

/** SSE/HTTP MCP server config (Streamable HTTP transport). */
export interface McpHttpServerConfig {
  url: string;
  headers?: Record<string, string>;
  /** OAuth 2.1 configuration for authenticated MCP servers. */
  oauth?: McpOAuthConfig;
}

/** OAuth 2.1 configuration for MCP HTTP servers (PKCE flow). */
export interface McpOAuthConfig {
  /** Authorization server metadata URL (RFC 8414). */
  metadataUrl?: string;
  /** Client ID registered with the authorization server. */
  clientId: string;
  /** Client secret (for confidential clients; omit for public clients using PKCE). */
  clientSecret?: string;
  /** Scopes to request. */
  scopes?: string[];
  /** Redirect URI for the authorization code flow. */
  redirectUri?: string;
  /** Environment variable name containing a pre-existing bearer token. */
  tokenEnvVar?: string;
}

/** Union config type: either stdio command or HTTP URL. */
export type McpServerEntry = McpServerConfig | McpHttpServerConfig;

/** Type guard: is this an HTTP config? */
export function isHttpConfig(cfg: McpServerEntry): cfg is McpHttpServerConfig {
  return typeof (cfg as McpHttpServerConfig).url === "string";
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class McpClient {
  private managed: ManagedCommand | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: JsonRpcResponse) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private buffer = "";

  constructor(private config: McpServerConfig, private context: CommandContext = { cwd: process.cwd() }) {}

  async start(): Promise<void> {
    this.managed = spawnCommand(this.context, [this.config.command, ...(this.config.args ?? [])], { tool: "mcp", env: this.config.env });
    this.managed.process.stderr.resume();
    this.managed.process.stdout.on("data", chunk => {
      this.buffer += chunk.toString();
      if (this.buffer.length > 1_000_000) { this.failAll(new Error("MCP response exceeded buffer limit")); this.managed?.stop(); return; }
      let index: number;
      while ((index = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, index).trim(); this.buffer = this.buffer.slice(index + 1);
        try {
          const message = JSON.parse(line) as JsonRpcResponse;
          const item = this.pending.get(message.id);
          if (item) { this.pending.delete(message.id); clearTimeout(item.timer); item.resolve(message); }
        } catch { /* non-protocol server output */ }
      }
    });
    void this.managed.finished.then(() => this.failAll(new Error("MCP server exited")), error => this.failAll(new Error(String(error))));
    await this.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ra", version: "1.0.0" } });
    this.send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  }
  private failAll(error: Error) { for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); } this.pending.clear(); }
  private send(message: unknown) {
    this.context.signal?.throwIfAborted();
    if (!this.managed) throw new Error("MCP client not started");
    this.managed.process.stdin.write(JSON.stringify(message) + "\n");
  }
  private request(method: string, params: unknown): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`MCP request timed out: ${method}`)); this.managed?.stop(); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ jsonrpc: "2.0", id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async listTools(): Promise<McpTool[]> {
    const response = await this.request("tools/list", {});
    if (response.error) throw new Error(`MCP tools/list error: ${response.error.message}`);
    return (response.result as { tools?: McpTool[] })?.tools ?? [];
  }
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const response = await this.request("tools/call", { name, arguments: args });
    if (response.error) throw new Error(`MCP tools/call error: ${response.error.message}`);
    const result = response.result as { content?: Array<{ type: string; text?: string }> };
    return (result.content ?? []).filter(c => c.type === "text" && c.text).map(c => c.text).join("\n") || JSON.stringify(result);
  }
  async close(): Promise<void> {
    const managed = this.managed; this.managed = null;
    this.failAll(new Error("MCP client closed"));
    if (managed) { managed.stop(); await managed.finished.catch(() => {}); }
  }
}

/**
 * OAuth token manager — handles token resolution for MCP HTTP servers.
 * Checks for pre-existing tokens from env vars, and generates PKCE challenges
 * for the authorization code flow with public clients.
 */
export class McpOAuthManager {
  private cachedToken: string | null = null;

  constructor(private oauth: McpOAuthConfig) {}

  /** Resolve a bearer token: env var first, then cached token. */
  resolveToken(): string | null {
    if (this.cachedToken) return this.cachedToken;
    if (this.oauth.tokenEnvVar) {
      const envToken = process.env[this.oauth.tokenEnvVar];
      if (envToken) {
        this.cachedToken = envToken;
        return envToken;
      }
    }
    return null;
  }

  /** Generate a PKCE code verifier (43-128 chars, RFC 7636). */
  static generateCodeVerifier(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  /** Derive the code challenge (S256) from a verifier. */
  static async deriveCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  /** Build the authorization URL for the PKCE flow. */
  buildAuthUrl(issuer: string, challenge: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.oauth.clientId,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    if (this.oauth.scopes?.length) params.set("scope", this.oauth.scopes.join(" "));
    if (this.oauth.redirectUri) params.set("redirect_uri", this.oauth.redirectUri);
    return `${issuer}?${params.toString()}`;
  }

  /** Exchange an authorization code for an access token. */
  async exchangeCode(
    tokenUrl: string,
    code: string,
    verifier: string,
  ): Promise<{ access_token: string; token_type?: string; expires_in?: number }> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: this.oauth.clientId,
    });
    if (this.oauth.clientSecret) body.set("client_secret", this.oauth.clientSecret);
    if (this.oauth.redirectUri) body.set("redirect_uri", this.oauth.redirectUri);

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`OAuth token exchange failed: ${res.status}`);
    const tokens = await res.json();
    this.cachedToken = tokens.access_token;
    return tokens;
  }

  /** Set a token directly (e.g. from a manual flow). */
  setToken(token: string): void {
    this.cachedToken = token;
  }
}

/**
 * MCP HTTP/SSE client — connects to a server via HTTP POST (JSON-RPC over HTTP).
 * Uses the Streamable HTTP transport: POST request with JSON-RPC body, response
 * is either a single JSON-RPC response or an SSE stream of messages.
 */
export class McpHttpClient {
  private nextId = 1;
  private oauthManager: McpOAuthManager | null = null;

  constructor(private config: McpHttpServerConfig, private signal?: AbortSignal) {
    if (config.oauth) {
      this.oauthManager = new McpOAuthManager(config.oauth);
    }
  }

  async start(): Promise<void> {
    // Handshake: initialize.
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "ra", version: "1.0.0" },
    });
    await this.notify("notifications/initialized", {});
  }

  private async send(msg: unknown): Promise<JsonRpcResponse | null> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.config.headers ?? {}),
    };
    // Attach OAuth bearer token if available
    if (this.oauthManager) {
      const token = this.oauthManager.resolveToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }
    const res = await fetch(this.config.url, {
      method: "POST",
      headers,
      body: JSON.stringify(msg),
      signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`MCP HTTP error: ${res.status} ${res.statusText}`);
    if (res.status === 202 || res.status === 204) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      // SSE: read the stream until we get our response
      const reader = res.body?.getReader();
      if (!reader) throw new Error("MCP HTTP: SSE stream without body");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE events are delimited by double newlines
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          const dataLines = event.split("\n").filter((l) => l.startsWith("data:"));
          for (const line of dataLines) {
            const json = line.slice(5).trim();
            try {
              const parsed = JSON.parse(json) as JsonRpcResponse;
              if (parsed.id === (msg as { id?: number }).id) return parsed;
            } catch { /* ignore */ }
          }
        }
      }
      return null;
    }
    // Single JSON response
    return await res.json() as JsonRpcResponse;
  }

  private async request(method: string, params: unknown): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const res = await this.send({ jsonrpc: "2.0", id, method, params });
    if (!res) throw new Error(`MCP HTTP request timed out: ${method}`);
    return res;
  }

  private async notify(method: string, params: unknown): Promise<void> {
    await this.send({ jsonrpc: "2.0", method, params });
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
    // HTTP connections are stateless; nothing to close.
  }
}

/**
 * Connect to all configured MCP servers and return their tools, tagged with
 * the server name. Servers that fail to start are skipped (logged to stderr).
 */
export async function loadMcpTools(
  servers: Record<string, McpServerEntry>, context: CommandContext = { cwd: process.cwd() },
): Promise<Array<McpTool & { server: string }>> {
  const out: Array<McpTool & { server: string }> = [];
  for (const [name, cfg] of Object.entries(servers)) {
    context.signal?.throwIfAborted();
    const client = isHttpConfig(cfg) ? new McpHttpClient(cfg, context.signal) : new McpClient(cfg, context);
    try { await client.start(); for (const tool of await client.listTools()) out.push({ ...tool, server: name }); }
    catch (error) { context.signal?.throwIfAborted(); console.error(`MCP server '${name}' failed: ${String(error)}`); }
    finally { await client.close(); }
  }
  return out;
}

/**
 * Lazy MCP tool search: connect to servers only when a query is issued, and
 * return tool definitions whose name or description matches the query. This
 * avoids eagerly loading every tool definition into the agent context.
 */
export async function searchMcpTools(
  servers: Record<string, McpServerEntry>,
  query: string,
): Promise<Array<McpTool & { server: string }>> {
  const q = query.toLowerCase();
  const all = await loadMcpTools(servers);
  if (!q) return all;
  return all.filter(
    (t) => t.name.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q),
  );
}

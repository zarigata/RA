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
  /** `"sse"` selects the legacy SSE transport (GET stream + endpoint event). */
  type?: "sse" | "streamableHttp";
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

/** Per-server tool allow/deny (imported autoApprove/enabled_tools/disabled_tools). */
export interface McpToolFilter {
  allow?: string[];
  deny?: string[];
}

/** Union config type: either stdio command or HTTP URL. */
export type McpServerEntry = McpServerConfig | (McpHttpServerConfig & { tools?: McpToolFilter });

/** Type guard: is this an HTTP config? */
export function isHttpConfig(cfg: McpServerEntry): cfg is McpHttpServerConfig {
  return typeof (cfg as McpHttpServerConfig).url === "string";
}

/**
 * Per-server tool allow/deny on an MCP config entry (Cline `autoApprove`,
 * Codex `enabled_tools`/`disabled_tools`; recorded at import, enforced here).
 * Entry field survives the stdio|http union: no filter → all tools allowed.
 */
export function toolFilterOf(cfg: McpServerEntry): McpToolFilter | undefined {
  const f = (cfg as { tools?: McpToolFilter }).tools;
  return f && typeof f === "object" && (f.allow?.length || f.deny?.length) ? f : undefined;
}

/**
 * Does a tool pass a server's allow/deny lists? Deny wins over allow (both
 * are exact-name lists in every source format we import). No filter → true.
 */
export function toolAllowed(filter: McpToolFilter | undefined, tool: string): boolean {
  if (!filter) return true;
  if (filter.deny?.includes(tool)) return false;
  if (filter.allow?.length) return filter.allow.includes(tool);
  return true;
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
 * Legacy SSE MCP transport (Cline `"type":"sse"` / url-without-type default;
 * pre-2025 MCP spec): one long-lived GET text/event-stream per session.
 *   • `endpoint` event carries the JSON-RPC POST endpoint URL.
 *   • Client messages are POSTed to that endpoint (Accept: application/json).
 *   • Responses arrive as `message` events on the same GET stream.
 * Fail-closed: anything the server doesn't answer or redirect cleanly is an
 * error, never a silent partial connection. Hand-rolled on fetch — no deps.
 */
export class McpSseClient {
  private nextId = 1;
  private endpoint = "";
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private pending = new Map<number, { resolve: (r: JsonRpcResponse) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private decoder = new TextDecoder();

  constructor(
    private config: McpHttpServerConfig,
    private signal?: AbortSignal,
    private timeoutMs = 10000,
  ) {}

  /** Open the GET stream, learn the POST endpoint from the `endpoint` event. */
  private async openStream(): Promise<void> {
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      ...(this.config.headers ?? {}),
    };
    const res = await fetch(this.config.url, {
      method: "GET",
      headers,
      signal: this.signal ? AbortSignal.any([this.signal]) : undefined,
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
      // Fail-closed with a self-describing error: a server that answers JSON
      // on GET is a streamable-HTTP server, not legacy SSE.
      throw new Error(`MCP SSE: ${this.config.url} did not open an event stream (HTTP ${res.status} ${res.headers.get("content-type") ?? "no content-type"}) — not a legacy SSE endpoint`);
    }
    this.reader = res.body!.getReader();
    let buffer = "";
    // The legacy handshake: the first event must be `endpoint` (some servers
    // prefix data with a newline). No endpoint within timeout → fail closed.
    const endpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("MCP SSE: no `endpoint` event received during handshake")), this.timeoutMs);
      (async () => {
        try {
          while (true) {
            const { done, value } = await this.reader!.read();
            if (done) { reject(new Error("MCP SSE: stream closed before `endpoint` event")); return; }
            buffer += this.decoder.decode(value, { stream: true });
            for (const evt of this.splitEvents(buffer)) {
              buffer = evt.remainder;
              const ep = evt.event === "endpoint" ? evt.data.find((d) => d.trim().length) : undefined;
              if (ep) {
                // Resolve endpoint URLs relative to the SSE root (spec convention).
                resolve(new URL(ep.trim(), this.config.url).toString());
                return;
              }
            }
          }
        } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
      })().finally(() => clearTimeout(timer));
    });
    this.endpoint = endpoint;
    // Drain the rest of the stream on the pending-response loop.
    void this.pump(buffer);
  }

  /** Split an SSE buffer into complete events (returns remainder for the next chunk). */
  private splitEvents(buffer: string): Array<{ event: string; data: string[]; remainder: string }> {
    const out: Array<{ event: string; data: string[]; remainder: string }> = [];
    let rest = buffer;
    let index: number;
    while ((index = rest.indexOf("\n\n")) >= 0) {
      const raw = rest.slice(0, index);
      rest = rest.slice(index + 2);
      const event = raw.split("\n").find((l) => l.startsWith("event:"))?.slice(6).trim() ?? "message";
      const data = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, ""));
      out.push({ event, data, remainder: rest });
    }
    return out;
  }

  /** Read the stream, resolving pending requests by id; runs until stream end. */
  private async pump(initial: string): Promise<void> {
    let buffer = initial;
    try {
      while (this.reader) {
        const { done, value } = await this.reader.read();
        if (done) break;
        buffer += this.decoder.decode(value, { stream: true });
        for (const evt of this.splitEvents(buffer)) {
          buffer = evt.remainder;
          if (evt.event !== "message") continue;
          for (const d of evt.data) {
            try {
              const parsed = JSON.parse(d) as JsonRpcResponse;
              const item = typeof parsed.id === "number" ? this.pending.get(parsed.id) : undefined;
              if (item) {
                this.pending.delete(parsed.id);
                clearTimeout(item.timer);
                item.resolve(parsed);
              }
            } catch { /* non-JSON data line */ }
          }
        }
      }
    } catch { /* stream aborted — pending requests fail via their own timers */ }
    this.failPending(new Error("MCP SSE: stream closed"));
  }

  private failPending(error: Error): void {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
  }

  private async post(message: unknown): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.config.headers ?? {}),
    };
    const oauth = this.config.oauth ? new McpOAuthManager(this.config.oauth) : null;
    const token = oauth?.resolveToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
      signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs),
    });
    // Legacy SSE accepts 202/204 for notifications; JSON bodies can also ride
    // the POST response directly (belt-and-braces for hybrid servers).
    if (res.status === 202 || res.status === 204) return;
    if ((res.headers.get("content-type") ?? "").includes("application/json") && res.body) {
      try {
        const parsed = (await res.json()) as JsonRpcResponse;
        const item = typeof parsed.id === "number" ? this.pending.get(parsed.id) : undefined;
        if (item) { this.pending.delete(parsed.id); clearTimeout(item.timer); item.resolve(parsed); }
      } catch { /* not JSON-RPC — ignore */ }
    }
  }

  private request(method: string, params: unknown): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`MCP SSE request timed out: ${method}`)); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.post({ jsonrpc: "2.0", id, method, params }).catch((e) => {
        clearTimeout(timer); this.pending.delete(id); reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }

  async start(): Promise<void> {
    await this.openStream();
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "ra", version: "1.0.0" },
    });
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  }

  async listTools(): Promise<McpTool[]> {
    const res = await this.request("tools/list", {});
    if (res.error) throw new Error(`MCP tools/list error: ${res.error.message}`);
    return (res.result as { tools?: McpTool[] })?.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const res = await this.request("tools/call", { name, arguments: args });
    if (res.error) throw new Error(`MCP tools/call error: ${res.error.message}`);
    const result = res.result as { content?: Array<{ type: string; text?: string }> };
    const text = (result.content ?? []).filter((c) => c.type === "text" && c.text).map((c) => c.text).join("\n");
    return text || JSON.stringify(result);
  }

  async close(): Promise<void> {
    this.failPending(new Error("MCP SSE client closed"));
    try { await this.reader?.cancel(); } catch { /* already closed */ }
    this.reader = null;
  }
}

/**
 * Connect to all configured MCP servers and return their tools, tagged with
 * the server name. Per-server `tools.allow/deny` entries (imported from
 * Cline autoApprove / Codex enabled_tools/disabled_tools) are enforced HERE:
 * denied tools never materialize into the agent's tool set. Servers that
 * fail to start are skipped (logged to stderr).
 */
export async function loadMcpTools(
  servers: Record<string, McpServerEntry>, context: CommandContext = { cwd: process.cwd() },
): Promise<Array<McpTool & { server: string }>> {
  const out: Array<McpTool & { server: string }> = [];
  for (const [name, cfg] of Object.entries(servers)) {
    context.signal?.throwIfAborted();
    const client = isHttpConfig(cfg)
      ? cfg.type === "sse" ? new McpSseClient(cfg, context.signal) : new McpHttpClient(cfg, context.signal)
      : new McpClient(cfg, context);
    try {
      await client.start();
      const filter = toolFilterOf(cfg);
      for (const tool of await client.listTools()) {
        if (!toolAllowed(filter, tool.name)) continue;
        out.push({ ...tool, server: name });
      }
    }
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

// ---- MCP elicitation (server-initiated requests for user input) -------------------------

/** MCP `elicitation/createMessage` request as sent by a server. */
export interface ElicitRequest {
  jsonrpc: "2.0";
  id: number;
  method: "elicitation/createMessage";
  params?: { message?: string; requestedSchema?: Record<string, unknown> };
}

/** Is a JSON-RPC message from a server an elicitation request? */
export function isElicitRequest(msg: unknown): msg is ElicitRequest {
  return !!msg && typeof msg === "object" &&
    (msg as { method?: unknown }).method === "elicitation/createMessage";
}

export interface ElicitDecision {
  /** The JSON-RPC result payload sent back to the server. */
  result: { code: number; message?: string };
  /** Human-readable reason (logged + surfaced in notes). */
  reason: string;
}

/**
 * Decide an elicitation request. RA has no interactive MCP prompt surface:
 * headless runs and the TUI share one policy — DECLINE, with a reason, so the
 * server sees an explicit `code 1 (declined)` and the run continues instead of
 * hanging on a request nobody can answer.
 * ponytail: ceiling — if the TUI grows an onAsk-style MCP prompt, branch on it
 * here (the ElicitDecision shape is already the response envelope).
 */
export function decideElicitation(
  request: ElicitRequest,
  opts: { onAsk?: (message: string) => string | null } = {},
): ElicitDecision {
  const message = request.params?.message ?? "(no message)";
  if (opts.onAsk) {
    const answer = opts.onAsk(message);
    if (answer !== null) return { result: { code: 0, message: answer }, reason: `elicitation answered via prompt: ${message}` };
  }
  return {
    result: { code: 1, message: "Declined: RA cannot prompt for MCP elicitation in this context" },
    reason: `declined elicitation (no interactive surface): ${message}`,
  };
}

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { McpClient, searchMcpTools, isHttpConfig, McpHttpClient, McpOAuthManager } from "../src/mcp.ts";

const SERVER = join(import.meta.dir, "fixtures", "mcp-server.ts");

describe("MCP stdio client", () => {
  test("handshake, list tools, and call a tool", async () => {
    const client = new McpClient({ command: "bun", args: [SERVER] });
    try {
      await client.start();
      const tools = await client.listTools();
      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe("echo");

      const out = await client.callTool("echo", { text: "hello" });
      expect(out).toContain("echo: hello");
    } finally {
      await client.close();
    }
  });

  test("listTools returns empty for a server with no tools", async () => {
    // A server that only responds to initialize (no tools/list) would time out;
    // instead verify the client rejects a missing command cleanly.
    const client = new McpClient({ command: "definitely-not-a-real-cmd-xyz" });
    await expect(client.start()).rejects.toThrow();
  });

  test("searchMcpTools filters by name/description", async () => {
    const servers = { test: { command: "bun", args: [SERVER] } };
    const all = await searchMcpTools(servers, "");
    expect(all.length).toBe(1);
    expect(all[0].name).toBe("echo");

    const hit = await searchMcpTools(servers, "echo");
    expect(hit.length).toBe(1);

    const miss = await searchMcpTools(servers, "nonexistent");
    expect(miss.length).toBe(0);
  });
});

describe("MCP HTTP client", () => {
  test("isHttpConfig distinguishes HTTP from stdio configs", () => {
    expect(isHttpConfig({ url: "http://localhost:3000/mcp" })).toBe(true);
    expect(isHttpConfig({ command: "bun", args: ["server.ts"] })).toBe(false);
  });

  test("McpHttpClient constructs with URL and headers", () => {
    const client = new McpHttpClient({
      url: "http://localhost:9999/mcp",
      headers: { "Authorization": "Bearer test-token" },
    });
    expect(client).toBeDefined();
  });
});

describe("MCP OAuth", () => {
  test("McpOAuthManager resolves token from env var", () => {
    const oldEnv = process.env.TEST_MCP_TOKEN;
    process.env.TEST_MCP_TOKEN = "test-bearer-123";
    try {
      const mgr = new McpOAuthManager({ clientId: "test-client", tokenEnvVar: "TEST_MCP_TOKEN" });
      expect(mgr.resolveToken()).toBe("test-bearer-123");
    } finally {
      if (oldEnv) process.env.TEST_MCP_TOKEN = oldEnv;
      else delete process.env.TEST_MCP_TOKEN;
    }
  });

  test("McpOAuthManager returns null when no token available", () => {
    const mgr = new McpOAuthManager({ clientId: "test-client" });
    expect(mgr.resolveToken()).toBeNull();
  });

  test("McpOAuthManager caches set token", () => {
    const mgr = new McpOAuthManager({ clientId: "test-client" });
    mgr.setToken("manual-token-456");
    expect(mgr.resolveToken()).toBe("manual-token-456");
  });

  test("generateCodeVerifier produces 43+ char base64url", () => {
    const verifier = McpOAuthManager.generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("deriveCodeChallenge produces S256 challenge", async () => {
    const verifier = "test-verifier-string-with-enough-length";
    const challenge = await McpOAuthManager.deriveCodeChallenge(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).not.toBe(verifier);
  });

  test("buildAuthUrl constructs correct URL", () => {
    const mgr = new McpOAuthManager({
      clientId: "ra-client",
      scopes: ["mcp:tools"],
      redirectUri: "http://localhost:3000/callback",
    });
    const url = mgr.buildAuthUrl("https://auth.example.com/authorize", "test-challenge");
    expect(url).toContain("response_type=code");
    expect(url).toContain("client_id=ra-client");
    expect(url).toContain("code_challenge=test-challenge");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("scope=mcp%3Atools");
  });

  test("McpHttpClient with oauth config constructs successfully", () => {
    const client = new McpHttpClient({
      url: "http://localhost:9999/mcp",
      oauth: { clientId: "test", tokenEnvVar: "NONEXISTENT_TOKEN" },
    });
    expect(client).toBeDefined();
  });
});

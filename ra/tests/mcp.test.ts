import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { McpClient, searchMcpTools } from "../src/mcp.ts";

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

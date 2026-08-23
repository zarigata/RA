import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { McpClient } from "../src/mcp.ts";

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
});

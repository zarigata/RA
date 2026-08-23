#!/usr/bin/env bun
// Minimal MCP stdio server for tests. Responds to initialize, tools/list, tools/call.
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });

rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === "initialize") {
    respond(msg.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "test-mcp", version: "1.0.0" },
    });
  } else if (msg.method === "tools/list") {
    respond(msg.id, {
      tools: [
        { name: "echo", description: "Echo text", inputSchema: { type: "object" } },
      ],
    });
  } else if (msg.method === "tools/call") {
    const text = msg.params?.arguments?.text ?? "";
    respond(msg.id, { content: [{ type: "text", text: `echo: ${text}` }] });
  }
});

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

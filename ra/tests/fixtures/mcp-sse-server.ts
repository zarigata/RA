#!/usr/bin/env bun
// Minimal LEGACY SSE MCP server for tests (pre-2025 transport):
//   GET  /sse      → text/event-stream; first event `endpoint` carries the POST
//                    URL, later `message` events carry JSON-RPC responses.
//   POST /messages → accepts JSON-RPC requests (202); replies ride the GET
//                    stream of the most recent /sse connection.
// Prints `sse-server:<port>` on stdout; kill the process to stop it.
// ponytail: single-connection server — the test client opens exactly one GET
// stream; a multi-client publish bus is the upgrade if tests need it.
const encoder = new TextEncoder();
// Push from POST handler into the open GET stream. The GET stream enqueues
// the handshake immediately and never closes; later replies are enqueued by
// reference as POSTs arrive.
let emit: ((chunk: string) => void) | null = null;

const server = Bun.serve({
  port: Number(process.env.SSE_PORT ?? 0),
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/sse") {
      const stream = new ReadableStream({
        start(controller) {
          emit = (chunk: string) => { try { controller.enqueue(encoder.encode(chunk)); } catch { /* client gone */ } };
          emit("event: endpoint\ndata: /messages?session=1\n\n");
          // Deliberately never closed: the legacy transport is a long-lived stream.
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
    }
    if (req.method === "POST" && url.pathname === "/messages") {
      const msg = (await req.json()) as { id?: number; method?: string; params?: { arguments?: { text?: string } } };
      if (emit && msg.id !== undefined) {
        const reply = (result: unknown) =>
          emit(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n\n`);
        if (msg.method === "initialize") {
          reply({ protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "sse-test", version: "1" } });
        } else if (msg.method === "tools/list") {
          reply({ tools: [{ name: "echo", description: "Echo text", inputSchema: { type: "object" } }] });
        } else if (msg.method === "tools/call") {
          reply({ content: [{ type: "text", text: `sse echo: ${msg.params?.arguments?.text ?? ""}` }] });
        }
      }
      return new Response(null, { status: 202 });
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`sse-server:${server.port}`);
// Hold the event loop open (Bun exits when only the server + streams remain
// if nothing else schedules work in some versions; this is the belt).
setInterval(() => {}, 1 << 30);

// Background daemon — owns session state over HTTP. The TUI/CLI is a thin
// client that talks to this daemon, so sessions survive terminal disconnects
// and multiple clients can share state.

import { loadSession, saveSession, appendMessage, listSessions, deleteSession, type Session } from "./session.ts";

export interface DaemonOptions {
  port?: number;
  host?: string;
}

const DEFAULT_PORT = 4317;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function readBody(req: Request): Promise<Record<string, unknown>> {
  return req.json().catch(() => ({}));
}

/** Start the daemon HTTP server. Returns the server handle. */
export function startDaemon(opts: DaemonOptions = {}) {
  const port = opts.port ?? DEFAULT_PORT;
  const host = opts.host ?? "127.0.0.1";

  const server = Bun.serve({
    port,
    hostname: host,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // GET /health
      if (req.method === "GET" && path === "/health") {
        return json({ ok: true, pid: process.pid });
      }

      // GET /sessions
      if (req.method === "GET" && path === "/sessions") {
        return json({ sessions: listSessions() });
      }

      // GET /session?cwd=...
      if (req.method === "GET" && path === "/session") {
        const cwd = url.searchParams.get("cwd") ?? process.cwd();
        return json({ session: loadSession(cwd) });
      }

      // POST /session  { cwd, role, content }  → append a message
      if (req.method === "POST" && path === "/session") {
        const body = await readBody(req);
        const cwd = String(body.cwd ?? process.cwd());
        const session = loadSession(cwd);
        const role = (body.role as Session["messages"][number]["role"]) ?? "user";
        const content = String(body.content ?? "");
        appendMessage(session, role, content);
        return json({ session });
      }

      // DELETE /session?cwd=...&id=...
      if (req.method === "DELETE" && path === "/session") {
        const id = url.searchParams.get("id");
        if (id) {
          const ok = deleteSession(id);
          return json({ ok }, ok ? 200 : 404);
        }
        return json({ ok: false, error: "missing id" }, 400);
      }

      return json({ error: "not found" }, 404);
    },
  });

  return server;
}

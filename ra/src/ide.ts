// IDE extension host protocol — a VS Code-compatible JSON-RPC 2.0 bridge.
// Exposes RA's capabilities (run task, list sessions, get session, health)
// over stdio so an IDE extension can drive the agent.

import { loadSession, listSessions, appendMessage } from "./server/session.ts";
import { runFullDevTask } from "../../anubis/src/runner.ts";
import { ANUBIS_HOME } from "./paths.ts";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

type Handler = (params: Record<string, unknown>) => Promise<unknown>;

const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

/** Dispatch a single JSON-RPC request to a handler. */
export async function dispatchRpc(
  req: JsonRpcRequest,
  handlers: Record<string, Handler>,
): Promise<JsonRpcResponse> {
  const handler = handlers[req.method];
  if (!handler) {
    return { jsonrpc: "2.0", id: req.id, error: { code: METHOD_NOT_FOUND, message: `Method not found: ${req.method}` } };
  }
  try {
    const result = await handler(req.params ?? {});
    return { jsonrpc: "2.0", id: req.id, result };
  } catch (e) {
    return { jsonrpc: "2.0", id: req.id, error: { code: INVALID_PARAMS, message: String(e) } };
  }
}

/** The default RA handler set (IDE-facing methods). */
export function raHandlers(): Record<string, Handler> {
  return {
    "ra/health": async () => ({ ok: true, version: "1.0.0" }),
    "ra/sessions": async () => ({ sessions: listSessions() }),
    "ra/session": async (p) => ({ session: loadSession(String(p.cwd ?? process.cwd())) }),
    "ra/message": async (p) => {
      const cwd = String(p.cwd ?? process.cwd());
      const session = loadSession(cwd);
      const role = (p.role as "user" | "assistant" | "system") ?? "user";
      const content = String(p.content ?? "");
      appendMessage(session, role, content);
      return { session };
    },
    "ra/run": async (p) => {
      const task = String(p.task ?? "");
      if (!task) throw new Error("missing task");
      const result = await runFullDevTask(task, {
        root: ANUBIS_HOME,
        stages: p.quick ? ["thoth", "ptah"] : undefined,
        cwd: String(p.cwd ?? process.cwd()),
        quiet: true,
      });
      return { filesWritten: result.filesWritten, summary: result.summary };
    },
  };
}

/**
 * Run a JSON-RPC server over stdio (one request per line). Reads from stdin,
 * writes responses to stdout. Resolves when stdin closes.
 */
export async function serveRpc(handlers: Record<string, Handler>): Promise<void> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      continue;
    }
    const res = await dispatchRpc(req, handlers);
    process.stdout.write(JSON.stringify(res) + "\n");
  }
}

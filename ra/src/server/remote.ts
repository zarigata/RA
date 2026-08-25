// Remote daemon client — connects the TUI to a running `ra daemon` instance
// over HTTP instead of running in-process. This enables sessions to survive
// terminal disconnects and multiple clients to share state.

import { loadSession, saveSession, appendMessage, type Session, type Message } from "./session.ts";

export interface RemoteClientOptions {
  /** Daemon URL, e.g. `http://127.0.0.1:8080` (internal) or
   *  `https://host:7788` (external, when 7788 → 8080 is reverse-proxied). */
  url: string;
}

export class RemoteClient {
  constructor(private opts: RemoteClientOptions) {}

  /** Check if the daemon is reachable. */
  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.opts.url}/health`);
      const body = await res.json();
      return body.ok === true;
    } catch {
      return false;
    }
  }

  /** Load a session from the daemon (or fall back to local disk). */
  async loadSession(cwd: string): Promise<Session> {
    try {
      const res = await fetch(`${this.opts.url}/session?cwd=${encodeURIComponent(cwd)}`);
      if (res.ok) {
        const body = await res.json();
        if (body.session) return body.session as Session;
      }
    } catch {
      // fall through to local
    }
    return loadSession(cwd);
  }

  /** Append a message to the session on the daemon only (not locally). */
  async appendMessage(session: Session, role: Message["role"], content: string): Promise<void> {
    // Send to daemon only — the caller handles local append separately.
    try {
      await fetch(`${this.opts.url}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: session.cwd, role, content }),
      });
    } catch {
      // daemon unreachable — caller's local state is still consistent
    }
  }

  /** List sessions from the daemon. */
  async listSessions(): Promise<Session[]> {
    try {
      const res = await fetch(`${this.opts.url}/sessions`);
      if (res.ok) {
        const body = await res.json();
        return body.sessions as Session[];
      }
    } catch {
      // fall through
    }
    // Fallback: import and use local listSessions
    const { listSessions } = await import("./session.ts");
    return listSessions();
  }

  /** Delete a session on the daemon. */
  async deleteSession(id: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.opts.url}/session?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = await res.json();
      return body.ok === true;
    } catch {
      return false;
    }
  }
}

/** Parse a --remote URL from CLI args. */
export function parseRemoteUrl(args: string[]): string | null {
  const idx = args.indexOf("--remote");
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  const envUrl = process.env.RA_REMOTE;
  return envUrl ?? null;
}
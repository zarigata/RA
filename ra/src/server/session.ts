import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, chmodSync } from "node:fs";
import { join, basename } from "node:path";
import { sessionPath, legacySessionPath, RA_GLOBAL, type RaConfig } from "../../../anubis/src/config.ts";
import { redact } from "../../../anubis/src/redact.ts";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  ts: number;
}

export interface Session {
  id: string;
  cwd: string;
  messages: Message[];
  simpleMode: boolean;
  modelOverride?: string;
  created: number;
}

export function loadSession(cwd: string): Session {
  const current = sessionPath(cwd);
  if (existsSync(current)) return JSON.parse(readFileSync(current, "utf-8")) as Session;
  const legacy = legacySessionPath(cwd);
  if (legacy !== current && existsSync(legacy)) return JSON.parse(readFileSync(legacy, "utf-8")) as Session;
  return { id: cwd, cwd, messages: [], simpleMode: false, created: Date.now() };
}

export function saveSession(session: Session): void {
  const path = sessionPath(session.cwd);
  writeFileSync(path, JSON.stringify(session, null, 2), { encoding: "utf-8", mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* best effort on non-POSIX filesystems */ }
}

export function appendMessage(session: Session, role: Message["role"], content: string): void {
  session.messages.push({ role, content, ts: Date.now() });
  if (session.messages.length > 200) session.messages = session.messages.slice(-200);
  saveSession(session);
}

/** List all persisted sessions (across projects), newest first. */
export function listSessions(): Session[] {
  const dir = join(RA_GLOBAL, "sessions");
  if (!existsSync(dir)) return [];
  const byId = new Map<string, { session: Session; canonical: boolean }>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const session = JSON.parse(readFileSync(join(dir, f), "utf-8")) as Session;
      if (!session || typeof session.cwd !== "string" || typeof session.id !== "string") continue;
      const canonical = basename(sessionPath(session.cwd)) === f;
      const prev = byId.get(session.id);
      if (!prev || (canonical && !prev.canonical)) byId.set(session.id, { session, canonical });
    } catch {
      /* skip corrupt session files */
    }
  }
  return [...byId.values()]
    .map((x) => x.session)
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
}

/** Find a session by id. Returns the session or null. */
export function findSession(id: string): Session | null {
  return listSessions().find((s) => s.id === id) ?? null;
}

/** Switch the "active" session by writing a pointer file. The TUI reads this on startup. */
export function switchSession(id: string): Session | null {
  const session = findSession(id);
  if (!session) return null;
  const pointerPath = join(RA_GLOBAL, "active-session.json");
  writeFileSync(pointerPath, JSON.stringify({ id, cwd: session.cwd }, null, 2), { encoding: "utf-8", mode: 0o600 });
  try { chmodSync(pointerPath, 0o600); } catch { /* best effort on non-POSIX filesystems */ }
  return session;
}

/** Read the active session pointer (if set). Returns the session or null. */
export function getActiveSession(): Session | null {
  const pointerPath = join(RA_GLOBAL, "active-session.json");
  if (!existsSync(pointerPath)) return null;
  try {
    const { id } = JSON.parse(readFileSync(pointerPath, "utf-8"));
    return findSession(id);
  } catch {
    return null;
  }
}

/** Delete a session by id. Removes canonical and legacy copies. */
export function deleteSession(id: string): boolean {
  const dir = join(RA_GLOBAL, "sessions");
  if (!existsSync(dir)) return false;
  let removed = false;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const session = JSON.parse(readFileSync(join(dir, f), "utf-8")) as Session;
      if (session.id === id) {
        unlinkSync(join(dir, f));
        removed = true;
      }
    } catch {
      /* skip */
    }
  }
  return removed;
}

/** One-line reattach summary for a session with prior messages. */
export function formatReattach(session: Session): string {
  const count = session.messages.length;
  const last = session.messages[count - 1];
  const preview = last.content.slice(0, 120) + (last.content.length > 120 ? "…" : "");
  return `Reattached to session (${count} message${count === 1 ? "" : "s"}). Last: [${last.role}] ${preview}`;
}

export function formatSessions(sessions: Session[]): string {
  if (!sessions.length) return "RA sessions\n(no sessions)";
  const rows = sessions.map((s) => {
    const when = new Date(s.created ?? 0).toISOString().slice(0, 19).replace("T", " ");
    return `  ${s.id}  ${s.messages.length} msgs  ${when}  ${s.cwd}`;
  });
  return ["RA sessions", ...rows].join("\n");
}

/**
 * Export a session transcript as sanitized Markdown. Secrets are redacted
 * (vibeguard) so the transcript is safe to share.
 */
export function exportSession(session: Session): string {
  const lines: string[] = [
    "# RA Session Transcript",
    "",
    `- **cwd:** \`${session.cwd}\``,
    `- **created:** ${new Date(session.created ?? 0).toISOString()}`,
    `- **messages:** ${session.messages.length}`,
    "",
  ];
  for (const m of session.messages) {
    const safe = redact(m.content).text;
    lines.push(`## ${m.role}`);
    lines.push("");
    lines.push(safe);
    lines.push("");
  }
  return lines.join("\n");
}

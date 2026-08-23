import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { sessionPath, RA_GLOBAL, type RaConfig } from "../../../anubis/src/config.ts";
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
  const p = sessionPath(cwd);
  if (existsSync(p)) return JSON.parse(readFileSync(p, "utf-8")) as Session;
  return { id: cwd, cwd, messages: [], simpleMode: false, created: Date.now() };
}

export function saveSession(session: Session): void {
  writeFileSync(sessionPath(session.cwd), JSON.stringify(session, null, 2), "utf-8");
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
  const out: Session[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const s = JSON.parse(readFileSync(join(dir, f), "utf-8")) as Session;
      if (s && typeof s.cwd === "string") out.push(s);
    } catch {
      /* skip corrupt session files */
    }
  }
  return out.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
}

/** Delete a session by id. Returns true if a file was removed. */
export function deleteSession(id: string): boolean {
  const dir = join(RA_GLOBAL, "sessions");
  if (!existsSync(dir)) return false;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const s = JSON.parse(readFileSync(join(dir, f), "utf-8")) as Session;
      if (s.id === id) {
        unlinkSync(join(dir, f));
        return true;
      }
    } catch {
      /* skip */
    }
  }
  return false;
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

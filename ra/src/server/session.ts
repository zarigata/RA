import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sessionPath, type RaConfig } from "../../../anubis/src/config.ts";

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

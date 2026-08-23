// Session replay + time-travel debugging — reconstruct a session's message
// timeline and step through it.

import { loadSession, type Session, type Message } from "./session.ts";

export interface ReplayStep {
  index: number;
  role: Message["role"];
  content: string;
  ts: number;
}

/** Flatten a session's messages into an ordered, indexed timeline. */
export function replayTimeline(session: Session): ReplayStep[] {
  return session.messages.map((m, i) => ({ index: i, role: m.role, content: m.content, ts: m.ts }));
}

/** Return the state of the session up to (and including) a given step index. */
export function replayUpTo(session: Session, index: number): Message[] {
  return session.messages.slice(0, index + 1);
}

/** Reconstruct the conversation as a transcript up to a step index. */
export function replayTranscript(session: Session, index?: number): string {
  const msgs = index == null ? session.messages : session.messages.slice(0, index + 1);
  return msgs.map((m) => `[${m.role}] ${m.content}`).join("\n");
}

/** Find the first message matching a predicate (for time-travel to a decision). */
export function findStep(session: Session, predicate: (m: Message) => boolean): number {
  return session.messages.findIndex(predicate);
}

/** Load a session and return its replay timeline. */
export function loadReplay(cwd: string): ReplayStep[] {
  return replayTimeline(loadSession(cwd));
}

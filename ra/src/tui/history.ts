// tui/history.ts — prompt history for the TUI input line (parity row 42).
// Readline-like up/down recall with draft restore, bounded to the last 200
// prompts, persisted as JSON under ~/.ra (same shape as tui.json prefs).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const HISTORY_LIMIT = 200;

const HISTORY_PATH = join(homedir(), ".ra", "history-prompts.json");

export interface PromptHistory {
  /** Prompts oldest→newest, at most HISTORY_LIMIT entries. */
  entries(): string[];
  /** Record a submitted prompt (dedup vs the previous entry, trim, bound). */
  add(prompt: string): void;
  /** Navigate up (older) from the draft; saves `draft` for restore. Returns the recalled prompt or null. */
  up(draft: string): string | null;
  /** Navigate down (newer); returns the next entry, or the saved draft at the end. */
  down(): string | null;
  /** True while navigating (index set). */
  browsing(): boolean;
}

/**
 * Pure navigation/recall state machine over a list of prompts. The TUI owns
 * the editor text; this class only tracks position. Newest-first indices:
 * `index` counts back from the end (0 = not browsing, 1 = newest entry).
 */
export function createPromptHistory(persisted: string[] = [], store: {
  read?: () => string[];
  write?: (entries: string[]) => void;
} = {}): PromptHistory {
  let entries = [...persisted];
  let index = 0;
  let savedDraft = "";
  const read = store.read ?? (() => {
    try { return JSON.parse(readFileSync(HISTORY_PATH, "utf-8")) as string[]; } catch { return []; }
  });
  const write = store.write ?? ((list: string[]) => {
    try {
      mkdirSync(join(homedir(), ".ra"), { recursive: true });
      writeFileSync(HISTORY_PATH, JSON.stringify(list.slice(-HISTORY_LIMIT), null, 2) + "\n");
    } catch { /* read-only home */ }
  });
  if (!persisted.length) {
    try { entries = read().filter((e) => typeof e === "string"); } catch { /* corrupt/absent */ }
  }
  return {
    entries: () => [...entries],
    add(prompt: string) {
      const p = prompt.trim();
      if (!p) return;
      if (entries[entries.length - 1] === p) return; // consecutive dedup
      entries.push(p);
      if (entries.length > HISTORY_LIMIT) entries = entries.slice(-HISTORY_LIMIT);
      index = 0;
      savedDraft = "";
      write(entries);
    },
    up(draft: string) {
      if (!entries.length) return null;
      if (index === 0) savedDraft = draft;
      index = Math.min(index + 1, entries.length);
      return entries[entries.length - index] ?? null;
    },
    down() {
      if (index === 0) return null;
      index--;
      return index === 0 ? savedDraft : entries[entries.length - index] ?? null;
    },
    browsing: () => index > 0,
  };
}

// ponytail: single shared instance — the TUI is one process, one input line;
// tests inject their own via createPromptHistory(store).
let shared: PromptHistory | null = null;
export function promptHistory(): PromptHistory {
  return shared ??= createPromptHistory();
}

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface MemoryCard { id: string; summary: string; tags?: string[]; required?: boolean }
/** Explicit project knowledge only: never copy conversation reasoning into cloud prompts. */
export function memoryPacket(cwd: string, task: string, maxChars = 6000): string {
  const path = join(cwd, ".ra", "memory-cards.json");
  if (!existsSync(path)) return "";
  const cards: MemoryCard[] = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(cards) || cards.some(c => !c || typeof c.id !== "string" || typeof c.summary !== "string" || (c.tags !== undefined && (!Array.isArray(c.tags) || c.tags.some(t => typeof t !== "string"))))) throw new Error("Invalid .ra/memory-cards.json");
  const words = new Set(task.toLowerCase().match(/[a-z0-9_]+/g) ?? []);
  const ranked = cards.map((card, index) => ({ card, index, score: (card.tags ?? []).filter(t => words.has(t.toLowerCase())).length }))
    .filter(x => x.card.required || x.score > 0).sort((a, b) => Number(!!b.card.required) - Number(!!a.card.required) || b.score - a.score || a.index - b.index);
  const lines: string[] = [];
  let size = 0;
  for (const { card } of ranked) {
    const line = `[${card.id}] ${card.summary}\n`;
    if (size + line.length > maxChars) {
      if (card.required) throw new Error(`Required memory exceeds packet budget: ${card.id}`);
      continue;
    }
    lines.push(line); size += line.length;
  }
  return lines.length ? `\n\nRelevant project facts (verify against source):\n${lines.join("")}` : "";
}

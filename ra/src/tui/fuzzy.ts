// tui/fuzzy.ts — fuzzy matcher for the unified palette (pure, testable).
// Subsequence scoring tuned for command/file names: consecutive and
// word-boundary hits score high; gaps and long needles score low.

export interface FuzzyHit {
  /** true when the query is a full subsequence of the text */
  matched: boolean;
  /** indices into `text` for each matched query char (in order) */
  indices: number[];
  /** higher is better; only meaningful when matched */
  score: number;
}

const BOUNDARY = /[^a-z0-9]|$/;

export function fuzzyMatch(query: string, text: string): FuzzyHit {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return { matched: true, indices: [], score: 0 };
  const indices: number[] = [];
  let score = 0;
  let ti = 0;
  let prevMatch = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    for (let i = ti; i < t.length; i++) {
      if (t[i] === ch) { found = i; break; }
    }
    if (found < 0) return { matched: false, indices: [], score: 0 };
    const gap = found - prevMatch - 1;
    let s = 8;
    if (found === prevMatch + 1) s += 12;              // consecutive
    else if (gap > 0) s -= Math.min(gap, 8);           // gap penalty
    const before = found > 0 ? text[found - 1] : "";
    if (found === 0 || BOUNDARY.test(before)) s += 10; // word boundary / start
    if (/[a-z]/.test(text[found] ?? "") && /[A-Z]/.test(before ?? "")) s += 8; // camelCase
    if (qi === 0 && found === 0) s += 6;               // prefix of the whole text
    score += s;
    indices.push(found);
    prevMatch = found;
    ti = found + 1;
  }
  // Prefer shorter texts at equal matching (specificity).
  score += Math.max(0, 12 - Math.floor(text.length / 8));
  return { matched: true, indices, score };
}

export interface FuzzyItem<T = string> {
  text: string;
  value: T;
  /** category shown as a dim suffix, e.g. "command", "file", "theme" */
  category?: string;
  /** longer description rendered under/beside the item */
  detail?: string;
}

export interface FilteredItem<T = string> {
  item: FuzzyItem<T>;
  indices: number[];
  score: number;
}

/** Filter + rank items; empty query keeps source order (grouped first). */
export function fuzzyFilter<T>(query: string, items: FuzzyItem<T>[], limit = 60): FilteredItem<T>[] {
  const out: FilteredItem<T>[] = [];
  for (const item of items) {
    const hit = fuzzyMatch(query, item.text);
    if (!hit.matched) continue;
    out.push({ item, indices: hit.indices, score: hit.score });
    if (out.length >= limit * 4) break;
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/** Wrap matched characters with open/close markers for rendering. */
export function highlightMatches(text: string, indices: number[], open: string, close: string): string {
  if (!indices.length) return text;
  const set = new Set(indices);
  let out = "";
  let on = false;
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    if (hit && !on) { out += open; on = true; }
    else if (!hit && on) { out += close; on = false; }
    out += text[i];
  }
  if (on) out += close;
  return out;
}

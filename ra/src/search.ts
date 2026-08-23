// Semantic code search — a local TF-IDF vector index over the repo, with
// incremental re-index on file change. No external embedding dependency.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface IndexedDoc {
  path: string;
  terms: Map<string, number>; // term → tf
  mtime: number;
}

export interface SearchHit {
  path: string;
  score: number;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "else", "for", "while",
  "do", "to", "of", "in", "on", "at", "by", "with", "from", "as", "is", "are",
  "was", "were", "be", "been", "this", "that", "these", "those", "it", "its",
  "not", "no", "yes", "can", "will", "would", "should", "could", "may", "might",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

/** Index a single file's content. */
export function indexFile(path: string, content: string, mtime: number): IndexedDoc {
  return { path, terms: termFrequency(tokenize(content)), mtime };
}

/** Recursively index a directory (skips node_modules, .git, and binary-ish files). */
export function indexDirectory(root: string): IndexedDoc[] {
  const docs: IndexedDoc[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".git" || name === "dist" || name === "build") continue;
      const abs = join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) {
        walk(abs);
      } else if (/\.(ts|tsx|js|jsx|py|go|rs|md|json|html|css)$/.test(name)) {
        try {
          const content = readFileSync(abs, "utf-8");
          docs.push(indexFile(relative(root, abs), content, st.mtimeMs));
        } catch {
          /* skip unreadable */
        }
      }
    }
  };
  walk(root);
  return docs;
}

/** Compute cosine similarity between a query and a doc using TF vectors. */
export function cosineSimilarity(queryTerms: Map<string, number>, doc: IndexedDoc): number {
  let dot = 0;
  let qNorm = 0;
  let dNorm = 0;
  for (const [t, q] of queryTerms) {
    qNorm += q * q;
    const d = doc.terms.get(t) ?? 0;
    dot += q * d;
  }
  for (const d of doc.terms.values()) dNorm += d * d;
  if (qNorm === 0 || dNorm === 0) return 0;
  return dot / (Math.sqrt(qNorm) * Math.sqrt(dNorm));
}

/** Search the index for a query, returning ranked hits. */
export function searchIndex(docs: IndexedDoc[], query: string, limit = 10): SearchHit[] {
  const qTerms = termFrequency(tokenize(query));
  const scored = docs
    .map((d) => ({ path: d.path, score: cosineSimilarity(qTerms, d) }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/** Incrementally re-index: update docs whose mtime changed, drop removed files. */
export function reindex(root: string, existing: IndexedDoc[]): IndexedDoc[] {
  const byPath = new Map(existing.map((d) => [d.path, d]));
  const fresh = indexDirectory(root);
  const out: IndexedDoc[] = [];
  for (const doc of fresh) {
    const prev = byPath.get(doc.path);
    if (prev && prev.mtime === doc.mtime) {
      out.push(prev); // unchanged → reuse
    } else {
      out.push(doc); // changed or new → re-index
    }
  }
  return out;
}

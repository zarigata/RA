// Checkpoint/undo — snapshot files before an agent edit batch, restore on demand.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { RA_GLOBAL, projectStateKey } from "../../../anubis/src/config.ts";

export interface Checkpoint {
  id: string;
  cwd: string;
  ts: number;
  files: string[]; // relative paths snapshotted
}

function checkpointDir(cwd: string): string {
  return join(RA_GLOBAL, "checkpoints", projectStateKey(cwd));
}

function legacyCheckpointDir(cwd: string): string {
  const slug = cwd.replace(/\//g, "_").replace(/^_|_$/g, "") || "default";
  return join(RA_GLOBAL, "checkpoints", slug);
}

function manifestPath(cwd: string): string {
  return join(checkpointDir(cwd), "manifest.json");
}

function legacyManifestPath(cwd: string): string {
  return join(legacyCheckpointDir(cwd), "manifest.json");
}

function loadManifest(cwd: string): Checkpoint[] {
  const current = manifestPath(cwd);
  const legacy = legacyManifestPath(cwd);
  const p = existsSync(current) ? current : existsSync(legacy) ? legacy : null;
  if (!p) return [];
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as Checkpoint[];
  } catch {
    return [];
  }
}

function checkpointStore(cwd: string, id: string, relPath: string): string | null {
  const current = join(checkpointDir(cwd), id, relPath);
  if (existsSync(current)) return current;
  const legacy = join(legacyCheckpointDir(cwd), id, relPath);
  return existsSync(legacy) ? legacy : null;
}

function saveManifest(cwd: string, list: Checkpoint[]): void {
  const dir = checkpointDir(cwd);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch { /* best effort on non-POSIX filesystems */ }
  const manifest = manifestPath(cwd);
  writeFileSync(manifest, JSON.stringify(list, null, 2), { encoding: "utf-8", mode: 0o600 });
  try { chmodSync(manifest, 0o600); } catch { /* best effort on non-POSIX filesystems */ }
}

/**
 * Snapshot a single file before it is modified. Stores the original content
 * under the latest checkpoint. Returns the checkpoint id, or null if the file
 * does not exist (nothing to snapshot).
 */
export function snapshotFile(cwd: string, relPath: string): string | null {
  const abs = join(cwd, relPath);
  if (!existsSync(abs)) return null;
  const content = readFileSync(abs, "utf-8");
  const list = loadManifest(cwd);
  let cp = list[0];
  if (!cp) {
    cp = { id: `cp-${Date.now()}`, cwd, ts: Date.now(), files: [] };
    list.unshift(cp);
  }
  if (cp.files.includes(relPath)) return cp.id;
  if (!cp.files.includes(relPath)) cp.files.push(relPath);
  const store = join(checkpointDir(cwd), cp.id, relPath);
  mkdirSync(dirname(store), { recursive: true, mode: 0o700 });
  writeFileSync(store, content, { encoding: "utf-8", mode: 0o600 });
  try { chmodSync(store, 0o600); } catch { /* best effort on non-POSIX filesystems */ }
  saveManifest(cwd, list);
  return cp.id;
}

/** Restore the most recent checkpoint, returning the list of restored files. */
export function restoreLatest(cwd: string): string[] {
  const list = loadManifest(cwd);
  if (!list.length) return [];
  const cp = list[0];
  const restored: string[] = [];
  for (const rel of cp.files) {
    const store = checkpointStore(cwd, cp.id, rel);
    if (!store) continue;
    const abs = join(cwd, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, readFileSync(store, "utf-8"), "utf-8");
    restored.push(rel);
  }
  // Drop the consumed checkpoint.
  list.shift();
  saveManifest(cwd, list);
  return restored;
}

/** List pending checkpoints (newest first). */
export function listCheckpoints(cwd: string): Checkpoint[] {
  return loadManifest(cwd);
}

/** Discard all checkpoints for a project. */
export function clearCheckpoints(cwd: string): void {
  for (const dir of new Set([checkpointDir(cwd), legacyCheckpointDir(cwd)])) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

/** Return the latest checkpoint's snapshot content for a file, or null. */
export function checkpointContent(cwd: string, relPath: string): string | null {
  const list = loadManifest(cwd);
  if (!list.length) return null;
  const cp = list[0];
  const store = checkpointStore(cwd, cp.id, relPath);
  if (!store) return null;
  return readFileSync(store, "utf-8");
}

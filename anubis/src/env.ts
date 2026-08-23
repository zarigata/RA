// src/env.ts — load .env into process.env (simple, no deps)

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function loadEnv(dir?: string): Record<string, string> {
  const root = dir ?? findRoot();
  const envPath = join(root, ".env");
  const out: Record<string, string> = {};
  if (existsSync(envPath)) {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      out[key] = val;
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
  return out;
}

function findRoot(): string {
  try {
    const file = fileURLToPath(import.meta.url);
    return join(dirname(file), "..");
  } catch {
    return process.cwd();
  }
}

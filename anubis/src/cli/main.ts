#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const anubisHome = join(dirname(fileURLToPath(import.meta.url)), "../..");
const raCli = join(anubisHome, "..", "ra", "src", "cli.ts");
const r = spawnSync("bun", [raCli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, ANUBIS_HOME: anubisHome, RA_HOME: join(anubisHome, "..") },
});
process.exit(r.status ?? 1);

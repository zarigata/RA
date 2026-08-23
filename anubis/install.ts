#!/usr/bin/env bun
import { writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";

const isWindows = platform() === "win32";
const binName = isWindows ? "anubis.cmd" : "anubis";
const binPath = join(process.cwd(), "bin", binName);

const scriptContent = isWindows 
  ? `@echo off\nbun run ${join(process.cwd(), "src/cli/main.ts")} %*`
  : `#!/usr/bin/env bash\nbun run ${join(process.cwd(), "src/cli/main.ts")} "$@"`;

console.log(`Installing Anubis to ${binPath}...`);
writeFileSync(binPath, scriptContent);
if (!isWindows) chmodSync(binPath, "755");

console.log("Installation complete!");
console.log(`To use it, add the 'bin' folder to your PATH: export PATH="$PATH:${join(process.cwd(), "bin")}"`);

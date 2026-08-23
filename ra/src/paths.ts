import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
export const RA_RUNTIME = join(__dir, "..");
export const RA_ROOT = join(RA_RUNTIME, "..");
export const ANUBIS_HOME = join(RA_ROOT, "anubis");
export const CORE = join(ANUBIS_HOME, "src");
export const PLUGINS_DIR = join(ANUBIS_HOME, ".anubis", "plugins");
export const AGENTS_DIR = join(ANUBIS_HOME, ".anubis", "agents");

import { existsSync, readFileSync, realpathSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve, relative, sep, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { RA_ROOT } from "./paths.ts";
import { assertTool, assertBash, type AgentCapabilities } from "./permission.ts";

export interface SandboxConfig { mode?: "workspace-write" | "read-only" | "off"; network?: "deny" | "allow"; allow_unsandboxed?: boolean }
export interface CommandContext { cwd: string; sandbox?: SandboxConfig; capabilities?: AgentCapabilities; signal?: AbortSignal }
export interface CommandResult { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean; sandbox: string }

export interface ResolvedBackend {
  backend: "macOS Seatbelt" | "Linux bubblewrap" | "disabled" | "unavailable";
  /** true when no OS boundary is applied despite a non-off mode (explicit consent) */
  unsandboxed: boolean;
  bwrapPath?: string;
}

/**
 * Pure backend resolution so platform behavior stays testable.
 * Consent (config sandbox.allow_unsandboxed or RA_ALLOW_UNSANDBOXED=1) permits
 * running without an OS boundary on platforms without a backend; without it,
 * RA fails closed.
 */
export function resolveBackend(opts: {
  platform: NodeJS.Platform;
  mode: "workspace-write" | "read-only" | "off";
  consent: boolean;
  hasSeatbelt: boolean;
  bwrapPath?: string | null;
}): ResolvedBackend {
  if (opts.mode === "off") return { backend: "disabled", unsandboxed: true };
  if (opts.platform === "darwin") {
    if (opts.hasSeatbelt) return { backend: "macOS Seatbelt", unsandboxed: false };
    if (opts.consent) return { backend: "disabled", unsandboxed: true };
    return { backend: "unavailable", unsandboxed: false };
  }
  if (opts.platform === "linux") {
    if (opts.bwrapPath) return { backend: "Linux bubblewrap", unsandboxed: false, bwrapPath: opts.bwrapPath };
    if (opts.consent) return { backend: "disabled", unsandboxed: true };
    return { backend: "unavailable", unsandboxed: false };
  }
  if (opts.consent) return { backend: "disabled", unsandboxed: true };
  return { backend: "unavailable", unsandboxed: false };
}

let bwrapNetNsProbe: boolean | undefined;
/** Whether --unshare-net works here (needs loopback setup rights, e.g. absent on CI runners). Cached. */
export function bwrapNetNsAvailable(bwrapPath: string): boolean {
  if (bwrapNetNsProbe !== undefined) return bwrapNetNsProbe;
  try {
    const r = spawnSync(bwrapPath, ["--dev", "/dev", "--ro-bind", "/", "/", "--unshare-net", "/bin/true"], { timeout: 8000, stdio: "ignore" });
    bwrapNetNsProbe = r.status === 0;
  } catch { bwrapNetNsProbe = false; }
  return bwrapNetNsProbe;
}

let bwrapPathCache: string | null | undefined;
function findBwrap(): string | null {
  if (bwrapPathCache !== undefined) return bwrapPathCache;
  for (const p of ["/usr/bin/bwrap", "/bin/bwrap", "/usr/local/bin/bwrap", "/snap/bin/bwrap"]) {
    if (existsSync(p)) { bwrapPathCache = p; return p; }
  }
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir && existsSync(join(dir, "bwrap"))) { bwrapPathCache = join(dir, "bwrap"); return bwrapPathCache; }
  }
  bwrapPathCache = null;
  return null;
}

export function sandboxSettings(context: CommandContext) {
  let mode = process.env.RA_SANDBOX ?? context.sandbox?.mode ?? "workspace-write";
  const network = process.env.RA_SANDBOX_NETWORK ?? context.sandbox?.network ?? "deny";
  if (!["workspace-write", "read-only", "off"].includes(mode)) throw new Error("sandbox.mode must be workspace-write, read-only, or off");
  if (!["deny", "allow"].includes(network)) throw new Error("sandbox.network must be deny or allow");
  if (context.capabilities?.readOnly) mode = "read-only";
  const consent = context.sandbox?.allow_unsandboxed === true || process.env.RA_ALLOW_UNSANDBOXED === "1";
  const resolved = resolveBackend({
    platform: process.platform,
    mode,
    consent,
    hasSeatbelt: process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec"),
    bwrapPath: process.platform === "linux" ? findBwrap() : null,
  });
  return {
    mode,
    network: mode === "off" ? "unrestricted" : network,
    backend: resolved.backend,
    unsandboxed: resolved.unsandboxed,
    bwrapPath: resolved.bwrapPath,
  };
}

const secretPath = /(?:^|\/)(?:\.env(?:\..*)?|\.netrc|\.npmrc|id_(?:rsa|ed25519)(?:\.pub)?|credentials(?:\.json)?|auth\.json)$|\.(?:pem|key)$/i;
const controlPath = /(?:^|\/)(?:\.git|\.ra|\.agents|\.codex)(?:\/|$)|(?:^|\/)(?:AGENTS|RA)\.md$/i;
const within = (root: string, path: string) => path === root || path.startsWith(root + sep);
export function assertFileAccess(path: string, write: boolean, cwd?: string): void {
  if (existsSync(path)) path = realpathSync(path);
  if (secretPath.test(path)) throw new Error("Access to credential files is blocked; provide a redacted example instead");
  if (write && (controlPath.test(cwd ? relative(realpathSync(cwd), path) : path) || within(realpathSync(RA_ROOT), path))) throw new Error("Agent writes to Git metadata, policy files, or the installed RA runtime are blocked");
}

/** Use an allowlist, not a blacklist: no provider keys, startup hooks, or injected loaders. */
function commandEnvironment(scratch: string, explicit: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "COLORTERM", "TZ", "SYSTEMROOT", "WINDIR"]) {
    if (process.env[name]) env[name] = process.env[name]!;
  }
  const developerBin = "/Library/Developer/CommandLineTools/usr/bin";
  if (process.platform === "darwin" && existsSync(developerBin)) env.PATH = (env.PATH ?? "/usr/bin:/bin").split(":").flatMap(p => p === "/usr/bin" ? [developerBin, p] : [p]).join(":");
  // Explicit MCP server settings are user configuration, never inherited implicitly.
  for (const [name, value] of Object.entries(explicit)) {
    if (!/^(?:OLLAMA_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|RA_|ANUBIS_|BASH_ENV|ENV|NODE_OPTIONS|PYTHONPATH|LD_|DYLD_)/.test(name)) env[name] = value;
  }
  Object.assign(env, { HOME: join(scratch, "home"), TMPDIR: join(scratch, "tmp"), TMP: join(scratch, "tmp"), TEMP: join(scratch, "tmp"),
    XDG_CACHE_HOME: join(scratch, "cache"), XDG_CONFIG_HOME: join(scratch, "config"), XDG_DATA_HOME: join(scratch, "data"),
    PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" });
  for (const path of [env.HOME, env.TMPDIR, env.XDG_CACHE_HOME, env.XDG_CONFIG_HOME, env.XDG_DATA_HOME]) mkdirSync(path, { recursive: true });
  return env;
}

function gitMetadata(cwd: string): string | undefined {
  try {
    const marker = join(cwd, ".git");
    if (!existsSync(marker)) return;
    let path = statSync(marker).isDirectory() ? marker : resolve(cwd, readFileSync(marker, "utf-8").match(/^gitdir: (.+)$/m)?.[1] ?? ".git-invalid");
    if (existsSync(join(path, "commondir"))) path = resolve(path, readFileSync(join(path, "commondir"), "utf-8").trim());
    if (existsSync(join(path, "HEAD")) && existsSync(join(path, "objects")) && existsSync(join(path, "config"))) return realpathSync(path);
  } catch { /* not a Git checkout */ }
}

function profile(cwd: string, scratch: string, mode: string, network: string, env: Record<string, string>, gitWrite = false, extraRead: string[] = []): string {
  const q = (s: string) => JSON.stringify(s);
  const scopePrefix = cwd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/";
  const ci = (s: string) => s.replace(/[a-z]/gi, c => `[${c.toLowerCase()}${c.toUpperCase()}]`);
  const systemRoots = ["/System", "/usr", "/bin", "/sbin", "/Library/Apple", "/Library/Developer/CommandLineTools", "/Library/Frameworks", "/opt/homebrew", "/private/var/db/dyld", "/private/var/db/timezone", "/Library/Preferences/Logging"];
  const runtimeRoots = new Set<string>();
  for (const path of (env.PATH ?? "").split(delimiter)) {
    if (!path || !path.startsWith("/") || !existsSync(path)) continue;
    // PATH grants read access only to executable directories, not the user's home.
    const real = realpathSync(path);
    if (real !== "/" && real !== process.env.HOME) runtimeRoots.add(real);
    for (const executable of ["node", "bun", "python3", "git", "rg"]) {
      const file = join(real, executable);
      if (existsSync(file)) runtimeRoots.add(dirname(realpathSync(file)));
    }
  }
  const metadata = gitMetadata(cwd);
  const read = [...new Set([...systemRoots, ...runtimeRoots, cwd, scratch, ...(metadata ? [metadata] : []), ...extraRead])].map(p => `(subpath ${q(p)})`).join(" ");
  const protect = [RA_ROOT].map(p => `(subpath ${q(resolve(p))})`).join(" ");
  return `(version 1)
(deny default)
(allow process-fork process-exec file-map-executable)
(allow sysctl-read
  (sysctl-name-prefix "hw.") (sysctl-name-prefix "machdep.") (sysctl-name-prefix "vm.")
  (sysctl-name "kern.argmax") (sysctl-name "kern.ostype") (sysctl-name "kern.osrelease")
  (sysctl-name "kern.osversion") (sysctl-name "kern.version") (sysctl-name "kern.hostname")
  (sysctl-name "kern.maxfiles") (sysctl-name "kern.maxfilesperproc")
  (sysctl-name "kern.maxproc") (sysctl-name "kern.maxprocperuid") (sysctl-name "kern.ngroups")
  (sysctl-name "kern.tcsm_available") (sysctl-name "security.mac.lockdown_mode_state")
  (sysctl-name "kern.osproductversion") (sysctl-name "kern.osvariant_status")
  (sysctl-name "kern.system_version_compat") (sysctl-name "kern.boottime") (sysctl-name "kern.clockrate")
  (sysctl-name "kern.hv_vmm_present") (sysctl-name "kern.memorystatus_level")
  (sysctl-name "sysctl.name2oid") (sysctl-name-prefix "sysctl.oidfmt."))
(allow signal (target self) (target same-sandbox))
; Default-deny plus a self grant exposed parent KERN_PROCARGS2 on the tested OS.
; Explicitly deny other targets; an environment allowlist alone cannot protect the parent.
(deny process-info*)
(allow process-info-pidinfo (target self))
(deny process-info-pidinfo (require-not (target self)))
(allow process-info-setcontrol process-info-dirtycontrol process-info-rusage process-info-ledger (target self))
(deny sysctl-read (sysctl-name-prefix "kern.procargs"))
(allow file-read-metadata)
(allow file-read* (literal "/") (path-ancestors ${q(cwd)}) (path-ancestors ${q(scratch)}) ${read})
(allow file-read* file-write-data file-ioctl (literal "/dev/null") (literal "/dev/zero") (literal "/dev/dtracehelper"))
(allow file-read* (literal "/dev/random") (literal "/dev/urandom") (literal "/private/etc/localtime") (literal "/private/etc/passwd"))
(allow file-write* (subpath ${q(scratch)}) ${mode === "workspace-write" ? `(subpath ${q(cwd)})` : ""} ${gitWrite && metadata ? `(subpath ${q(metadata)})` : ""})
(deny file-write* ${protect} ${!gitWrite ? `(regex #${q(scopePrefix + ci("(.*/)?[.](git|ra|agents|codex)(/.*)?$"))}) (regex #${q(scopePrefix + ci("(.*/)?(AGENTS|RA)[.]md$"))})` : ""})
(deny file-read-data file-write*
  (require-all (require-any (subpath ${q(cwd)}) ${metadata ? `(subpath ${q(metadata)})` : ""})
    (require-not (subpath ${q(scratch)}))
    (require-any (regex #${q(ci(".*/[.]env([.].*)?$"))}) (regex #${q(ci(".*/([.]netrc|[.]npmrc|id_rsa|id_ed25519|credentials([.].*)?|auth[.]json)$"))}) (regex #${q(ci(".*[.](pem|key)$"))}))))
${network === "allow" ? "(allow network-outbound (remote ip))\n(allow network-bind network-inbound (local ip \"localhost:*\"))\n(allow mach-lookup (global-name \"com.apple.system.opendirectoryd.libinfo\") (global-name \"com.apple.SystemConfiguration.configd\"))\n(allow file-read* (literal \"/private/etc/hosts\") (literal \"/private/etc/resolv.conf\"))" : ""}
`;
}

export interface ManagedCommand {
  process: ChildProcessWithoutNullStreams;
  finished: Promise<{ code: number | null; signal: NodeJS.Signals | null; timedOut: boolean }>;
  stop: () => void;
  sandbox: string;
}

/** Every executable uses the same boundary, cancellation and descendant cleanup. */
interface LaunchOptions { tool?: string; timeoutMs?: number; env?: Record<string, string> }
function prepareCommand(context: CommandContext, args: string[], options: LaunchOptions, gitWrite = false) {
  if (!args.length || args.some(arg => typeof arg !== "string" || arg.includes("\0"))) throw new Error("Invalid command arguments");
  context.signal?.throwIfAborted();
  const tool = options.tool ?? "bash";
  assertTool(context.capabilities, tool);
  if (tool === "bash" || tool === "diagnose") assertBash(context.capabilities, tool === "bash" && args[0] === "/bin/bash" ? args[2] : args.join(" "));
  const settings = sandboxSettings(context);
  if (settings.backend === "unavailable") throw new Error(
    "No OS command sandbox on this platform. Install bubblewrap (Debian/Ubuntu: apt install bubblewrap; Fedora: dnf install bubblewrap) "
    + "for isolated commands, or consent to unsandboxed execution in a trusted environment with RA_ALLOW_UNSANDBOXED=1 or config "
    + "sandbox.allow_unsandboxed=true. RA fails closed instead of guessing."
  );
  const cwd = realpathSync(context.cwd);
  const scratch = mkdtempSync(join(tmpdir(), "ra-command-"));
  try {
  const env = commandEnvironment(scratch, options.env);
  let command = args;
  if (settings.backend === "Linux bubblewrap" && settings.bwrapPath) {
    const netIsolated = settings.network === "deny" && bwrapNetNsAvailable(settings.bwrapPath);
    const bwrap: string[] = [settings.bwrapPath,
      "--dev", "/dev", "--proc", "/proc",
      "--ro-bind", "/", "/",
      "--clearenv", "--die-with-parent"];
    if (settings.mode === "workspace-write") bwrap.push("--bind", cwd, cwd);
    bwrap.push("--bind", scratch, scratch);
    if (netIsolated) bwrap.push("--unshare-net");
    for (const [k, v] of Object.entries(env)) bwrap.push("--setenv", k, v);
    command = [...bwrap, ...args];
    settings.network = settings.network === "deny" && !netIsolated ? "shared (netns unavailable)" : settings.network;
  } else if (!settings.unsandboxed) {
    const path = join(scratch, "policy.sb");
    writeFileSync(path, profile(cwd, scratch, settings.mode, settings.network, env, gitWrite, commandReadRoots(tool, args)), { mode: 0o600 });
    command = ["/usr/bin/sandbox-exec", "-f", path, ...args];
  }
  const tag = settings.unsandboxed && settings.mode !== "off" ? `${settings.backend} (no isolation; user consent)` : settings.backend;
  return { cwd, scratch, env, command, settings: { ...settings, backend: tag } };
  } catch (error) { rmSync(scratch, { recursive: true, force: true }); throw error; }
}

/**
 * MCP server configs are trusted user configuration and frequently point at
 * scripts or serve directories outside the project (a global server script, a
 * sibling checkout). Grant read access to exactly those configured paths —
 * files grant their containing directory, directories grant themselves.
 */
function commandReadRoots(tool: string, args: string[]): string[] {
  if (tool !== "mcp") return [];
  const roots: string[] = [];
  for (const candidate of args) {
    if (!candidate || !candidate.startsWith("/")) continue;
    try {
      const real = realpathSync(candidate);
      const stat = statSync(real);
      roots.push(stat.isDirectory() ? real : dirname(real));
    } catch { /* not an existing path */ }
  }
  return roots;
}

/** Trusted Git orchestration may write Git metadata, but its filters still cannot access the host. */
export function runGitCommand(args: string[], cwd: string) {
  const prepared = prepareCommand({ cwd, sandbox: { network: "deny" } }, ["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { tool: "git" }, true);
  try {
    const result = spawnSync(prepared.command[0], prepared.command.slice(1), { cwd: prepared.cwd, env: prepared.env, encoding: "utf-8", detached: process.platform !== "win32", timeout: 30000, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024 });
    try { if (process.platform !== "win32" && result.pid) process.kill(-result.pid, "SIGKILL"); } catch { /* exited */ }
    return { ok: result.status === 0, out: (result.stdout ?? "") + (result.stderr ?? "") + (result.error ? String(result.error) : "") };
  } finally { rmSync(prepared.scratch, { recursive: true, force: true }); }
}

export function spawnCommand(context: CommandContext, args: string[], options: LaunchOptions = {}): ManagedCommand {
  const { cwd, scratch, env, command, settings } = prepareCommand(context, args, options);
  let proc: ChildProcessWithoutNullStreams;
  try { proc = spawn(command[0], command.slice(1), { cwd, env, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] }); }
  catch (error) { rmSync(scratch, { recursive: true, force: true }); throw error; }
  let timedOut = false, hardKill: ReturnType<typeof setTimeout> | undefined;
  const kill = (signal: NodeJS.Signals) => {
    try { if (process.platform !== "win32" && proc.pid) process.kill(-proc.pid, signal); else proc.kill(signal); } catch { /* exited */ }
  };
  const stop = () => { kill("SIGTERM"); hardKill ??= setTimeout(() => kill("SIGKILL"), 1000); };
  const timer = setTimeout(() => { timedOut = true; stop(); }, options.timeoutMs ?? 60_000);
  context.signal?.addEventListener("abort", stop, { once: true });
  if (context.signal?.aborted) stop();
  const finished = new Promise<{ code: number | null; signal: NodeJS.Signals | null; timedOut: boolean }>((resolve, reject) => {
    proc.once("error", reject);
    proc.once("close", (code, signal) => resolve({ code, signal, timedOut }));
  }).finally(() => {
    // Never leave a background worker alive after its owning tool has returned.
    kill("SIGKILL");
    clearTimeout(timer);
    if (hardKill) clearTimeout(hardKill);
    context.signal?.removeEventListener("abort", stop);
    rmSync(scratch, { recursive: true, force: true });
  });
  return { process: proc, finished, stop, sandbox: `${settings.backend}/${settings.mode}; network=${settings.network}` };
}

export async function runCommand(context: CommandContext, args: string[], options: { tool?: string; timeoutMs?: number } = {}): Promise<CommandResult> {
  const managed = spawnCommand(context, args, options);
  let stdout = "", stderr = "";
  managed.process.stdin.end();
  managed.process.stdout.on("data", chunk => { stdout = (stdout + chunk.toString()).slice(-100_000); });
  managed.process.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-100_000); });
  const result = await managed.finished;
  context.signal?.throwIfAborted();
  if (stderr.includes("sandbox_apply: Operation not permitted")) throw new Error("macOS refused sandbox initialization (nested sandboxes are unsupported). The command was not run; RA will not retry it without sandboxing.");
  return { ...result, stdout, stderr, sandbox: managed.sandbox };
}

import type { RaConfig } from "../../../anubis/src/config.ts";
import { runCommand, sandboxSettings, type SandboxConfig } from "../sandbox.ts";
import { resolveCapabilities } from "../permission.ts";
import { runSignal } from "../execution.ts";

export const SANDBOX_HELP = `RA sandbox
  ra sandbox status [--json]
  ra sandbox exec [--mode workspace-write|read-only|off] [--network deny|allow] -- COMMAND [ARG...]

Default: workspace writes, private temporary HOME, no subprocess networking.
Network allow grants IP traffic and loopback listeners, not Unix-domain sockets.
On macOS, Seatbelt enforces filesystem and network boundaries. Unsupported or
nested environments fail closed. No automatic unsandboxed retry occurs.
Use off only for trusted work; provider credentials are still removed from the environment.
Agent writes to Git metadata, policy files, credential files and RA's installed runtime are blocked.
Cloud model requests and explicitly configured HTTP tools run in RA's trusted control process.`;

export async function sandboxCommand(args: string[], cwd: string, config: RaConfig) {
  const [action = "status"] = args;
  if (action === "help") return { code: 0, data: { help: SANDBOX_HELP }, text: SANDBOX_HELP };
  const settings: SandboxConfig = { ...config.sandbox };
  if (action === "status") {
    if (args.slice(1).some(a => a !== "--json")) throw new Error("Unexpected sandbox status argument");
    const data = { ...sandboxSettings({ cwd, sandbox: settings }), cwd, environment: "allowlist; private HOME and temporary directory", protected: ["credentials", "Git metadata", "agent policy", "installed RA runtime"] };
    return { code: 0, data, text: `RA sandbox: ${data.backend} · ${data.mode} · subprocess network ${data.network}\nWorkspace: ${cwd}\nEnvironment: ${data.environment}\n${SANDBOX_HELP}` };
  }
  if (action !== "exec") throw new Error(SANDBOX_HELP);
  const separator = args.indexOf("--");
  if (separator < 0 || !args[separator + 1]) throw new Error(SANDBOX_HELP);
  for (let i = 1; i < separator; i++) {
    if (args[i] === "--json") continue;
    if (args[i] === "--mode" && i + 1 < separator) settings.mode = args[++i] as SandboxConfig["mode"];
    else if (args[i] === "--network" && i + 1 < separator) settings.network = args[++i] as SandboxConfig["network"];
    else throw new Error(`Unknown sandbox option: ${args[i]}`);
  }
  const context = { cwd, sandbox: settings, signal: runSignal(), capabilities: resolveCapabilities({ ...config, sandbox: settings }) };
  const data = await runCommand(context, args.slice(separator + 1));
  return { code: data.code ?? 1, data, text: `[${data.sandbox}]\n${data.stdout}${data.stderr ? `\nstderr:\n${data.stderr}` : ""}` };
}

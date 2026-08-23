// .anubis/plugins/router.ts — role→model assignment visibility (/roles command)
import {
  resolveAll,
  formatAssignments,
  validateConfig,
  type RouterConfig,
} from "../../src/router.ts";
import { readFileSync, existsSync } from "node:fs";

type AnyCtx = Record<string, unknown>;

function loadRouterConfig(projectDir: string): RouterConfig | null {
  const path = `${projectDir}/anubis.json`;
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const cfg: RouterConfig = {
      model: raw.model ?? "anthropic/claude-sonnet-4-5",
      agent: raw.agent ?? {},
    };
    return validateConfig(cfg) ? cfg : null;
  } catch {
    return null;
  }
}

export const RouterPlugin = async (ctx: AnyCtx) => {
  const client = (ctx as { client?: AnyCtx }).client;
  const project = (ctx as { project?: { path?: string } }).project;
  const log = async (message: string) => {
    try {
      await client?.app?.log?.({ body: { service: "router", level: "info", message } });
    } catch {
      /* no-op */
    }
  };
  const flagModel = process.env.ANUBIS_MODEL;
  const show = async () => {
    const cfg = loadRouterConfig(project?.path ?? process.cwd()) ?? {
      model: "(unconfigured)",
      agent: {},
    };
    const assignments = resolveAll(cfg, flagModel);
    await log(formatAssignments(assignments));
  };
  return {
    "tui.command.execute": async (input: AnyCtx, output: AnyCtx) => {
      if ((input.command as string)?.startsWith("/roles")) {
        (output as { handled?: boolean }).handled = true;
        await show();
      }
    },
    "session.created": async () => {
      await show();
    },
  };
};

export { resolveAll, formatAssignments };
export default RouterPlugin;

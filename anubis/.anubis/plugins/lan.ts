// .anubis/plugins/lan.ts — LAN model server discovery (/lan-scan)
import {
  scanSubnet,
  formatDiscovery,
  buildLanConfig,
  expandSubnet,
} from "../../src/lan.ts";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";

type AnyCtx = Record<string, unknown>;

function localSubnet(): string {
  // best-effort; default to a common home subnet
  return process.env.ANUBIS_LAN_CIDR ?? "192.168.1.0/24";
}

export const LanPlugin = async (ctx: AnyCtx) => {
  const client = (ctx as { client?: AnyCtx }).client;
  const log = async (message: string) => {
    try {
      await client?.app?.log?.({ body: { service: "lan", level: "info", message } });
    } catch {
      /* no-op */
    }
  };
  return {
    "tui.command.execute": async (input: AnyCtx, output: AnyCtx) => {
      if (!(input.command as string)?.startsWith("/lan-scan")) return;
      (output as { handled?: boolean }).handled = true;
      const cidr = localSubnet();
      await log(`scanning ${cidr} (${expandSubnet(cidr).length} hosts)`);
      const found = await scanSubnet(cidr);
      await log(formatDiscovery(found));
      if (found.length > 0) {
        const cfg = buildLanConfig(found);
        const dir = `${process.cwd()}/.anubis`;
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(`${dir}/lan.json`, JSON.stringify(cfg, null, 2));
      }
    },
  };
};

export { scanSubnet, formatDiscovery };
export default LanPlugin;

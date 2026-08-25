import { describe, expect, test } from "bun:test";
import { toolPermission, canRunTool, restrictedTools } from "../src/permission.ts";
import type { RaConfig } from "../../anubis/src/config.ts";

const base: RaConfig = { agent: {}, model: "ollama-cloud/glm-5.2" };

describe("permission engine", () => {
  test("defaults to allow when no rules", () => {
    expect(toolPermission(base, "bash")).toBe("allow");
    expect(canRunTool(base, "bash")).toBe(true);
  });

  test("deny blocks a tool", () => {
    const cfg: RaConfig = { ...base, permission: { tool: { bash: "deny" } } };
    expect(toolPermission(cfg, "bash")).toBe("deny");
    expect(canRunTool(cfg, "bash")).toBe(false);
  });

  test("ask is treated as not-allowed (headless)", () => {
    const cfg: RaConfig = { ...base, permission: { tool: { write: "ask" } } };
    expect(canRunTool(cfg, "write")).toBe(false);
  });

  test("ask with autoApprove proceeds", () => {
    const cfg: RaConfig = { ...base, permission: { tool: { write: "ask" } } };
    expect(canRunTool(cfg, "write", { autoApprove: true })).toBe(true);
  });

  test("ask with onAsk callback uses callback result", () => {
    const cfg: RaConfig = { ...base, permission: { tool: { write: "ask" } } };
    expect(canRunTool(cfg, "write", { onAsk: () => true })).toBe(true);
    expect(canRunTool(cfg, "write", { onAsk: () => false })).toBe(false);
  });

  test("restrictedTools lists non-allow tools", () => {
    const cfg: RaConfig = {
      ...base,
      permission: { tool: { bash: "deny", write: "ask", read: "allow" } },
    };
    const restricted = restrictedTools(cfg);
    expect(restricted).toContain("bash");
    expect(restricted).toContain("write");
    expect(restricted).not.toContain("read");
  });
});

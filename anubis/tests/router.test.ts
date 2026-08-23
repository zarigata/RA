import { describe, expect, test } from "bun:test";
import {
  resolveRoleModel,
  resolveAll,
  formatAssignments,
  validateConfig,
  ROLES,
  type RouterConfig,
} from "../src/router.ts";

const cfg: RouterConfig = {
  model: "default/model",
  agent: {
    ptah: { model: "anthropic/claude-sonnet-4-5" },
    maat: { model: "ollama/gemma:latest" },
  },
};

describe("router resolution priority", () => {
  test("flag overrides everything", () => {
    expect(resolveRoleModel("ptah", cfg, "flag/model").model).toBe("flag/model");
    expect(resolveRoleModel("ptah", cfg, "flag/model").source).toBe("flag");
  });
  test("config wins over default", () => {
    const r = resolveRoleModel("ptah", cfg);
    expect(r.model).toBe("anthropic/claude-sonnet-4-5");
    expect(r.source).toBe("config");
  });
  test("default used when unassigned", () => {
    const r = resolveRoleModel("sekhmet", cfg);
    expect(r.model).toBe("default/model");
    expect(r.source).toBe("default");
  });
  test("no role is ever locked in code", () => {
    // every role resolves to *something* but never throws
    for (const role of ROLES) {
      const r = resolveRoleModel(role, cfg);
      expect(r.model.length).toBeGreaterThan(0);
    }
  });
});

describe("resolveAll", () => {
  test("resolves all 8 roles", () => {
    const all = resolveAll(cfg);
    expect(all).toHaveLength(8);
    expect(all.map((a) => a.role).sort()).toEqual([...ROLES].sort());
  });
  test("flag applies to all roles (session-wide)", () => {
    const all = resolveAll(cfg, "flag/model");
    expect(all.every((a) => a.model === "flag/model")).toBe(true);
  });
});

describe("formatAssignments", () => {
  test("includes header and all roles", () => {
    const text = formatAssignments(resolveAll(cfg));
    expect(text).toContain("ROLE");
    expect(text).toContain("SOURCE");
    for (const role of ROLES) {
      expect(text).toContain(role);
    }
  });
});

describe("validateConfig", () => {
  test("valid config", () => {
    expect(validateConfig({ model: "m", agent: {} })).toBe(true);
  });
  test("invalid configs", () => {
    expect(validateConfig(null)).toBe(false);
    expect(validateConfig({})).toBe(false);
    expect(validateConfig({ model: "m" })).toBe(false);
    expect(validateConfig({ model: "m", agent: "x" })).toBe(false);
  });
});

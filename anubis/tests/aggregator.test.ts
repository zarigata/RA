import { describe, expect, test } from "bun:test";
import {
  buildAggregatePrompt,
  parseRoleOverride,
  stripRoleOverride,
  DEFAULT_MOA_CONFIG,
  type RoleResult,
} from "../src/aggregator.ts";

describe("moa aggregation", () => {
  test("aggregate prompt includes all roles", () => {
    const results: RoleResult[] = [
      { role: "thoth", model: "m1", output: "plan" },
      { role: "ptah", model: "m2", output: "code" },
      { role: "maat", model: "m3", output: "review" },
    ];
    const prompt = buildAggregatePrompt("build X", results);
    expect(prompt).toContain("build X");
    expect(prompt).toContain("thoth");
    expect(prompt).toContain("ptah");
    expect(prompt).toContain("maat");
    expect(prompt).toContain("m1");
    expect(prompt).toContain("Aggregation rules");
  });
  test("empty results still produces prompt", () => {
    const prompt = buildAggregatePrompt("task", []);
    expect(prompt).toContain("task");
  });
  test("default config has 4 roles and parallel", () => {
    expect(DEFAULT_MOA_CONFIG.roles).toContain("thoth");
    expect(DEFAULT_MOA_CONFIG.roles).toContain("ptah");
    expect(DEFAULT_MOA_CONFIG.parallel).toBe(true);
  });
});

describe("role override parsing", () => {
  test("parses @roles", () => {
    expect(parseRoleOverride("task @thoth @ptah")).toEqual(["thoth", "ptah"]);
  });
  test("returns null when no @roles", () => {
    expect(parseRoleOverride("just a task")).toBeNull();
  });
  test("strips roles from task", () => {
    expect(stripRoleOverride("task @thoth @ptah")).toBe("task");
  });
  test("strips nothing when no roles", () => {
    expect(stripRoleOverride("plain task")).toBe("plain task");
  });
});

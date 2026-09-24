// tests/agents-catalog.test.ts — agent-library integrity (ra.76 "Agent Legion").
// Pins: ≥70 visible agents, unique names, valid frontmatter, non-empty
// categories, description budget, TASK-hint token cap, scope precedence.

import { describe, expect, test } from "bun:test";
import {
  listCatalog,
  visibleCatalog,
  taskCatalogHint,
  formatCatalog,
  estTokens,
  parseAgentFrontmatter,
  resolveAgentFile,
  scaffoldAgent,
  refreshCatalog,
} from "../src/agents/catalog.ts";
import { buildToolHint, planCompaction } from "../src/agent.ts";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("agent library integrity", () => {
  test("ships at least 70 visible agents (the Legion promise)", () => {
    expect(visibleCatalog().length).toBeGreaterThanOrEqual(70);
    expect(listCatalog().length).toBeGreaterThanOrEqual(visibleCatalog().length);
  });

  test("every agent has a unique name and valid frontmatter", () => {
    const entries = listCatalog();
    const names = entries.map((e) => e.role);
    expect(new Set(names).size).toBe(names.length);
    for (const e of entries) {
      expect(e.description.length, `${e.role} needs a description`).toBeGreaterThan(8);
      const words = e.description.split(/\s+/).length;
      expect(words, `${e.role} description ≤ 30 words (token budget)`).toBeLessThanOrEqual(30);
      expect(e.category).toMatch(/^[a-z][a-z-]*$/);
    }
  });

  test("every category is populated", () => {
    const categories = new Set(visibleCatalog().map((e) => e.category));
    for (const want of ["core", "research", "implement", "review", "ops", "planning", "domain", "docs", "data"]) {
      expect(categories.has(want), `category ${want} should exist`).toBe(true);
    }
    const count = (c: string) => visibleCatalog().filter((e) => e.category === c).length;
    for (const c of ["research", "implement", "review", "ops", "planning", "domain", "docs", "data"]) {
      expect(count(c), `category ${c} should have ≥4 agents`).toBeGreaterThanOrEqual(4);
    }
  });

  test("hidden system agents stay programmatically invocable but invisible", () => {
    const hidden = listCatalog().filter((e) => e.mode === "hidden");
    expect(hidden.map((e) => e.role).sort()).toEqual(["compaction", "summary", "title"]);
    expect(visibleCatalog().some((e) => e.role === "compaction")).toBe(false);
    for (const h of hidden) expect(resolveAgentFile(h.role)).toBeTruthy();
  });

  test("core pipeline roles survive intact", () => {
    const roles = new Set(listCatalog().map((e) => e.role));
    for (const core of ["anubis", "thoth", "ptah", "maat", "sekhmet", "isis", "seshat", "horus"]) {
      expect(roles.has(core), `core role ${core} must exist`).toBe(true);
    }
  });
});

describe("TASK catalog hint budget", () => {
  test("hint lists agents grouped by category within the token cap", () => {
    const hint = taskCatalogHint();
    expect(hint).toContain("core:");
    expect(hint).toContain("research:");
    expect(hint).toContain("implement:");
    expect(estTokens(hint)).toBeLessThanOrEqual(1200);
  });

  test("buildToolHint embeds the catalog without exploding", () => {
    const h = buildToolHint();
    expect(h).toContain("TASK <role> <task>");
    expect(h).toContain("Agents:");
    // Whole-hint sanity: grammar + catalog stays lean (< 2k tokens).
    expect(estTokens(h)).toBeLessThanOrEqual(2000);
  });

  test("collapsed categories when the budget is tiny", () => {
    const hint = taskCatalogHint(undefined, 10);
    expect(hint).toMatch(/…\d+ agents \(see \/agents\)/);
  });
});

describe("catalog scoping", () => {
  test("project scope overrides builtin; user scope overrides builtin", () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-agents-"));
    try {
      const projectDir = join(dir, ".ra", "agents");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, "thoth.md"), `---\ndescription: Project-local planner override.\ncategory: planning\nmode: subagent\n---\n\nLocal thoth.\n`);
      refreshCatalog();
      const resolved = resolveAgentFile("thoth", dir);
      expect(resolved?.startsWith(dir)).toBe(true);
      const entry = listCatalog(dir).find((e) => e.role === "thoth");
      expect(entry?.scope).toBe("project");
      expect(entry?.description).toBe("Project-local planner override.");
      expect(listCatalog(dir).filter((e) => e.role === "thoth").length).toBe(1);
    } finally {
      refreshCatalog();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("scaffoldAgent writes a parseable agent and refuses duplicates", () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-agents-"));
    try {
      const { path } = scaffoldAgent("my-widget", { cwd: dir });
      refreshCatalog();
      const entry = listCatalog(dir).find((e) => e.role === "my-widget");
      expect(entry?.scope).toBe("project");
      expect(entry?.category).toBe("custom");
      expect(() => scaffoldAgent("my-widget", { cwd: dir })).toThrow();
    } finally {
      refreshCatalog();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("parseAgentFrontmatter tolerates missing fields", () => {
    const parsed = parseAgentFrontmatter("# just a heading\nno frontmatter");
    expect(parsed.mode).toBe("subagent");
    expect(parsed.description).toBe("");
  });
});

describe("formatCatalog", () => {
  test("lists visible agents grouped with counts", () => {
    const text = formatCatalog();
    expect(text).toContain("RA agents — ");
    expect(text).toContain("research (");
    expect(text).not.toContain(" compaction —");
  });
});

describe("compaction planner (hidden compaction agent)", () => {
  const msg = (role: "system" | "user" | "assistant", content: string) => ({ role, content });

  test("under threshold: no plan", () => {
    expect(planCompaction([msg("system", "s"), msg("user", "u"), msg("assistant", "a")], 1000)).toBeNull();
  });

  test("over threshold: keeps system, original task + last exchange, summarizes the middle", () => {
    const messages = [
      msg("system", "s".repeat(100)),
      msg("user", "task"),
      msg("assistant", "x".repeat(40_000)),
      msg("user", "tool result big"),
      msg("assistant", "x".repeat(40_000)),
    ];
    const plan = planCompaction(messages, 10_000);
    expect(plan).not.toBeNull();
    expect(plan!.keep[0].role).toBe("system");
    expect(plan!.summarize.length).toBe(2);
    expect(plan!.keep).toContain(messages[1]);
  });

  test("short conversations are never compacted", () => {
    expect(planCompaction([msg("system", "s".repeat(100)), msg("user", "u")], 1)).toBeNull();
  });
});

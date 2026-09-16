// tests/tools-ra76.test.ts — the four ra.76 tools: SKILL, REPOMAP, TEST,
// WEBSEARCH. Pins dispatch wiring, permissions, airgap behavior, and the
// pure cores (repo-map ranking, skill parsing).

import { describe, expect, test } from "bun:test";
import { listSkills, parseSkillFrontmatter, loadSkillBody, toolSkill, skillPermission } from "../src/skills.ts";
import { buildRepoMap, collectRepoEntries, type RepoMapEntry } from "../src/repomap.ts";
import { toolWebSearch } from "../src/tools/index.ts";
import { execToolBlock, buildToolHint } from "../src/agent.ts";
import type { RaConfig } from "../../anubis/src/config.ts";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ctx = { cwd: process.cwd() } as Parameters<typeof execToolBlock>[0];

describe("SKILL tool", () => {
  test("finds the vendored skills in this repo (22 on disk)", () => {
    const skills = listSkills(process.cwd());
    expect(skills.length).toBeGreaterThanOrEqual(20);
    expect(skills.some((s) => s.name === "caveman")).toBe(true);
    expect(skills.some((s) => s.name === "lean-build")).toBe(true);
  });

  test("parses plain and folded frontmatter descriptions", () => {
    const plain = parseSkillFrontmatter("---\nname: x\ndescription: Does things.\n---\nbody");
    expect(plain.description).toBe("Does things.");
    const folded = parseSkillFrontmatter("---\nname: y\ndescription: >\n  Multi line\n  description here\n---\nbody");
    expect(folded.description).toContain("Multi line");
  });

  test("SKILL list and SKILL <name> inject bodies; unknown skills error", () => {
    const list = toolSkill({ cwd: process.cwd() }, "list");
    expect(list).toContain("Skills (");
    const body = toolSkill({ cwd: process.cwd() }, "caveman");
    expect(body).toContain("Skill 'caveman' loaded");
    const missing = toolSkill({ cwd: process.cwd() }, "nope");
    expect(missing).toMatch(/not found/);
  });

  test("config permission.skill can deny", () => {
    const config: RaConfig = { model: "m", agent: {}, permission: { skill: { "*": "deny" } } };
    expect(skillPermission(config)).toBe("deny");
    expect(toolSkill({ cwd: process.cwd() }, "caveman", config)).toMatch(/not permitted|deny/i);
  });

  test("body loading caps length and strips frontmatter", () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-skill-"));
    try {
      const sdir = join(dir, ".agents", "skills", "demo");
      mkdirSync(sdir, { recursive: true });
      writeFileSync(join(sdir, "SKILL.md"), "---\nname: demo\ndescription: Demo skill.\n---\n\nFollow the demo rules.\n");
      const body = loadSkillBody("demo", dir, 100);
      expect(body).not.toBeNull();
      expect(body!.startsWith("---")).toBe(false);
      expect(body!.length).toBeLessThanOrEqual(120); // capped + truncation marker
      expect(loadSkillBody("missing", dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("REPOMAP tool", () => {
  const entries: RepoMapEntry[] = [
    { path: "src/old.ts", symbols: ["a"], score: 1 },
    { path: "src/hot.ts", symbols: ["x", "y", "z", "w"], score: 99 },
    { path: "src/deep/nested/mod.ts", symbols: ["m"], score: 50 },
  ];

  test("ranks recent + symbol-rich files first", () => {
    const map = buildRepoMap(entries);
    expect(map).toContain("repo map");
    const hot = map.indexOf("src/hot.ts");
    const old = map.indexOf("src/old.ts");
    expect(hot).toBeGreaterThanOrEqual(0);
    expect(hot).toBeLessThan(old);
  });

  test("respects the character budget with a continuation line", () => {
    const map = buildRepoMap(entries, 40);
    expect(map).toMatch(/\+\d+ more files/);
  });

  test("collectRepoEntries finds this repo's tracked sources", () => {
    const found = collectRepoEntries(process.cwd(), 30);
    expect(found.length).toBeGreaterThan(5);
    expect(found.some((e) => e.path.endsWith("agent.ts"))).toBe(true);
  });
});

describe("WEBSEARCH tool", () => {
  test("no key → clear guidance", async () => {
    const out = await toolWebSearch("q", {}, false);
    expect(out).toMatch(/BRAVE_SEARCH_API_KEY or TAVILY_API_KEY/);
  });

  test("airgap → blocked", async () => {
    const out = await toolWebSearch("q", { BRAVE_SEARCH_API_KEY: "x" }, true);
    expect(out).toMatch(/air-gapped/);
  });

  test("empty query → error", async () => {
    expect(await toolWebSearch("  ", { BRAVE_SEARCH_API_KEY: "x" }, false)).toMatch(/needs a query/);
  });
});

describe("execToolBlock wiring (ra.76 verbs)", () => {
  test("SKILL dispatches through the tool grammar", async () => {
    const note = await execToolBlock(ctx, "SKILL caveman");
    expect(note.note).toContain("Skill 'caveman' loaded");
  });

  test("REPOMAP dispatches and returns a ranked map", async () => {
    const note = await execToolBlock(ctx, "REPOMAP");
    expect(note.note).toContain("repo map");
  });

  test("WEBSEARCH without a key returns guidance, not a crash", async () => {
    const note = await execToolBlock(ctx, "WEBSEARCH ollama docs");
    expect(note.note).toMatch(/BRAVE_SEARCH_API_KEY|TAVILY_API_KEY/);
  });

  test("TEST runs the detected runner (bun test in this repo) and reports exit status", async () => {
    const note = await execToolBlock(ctx, "TEST tests/agents-catalog.test.ts");
    expect(note.note).toMatch(/TEST bun test/);
    expect(note.note).toMatch(/exit \d+/);
  }, 120000);

  test("buildToolHint advertises the new verbs", () => {
    const h = buildToolHint();
    expect(h).toContain("SKILL");
    expect(h).toContain("REPOMAP");
    expect(h).toContain("WEBSEARCH");
    expect(h).toContain("TEST [target]");
  });
});

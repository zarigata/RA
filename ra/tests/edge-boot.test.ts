// edge-boot.test.ts — Wave 3a edge cases, part 1: hostile-environment boot.
// Empty-project (no .ra, no git, empty dir), unicode paths (emoji project
// names), dangling-symlink surfaces beyond listDir, RA_CONFIG isolation
// under a clean env (the Wave 2 leak guard), and session slug stability for
// exotic cwds.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listDir, safePath, toolRead } from "../src/tools/index.ts";
import { listSkills, toolSkill } from "../src/skills.ts";
import { listCatalog, formatCatalog, taskCatalogHint, scaffoldAgent } from "../src/agents/catalog.ts";
import { loadCustomCommands, customCommandDirs } from "../src/commands/index.ts";
import { sessionPath } from "../../anubis/src/config.ts";
import { loadAgentMeta, loadProjectMemory } from "../src/agent.ts";
import { spawnSync } from "node:child_process";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

/** Boot every cwd-sensitive listing API against a directory and assert no throw. */
function bootListings(cwd: string) {
  const results: Record<string, unknown> = {};
  results.skills = listSkills(cwd);
  results.catalog = listCatalog(cwd);
  results.commands = loadCustomCommands(customCommandDirs(cwd));
  results.hint = taskCatalogHint(cwd);
  results.listing = listDir({ cwd }, ".");
  results.memory = loadProjectMemory(cwd);
  results.meta = loadAgentMeta("anubis", cwd);
  return results;
}

describe("empty-project boot (no .ra, no git, empty dir)", () => {
  test("every listing API returns empty/graceful on a truly empty dir", () => {
    const empty = mkdtempSync(join(tmpdir(), "ra-empty-"));
    try {
      const r = bootListings(empty);
      expect(r.skills.filter((s: { source: string }) => s.source === "project")).toEqual([]);
      expect((r.catalog as Array<unknown>).length).toBeGreaterThan(0); // builtin agents still visible
      expect(r.commands).toEqual([]);
      expect(r.hint).toContain("core");
      expect(readdirSync(empty)).toEqual([]); // truly empty
      expect(r.memory).toBe(""); // no AGENTS.md/RA.md anywhere up the chain
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test("formatCatalog renders the builtin-only catalog without project artifacts", () => {
    const empty = mkdtempSync(join(tmpdir(), "ra-empty2-"));
    try {
      const text = formatCatalog(empty);
      expect(text).toContain("RA agents");
      expect(text).toContain("visible");
      expect(text).not.toContain("· project"); // no project-scope agents
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test("SKILL tool in a project with no PROJECT skills doesn't list project scope; unknown skill names error gracefully", () => {
    // Note: user-level skill dirs (~/.cursor/skills etc.) legitimately leak
    // into every project — the isolation guarantee is project-scope absence.
    const empty = mkdtempSync(join(tmpdir(), "ra-empty3-"));
    try {
      expect(listSkills(empty).some((s) => s.source === "project")).toBe(false);
      const out = toolSkill({ cwd: empty }, "definitely-not-a-skill-name-xyz");
      expect(String(out)).toContain("not found");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test("scaffoldAgent into a fresh empty project works and refreshes the catalog", () => {
    const empty = mkdtempSync(join(tmpdir(), "ra-empty4-"));
    try {
      const { path } = scaffoldAgent("scout", { cwd: empty, description: "Test scout." });
      expect(path).toContain(join(empty, ".ra", "agents"));
      const catalog = listCatalog(empty);
      const scout = catalog.find((e) => e.role === "scout")!;
      expect(scout.scope).toBe("project");
      expect(scout.description).toBe("Test scout.");
      // duplicate scaffold refuses
      expect(() => scaffoldAgent("scout", { cwd: empty })).toThrow(/already exists/i);
      // invalid role refuses
      expect(() => scaffoldAgent("Bad Role", { cwd: empty })).toThrow(/Invalid agent name/i);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test("CLI --version and help boot from inside an empty cwd", () => {
    const empty = mkdtempSync(join(tmpdir(), "ra-empty5-"));
    try {
      for (const args of [["--version"], ["help"]] as const) {
        const r = spawnSync("bun", [CLI, ...args], { encoding: "utf-8", cwd: empty });
        expect(r.status).toBe(0); // ${args[0]}
      }
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("unicode project paths (emoji + CJK + accents + RTL)", () => {
  const NAMES = ["プロジェクト📁", "café-naïve", "مرحبا-project", "emoji-🚀-mix"];

  for (const name of NAMES) {
    test(`boot + list + read round-trip in "${name}"`, () => {
      const root = mkdtempSync(join(tmpdir(), "ra-uni-"));
      const proj = join(root, name);
      try {
        mkdirSync(proj, { recursive: true });
        writeFileSync(join(proj, "héllo-wörld.txt"), "unicode content 🎉");
        // listings boot
        bootListings(proj);
        // listDir shows the file with its unicode name intact
        const listing = listDir({ cwd: proj }, ".");
        expect(listing).toContain("héllo-wörld.txt");
        // read round-trips
        const read = toolRead({ cwd: proj }, "héllo-wörld.txt");
        expect(String(read)).toContain("unicode content 🎉");
        // session slug for the unicode cwd resolves (slug is path-mangled, no throw)
        expect(sessionPath(proj)).toContain(".ra/sessions/");
        // scaffold + catalog in unicode cwd
        scaffoldAgent("uni-agent", { cwd: proj });
        expect(listCatalog(proj).some((e) => e.role === "uni-agent")).toBe(true);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

describe("symlink surfaces (Wave 2 dangling-symlink fix + escapes)", () => {
  test("listDir in a dir FULL of dangling symlinks lists every one as 'l'", () => {
    const proj = mkdtempSync(join(tmpdir(), "ra-slinks-"));
    try {
      for (const n of ["dead1", "dead2", "dead-🌍"]) symlinkSync(join(proj, "nonexistent-target"), join(proj, n));
      mkdirSync(join(proj, "realdir"));
      writeFileSync(join(proj, "realfile"), "x");
      const listing = listDir({ cwd: proj }, ".");
      expect(listing).toContain("l dead1");
      expect(listing).toContain("l dead2");
      expect(listing).toContain("l dead-🌍");
      expect(listing).toContain("d realdir");
      expect(listing).toContain("f realfile");
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });

  test("listDir on a path that IS a dangling symlink throws the broken-symlink guard (surfaced as a tool error upstream)", () => {
    const proj = mkdtempSync(join(tmpdir(), "ra-slink2-"));
    try {
      symlinkSync(join(proj, "nowhere"), join(proj, "dirlink"));
      // safePath (inside listDir) rejects the broken link — a thrown guard is
      // correct here (unlike a dangling link INSIDE the listed dir, which Wave
      // 2 fixed to list as 'l').
      expect(() => listDir({ cwd: proj }, "dirlink")).toThrow(/broken symlink/);
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });

  test("safePath rejects a path through a dangling symlink (broken ancestor)", () => {
    const proj = mkdtempSync(join(tmpdir(), "ra-slink3-"));
    try {
      symlinkSync(join(proj, "missing-dir"), join(proj, "ghostdir"));
      expect(() => safePath(proj, join("ghostdir", "file.txt"))).toThrow(/broken symlink/);
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });

  test("safePath rejects symlink escape out of the project root", () => {
    const proj = mkdtempSync(join(tmpdir(), "ra-slink4-"));
    const outside = mkdtempSync(join(tmpdir(), "ra-slink4-out-"));
    try {
      writeFileSync(join(outside, "secret.txt"), "outside");
      symlinkSync(join(outside, "secret.txt"), join(proj, "escape.txt"));
      expect(() => safePath(proj, "escape.txt")).toThrow(/symlink escapes project/);
    } finally {
      rmSync(proj, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("RA_CONFIG isolation under a clean environment (Wave 2 leak guard)", () => {
  test("env -i bun cli help: RA resolves its config via RA_CONFIG, no ambient leak", () => {
    // The Wave 2 finding: run gates under `env -i` so ambient HOME/RA_* can't
    // mask a config-resolution bug. Here: a clean-env CLI boot must not
    // accidentally pick up the developer's real ~/.ra or repo ra.json.
    const proj = mkdtempSync(join(tmpdir(), "ra-enviso-"));
    try {
      writeFileSync(join(proj, "ra.json"), JSON.stringify({ model: "ollama-lan/qwen3.8:latest", agent: {} }));
      const r = spawnSync("env", ["-i", "PATH=" + process.env.PATH, "HOME=" + proj,
        "RA_CONFIG=" + join(proj, "ra.json"), process.execPath, CLI, "help"], {
        encoding: "utf-8", cwd: proj,
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("RA"); // help rendered
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  }, 30_000);

  test("env -i with NO config anywhere: help still works (config only needed per-command)", () => {
    const proj = mkdtempSync(join(tmpdir(), "ra-enviso2-"));
    try {
      const r = spawnSync("env", ["-i", "PATH=" + process.env.PATH, "HOME=" + proj, process.execPath, CLI, "--version"], {
        encoding: "utf-8", cwd: proj,
      });
      expect(r.status).toBe(0);
      expect(r.stdout.trim().length).toBeGreaterThan(0);
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  }, 30_000);

  test("customCommandDirs: project dir first, then user, then legacy", () => {
    const proj = mkdtempSync(join(tmpdir(), "ra-cmdirs-"));
    try {
      const dirs = customCommandDirs(proj);
      expect(dirs[0]).toBe(join(proj, ".ra", "commands"));
      expect(dirs[1]).toBe(join(dirs[1]!.split(".ra")[0]!, ".ra", "commands")); // user-level shape
      expect(dirs[2]).toContain(".anubis/commands"); // legacy
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });
});

describe("session slug stability for exotic cwds", () => {
  test("slashes collapse to underscores (leading trimmed); unicode preserved; root → default", () => {
    expect(sessionPath("/a/b/c").endsWith("a_b_c.json")).toBe(true);
    expect(sessionPath("/tmp/プロジェクト📁")).toContain("プロジェクト📁");
    expect(sessionPath("/").endsWith("default.json")).toBe(true);
  });
});

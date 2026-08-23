import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const AGENTS_DIR = join(ROOT, ".anubis", "agents");
const CONFIG = join(ROOT, "ra.json");

describe("Anubis distribution integrity", () => {
  test("all 8 role agents exist", () => {
    const expected = [
      "anubis",
      "thoth",
      "ptah",
      "maat",
      "sekhmet",
      "isis",
      "seshat",
      "horus",
    ];
    const files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"));
    for (const role of expected) {
      expect(files).toContain(`${role}.md`);
    }
  });

  test("NO role agent pins a model (models never locked)", () => {
    const agents = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"));
    for (const f of agents) {
      const content = readFileSync(join(AGENTS_DIR, f), "utf8");
      // extract frontmatter only (between first two ---)
      const fm = content.split("---")[1] ?? "";
      // a model pinned in frontmatter would look like `model:` with a value
      const modelLine = fm.match(/^model:\s*\S+/m);
      if (modelLine) {
        throw new Error(`${f} pins a model in frontmatter: ${modelLine[0]}`);
      }
    }
  });

  test("anubis agent is primary mode", () => {
    const content = readFileSync(join(AGENTS_DIR, "anubis.md"), "utf8");
    const fm = content.split("---")[1] ?? "";
    expect(fm).toContain("mode: primary");
  });

  test("read-only roles deny edits", () => {
    const readonly = ["thoth", "maat", "sekhmet", "isis"];
    for (const role of readonly) {
      const content = readFileSync(join(AGENTS_DIR, `${role}.md`), "utf8");
      const fm = content.split("---")[1] ?? "";
      expect(fm).toContain("edit: deny");
    }
  });

  test("config references Ollama provider", () => {
    const cfg = JSON.parse(readFileSync(CONFIG, "utf8"));
    expect(cfg.provider).toHaveProperty("ollama-lan");
    expect(cfg.provider["ollama-lan"].options.baseURL).toContain("251");
    expect(cfg.provider).toHaveProperty("ollama");
  });

  test("config agents are assignable (role→model present, user-editable)", () => {
    const cfg = JSON.parse(readFileSync(CONFIG, "utf8"));
    // config MAY assign models (user's choice) but agents/*.md must not.
    expect(cfg.agent).toBeDefined();
    expect(Object.keys(cfg.agent).length).toBeGreaterThan(0);
  });

  test("all tier-1 plugins exist", () => {
    const plugins = [
      "horus",
      "vibeguard",
      "dcp",
      "cost-tracker",
      "notify",
      "moa",
      "router",
      "lan",
      "papyrus",
    ];
    const dir = join(ROOT, ".anubis", "plugins");
    for (const p of plugins) {
      expect(existsSync(join(dir, `${p}.ts`))).toBe(true);
    }
  });

  test("papyrus skills embedded", () => {
    const skillsDir = join(ROOT, ".anubis", "skills");
    const skills = readdirSync(skillsDir);
    expect(skills).toContain("papyrus");
    expect(existsSync(join(skillsDir, "papyrus", "SKILL.md"))).toBe(true);
  });

  test("launcher exists and is the entrypoint", () => {
    expect(existsSync(join(ROOT, "bin", "anubis"))).toBe(true);
  });
});

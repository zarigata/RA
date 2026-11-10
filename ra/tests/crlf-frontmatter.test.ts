// crlf-frontmatter.test.ts — Wave 3a regression pin: CRLF-tolerant frontmatter
// everywhere. This session found that six frontmatter parsers (skills,
// agents/catalog, commands, rules, agent.ts permissions + metadata) matched
// `^---\n` strictly, so any file saved with Windows/DRS line endings silently
// lost its frontmatter. Each parser that was fixed gets a named pin here.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSkillFrontmatter } from "../src/skills.ts";
import { parseAgentFrontmatter } from "../src/agents/catalog.ts";
import { parseRulePaths } from "../src/rules.ts";
import { loadAgentPermissionDetail, loadAgentMeta } from "../src/agent.ts";
import { loadCustomCommands } from "../src/commands/index.ts";

describe("CRLF frontmatter pins (Wave 3a bug: strict \\n-only matching dropped all metadata)", () => {
  test("parseSkillFrontmatter: CRLF SKILL.md yields name + folded description", () => {
    const raw = "---\r\nname: my-skill\r\ndescription: >\r\n  folded body\r\n---\r\n# body";
    const { name, description } = parseSkillFrontmatter(raw);
    expect(name).toBe("my-skill");
    expect(description).toContain("folded body");
  });

  test("parseSkillFrontmatter: CRLF with extra frontmatter keys via frontmatterKeys", async () => {
    const { frontmatterKeys } = await import("../src/skills.ts");
    const { keys, values } = frontmatterKeys("---\r\nname: a\r\nlicense: MIT\r\n---\r\n");
    expect(keys).toContain("name");
    expect(keys).toContain("license");
    expect(values.license).toBe("MIT");
  });

  test("parseAgentFrontmatter: CRLF agent .md keeps description + mode", () => {
    const fm = parseAgentFrontmatter("---\r\ndescription: crlf agent\r\nmode: subagent\r\n---\r\nbody");
    expect(fm.description).toBe("crlf agent");
    expect(fm.mode).toBe("subagent");
  });

  test("parseRulePaths: CRLF rules file resolves globs", () => {
    const paths = parseRulePaths("---\r\npaths:\r\n  - 'src/**'\r\n  - \"docs/*.md\"\r\n---\r\nbody");
    expect(paths).toEqual(["src/**", "docs/*.md"]);
  });

  test("loadCustomCommands: CRLF command file extracts fields + prompt", () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-crlf-cmd-"));
    try {
      writeFileSync(
        join(dir, "crlf-cmd.md"),
        "---\r\ndescription: crlf cmd\r\nallowed-tools: Bash, Read\r\n---\r\n# prompt body",
      );
      const cmds = loadCustomCommands(dir);
      expect(cmds).toHaveLength(1);
      expect(cmds[0]!.name).toBe("crlf-cmd");
      expect(cmds[0]!.description).toBe("crlf cmd");
      expect(cmds[0]!.allowedTools).toEqual(["Bash", "Read"]);
      expect(cmds[0]!.prompt).toContain("prompt body");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("loadAgentPermissionDetail: CRLF permission block is honored end-to-end", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-crlf-agent-"));
    try {
      mkdirSync(join(cwd, ".ra", "agents"), { recursive: true });
      writeFileSync(
        join(cwd, ".ra", "agents", "crlf-agent.md"),
        "---\r\ndescription: x\r\npermission:\r\n  edit: deny\r\n  read: allow\r\n---\r\nbody",
      );
      const detail = loadAgentPermissionDetail("crlf-agent", cwd);
      expect(detail).not.toBeNull();
      expect(detail!.tools.edit).toBe("deny");
      expect(detail!.tools.read).toBe("allow");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("loadAgentMeta: CRLF agent metadata (model/tools/category) is read", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-crlf-meta-"));
    try {
      mkdirSync(join(cwd, ".ra", "agents"), { recursive: true });
      writeFileSync(
        join(cwd, ".ra", "agents", "meta-agent.md"),
        "---\r\nmodel: ollama-lan/q\r\ntools: Read, Grep\r\ncategory: research\r\n---\r\nbody",
      );
      const meta = loadAgentMeta("meta-agent", cwd);
      expect(meta.model).toBe("ollama-lan/q");
      expect(meta.tools).toEqual(["Read", "Grep"]);
      expect(meta.category).toBe("research");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// (Skill-body and roomodes/TOML CRLF coverage lives in parser-corpus.test.ts.)

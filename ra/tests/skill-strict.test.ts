// skill-strict.test.ts — Wave 3a boundary sweep: the strict SKILL.md
// validator (Codex-strict subset) at every documented limit — name length
// 63/64/65, kebab-case violations, description 1023/1024/1025, extra keys,
// missing frontmatter — plus the parse helpers underpinning it.

import { describe, expect, test } from "bun:test";
import { checkSkillStrict, frontmatterKeys, parseSkillFrontmatter, loadSkillBody } from "../src/skills.ts";

/** Same pattern as skills.ts NAME_RE (unexported — mirrored here deliberately). */
const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const skill = (name: string, description: string, extra = "") =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\nBody text.\n`;

describe("checkSkillStrict — name length boundaries (limit 64)", () => {
  const kebab64 = "a".repeat(64);
  const kebab63 = "a".repeat(63);
  const kebab65 = "a".repeat(65);

  test("63 chars: clean", () => {
    expect(checkSkillStrict(kebab63, skill(kebab63, "d")).problems).toEqual([]);
  });
  test("64 chars: clean (at the limit)", () => {
    expect(checkSkillStrict(kebab64, skill(kebab64, "d")).problems).toEqual([]);
  });
  test("65 chars: flagged with the actual length", () => {
    const f = checkSkillStrict(kebab65, skill(kebab65, "d"));
    expect(f.problems.some((p) => p.includes("exceeds 64") && p.includes("65"))).toBe(true);
  });
});

describe("checkSkillStrict — kebab-case violations", () => {
  const cases: Array<[string, string]> = [
    ["has spaces", "spaces"],
    ["UpperStart", "uppercase start"],
    ["camelCase", "camelCase"],
    ["snake_case", "underscores"],
    ["double--dash", "double dash"],
    ["-leading-dash", "leading dash"],
    ["trailing-dash-", "trailing dash"],
    ["dot.name", "dots"],
    ["name!", "punctuation"],
    ["", "empty name key"],
  ];
  for (const [name, label] of cases) {
    test(`"${label}" is flagged as not kebab-case`, () => {
      const f = checkSkillStrict("dirname", skill(name, "d"));
      if (name === "") {
        // empty name key = effectively missing
        expect(f.problems.some((p) => p.includes("missing"))).toBe(true);
      } else {
        expect(f.problems.some((p) => p.includes("not kebab-case"))).toBe(true); // ${label}
      }
    });
  }

  test("valid kebab shapes pass: letters, digits, single dashes", () => {
    for (const ok of ["a", "ab", "a-b", "a1-b2-c3", "0start", "end9"]) {
      expect(checkSkillStrict(ok, skill(ok, "d")).problems.filter((p) => p.includes("kebab"))).toEqual([]); // ${ok}
    }
  });

  test("dirname violations are flagged when they differ from the frontmatter name", () => {
    // fm name fine, dirname not kebab → flagged (import-time collision guard)
    const f = checkSkillStrict("Bad Dirname", skill("good-name", "d"));
    expect(f.problems.some((p) => p.includes("dirname 'Bad Dirname' is not kebab-case"))).toBe(true);
  });
});

describe("checkSkillStrict — description length boundaries (limit 1024)", () => {
  const d1023 = "d".repeat(1023);
  const d1024 = "d".repeat(1024);
  const d1025 = "d".repeat(1025);

  test("1023 chars: clean", () => {
    expect(checkSkillStrict("ok", skill("ok", d1023)).problems).toEqual([]);
  });
  test("1024 chars: clean (at the limit)", () => {
    expect(checkSkillStrict("ok", skill("ok", d1024)).problems).toEqual([]);
  });
  test("1025 chars: flagged with the actual length", () => {
    const f = checkSkillStrict("ok", skill("ok", d1025));
    expect(f.problems.some((p) => p.includes("exceeds 1024") && p.includes("1025"))).toBe(true);
  });
  test("missing description (empty value) is flagged", () => {
    expect(checkSkillStrict("ok", "---\nname: ok\ndescription:\n---\nbody").problems)
      .toContain("description missing");
  });
  test("folded (multi-line) description counts toward the length limit", () => {
    const raw = `---\nname: ok\ndescription: >\n  ${"d ".repeat(520)}\n---\nbody`; // folds to 1039 chars
    const f = checkSkillStrict("ok", raw);
    expect(f.problems.some((p) => p.includes("exceeds 1024"))).toBe(true);
  });

  test("an indented continuation without a > marker is NOT folded (strict inline only)", () => {
    // "description:" with empty inline value but continuation lines that are
    // themselves key-looking (no leading indent match) → description missing.
    const raw = "---\nname: ok\ndescription:\nname2: x\n---\nbody";
    expect(parseSkillFrontmatter(raw).description).toBe("");
  });
});

describe("checkSkillStrict — extra keys + missing frontmatter", () => {
  test("extra keys are flagged as extraKeys but produce NO problems (superset tolerated)", () => {
    const f = checkSkillStrict("ok", skill("ok", "d", "license: MIT\nversion: 2\n"));
    expect(f.extraKeys).toEqual(["license", "version"]);
    expect(f.problems).toEqual([]);
  });

  test("the strict pair alone produces no extraKeys field at all", () => {
    const f = checkSkillStrict("ok", skill("ok", "d"));
    expect(f.extraKeys).toBeUndefined();
  });

  test("missing frontmatter entirely: description missing + name missing", () => {
    const f = checkSkillStrict("dirname", "Just a body, no fences.");
    expect(f.problems).toContain("description missing");
    expect(f.problems.some((p) => p.includes("`name` missing"))).toBe(true);
  });

  test("empty raw string behaves like missing frontmatter", () => {
    const f = checkSkillStrict("dirname", "");
    expect(f.problems.length).toBeGreaterThanOrEqual(2);
  });

  test("finding carries the skill name", () => {
    expect(checkSkillStrict("my-skill", skill("my-skill", "d")).skill).toBe("my-skill");
  });
});

describe("frontmatterKeys — the raw key scanner", () => {
  test("captures top-level keys with values; nested/indented lines ignored", () => {
    const raw = "---\nname: x\ndescription: y\npermission:\n  edit: deny\nallowed-tools: Bash\n---\n";
    const { keys, values } = frontmatterKeys(raw);
    expect(keys).toEqual(["name", "description", "permission", "allowed-tools"]);
    expect(values["name"]).toBe("x");
    expect(values["permission"]).toBe(""); // empty value
  });

  test("no frontmatter → empty keys (not a throw)", () => {
    expect(frontmatterKeys("no fences")).toEqual({ keys: [], values: {} });
  });
});

describe("loadSkillBody + NAME_RE edges", () => {
  test("NAME_RE accepts kebab/alnum, rejects path traversal and spaces", () => {
    for (const ok of ["a", "a-b", "a_b", "A-b", "x9"]) expect(NAME_RE.test(ok)).toBe(true);
    for (const bad of ["../escape", "a b", "", "-x", "a/b", "."]) expect(NAME_RE.test(bad)).toBe(false);
  });

  test("loadSkillBody caps at maxChars with an explicit truncation marker", () => {
    const proj = mkdtempSync(join(tmpdir(), "ra-skillstrict-"));
    try {
      mkdirSync(join(proj, ".agents", "skills", "big"), { recursive: true });
      writeFileSync(join(proj, ".agents", "skills", "big", "SKILL.md"), `---\nname: big\ndescription: d\n---\n${"x".repeat(100)}`);
      const body = loadSkillBody("big", proj, 10)!;
      expect(body.length).toBeLessThan(40);
      expect(body).toContain("(skill truncated)");
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });

  test("a frontmatter-only SKILL.md falls back to the raw text as body", () => {
    const proj = mkdtempSync(join(tmpdir(), "ra-skillstrict2-"));
    try {
      mkdirSync(join(proj, ".agents", "skills", "fm"), { recursive: true });
      writeFileSync(join(proj, ".agents", "skills", "fm", "SKILL.md"), "---\nname: fm\ndescription: d\n---\n");
      expect(loadSkillBody("fm", proj)).toContain("name: fm");
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });

  test("unknown skill returns null; traversal-shaped names rejected", () => {
    const proj = mkdtempSync(join(tmpdir(), "ra-skillstrict3-"));
    try {
      expect(loadSkillBody("nope", proj)).toBeNull();
      expect(loadSkillBody("../escape", proj)).toBeNull();
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });
});

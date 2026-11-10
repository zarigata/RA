// parser-corpus.test.ts — Wave 3a corpus sweep: the hand-rolled TOML
// (plugins/toml.ts) and YAML-subset (plugins/roo-modes.ts) parsers against
// the real parity fixtures (valid shapes) plus programmatic mutations
// (truncation, wrong indent, unclosed quotes, duplicate keys, empty file,
// BOM, CRLF). Fail-closed contract: parseToml/parseRoomodes NEVER throw and
// never half-import a malformed entry — junk skips with a warning.

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseToml, tomlGet } from "../src/plugins/toml.ts";
import { parseRoomodes } from "../src/plugins/roo-modes.ts";
import { parseSkillFrontmatter } from "../src/skills.ts";
import { parseAgentFrontmatter } from "../src/agents/catalog.ts";
import { loadCustomCommands } from "../src/commands/index.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const FIX = join(import.meta.dir, "fixtures", "parity");
const read = (p: string) => readFileSync(p, "utf-8");

// ---- mutation engine ------------------------------------------------------------------

type Mutator = { name: string; apply: (src: string) => string };

const MUTATORS: Mutator[] = [
  { name: "truncated at 50%", apply: (s) => s.slice(0, Math.floor(s.length / 2)) },
  { name: "truncated to first line", apply: (s) => s.split("\n")[0]! },
  { name: "unclosed quote injection", apply: (s) => s.replace(/"/, '"') /* odd count now */ },
  { name: "empty file", apply: () => "" },
  { name: "whitespace only", apply: () => "   \n\t\n" },
  { name: "BOM prefix", apply: (s) => "﻿" + s },
  { name: "CRLF line endings", apply: (s) => s.replace(/\r?\n/g, "\r\n") },
  { name: "null bytes", apply: (s) => s + "\0\0junk\0" },
  { name: "binary garbage", apply: () => "\u0001\u0002\u0003\u0004 ÿþ" },
  { name: "nesting bomb (deep dotted headers)", apply: () => "[a.b.c.d.e.f.g.h.i.j.k]\nx = 1\n".repeat(20) },
  { name: "duplicate keys", apply: (s) => s + "\n" + (s.match(/^[A-Za-z0-9_.-]+\s*=/m)?.[0] ?? "x = 1") + " 2" },
  { name: "double of the whole file", apply: (s) => s + "\n" + s },
];

/** The fail-closed oracle: parser returns a result object, never throws. */
function expectNeverThrows(fn: () => unknown): void {
  let out: unknown;
  expect(() => { out = fn(); }).not.toThrow();
  expect(out).toBeDefined();
}

// ---- TOML: valid corpus ----------------------------------------------------------------

describe("parseToml — valid fixture corpus", () => {
  const codexToml = read(join(FIX, "codex", "config.toml"));

  test("canonical codex config parses: model, features, mcp_servers, projects", () => {
    const { value, warnings } = parseToml(codexToml);
    expect(warnings).toEqual([]);
    expect(value["model"]).toBe("gpt-5.6-sol");
    expect((value["features"] as Record<string, unknown>)["hooks"]).toBe(true);
    const roblox = tomlGet(value, "mcp_servers.roblox-studio")!;
    expect(roblox["command"]).toContain("RobloxStudio");
    const godot = tomlGet(value, "mcp_servers.godot-mcp")!;
    expect(godot["args"]).toEqual(["run", "server.py"]);
    expect(godot["startup_timeout_sec"]).toBe(60);
    expect(godot["tool_timeout_sec"]).toBe(90);
    expect(tomlGet(value, "mcp_servers.godot-mcp.env")!["GDAI_MCP_SERVER_PORT"]).toBe("3571");
    expect(tomlGet(value, 'projects."/Users/zari/Documents/RA/RA"')!["trust_level"]).toBe("trusted");
  });

  test("tomlGet returns undefined for absent paths, arrays, scalars", () => {
    const { value } = parseToml(codexToml);
    expect(tomlGet(value, "mcp_servers.nothing")).toBeUndefined();
    expect(tomlGet(value, "model")).toBeUndefined(); // scalar, not a table
    expect(tomlGet(value, "mcp_servers.godot-mcp.args")).toBeUndefined(); // array, not a table
  });

  test("scalar shapes: strings (both quotes), ints, floats, bools, arrays, empty array", () => {
    const { value, warnings } = parseToml([
      'a = "double"', "b = 'single'", "c = 42", "d = -7", "e = 3.5", "f = true", "g = false",
      'h = ["x", "y"]', "i = []", 'j = "with \\"escaped\\" and \\\\ backslash"',
    ].join("\n"));
    expect(warnings).toEqual([]);
    expect(value["a"]).toBe("double");
    expect(value["b"]).toBe("single");
    expect(value["c"]).toBe(42);
    expect(value["d"]).toBe(-7);
    expect(value["e"]).toBe(3.5);
    expect(value["f"]).toBe(true);
    expect(value["g"]).toBe(false);
    expect(value["h"]).toEqual(["x", "y"]);
    expect(value["i"]).toEqual([]);
    expect(value["j"]).toBe('with "escaped" and \\ backslash');
  });

  test("comments and blank lines are ignored; inline comment after value stripped", () => {
    const { value, warnings } = parseToml([
      "# leading comment",
      "",
      "model = \"x\" # trailing comment",
      "  # indented comment",
      "[sec] # header comment",
      "k = 1",
    ].join("\n"));
    expect(warnings).toEqual([]);
    expect(value["model"]).toBe("x");
    expect((value["sec"] as Record<string, unknown>)["k"]).toBe(1);
  });

  test("out-of-subset values warn+skip, never throw: dates, inline tables, multiline arrays", () => {
    const { value, warnings } = parseToml([
      "d = 1979-05-27T07:32:00Z",
      "t = { inline = 'table' }",
      "m = [",
      '  "multi",',
      "]",
      "ok = 1",
    ].join("\n"));
    expect(value["ok"]).toBe(1);
    expect(value["d"]).toBeUndefined();
    expect(value["t"]).toBeUndefined();
    expect(value["m"]).toBeUndefined();
    expect(warnings.length).toBeGreaterThanOrEqual(3);
  });
});

// ---- TOML: mutation sweep ----------------------------------------------------------------

describe("parseToml — mutation sweep (fail-closed)", () => {
  const codexToml = read(join(FIX, "codex", "config.toml"));

  for (const m of MUTATORS) {
    test(`mutation "${m.name}": no throw, result object returned`, () => {
      const mutated = m.apply(codexToml);
      expectNeverThrows(() => parseToml(mutated));
    });
  }

  test("truncation mid-section keeps the already-parsed prefix intact", () => {
    const truncated = codexToml.slice(0, codexToml.indexOf("[mcp_servers.cloudflare]"));
    const { value } = parseToml(truncated);
    expect(value["model"]).toBe("gpt-5.6-sol"); // prefix survives
    expect(tomlGet(value, "mcp_servers.roblox-studio")).toBeDefined();
    expect(tomlGet(value, "mcp_servers.cloudflare")).toBeUndefined();
  });

  test("BOM before a header degrades that header but never crashes the parse", () => {
    const { value } = parseToml("﻿model = \"x\"");
    // The BOM glues to the key — either the key is skipped (warn) or parsed
    // without the BOM; both are acceptable fail-closed outcomes, but the
    // parser must not throw and must return an object.
    expect(typeof value).toBe("object");
  });

  test("duplicate key: last assignment wins (documented TOML-lenient behavior)", () => {
    const { value, warnings } = parseToml("k = \"first\"\nk = \"second\"");
    // Real TOML rejects duplicates; the subset parser is lenient — pin the
    // actual behavior (overwrite) so a change to reject is a visible decision.
    expect(value["k"]).toBe("second");
    expect(warnings).toEqual([]);
  });

  test("CRLF headers and keys parse identically to LF", () => {
    const lf = parseToml("[sec]\nkey = \"v\"\n");
    const crlf = parseToml("[sec]\r\nkey = \"v\"\r\n");
    expect(crlf.value).toEqual(lf.value);
  });
});

// ---- YAML subset (roomodes): valid corpus ---------------------------------------------------

describe("parseRoomodes — valid fixture corpus (JSON + YAML shapes)", () => {
  const roomodesYaml = read(join(FIX, "roo", "roomodes.yaml"));
  const roomodesJson = read(join(FIX, "roo", "roomodes.json"));

  test("roomodes.yaml fixture parses into modes with groups", () => {
    const { modes, warnings } = parseRoomodes(roomodesYaml);
    expect(modes.length).toBeGreaterThan(0);
    for (const m of modes) {
      expect(m.slug).toMatch(/^[a-zA-Z0-9-]+$/);
      expect(m.roleDefinition.length).toBeGreaterThan(0);
    }
    // at least one mode carries tuple-form edit groups with fileRegex
    const withRegex = modes.flatMap((m) => m.groups).find((g) => g.fileRegex);
    expect(withRegex).toBeTruthy();
    expect(warnings).toEqual([]);
  });

  test("roomodes.json fixture parses through the JSON path (no yaml warnings)", () => {
    const { modes, warnings } = parseRoomodes(roomodesJson);
    expect(modes.length).toBeGreaterThan(0);
    expect(warnings.filter((w) => w.startsWith("yaml:"))).toEqual([]);
  });

  test("tuple groups from JSON arrays keep fileRegex + description", () => {
    const { modes } = parseRoomodes(JSON.stringify({ customModes: [{
      slug: "t1", roleDefinition: "r",
      groups: [["edit", { fileRegex: "\\.md$", description: "docs only" }], "read"],
    }] }));
    const g = modes[0]!.groups;
    expect(g[0]).toEqual({ name: "edit", fileRegex: "\\.md$", description: "docs only" });
    expect(g[1]).toEqual({ name: "read" });
  });

  test("unknown groups warn and are dropped; known ones survive in the same mode", () => {
    const { modes, warnings } = parseRoomodes(JSON.stringify({ customModes: [{
      slug: "s", roleDefinition: "r", groups: ["edit", "browser-hack", ["command", {}]],
    }] }));
    expect(modes[0]!.groups.map((g) => g.name)).toEqual(["edit", "command"]);
    expect(warnings.some((w) => w.includes("unknown group 'browser-hack'"))).toBe(true);
  });

  test("modes missing slug or roleDefinition are skipped with warnings (fail-closed)", () => {
    const { modes, warnings } = parseRoomodes(JSON.stringify({ customModes: [
      { roleDefinition: "no slug" },
      { slug: "Bad Slug!", roleDefinition: "r" },
      { slug: "ok", roleDefinition: "" },
      { slug: "good", roleDefinition: "fine" },
    ] }));
    expect(modes.map((m) => m.slug)).toEqual(["good"]);
    expect(warnings.length).toBe(3);
  });
});

// ---- YAML subset: mutation sweep ------------------------------------------------------------

describe("parseRoomodes — mutation sweep (fail-closed)", () => {
  const roomodesYaml = read(join(FIX, "roo", "roomodes.yaml"));
  const roomodesJson = read(join(FIX, "roo", "roomodes.json"));

  for (const src of [["yaml", roomodesYaml], ["json", roomodesJson]] as const) {
    for (const m of MUTATORS) {
      test(`${src[0]} × mutation "${m.name}": no throw, no half-imported junk modes`, () => {
        const mutated = m.apply(src[1]);
        expectNeverThrows(() => parseRoomodes(mutated));
        const { modes } = parseRoomodes(mutated);
        // Any mode that survives must be VALID (slug + roleDefinition) —
        // half-parsed junk never leaks through.
        for (const mode of modes) {
          expect(mode.slug).toMatch(/^[a-zA-Z0-9-]+$/); // ${src[0]} ${m.name}
          expect(mode.roleDefinition.trim().length).toBeGreaterThan(0);
        }
      });
    }
  }

  test("wrong indentation inside the yaml block warns, never throws", () => {
    const { modes, warnings } = parseRoomodes([
      "customModes:",
      "  - slug: a",
      "      roleDefinition: over-indented",
      "    groups:",
      "      - edit",
    ].join("\n"));
    expectNeverThrows(() => modes);
    expect(warnings.some((w) => w.includes("indent") || w.includes("unparseable"))).toBe(true);
  });

  test("flow list with quoted commas splits correctly", () => {
    const { modes } = parseRoomodes([
      "customModes:",
      "  - slug: q",
      '    roleDefinition: "has, comma"',
      "    groups: [edit, command]",
    ].join("\n"));
    expect(modes[0]!.roleDefinition).toBe("has, comma");
    expect(modes[0]!.groups.map((g) => g.name)).toEqual(["edit", "command"]);
  });
});

// ---- frontmatter parsers: malformed-everything sweep -----------------------------------------

describe("frontmatter parsers — malformed sweep", () => {
  const malformed: Array<{ name: string; raw: string }> = [
    { name: "no frontmatter at all", raw: "just a body" },
    { name: "opening fence only", raw: "---\nname: x" },
    { name: "closing fence only", raw: "name: x\n---" },
    { name: "empty frontmatter", raw: "---\n---\nbody" },
    { name: "frontmatter not at line 1 (leading blank)", raw: "\n---\nname: x\n---\n" },
    { name: "CRLF frontmatter", raw: "---\r\ndescription: crlf doc\r\n---\r\nbody" },
    { name: "BOM before fence", raw: "﻿---\nname: bom\n---\nbody" },
    { name: "null bytes in frontmatter", raw: "---\nname: \0bad\n---\nbody" },
    { name: "fence with trailing spaces", raw: "--- \nname: x\n---\nbody" },
    { name: "duplicate name keys", raw: "---\nname: first\nname: second\n---\nbody" },
    { name: "name with leading/trailing spaces", raw: "---\nname:   padded   \n---\nbody" },
    { name: "folded description block", raw: "---\nname: x\ndescription: >\n  line one\n  line two\n---\nbody" },
    { name: "pipe description block", raw: "---\nname: x\ndescription: |\n  literal\n---\nbody" },
  ];

  test("parseSkillFrontmatter never throws on malformed input", () => {
    for (const m of malformed) expectNeverThrows(() => parseSkillFrontmatter(m.raw));
  });

  test("parseAgentFrontmatter never throws; defaults to subagent mode", () => {
    for (const m of malformed) {
      expectNeverThrows(() => parseAgentFrontmatter(m.raw));
      expect(parseAgentFrontmatter(m.raw).mode).toBe("subagent"); // ${m.name}
    }
  });

  test("CRLF frontmatter still extracts description (both parsers split \\r?\\n)", () => {
    expect(parseSkillFrontmatter("---\r\ndescription: crlf doc\r\n---\r\nbody").description).toBe("crlf doc");
  });

  test("folded (>) descriptions join lines with spaces; literal (|) folds too (subset)", () => {
    expect(parseSkillFrontmatter("---\nname: x\ndescription: >\n  line one\n  line two\n---\n").description)
      .toBe("line one line two");
    expect(parseSkillFrontmatter("---\nname: x\ndescription: |\n  literal text\n---\n").description)
      .toBe("literal text");
  });

  test("loadCustomCommands skips malformed command files silently", () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-fm-malformed-"));
    try {
      writeFileSync(join(dir, "garbage.md"), "---\nname: [unclosed\ndescription: x\n---\nbody");
      writeFileSync(join(dir, "truncated.md"), "---\nname: t");
      writeFileSync(join(dir, "empty.md"), "");
      writeFileSync(join(dir, "binary.md"), "\u0000\u0001\u0002");
      const cmds = loadCustomCommands(dir);
      // Whatever loads must be dispatchable (name + prompt); junk is skipped.
      for (const c of cmds) {
        expect(c.name.length).toBeGreaterThan(0);
        expect(c.prompt.length).toBeGreaterThan(0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---- fixture inventory sweep ------------------------------------------------------------------

describe("parity fixture corpus inventory", () => {
  test("every .md fixture under parity/ parses through every frontmatter parser without throwing", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name));
        else if (e.name.endsWith(".md")) files.push(join(d, e.name));
      }
    };
    walk(FIX);
    expect(files.length).toBeGreaterThanOrEqual(12); // corpus didn't silently vanish
    for (const f of files) {
      const raw = read(f);
      expectNeverThrows(() => parseSkillFrontmatter(raw)); // ${f}
      expectNeverThrows(() => parseAgentFrontmatter(raw)); // ${f}
    }
  });
});

// parity-wavee.test.ts — Wave E tail-closure suite:
//   1. Claude settings.json import (permissions → namespaced entries; env
//      recorded NOT applied; model noted) — fixture validated against the
//      settings schema documented in COMPETITORS.md / claude-code-settings
//      evidence.
//   2. Legacy SSE MCP transport against a real in-test Bun.serve fixture
//      (endpoint event → POST → message events).
//   3. Roo memory-bank dir detection → import → .ra/rules/memory-bank + roo
//      agent description note.
//   4. MCP per-server allowlist enforcement at tool-registration + call time.
//   5. MCP elicitation policy (decline with reason, run continues).
//   6. Inline images: detection + placeholder rendering (pure).
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { detectStores } from "../src/plugins/stores.ts";
import { importEntry, loadManifest, claudeSettingsToImport, claudePermRuleToRa, mcpConfigEntry, rooModeToAgentMd } from "../src/plugins/import.ts";
import { McpSseClient, loadMcpTools, toolFilterOf, toolAllowed, decideElicitation, isElicitRequest } from "../src/mcp.ts";
import { loadRules } from "../src/rules.ts";
import { loadProjectMemory } from "../src/agent.ts";
import { detectImageSupport, renderImageBlock, isImagePath } from "../src/tui/images.ts";
import { parseRoomodes } from "../src/plugins/roo-modes.ts";

const FIX = join(import.meta.dir, "fixtures", "parity");
const read = (p: string) => readFileSync(p, "utf-8");

let HOME = "";
let PROJ = "";
beforeAll(() => {
  HOME = mkdtempSync(join(tmpdir(), "ra-wavee-home-"));
  PROJ = mkdtempSync(join(tmpdir(), "ra-wavee-proj-"));
});
afterAll(() => {
  rmSync(HOME, { recursive: true, force: true });
  rmSync(PROJ, { recursive: true, force: true });
});

// ---- 1. Claude settings.json import ------------------------------------------------------

describe("1. Claude settings.json import", () => {
  test("fixture parses and is detected as a settings entry (user scope)", () => {
    mkdirSync(join(HOME, ".claude"), { recursive: true });
    writeFileSync(join(HOME, ".claude", "settings.json"), read(join(FIX, "claude-code", "settings.json")));
    const entries = detectStores(HOME, PROJ);
    const s = entries.find((e) => e.kind === "settings" && e.name === "claude-settings")!;
    expect(s).toBeTruthy();
    expect(s.description).toContain("2 allow");
    expect(s.description).toContain("model=claude-sonnet-5");
    expect(s.description).toContain("env (recorded, never applied)");
  });

  test("project settings.local.json wins over user settings.json", () => {
    mkdirSync(join(PROJ, ".claude"), { recursive: true });
    writeFileSync(join(PROJ, ".claude", "settings.local.json"), JSON.stringify({ model: "claude-opus-4" }));
    const entries = detectStores(HOME, PROJ).filter((e) => e.kind === "settings");
    expect(entries.map((e) => e.name)).toEqual(["claude-settings-local"]);
    rmSync(join(PROJ, ".claude"), { recursive: true, force: true });
  });

  test("permissions → namespaced permission.tool entries in ~/.ra/ra.json", () => {
    const s = detectStores(HOME, PROJ).find((e) => e.kind === "settings")!;
    const r = importEntry(s, HOME);
    expect(r.status).toBe("imported");
    const cfg = JSON.parse(read(join(HOME, ".ra", "ra.json")));
    // Allow rules: bare + specifier forms, namespaced with claude: prefix.
    expect(cfg.permission.tool["claude:bash:Bash(npm run *)"]).toBe("allow");
    expect(cfg.permission.tool["claude:read:Read(~/.zshrc)"]).toBe("allow");
    expect(cfg.permission.tool["claude:bash:Bash(git push *)"]).toBe("ask");
    expect(cfg.permission.tool["claude:read:Read(./.env)"]).toBe("deny");
    // Bare tool rule maps to the collapsed namespaced key.
    expect(cfg.permission.tool["claude:webfetch"]).toBe("deny");
  });

  test("env keys are recorded in the manifest but NEVER applied", () => {
    const rec = loadManifest(HOME).imports.find((i) => i.kind === "settings")!;
    expect(rec.settings!.envRecordedOnly).toEqual(["DISABLE_AUTO_COMPACT", "ANTHROPIC_BASE_URL"]);
    expect(rec.settings!.model).toBe("claude-sonnet-5");
    expect(rec.note).toContain("NOT applied");
    // The env values never land anywhere on disk except the manifest keys list.
    const cfg = read(join(HOME, ".ra", "ra.json"));
    expect(cfg).not.toContain("proxy.example.com");
  });

  test("re-import never overwrites existing permission keys", () => {
    const before = JSON.parse(read(join(HOME, ".ra", "ra.json")));
    // Idempotent at the manifest level (already imported → skip).
    const s = detectStores(HOME, PROJ).find((e) => e.kind === "settings")!;
    expect(importEntry(s, HOME).status).toBe("already");
    expect(JSON.parse(read(join(HOME, ".ra", "ra.json")))).toEqual(before);
  });

  test("unmappable rules are noted, never mistranslated", () => {
    const { permissionRules, notes } = claudeSettingsToImport({ permissions: { allow: ["mcp__github__create_issue"] } });
    expect(permissionRules).toEqual({});
    expect(notes[0]).toContain("not mappable");
  });

  test("claudePermRuleToRa maps tool names; unknown tools → null", () => {
    expect(claudePermRuleToRa("WebFetch")!.key).toBe("claude:webfetch");
    expect(claudePermRuleToRa("mcp__x__y")).toBeNull();
    expect(claudePermRuleToRa("Bash(npm run *)")!.key).toBe("claude:bash:Bash(npm run *)");
  });
});

// ---- 2. Legacy SSE transport ---------------------------------------------------------------

describe("2. Legacy SSE MCP transport", () => {
  let proc: ChildProcess | null = null;
  let port = 0;
  beforeAll(async () => {
    proc = spawn("bun", [join(import.meta.dir, "fixtures", "mcp-sse-server.ts")], { stdio: ["pipe", "pipe", "inherit"] });
    const line: string = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("sse fixture did not start")), 10000);
      proc!.stdout!.on("data", (d: Buffer) => {
        const m = d.toString().match(/sse-server:(\d+)/);
        if (m) { clearTimeout(timer); resolve(m[1]!); }
      });
      proc!.on("exit", (c) => { clearTimeout(timer); reject(new Error(`sse fixture exited ${c}`)); });
    });
    port = Number(line);
  });
  afterAll(() => { proc?.kill(); });

  test("handshake via endpoint event; tools/list + tools/call over the SSE stream", async () => {
    const client = new McpSseClient({ url: `http://localhost:${port}/sse` });
    try {
      await client.start();
      const tools = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(["echo"]);
      const out = await client.callTool("echo", { text: "hi" });
      expect(out).toBe("sse echo: hi");
    } finally {
      await client.close();
    }
  });

  test("fail-closed: a non-SSE endpoint is an explicit error, never a silent partial", async () => {
    const client = new McpSseClient({ url: `http://localhost:${port}/not-sse` });
    await expect(client.start()).rejects.toThrow(/did not open an event stream|no `endpoint` event/);
    await client.close();
  });

  test("Cline sse server config maps to a type:sse entry; streamableHttp stays marker-free", () => {
    expect(mcpConfigEntry({ type: "sse", url: "https://x.example/sse" })).toEqual({ url: "https://x.example/sse", type: "sse" });
    // Explicit streamableHttp and Codex/OpenCode url-without-type stay marker-free
    // (ponytail ceiling: Cline's url-no-type→sse default can't be honored without
    // mistyping other stores' streamable endpoints — see import.ts).
    expect(mcpConfigEntry({ url: "https://x.example/mcp" })).toEqual({ url: "https://x.example/mcp" });
    expect(mcpConfigEntry({ type: "streamableHttp", url: "https://x.example/mcp" })).toEqual({ url: "https://x.example/mcp" });
  });
});

// ---- 3. Roo memory-bank dir ---------------------------------------------------------------

describe("3. Roo memory-bank dir", () => {
  beforeAll(() => {
    mkdirSync(join(PROJ, "memory-bank"), { recursive: true });
    writeFileSync(join(PROJ, "memory-bank", "activeContext.md"), read(join(FIX, "roo", "memory-bank", "activeContext.md")));
    writeFileSync(join(PROJ, "memory-bank", "productContext.md"), read(join(FIX, "roo", "memory-bank", "productContext.md")));
  });

  test("memory-bank/*.md detected (project dir wins over home)", () => {
    const entries = detectStores(HOME, PROJ).filter((e) => e.kind === "memory-bank");
    expect(entries.map((e) => e.name).sort()).toEqual(["activeContext", "productContext"]);
    expect(entries[0]!.path.startsWith(PROJ)).toBe(true);
  });

  test("import → ~/.ra/rules/memory-bank/, injected as always-on rules", () => {
    for (const e of detectStores(HOME, PROJ).filter((e) => e.kind === "memory-bank")) importEntry(e, HOME);
    expect(existsSync(join(HOME, ".ra", "rules", "memory-bank", "activeContext.md"))).toBe(true);
    // LIVE: loadProjectMemory (the real prompt-assembly path) injects it.
    const mem = loadProjectMemory(join(HOME, "project"));
    expect(mem).toContain("Converting the settings importer");
    expect(mem).toContain("Ship parity with the five competitor ecosystems");
  });

  test("roo-* generated agents note the memory bank", () => {
    const { modes } = parseRoomodes(read(join(FIX, "roo", "roomodes.yaml")));
    const md = rooModeToAgentMd(modes.find((m) => m.slug === "reviewer")!);
    expect(md).toContain("memory-bank/*.md");
  });
});

// ---- 4. MCP allowlist enforcement ---------------------------------------------------------

describe("4. MCP per-server allowlist enforcement", () => {
  test("toolAllowed: allow-list filters; deny-list excludes; no list = all", () => {
    expect(toolAllowed(undefined, "anything")).toBe(true); // backward compat
    expect(toolAllowed({ allow: ["echo"] }, "echo")).toBe(true);
    expect(toolAllowed({ allow: ["echo"] }, "other")).toBe(false);
    expect(toolAllowed({ deny: ["danger"] }, "danger")).toBe(false);
    expect(toolAllowed({ deny: ["danger"] }, "echo")).toBe(true);
    // deny wins over allow
    expect(toolAllowed({ allow: ["x"], deny: ["x"] }, "x")).toBe(false);
  });

  test("toolFilterOf reads the union field off stdio and http entries", () => {
    expect(toolFilterOf({ command: "x", tools: { allow: ["a"] } } as never)).toEqual({ allow: ["a"] });
    expect(toolFilterOf({ url: "https://x", tools: { deny: ["b"] } })).toEqual({ deny: ["b"] });
    expect(toolFilterOf({ url: "https://x" })).toBeUndefined();
  });

  test("loadMcpTools filters a stdio server's tools at registration time", async () => {
    const SERVER = join(import.meta.dir, "fixtures", "mcp-server.ts");
    // The fixture exposes one tool ("echo"); an allow list without it drops it.
    const none = await loadMcpTools({ picky: { command: "bun", args: [SERVER], tools: { allow: ["not-echo"] } } as never });
    expect(none).toEqual([]);
    // No filter → all tools (backward compat).
    const all = await loadMcpTools({ open: { command: "bun", args: [SERVER] } });
    expect(all.map((t) => t.name)).toEqual(["echo"]);
    // Deny-list excludes exactly the denied tool.
    const denied = await loadMcpTools({ noecho: { command: "bun", args: [SERVER], tools: { deny: ["echo"] } } as never });
    expect(denied).toEqual([]);
  });

  test("mcpConfigEntry records allow/deny from Cline autoApprove / Codex enabled_tools", () => {
    expect(mcpConfigEntry({ command: "x", autoApprove: ["echo", "read"] }).tools).toEqual({ allow: ["echo", "read"] });
    expect(mcpConfigEntry({ command: "x", enabled_tools: ["a"], disabled_tools: ["b"] }).tools).toEqual({ allow: ["a"], deny: ["b"] });
    expect(mcpConfigEntry({ command: "x" }).tools).toBeUndefined();
  });
});

// ---- 5. MCP elicitation -------------------------------------------------------------------

describe("5. MCP elicitation", () => {
  test("elicitation request detected from a server message", () => {
    expect(isElicitRequest({ jsonrpc: "2.0", id: 7, method: "elicitation/createMessage", params: { message: "Your API key?" } })).toBe(true);
    expect(isElicitRequest({ jsonrpc: "2.0", id: 7, method: "tools/call" })).toBe(false);
  });

  test("headless default: declined with code 1 + logged reason; run continues", () => {
    const d = decideElicitation({ jsonrpc: "2.0", id: 7, method: "elicitation/createMessage", params: { message: "Enter token" } });
    expect(d.result.code).toBe(1); // declined
    expect(d.result.message).toContain("Declined");
    expect(d.reason).toContain("Enter token");
    expect(d.reason).toContain("declined elicitation");
  });

  test("onAsk surface (if a host provides one) answers with code 0", () => {
    const d = decideElicitation(
      { jsonrpc: "2.0", id: 8, method: "elicitation/createMessage", params: { message: "Name?" } },
      { onAsk: () => "zari" },
    );
    expect(d.result.code).toBe(0);
    expect(d.result.message).toBe("zari");
  });

  test("onAsk returning null still declines", () => {
    const d = decideElicitation(
      { jsonrpc: "2.0", id: 9, method: "elicitation/createMessage", params: { message: "X?" } },
      { onAsk: () => null },
    );
    expect(d.result.code).toBe(1);
  });
});

// ---- 6. Inline images in TUI ----------------------------------------------------------------

describe("6. Inline images (detection + placeholder)", () => {
  test("detection: kitty/iTerm/sixel via env; RA_IMAGES kill switch", () => {
    expect(detectImageSupport({ TERM: "xterm-kitty" })).toBe("kitty");
    expect(detectImageSupport({ TERM_PROGRAM: "kitty" })).toBe("kitty");
    expect(detectImageSupport({ TERM_PROGRAM: "ghostty" })).toBe("kitty");
    expect(detectImageSupport({ TERM_PROGRAM: "WezTerm" })).toBe("iterm");
    expect(detectImageSupport({ TERM_PROGRAM: "vscode" })).toBe("iterm");
    expect(detectImageSupport({ TERM: "xterm-256color-sixel" })).toBe("sixel");
    expect(detectImageSupport({ TERM: "xterm-256color" })).toBe("none");
    expect(detectImageSupport({ TERM_PROGRAM: "kitty", RA_IMAGES: "0" })).toBe("none");
    expect(detectImageSupport({ RA_IMAGES: "kitty" })).toBe("kitty");
  });

  test("placeholder renders dims + path + open hint (pure, no escapes)", () => {
    const box = renderImageBlock("/tmp/out/chart.png", { width: 800, height: 600, sizeBytes: 45_000 });
    expect(box).toContain("800x600");
    expect(box).toContain("43.9 KB");
    expect(box).toContain("/tmp/out/chart.png");
    expect(box).toContain("open /tmp/out/chart.png");
    expect(box).not.toContain("\x1b"); // no escape sequences — honest placeholder
    // No-dims variant still renders the box.
    expect(renderImageBlock("img.jpeg")).toContain("img.jpeg");
  });

  test("support hint names the detected protocol but stays placeholder-honest", () => {
    const box = renderImageBlock("a.png", { support: "kitty" });
    expect(box).toContain("supports kitty");
    expect(box).toContain("known ceiling");
    expect(box).not.toContain("\x1b]");
  });

  test("isImagePath accepts image extensions only", () => {
    expect(isImagePath("chart.png")).toBe(true);
    expect(isImagePath("photo.jpeg")).toBe(true);
    expect(isImagePath("/abs/path/diagram.svg")).toBe(true);
    expect(isImagePath("notes.md")).toBe(false);
    expect(isImagePath("script.ts")).toBe(false);
  });
});

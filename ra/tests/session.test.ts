import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSession, saveSession, appendMessage, listSessions, deleteSession, formatSessions, exportSession } from "../src/server/session.ts";
import { RA_GLOBAL } from "../../anubis/src/config.ts";

describe("session persistence", () => {
  test("loadSession returns a fresh session for unknown cwd", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-sess-"));
    try {
      const s = loadSession(cwd);
      expect(s.cwd).toBe(cwd);
      expect(s.messages).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("save + load round-trips messages", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-sess-"));
    try {
      const s = loadSession(cwd);
      appendMessage(s, "user", "hello");
      appendMessage(s, "assistant", "hi");
      const reloaded = loadSession(cwd);
      expect(reloaded.messages.length).toBe(2);
      expect(reloaded.messages[0].content).toBe("hello");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("exportSession sanitizes secrets", () => {
    const s = {
      id: "x",
      cwd: "/tmp/x",
      messages: [
        { role: "user", content: "my key is sk-ant-abcdefghijklmnopqrstuvwxyz123456", ts: 1 },
        { role: "assistant", content: "ok", ts: 2 },
      ],
      simpleMode: false,
      created: Date.now(),
    };
    const out = exportSession(s);
    expect(out).toContain("# RA Session Transcript");
    expect(out).toContain("## user");
    expect(out).not.toContain("sk-ant-abcdefghijklmnopqrstuvwxyz123456");
    expect(out).toContain("__VIBEGUARD_");
  });

  test("listSessions + deleteSession + formatSessions", () => {
    const dir = join(RA_GLOBAL, "sessions");
    mkdirSync(dir, { recursive: true });
    const id = `test-${Date.now()}`;
    const file = join(dir, `${id}.json`);
    writeFileSync(
      file,
      JSON.stringify({ id, cwd: "/tmp/example", messages: [{ role: "user", content: "x", ts: 1 }], simpleMode: false, created: Date.now() }),
    );
    try {
      const list = listSessions();
      expect(list.some((s) => s.id === id)).toBe(true);
      expect(formatSessions(list)).toContain("RA sessions");
      expect(deleteSession(id)).toBe(true);
      expect(deleteSession(id)).toBe(false);
    } finally {
      rmSync(file, { force: true });
    }
  });
});

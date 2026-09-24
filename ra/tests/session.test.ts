import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSession, saveSession, appendMessage, listSessions, deleteSession, findSession, switchSession, getActiveSession, formatSessions, exportSession, formatReattach } from "../src/server/session.ts";
import { RA_GLOBAL, sessionPath, legacySessionPath } from "../../anubis/src/config.ts";

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


  test("persisted session files are owner-only on POSIX", () => {
    if (process.platform === "win32") return;
    const cwd = mkdtempSync(join(tmpdir(), "ra-sess-mode-"));
    try {
      const session = loadSession(cwd);
      appendMessage(session, "user", "private");
      expect(statSync(sessionPath(cwd)).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(cwd, { recursive: true });
      rmSync(sessionPath(cwd), { force: true });
    }
  });


  test("distinct projects that collided under legacy slugs stay isolated", () => {
    const root = mkdtempSync(join(tmpdir(), "ra-sess-collision-"));
    const cwdA = join(root, "a", "b_c");
    const cwdB = join(root, "a_b", "c");
    mkdirSync(cwdA, { recursive: true });
    mkdirSync(cwdB, { recursive: true });
    try {
      expect(legacySessionPath(cwdA)).toBe(legacySessionPath(cwdB));
      expect(sessionPath(cwdA)).not.toBe(sessionPath(cwdB));

      const a = loadSession(cwdA);
      const b = loadSession(cwdB);
      appendMessage(a, "user", "from A");
      appendMessage(b, "user", "from B");

      expect(loadSession(cwdA).messages.at(-1)?.content).toBe("from A");
      expect(loadSession(cwdB).messages.at(-1)?.content).toBe("from B");
    } finally {
      deleteSession(cwdA);
      deleteSession(cwdB);
      rmSync(root, { recursive: true });
    }
  });

  test("loadSession still reads a legacy session file", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-sess-legacy-"));
    const legacy = legacySessionPath(cwd);
    try {
      writeFileSync(legacy, JSON.stringify({
        id: cwd, cwd, messages: [{ role: "user", content: "legacy", ts: 1 }],
        simpleMode: false, created: 1,
      }));
      expect(loadSession(cwd).messages[0].content).toBe("legacy");
    } finally {
      rmSync(legacy, { force: true });
      rmSync(sessionPath(cwd), { force: true });
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

  test("formatReattach summarizes prior conversation", () => {
    const s = {
      id: "x",
      cwd: "/tmp/x",
      messages: [
        { role: "user", content: "hello", ts: 1 },
        { role: "assistant", content: "hi there", ts: 2 },
      ],
      simpleMode: false,
      created: Date.now(),
    };
    const out = formatReattach(s);
    expect(out).toContain("Reattached to session (2 messages)");
    expect(out).toContain("[assistant] hi there");
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

  test("findSession + switchSession + getActiveSession", () => {
    const dir = join(RA_GLOBAL, "sessions");
    mkdirSync(dir, { recursive: true });
    const id = `test-switch-${Date.now()}`;
    const file = join(dir, `${id}.json`);
    writeFileSync(
      file,
      JSON.stringify({ id, cwd: "/tmp/switch-test", messages: [{ role: "user", content: "x", ts: 1 }], simpleMode: false, created: Date.now() }),
    );
    const pointerFile = join(RA_GLOBAL, "active-session.json");
    try {
      // findSession
      const found = findSession(id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(id);

      // switchSession
      const switched = switchSession(id);
      expect(switched).not.toBeNull();
      expect(switched!.cwd).toBe("/tmp/switch-test");

      // getActiveSession
      const active = getActiveSession();
      expect(active).not.toBeNull();
      expect(active!.id).toBe(id);

      // findSession returns null for unknown id
      expect(findSession("nonexistent-id-12345")).toBeNull();
    } finally {
      rmSync(file, { force: true });
      rmSync(pointerFile, { force: true });
    }
  });
});

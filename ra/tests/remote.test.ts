import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { startDaemon } from "../src/server/daemon.ts";
import { RemoteClient, parseRemoteUrl } from "../src/server/remote.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PORT = 4319;
const base = `http://127.0.0.1:${PORT}`;
let server: ReturnType<typeof startDaemon> | null = null;

beforeAll(() => {
  server = startDaemon({ port: PORT });
});

afterAll(() => {
  server?.stop(true);
});

describe("remote client", () => {
  test("health check returns true when daemon is up", async () => {
    const client = new RemoteClient({ url: base });
    expect(await client.health()).toBe(true);
  });

  test("health check returns false when daemon is down", async () => {
    const client = new RemoteClient({ url: "http://127.0.0.1:9999" });
    expect(await client.health()).toBe(false);
  });

  test("loadSession falls back to local when daemon unreachable", async () => {
    const client = new RemoteClient({ url: "http://127.0.0.1:9999" });
    const cwd = mkdtempSync(join(tmpdir(), "ra-remote-"));
    try {
      const session = await client.loadSession(cwd);
      expect(session.cwd).toBe(cwd);
      expect(session.messages).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("appendMessage syncs to daemon", async () => {
    const client = new RemoteClient({ url: base });
    const cwd = mkdtempSync(join(tmpdir(), "ra-remote-sync-"));
    try {
      // Use a fresh cwd that the daemon has never seen
      await client.appendMessage({ id: cwd, cwd, messages: [], simpleMode: false, created: Date.now() }, "user", "hello from remote");
      
      // Verify it was synced to daemon
      const res = await fetch(`${base}/session?cwd=${encodeURIComponent(cwd)}`);
      const body = await res.json();
      expect(body.session.messages.length).toBe(1);
      expect(body.session.messages[0].content).toBe("hello from remote");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("listSessions returns array from daemon", async () => {
    const client = new RemoteClient({ url: base });
    const sessions = await client.listSessions();
    expect(Array.isArray(sessions)).toBe(true);
  });

  test("parseRemoteUrl extracts --remote from args", () => {
    expect(parseRemoteUrl(["--remote", "http://localhost:4317"])).toBe("http://localhost:4317");
    expect(parseRemoteUrl([])).toBe(null);
  });

  test("parseRemoteUrl respects RA_REMOTE env var", () => {
    const oldEnv = process.env.RA_REMOTE;
    process.env.RA_REMOTE = "http://env-host:4317";
    try {
      expect(parseRemoteUrl([])).toBe("http://env-host:4317");
    } finally {
      if (oldEnv) process.env.RA_REMOTE = oldEnv;
      else delete process.env.RA_REMOTE;
    }
  });
});
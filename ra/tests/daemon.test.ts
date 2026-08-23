import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { startDaemon } from "../src/server/daemon.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PORT = 4318; // avoid clashing with the default daemon port
const base = `http://127.0.0.1:${PORT}`;
let server: ReturnType<typeof startDaemon> | null = null;

beforeAll(() => {
  server = startDaemon({ port: PORT });
});

afterAll(() => {
  server?.stop(true);
});

describe("daemon", () => {
  test("health endpoint responds", async () => {
    const res = await fetch(`${base}/health`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  test("session round-trip via HTTP", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-daemon-"));
    try {
      const post = await fetch(`${base}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, role: "user", content: "hello daemon" }),
      });
      expect(post.status).toBe(200);

      const get = await fetch(`${base}/session?cwd=${encodeURIComponent(cwd)}`);
      const body = await get.json();
      expect(body.session.messages.length).toBe(1);
      expect(body.session.messages[0].content).toBe("hello daemon");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("list sessions returns an array", async () => {
    const res = await fetch(`${base}/sessions`);
    const body = await res.json();
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  test("unknown route returns 404", async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });

  test("dashboard returns HTML", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const text = await res.text();
    expect(text).toContain("RA Dashboard");
  });
});

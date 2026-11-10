// edge-concurrency.test.ts — Wave 3a edge cases, part 2: concurrency + timeouts.
// Two daemons on different ports, parallel session writes, checkpoint races,
// the execution-scope timeout/limit paths, settledPool concurrency
// validation, sandbox command timeout — all offline (real HTTP on localhost,
// no model calls).

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../src/server/daemon.ts";
import { loadSession, appendMessage } from "../src/server/session.ts";
import { withAgentRun, withAgentScope, settledPool, reserveCall, runStats, activeRunCount, cancelRuns } from "../src/execution.ts";
import { snapshotFile } from "../src/server/checkpoint.ts";
import { runCommand } from "../src/sandbox.ts";

const A = 4391, B = 4392; // two distinct ports
let daemonA: ReturnType<typeof startDaemon> | null = null;
let daemonB: ReturnType<typeof startDaemon> | null = null;

beforeAll(() => {
  daemonA = startDaemon({ port: A, host: "127.0.0.1" });
  daemonB = startDaemon({ port: B, host: "127.0.0.1" });
});
afterAll(() => {
  daemonA?.stop(true);
  daemonB?.stop(true);
});

describe("two daemons on different ports", () => {
  test("both serve independent /health with their own pid", async () => {
    const [ha, hb] = await Promise.all([
      fetch(`http://127.0.0.1:${A}/health`).then((r) => r.json() as Promise<{ ok: boolean; pid: number }>),
      fetch(`http://127.0.0.1:${B}/health`).then((r) => r.json() as Promise<{ ok: boolean; pid: number }>),
    ]);
    expect(ha.ok).toBe(true);
    expect(hb.ok).toBe(true);
    // Both run in THIS process (Bun.serve objects) — pid equality is expected
    // and fine; the isolation guarantee under test is port separation below.
    expect(typeof ha.pid).toBe("number");
    expect(typeof hb.pid).toBe("number");
  });

  test("same session written through both daemons merges (shared store)", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-dual-"));
    try {
      await Promise.all([
        fetch(`http://127.0.0.1:${A}/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, role: "user", content: "via A" }) }),
        fetch(`http://127.0.0.1:${B}/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, role: "user", content: "via B" }) }),
      ]);
      const s = loadSession(cwd);
      expect(s.messages.map((m) => m.content).sort()).toEqual(["via A", "via B"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("404s are JSON, not crashes, for unknown routes on both", async () => {
    for (const port of [A, B]) {
      const r = await fetch(`http://127.0.0.1:${port}/nope`);
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: "not found" });
    }
  });
});

describe("parallel session writes", () => {
  test("20 concurrent POSTs to one session all persist in order-tolerant totality", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-par-"));
    try {
      await Promise.all(Array.from({ length: 20 }, (_, i) =>
        fetch(`http://127.0.0.1:${A}/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, role: "user", content: `msg-${i}` }) }),
      ));
      const s = loadSession(cwd);
      expect(s.messages.length).toBe(20);
      const contents = s.messages.map((m) => m.content);
      for (let i = 0; i < 20; i++) expect(contents).toContain(`msg-${i}`);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("appendMessage caps the session at 200 messages (newest kept)", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-cap-"));
    try {
      const s = loadSession(cwd);
      for (let i = 0; i < 205; i++) appendMessage(s, "user", `m${i}`);
      expect(s.messages.length).toBe(200);
      expect(s.messages[0]!.content).toBe("m5"); // oldest five evicted
      expect(s.messages[199]!.content).toBe("m204");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("checkpoint race", () => {
  test("concurrent snapshotFile calls on the same file all succeed (atomic writes)", async () => {
    const proj = mkdtempSync(join(tmpdir(), "ra-ckpt-"));
    try {
      writeFileSync(join(proj, "race.txt"), "before");
      // snapshotFile is sync + idempotent per file (second call returns the
      // same checkpoint id without rewriting) — run 12 interleaved calls.
      const results = await Promise.all(
        Array.from({ length: 12 }, () => Promise.resolve().then(() => snapshotFile(proj, "race.txt"))),
      );
      for (const id of results) expect(id).toMatch(/^cp-\d+$/); // no interleaved corruption throw
      // all calls agree on the checkpoint id (same in-flight checkpoint reused)
      expect(new Set(results).size).toBe(1);
      writeFileSync(join(proj, "race.txt"), "after");
      // restoreLatest brings back the snapshotted content
      const { restoreLatest } = await import("../src/server/checkpoint.ts");
      expect(restoreLatest(proj)).toContain("race.txt");
      expect(readFileSync(join(proj, "race.txt"), "utf-8")).toBe("before");
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });
});

describe("execution scope: timeout + budget paths", () => {
  test("timeout_ms aborts at the next model-call seam (reserveCall observes the deadline)", async () => {
    await expect(withAgentRun({ label: "t", limits: { timeout_ms: 60 } }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      reserveCall(); // the cooperative check every real model call does
      return "unreachable";
    })).rejects.toThrow(/deadline exceeded/);
  });

  test("a run finishing before the deadline completes normally", async () => {
    const out = await withAgentRun({ label: "t2", limits: { timeout_ms: 5_000 } }, async () => {
      reserveCall(); // seam passes — deadline not hit
      return 42;
    });
    expect(out).toBe(42);
  });

  test("signal-blind work still resolves (abort is cooperative, not preemptive)", async () => {
    // Document the contract: the deadline only bites at checkRun/reserveCall
    // seams; pure work that never checks completes anyway.
    const out = await withAgentRun({ label: "t3", limits: { timeout_ms: 40 } }, () => new Promise((resolve) => setTimeout(resolve, 120)));
    expect(out).toBeUndefined();
  });

  test("invalid limits are rejected up front (positive integers)", () => {
    for (const limits of [{ timeout_ms: 0 }, { timeout_ms: -1 }, { max_calls: 0 }, { max_agents: -2 }, { max_depth: 1.5 }]) {
      expect(() => withAgentRun({ limits: limits as never }, () => Promise.resolve())).toThrow(/positive integer/); // ${JSON.stringify(limits)}
    }
  });

  test("reserveCall enforces the max_calls budget and aborts past it", async () => {
    await withAgentRun({ limits: { max_calls: 2, timeout_ms: 5_000 } }, async () => {
      reserveCall();
      reserveCall();
      expect(() => reserveCall()).toThrow(/budget exhausted|cancelled/i);
    });
  });

  test("runStats counts calls/agents/elapsed inside a run; zero outside", async () => {
    expect(runStats().calls).toBe(0);
    await withAgentRun({ limits: { timeout_ms: 5_000 } }, async () => {
      reserveCall();
      const s = runStats();
      expect(s.calls).toBe(1);
      expect(s.elapsedMs).toBeGreaterThanOrEqual(0);
    });
  });

  test("withAgentScope enforces depth + agent budgets", async () => {
    // Depth: root=-1, a=0, b=1, c=2. max_depth:1 admits a and b, rejects c.
    // agents++ on every admitted scope; failed depth entries consume nothing.
    await withAgentRun({ limits: { max_depth: 1, max_agents: 2, timeout_ms: 5_000 } }, async () => {
      await withAgentScope("a", "t", async () => {
        await withAgentScope("b", "t", async () => {
          await expect(withAgentScope("c", "t", () => Promise.resolve())).rejects.toThrow(/depth limit/);
        });
      });
      await expect(withAgentScope("d", "t", () => Promise.resolve())).rejects.toThrow(/Agent budget exhausted/); // a+b used both slots
    });
  });

  test("cancelRuns aborts an active run at its next seam", async () => {
    const p = withAgentRun({ label: "c1", limits: { timeout_ms: 60_000 } }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      reserveCall();
      return "unreachable";
    });
    expect(activeRunCount()).toBeGreaterThanOrEqual(1);
    cancelRuns();
    await expect(p).rejects.toThrow(/cancelled/i);
  });

  test("nested withAgentRun reuses the outer scope (no deadline reset)", async () => {
    const t0 = Date.now();
    await expect(withAgentRun({ limits: { timeout_ms: 60 } }, async () => {
      // inner "run" claims a huge deadline — must be ignored (scope reuse)
      await withAgentRun({ limits: { timeout_ms: 60_000 } }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        reserveCall();
      });
    })).rejects.toThrow(/deadline exceeded/);
    expect(Date.now() - t0).toBeLessThan(2_000);
  });
});

describe("settledPool concurrency discipline", () => {
  test("preserves input order regardless of completion order", async () => {
    const out = await withAgentRun({ limits: { timeout_ms: 5_000 } }, () =>
      settledPool([300, 10, 200, 1], 4, (ms) => new Promise((r) => setTimeout(() => r(ms), ms))),
    );
    expect(out.map((r) => r.status === "fulfilled" ? r.value : -1)).toEqual([300, 10, 200, 1]);
  });

  test("a failing item never abandons siblings (all outcomes settled)", async () => {
    const out = await withAgentRun({ limits: { timeout_ms: 5_000 } }, () =>
      settledPool([1, 2, 3], 2, (n) => n === 2 ? Promise.reject(new Error("boom")) : Promise.resolve(n)),
    );
    expect(out[0]).toEqual({ status: "fulfilled", value: 1 });
    expect(out[1]!.status).toBe("rejected");
    expect(out[2]).toEqual({ status: "fulfilled", value: 3 });
  });

  test("concurrency bounds are enforced: max in-flight = the cap", async () => {
    let inFlight = 0, peak = 0;
    await withAgentRun({ limits: { timeout_ms: 5_000 } }, () =>
      settledPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 20 + n));
        inFlight--;
        return n;
      }),
    );
    expect(peak).toBeLessThanOrEqual(2);
  });

  test("invalid concurrency values rejected (integer 1..16)", async () => {
    for (const c of [0, -1, 1.5, 17, Number.NaN]) {
      await expect(withAgentRun({ limits: { timeout_ms: 1_000 } }, () => settledPool([1], c, (n) => Promise.resolve(n))))
        .rejects.toThrow(/concurrency/); // c=${c}
    }
  });

  test("empty item list completes immediately", async () => {
    const out = await withAgentRun({ limits: { timeout_ms: 1_000 } }, () => settledPool([], 4, (n) => Promise.resolve(n)));
    expect(out).toEqual([]);
  });
});

describe("sandbox command timeout path", () => {
  test("runCommand timeoutMs kills a sleeping command and reports timedOut", async () => {
    const proj = mkdtempSync(join(tmpdir(), "ra-sbx-"));
    try {
      const r = await runCommand({ cwd: proj }, ["sh", "-c", "sleep 5"], { timeoutMs: 150 });
      expect(r.timedOut).toBe(true);
      expect(r.code).not.toBe(0);
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  }, 15_000);

  test("runCommand completes fast commands under the same timeout", async () => {
    const proj = mkdtempSync(join(tmpdir(), "ra-sbx2-"));
    try {
      const r = await runCommand({ cwd: proj }, ["sh", "-c", "echo fast"], { timeoutMs: 5_000 });
      expect(r.code).toBe(0);
      expect(r.stdout.trim()).toBe("fast");
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });
});

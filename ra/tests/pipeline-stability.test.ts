// tests/pipeline-stability.test.ts — F4 (Wave 3c): a wandering planner must
// degrade its stage, never abort the pipeline. Drives runFullDevTask against
// an empty dir with a scripted fake provider: thoth loops tool calls until
// its 10-step limit, ptah then implements from the partial plan.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFullDevTask } from "../../anubis/src/runner.ts";
import type { RaConfig } from "../../anubis/src/config.ts";

interface ChatBody {
  model?: string;
  messages?: Array<{ role: string; content: string }>;
  stream?: boolean;
}

/**
 * Fake OpenAI-compatible provider (provider baseURL = the /v1 surface by
 * contract). Replies are chosen by request order — the wandering planner
 * consumes the first N replies, the implementer the last.
 */
function startFakeProvider(script: string[]) {
  const bodies: ChatBody[] = [];
  let n = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/v1/models") return Response.json({ data: [{ id: "tiny" }, { id: "big" }] });
      if (url.pathname === "/v1/chat/completions") {
        bodies.push((await req.json()) as ChatBody);
        const step = script[Math.min(n, script.length - 1)]!;
        n++;
        const payload = JSON.stringify({
          model: "tiny",
          choices: [{ delta: { content: step } }],
          usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
        });
        return new Response(`data: ${payload}\n\ndata: [DONE]\n\n`, {
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { server, url: `http://localhost:${server.port}/v1`, bodies };
}

function dualConfig(url: string): RaConfig {
  return {
    model: "fakelan/tiny",
    small_model: "fakelan/tiny",
    provider: { fakelan: { options: { baseURL: url }, models: { tiny: { context: 8192 } } } },
    capability_router: { enabled: false },
    // No built-in ollama-lan fallback chains — the fake provider is the only
    // endpoint in this environment (default chains would probe the real LAN).
    fallbacks: { default: ["fakelan/tiny"], models: { "fakelan/tiny": ["fakelan/tiny"] } },
    context: { adaptive: false }, // planner wandering is NOT context pressure
  } as RaConfig;
}

const WANDER = "READ nonexistent-notes.txt"; // a tool call, never DONE

/** runFullDevTask loads config itself (root/. env/. RA_CONFIG) — point it at
 *  an isolated HOME + RA_CONFIG so the test never touches the real ~/.ra or
 *  the developer's ra.json. */
function isolateHome(): string {
  const home = mkdtempSync(join(tmpdir(), "ra-f4-home-"));
  mkdirSync(join(home, ".ra"), { recursive: true });
  process.env.HOME = home;
  process.env.RA_CONFIG = join(home, "ra.json");
  return home;
}

function restoreHome(prev: { HOME?: string; RA_CONFIG?: string }, home: string) {
  if (prev.HOME === undefined) delete process.env.HOME; else process.env.HOME = prev.HOME;
  if (prev.RA_CONFIG === undefined) delete process.env.RA_CONFIG; else process.env.RA_CONFIG = prev.RA_CONFIG;
  rmSync(home, { recursive: true, force: true });
}

describe("pipeline step-limit graceful path (F4)", () => {
  test("wandering thoth downgrades its stage; the pipeline still completes and ptah writes the artifact", async () => {
    // thoth wanders 10 steps (its frontmatter budget) then hits the limit;
    // ptah implements from the degraded plan, then DONEs.
    const { server, url, bodies } = startFakeProvider([
      ...Array(10).fill(WANDER),
      `WRITE index.html
\`\`\`html
<!DOCTYPE html><html><head><title>RA</title></head><body><h1>Hello RA</h1></body></html>
\`\`\``,
      "DONE index.html written with the greeting.",
    ]);
    const cwd = mkdtempSync(join(tmpdir(), "ra-pipe-f4-"));
    const prevEnv = { HOME: process.env.HOME, RA_CONFIG: process.env.RA_CONFIG };
    const home = isolateHome();
    writeFileSync(process.env.RA_CONFIG!, JSON.stringify(dualConfig(url)), "utf-8");
    try {
      const result = await runFullDevTask("create index.html saying Hello RA", {
        stages: ["thoth", "ptah"],
        cwd,
        quiet: true,
      });
      // The run completed — no throw from the planner's step limit.
      // (macOS symlink: mkdtemp yields /var/..., toolWrite /private/var/...)
      expect(result.filesWritten.some((f) => f.endsWith("index.html"))).toBe(true);
      const thothOut = result.outputs.find((o) => o.stage === "thoth")!;
      expect(thothOut.content).toContain("step limit reached — partial output");
      const html = readFileSync(join(cwd, "index.html"), "utf-8");
      expect(html).toContain("Hello RA");
      // The wandering planner really did burn its whole budget first.
      expect(bodies.length).toBeGreaterThan(10);
    } finally {
      restoreHome(prevEnv, home);
      server.stop(true);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("ptah (the implementer) is NOT soft — its step-limit abort is still fatal", async () => {
    const { server, url } = startFakeProvider([
      "DONE Plan: write index.html.",
      ...Array(12).fill(WANDER), // ptah wanders past its 16-step default budget
    ]);
    const cwd = mkdtempSync(join(tmpdir(), "ra-pipe-f4b-"));
    const prevEnv = { HOME: process.env.HOME, RA_CONFIG: process.env.RA_CONFIG };
    const home = isolateHome();
    writeFileSync(process.env.RA_CONFIG!, JSON.stringify(dualConfig(url)), "utf-8");
    try {
      await runFullDevTask("create index.html saying Hello RA", {
        stages: ["thoth", "ptah"],
        cwd,
        quiet: true,
      });
      throw new Error("expected runFullDevTask to reject");
    } catch (e) {
      expect(String(e)).toContain("Stage ptah failed");
    } finally {
      restoreHome(prevEnv, home);
      server.stop(true);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("a provider 502 on an advisory stage degrades it — the run completes (live 201-server evidence)", async () => {
    let calls = 0;    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === "/v1/models") return Response.json({ data: [{ id: "tiny" }] });
        if (u.pathname === "/v1/chat/completions") {
          calls++;
          // thoth (call 1..) OK; maat/sekhmet (later calls) always 502.
          const step = calls === 1
            ? "DONE Plan: single static page with the greeting."
            : calls === 2
              ? `WRITE index.html
\`\`\`html
<!DOCTYPE html><html><head><title>RA</title></head><body><h1>Hello RA</h1></body></html>
\`\`\``
              : calls === 3
                ? "DONE Implemented."
                : null;
          if (step === null) return new Response("upstream exploded", { status: 502 });
          const payload = JSON.stringify({
            model: "tiny",
            choices: [{ delta: { content: step } }],
            usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
          });
          return new Response(`data: ${payload}\n\ndata: [DONE]\n\n`, {
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    const url = `http://localhost:${server.port}/v1`;
    const cwd = mkdtempSync(join(tmpdir(), "ra-pipe-f4c-"));
    const prevEnv = { HOME: process.env.HOME, RA_CONFIG: process.env.RA_CONFIG };
    const home = isolateHome();
    writeFileSync(process.env.RA_CONFIG!, JSON.stringify(dualConfig(url)), "utf-8");
    try {
      const result = await runFullDevTask("create index.html saying Hello RA", {
        stages: ["thoth", "ptah", "maat"],
        cwd,
        quiet: true,
      });
      expect(result.filesWritten.some((f) => f.endsWith("index.html"))).toBe(true);
      const maat = result.outputs.find((o) => o.stage === "maat")!;
      expect(maat.content).toContain("stage degraded");
      const html = readFileSync(join(cwd, "index.html"), "utf-8");
      expect(html).toContain("Hello RA");
    } finally {
      restoreHome(prevEnv, home);
      server.stop(true);
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

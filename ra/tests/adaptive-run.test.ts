// tests/adaptive-run.test.ts — the ra.78 low-context runtime: token ledger
// pressure, handoff packets, the shrinking continuation budget, and the full
// agent loop against a scripted fake Ollama (context-critical checkpoint →
// continuation seeded with the objective; provider overflow → resume instead
// of crash; exhausted continuations → honest partial).

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { runTaskAgent, getLiveContextState } from "../src/agent.ts";
import { resumeStepBudget, buildHandoff, buildContinuationTask, lowContextNotice } from "../src/resume.ts";
import { contextPolicy, ContextLedger } from "../../anubis/src/context-limits.ts";
import type { RaConfig } from "../../anubis/src/config.ts";

// ---- pure units ----

describe("continuation step budget", () => {
  test("runs get shorter as pressure rises, never below 2", () => {
    expect(resumeStepBudget(16, 0)).toBe(16);
    expect(resumeStepBudget(16, 1)).toBe(12);
    expect(resumeStepBudget(16, 2)).toBe(8);
    expect(resumeStepBudget(16, 3)).toBe(8);
    expect(resumeStepBudget(16, 9)).toBe(8);
    expect(resumeStepBudget(3, 2)).toBe(2); // floor: always act + finish
  });
});

describe("handoff packet", () => {
  test("restates the objective verbatim and carries progress", () => {
    const handoff = buildHandoff({
      role: "thoth",
      objective: "Refactor the auth module without changing behavior",
      reason: "low-context",
      continuation: 0,
      model: "fakelan/tiny",
      windowTokens: 8192,
      usedTokens: 7900,
      filesWritten: ["src/auth.ts"],
      todos: [{ id: 1, text: "extract token check", done: false }],
      lastAssistant: "Halfway through the extraction.",
      recent: [{ role: "assistant", content: "I read three files." }],
    });
    expect(handoff).toContain("Refactor the auth module without changing behavior");
    expect(handoff).toContain("src/auth.ts");
    expect(handoff).toContain("extract token check");
    expect(handoff).toContain("Halfway through the extraction.");
    expect(handoff).toContain("Do NOT redo completed work");
  });

  test("continuation task embeds objective + handoff + do-not-redo", () => {
    const task = buildContinuationTask("Fix the off-by-one bug", "# RA handoff — ptah", 1, 3);
    expect(task).toContain("CONTINUATION 1/3");
    expect(task).toContain("Fix the off-by-one bug");
    expect(task).toContain("# RA handoff — ptah");
    expect(task).toContain("Do NOT redo");
  });

  test("the low-context notice asks for objective + TODO restatement", () => {
    const notice = lowContextNotice(1200);
    expect(notice).toContain("Context is running low");
    expect(notice).toContain("objective");
    expect(notice).toContain("TODO");
  });
});

describe("ledger plumbing visible to the runtime", () => {
  test("policy defaults are sane", () => {
    const p = contextPolicy();
    expect(p.adaptive).toBe(true);
    expect(p.resumeLimit).toBe(3);
  });

  test("ledger pressure against a small window", () => {
    const ledger = new ContextLedger("m", 8192, contextPolicy({ context: { low_watermark: 0.5, critical_watermark: 0.8 } }));
    expect(ledger.pressure([{ content: "short" }])).toBe("ok");
    expect(ledger.pressure([{ content: "x".repeat(ledger.budgetTokens * 0.5 * 4 + 64) }])).toBe("low");
    expect(ledger.pressure([{ content: "x".repeat(ledger.budgetTokens * 0.8 * 4 + 64) }])).toBe("critical");
  });
});

// ---- full-loop integration against a scripted fake Ollama ----

interface ChatBody {
  model?: string;
  messages?: Array<{ role: string; content: string }>;
  options?: { num_ctx?: number; num_predict?: number; temperature?: number };
  stream?: boolean;
}

/** Fake native Ollama: /api/tags, /api/show, and a scripted /api/chat queue. */
function startFakeOllama(script: Array<string | { status: number; error: string }>) {
  const bodies: ChatBody[] = [];
  let n = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/tags") return Response.json({ models: [{ name: "tiny" }] });
      if (url.pathname === "/api/show") return Response.json({ model_info: { "tiny.context_length": 8192 } });
      if (url.pathname === "/api/chat") {
        bodies.push((await req.json()) as ChatBody);
        const step = script[Math.min(n, script.length - 1)]!;
        n++;
        if (typeof step === "object") return new Response(step.error, { status: step.status });
        return new Response(
          JSON.stringify({ message: { content: step }, done: true, model: "tiny", prompt_eval_count: 800, eval_count: 100 }) + "\n",
          { headers: { "Content-Type": "application/x-ndjson" } },
        );
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { server, url: `http://localhost:${server.port}`, bodies };
}

function adaptiveConfig(url: string, extra: Partial<NonNullable<RaConfig["context"]>> = {}): RaConfig {
  return {
    model: "fakelan/tiny",
    small_model: "fakelan/tiny",
    agent: { thoth: { model: "fakelan/tiny" } },
    provider: { fakelan: { options: { baseURL: url }, models: { tiny: { context: 8192 } } } },
    capability_router: { enabled: false },
    context: { adaptive: true, resume_limit: 2, low_watermark: 0.5, critical_watermark: 0.8, ...extra },
  } as RaConfig;
}

// ~31k chars of padding — pushes the fake 8k window past critical in one reply.
const PADDING = "lorem ipsum dolor sit amet consetetur sadipscing elitr sed diam ".repeat(460);
const OBJECTIVE = "Summarize the migration notes precisely";

function readLatestHandoff(cwd: string): string {
  const slug = cwd.replace(/\//g, "_").replace(/^_|_$/g, "") || "default";
  const dir = join(homedir(), ".ra", "handoffs", slug);
  const files = readdirSync(dir).filter((f) => f.startsWith("thoth-0-")).sort();
  return readFileSync(join(dir, files.at(-1)!), "utf-8");
}

describe("adaptive run loop (fake Ollama, 8k window)", () => {
  test("context-critical run checkpoints and the continuation finishes", async () => {
    const { server, url, bodies } = startFakeOllama([
      `${PADDING}\nREAD definitely-missing-notes.txt`,
      "DONE continued and finished",
    ]);
    const cwd = mkdtempSync(join(tmpdir(), "ra-adaptive-"));
    try {
      const result = await runTaskAgent("thoth", OBJECTIVE, adaptiveConfig(url), { cwd }, {}, 8);
      expect(result.output).toContain("continued and finished");
      expect(result.status ?? "done").toBe("done");
      expect(result.context?.resumes).toBe(1);
      expect(result.context?.windowTokens).toBe(8192);
      expect(bodies.length).toBe(2);
      // Every call reserved num_ctx from the registry — no silent server default.
      expect(bodies[0].options?.num_ctx).toBe(8192);
      expect(bodies[1].options?.num_ctx).toBe(8192);
      // The continuation was seeded with the objective + handoff, not the transcript.
      const cont = bodies[1].messages!.map((m) => m.content).join("\n");
      expect(cont).toContain("CONTINUATION 1/2");
      expect(cont).toContain(OBJECTIVE);
      expect(cont).toContain("HANDOFF");
      // The handoff packet was persisted with the objective restated.
      const handoff = readLatestHandoff(cwd);
      expect(handoff).toContain("Objective (unchanged)");
      expect(handoff).toContain(OBJECTIVE);
      expect(handoff).toContain("Next steps");
      // Live telemetry is exposed for /context.
      expect(getLiveContextState()?.windowTokens).toBe(8192);
    } finally {
      server.stop(true);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("provider context overflow resumes instead of crashing", async () => {
    const { server, url, bodies } = startFakeOllama([
      { status: 400, error: "input length exceeds context length" },
      "DONE recovered after overflow",
    ]);
    const cwd = mkdtempSync(join(tmpdir(), "ra-adaptive-"));
    try {
      const result = await runTaskAgent("thoth", OBJECTIVE, adaptiveConfig(url), { cwd }, {}, 8);
      expect(result.output).toContain("recovered after overflow");
      expect(result.context?.resumes).toBe(1);
      expect(bodies.length).toBe(2);
    } finally {
      server.stop(true);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("exhausted continuations with no bigger model return an honest partial", async () => {
    const { server, url, bodies } = startFakeOllama([
      `${PADDING}\nREAD definitely-missing-notes.txt`,
      "DONE never reached",
    ]);
    const cwd = mkdtempSync(join(tmpdir(), "ra-adaptive-"));
    try {
      const result = await runTaskAgent("thoth", OBJECTIVE, adaptiveConfig(url, { resume_limit: 0 }), { cwd }, {}, 8);
      expect(result.status).toBe("partial");
      expect(result.output).toContain("context exhausted");
      expect(result.output).toContain("Handoff saved");
      expect(bodies.length).toBe(1); // no continuation was allowed
    } finally {
      server.stop(true);
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

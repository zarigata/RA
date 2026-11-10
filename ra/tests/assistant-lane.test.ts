// tests/assistant-lane.test.ts — plan step 2: the assistant/coding lane
// heuristic, write-tool gating capabilities, and the full orchestrator turn
// against a scripted fake Ollama (single-shot assistant reply, denied WRITE
// mid-conversation, edit-intent ask routed to the ptah pipeline).

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyLane, resolveLane, assistantCapabilities } from "../src/lane.ts";
import { runOrchestratorTurn } from "../src/agent.ts";
import type { RaConfig } from "../../anubis/src/config.ts";

// ---- pure heuristic ----

describe("lane classification", () => {
  test("conversational and research asks take the assistant lane", () => {
    for (const ask of [
      "what is the capital of France",
      "Why do cats purr?",
      "summarize this article https://example.com/posts/why-bun-wins",
      "explain how HTTP/3 differs from HTTP/2",
      "how do I fix a flaky test?  (asking for advice, no repo)",
      "why does this crash on startup?",
    ]) {
      expect(classifyLane(ask).lane).toBe("assistant");
    }
  });

  test("edit-intent and failure asks take the coding lane", () => {
    for (const ask of [
      "fix the failing test in foo.ts",
      "create a new config module",
      "refactor the auth middleware",
      "update README.md with install steps",
      "the build fails on src/foo.ts",
    ]) {
      expect(classifyLane(ask).lane).toBe("coding");
    }
  });

  test("RA_LANE overrides the heuristic", () => {
    expect(resolveLane("fix foo.ts", { RA_LANE: "assistant" }).lane).toBe("assistant");
    expect(resolveLane("what is the capital of France", { RA_LANE: "coding" }).lane).toBe("coding");
    // auto (and unknown values) fall back to the heuristic
    expect(resolveLane("what is the capital of France", { RA_LANE: "auto" }).lane).toBe("assistant");
    expect(resolveLane("what is the capital of France", { RA_LANE: "bogus" }).lane).toBe("assistant");
    expect(resolveLane("fix foo.ts", {}).lane).toBe("coding");
  });
});

// ---- capability gating (pure) ----

describe("assistant capabilities are read-only", () => {
  const caps = assistantCapabilities({} as RaConfig);
  test("read/search/web tools stay available", () => {
    for (const t of ["read", "outline", "glob", "grep", "repomap", "webfetch", "websearch", "skill", "done"]) {
      expect(caps.tools.has(t)).toBe(true);
    }
  });
  test("write/edit/bash/test/diagnose/subagent tools are gated off", () => {
    for (const t of ["write", "edit", "multiedit", "bash", "test", "diagnose", "task", "todo", "mcp"]) {
      expect(caps.tools.has(t)).toBe(false);
    }
    expect(caps.readOnly).toBe(true);
  });
});

// ---- full orchestrator turn against a scripted fake Ollama ----

interface ChatBody {
  model?: string;
  messages?: Array<{ role: string; content: string }>;
  options?: { num_ctx?: number };
  stream?: boolean;
}

/** Fake native Ollama: /api/tags, /api/show, and a scripted /api/chat queue. */
function startFakeOllama(script: string[]) {
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
        return new Response(
          JSON.stringify({ message: { content: step }, done: true, model: "tiny", prompt_eval_count: 100, eval_count: 20 }) + "\n",
          { headers: { "Content-Type": "application/x-ndjson" } },
        );
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { server, url: `http://localhost:${server.port}`, bodies };
}

function laneConfig(url: string): RaConfig {
  return {
    model: "fakelan/tiny",
    small_model: "fakelan/tiny",
    provider: { fakelan: { options: { baseURL: url }, models: { tiny: { context: 8192 } } } },
    capability_router: { enabled: false },
  } as RaConfig;
}

describe("orchestrator lanes (fake Ollama)", () => {
  test("a plain question is answered single-shot on the assistant lane", async () => {
    const { server, url, bodies } = startFakeOllama(["The capital of France is Paris."]);
    const cwd = mkdtempSync(join(tmpdir(), "ra-lane-"));
    try {
      const out = await runOrchestratorTurn("What is the capital of France?", laneConfig(url), { cwd, filesWritten: [] });
      expect(out).toContain("## general (tiny)");
      expect(out).toContain("Paris");
      expect(bodies.length).toBe(1); // single-shot: no pipeline, no follow-ups
      const system = bodies[0].messages![0].content;
      expect(system).toContain("general-purpose assistant");
      expect(system).toContain("WEBSEARCH"); // research tools advertised
      expect(system).not.toContain("Project files (top level)"); // no repo scan
    } finally {
      server.stop(true);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("a WRITE attempt inside the assistant lane is denied, not executed", async () => {
    const { server, url, bodies } = startFakeOllama([
      "WRITE victim.txt\n```\npwned\n```",
      "DONE Understood — I cannot write files; here is the answer instead.",
    ]);
    const cwd = mkdtempSync(join(tmpdir(), "ra-lane-"));
    try {
      const out = await runOrchestratorTurn("What is the capital of France?", laneConfig(url), { cwd, filesWritten: [] });
      expect(out).toContain("cannot write files");
      expect(existsSync(join(cwd, "victim.txt"))).toBe(false);
      expect(bodies.length).toBe(2); // denial fed back, model recovered once
      const fed = bodies[1].messages!.at(-1)!.content;
      expect(fed).toContain("Tool 'write' is not permitted");
    } finally {
      server.stop(true);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("an edit-intent ask routes to the ptah coding pipeline", async () => {
    const { server, url, bodies } = startFakeOllama([
      "DONE foo.ts not found in this project — nothing to fix.",
      "DONE foo.ts not found in this project — nothing to fix.",
    ]);
    const cwd = mkdtempSync(join(tmpdir(), "ra-lane-"));
    try {
      const out = await runOrchestratorTurn("fix the failing test in src/foo.ts", laneConfig(url), { cwd, filesWritten: [] });
      expect(out).toContain("## ptah"); // coding pipeline, not the assistant lane
      const system = bodies[0].messages![0].content;
      expect(system).not.toContain("general-purpose assistant");
    } finally {
      server.stop(true);
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// tests/moa-layers.test.ts — Mixture-of-Agents 2.0 (ra.76).
// Pins: layer plan resolution (flags > preset > config), cross-model fan-out,
// critic layer seeing every proposal, agreement matrix, budget guard, and the
// persistent team board (cards / mailbox / mission log / resume).

import { describe, expect, test, afterAll } from "bun:test";
import {
  resolveLayerPlan,
  agreementMatrix,
  estimateMoaCost,
  shouldSuggestMoa,
  runLayeredMoa,
} from "../src/moa/layers.ts";
import { TeamBoard, listTeamBoards, formatBoard } from "../src/teams/board.ts";
import type { RaConfig } from "../../anubis/src/config.ts";
import type { TaskResult } from "../src/agent.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const config: RaConfig = {
  model: "ollama-cloud/glm-5.2",
  small_model: "ollama-lan/gpt-oss:20b",
  agent: {},
  moa: { roles: ["thoth", "ptah", "maat", "sekhmet"], parallel: true, layers: 2 },
  teams: {
    "security-sweep": { critics: ["security-reviewer", "maat"], layers: 2 },
  },
};

describe("layer plan resolution", () => {
  test("defaults: cross-model fan-out over small+BIG lanes, 2 layers", () => {
    const plan = resolveLayerPlan(config);
    expect(plan.models).toEqual(["ollama-lan/gpt-oss:20b", "ollama-cloud/glm-5.2"]);
    expect(plan.layers).toBe(2);
    expect(plan.role).toBe("general");
    expect(plan.critics).toEqual(["maat", "sekhmet"]);
  });

  test("flags override preset and config", () => {
    const plan = resolveLayerPlan(config, { models: ["a", "b"], layers: 3, role: "scout" });
    expect(plan.models).toEqual(["a", "b"]);
    expect(plan.layers).toBe(3);
    expect(plan.role).toBe("scout");
  });

  test("team preset applies critic roles and rejects unknown presets", () => {
    const plan = resolveLayerPlan(config, { team: "security-sweep" });
    expect(plan.critics).toEqual(["security-reviewer", "maat"]);
    expect(() => resolveLayerPlan(config, { team: "nope" })).toThrow(/Unknown team preset/);
  });

  test("layers clamp to 1..3", () => {
    expect(resolveLayerPlan(config, { layers: 9 }).layers).toBe(3);
    expect(resolveLayerPlan(config, { layers: 0 }).layers).toBe(1);
  });
});

describe("agreement matrix", () => {
  test("splits and consensus on contested files", () => {
    const report = agreementMatrix([
      { source: "a@lan", output: "edit src/one.ts and src/two.ts" },
      { source: "b@cloud", output: "edit src/one.ts only" },
      { source: "c@local", output: "rewrite src/one.ts and src/three.ts" },
    ]);
    const one = report.files.find((f) => f.file === "src/one.ts");
    expect(one?.agreement).toBeCloseTo(1);
    const two = report.files.find((f) => f.file === "src/two.ts");
    expect(two?.agreement).toBeCloseTo(1 / 3);
    expect(report.consensus).toBeLessThan(1);
    expect(report.notes.some((n) => n.includes("src/two.ts") || n.includes("src/three.ts"))).toBe(true);
  });

  test("empty outputs → perfect consensus by convention", () => {
    const report = agreementMatrix([]);
    expect(report.consensus).toBe(1);
    expect(report.files).toEqual([]);
  });
});

describe("cost estimate + budget guard", () => {
  test("free-only fan-out estimates $0", () => {
    const plan = resolveLayerPlan(config, { models: ["ollama-lan/gpt-oss:20b", "ollama/gemma:latest"] });
    expect(estimateMoaCost(plan, "task")).toBe(0);
  });

  test("subscription topology (ollama-cloud glm) estimates ~$0", () => {
    expect(estimateMoaCost(resolveLayerPlan(config), "redesign the auth system")).toBe(0);
  });

  test("paid fan-out estimates non-zero and the guard aborts before running", async () => {
    const plan = resolveLayerPlan(config, { models: ["anthropic/claude-sonnet-4-5"] });
    expect(estimateMoaCost(plan, "redesign the auth system")).toBeGreaterThan(0);
    let ran = 0;
    await expect(runLayeredMoa("redesign auth", config, { cwd: process.cwd() }, {
      models: ["anthropic/claude-sonnet-4-5"],
      budgetUsd: 0.0001,
      runAgent: async () => { ran++; throw new Error("should not run"); },
    })).rejects.toThrow(/exceeds budget/);
    expect(ran).toBe(0);
  });

  test("shouldSuggestMoa fires on architect-class tasks only", () => {
    expect(shouldSuggestMoa("refactor the payment module", config)?.suggest).toBe(true);
    expect(shouldSuggestMoa("fix this typo", config)).toBeNull();
  });
});

describe("layered execution (fake agents)", () => {
  const boardDir = mkdtempSync(join(tmpdir(), "ra-moa-board-"));
  const fakeSynth = async (task: string) => `synthesis of ${task}`;

  test("fan-out across models; critics see every layer-1 output", async () => {
    const seen: Array<{ role: string; task: string; model: string }> = [];
    const result = await runLayeredMoa("plan the new module", { ...config, agent: {} } as RaConfig, { cwd: process.cwd() }, {
      models: ["m1", "m2"],
      layers: 2,
      critics: ["maat"],
      boardName: "test-moa-board",
      boardRoot: boardDir,
      synthesize: fakeSynth,
      runAgent: async (role, task, cfg) => {
        const model = cfg.agent?.[role]?.model ?? "tier";
        seen.push({ role, task, model });
        return { role, model, output: `out from ${role} on ${model}: edit src/app.ts` };
      },
    });
    // layer 1: one run per model with the model forced via config
    const proposals = seen.filter((s) => s.role === "general");
    expect(proposals.length).toBe(2);
    expect(new Set(proposals.map((p) => p.model))).toEqual(new Set(["m1", "m2"]));
    // layer 2: critic received both proposals in its task
    const critic = seen.find((s) => s.role === "maat");
    expect(critic).toBeTruthy();
    expect(critic!.task).toContain("out from general");
    expect(result.status).toBe("completed");
    expect(result.results.length).toBe(3);
    expect(result.boardPath).toContain("test-moa-board");
  });

  test("single-layer mode skips critics", async () => {
    const seen: string[] = [];
    const result = await runLayeredMoa("quick check", config, { cwd: process.cwd() }, {
      models: ["m1"],
      layers: 1,
      boardName: "test-moa-l1",
      boardRoot: boardDir,
      synthesize: fakeSynth,
      runAgent: async (role) => { seen.push(role); return { role, model: "m1", output: "ok src/x.ts" }; },
    });
    expect(seen).toEqual(["general"]);
    expect(result.critics).toEqual(["maat", "sekhmet"]); // plan keeps defaults; execution skipped
    expect(result.results.every((r) => r.layer === 1)).toBe(true);
  });

  test("a failed proposer does not sink the run (partial semantics)", async () => {
    const result = await runLayeredMoa("resilient task", config, { cwd: process.cwd() }, {
      models: ["m1", "m2"],
      layers: 1,
      boardName: "test-moa-partial",
      boardRoot: boardDir,
      synthesize: fakeSynth,
      runAgent: async (role, task, cfg) => {
        if ((cfg.agent?.[role]?.model ?? "") === "m2") throw new Error("provider down");
        return { role, model: "m1", output: "survivor proposal src/ok.ts" };
      },
    });
    expect(result.results.find((r) => r.model === "m2")?.status).toBe("failed");
    expect(result.results.find((r) => r.model === "m1")?.status).toBe("completed");
    expect(result.status).toBe("completed"); // at least one success + synthesis
  });

  afterAll(() => rmSync(boardDir, { recursive: true, force: true }));
});

describe("persistent team board", () => {
  test("cards, mailbox, mission log persist and format", () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-board-"));
    try {
      const board = new TeamBoard("alpha", dir);
      board.begin("mission alpha", "2 models");
      board.addCard("general@m1", "propose", "m1", 1);
      board.addCard("maat", "critique", "tier", 2);
      board.completeCard("general@m1", { model: "m1", ms: 1200, note: "done note" });
      board.failCard("maat", "critic crashed");
      board.postMail("coordinator", "general@m1", "go");
      board.postMail("general@m1", "coordinator", "result summary");
      board.finish("partial", "1/2");

      const reloaded = new TeamBoard("alpha", dir);
      expect(reloaded.board.status).toBe("partial");
      expect(reloaded.board.cards.length).toBe(2);
      expect(reloaded.board.cards[0].status).toBe("completed");
      expect(reloaded.board.cards[0].ms).toBe(1200);
      expect(reloaded.board.cards[1].status).toBe("failed");
      expect(reloaded.readMail("coordinator").map((m) => m.from)).toEqual(["general@m1"]);
      expect(reloaded.pendingCards().map((c) => c.agent)).toEqual(["maat"]); // resume set

      const listed = listTeamBoards(dir);
      expect(listed.length).toBe(1);
      expect(listed[0].name).toBe("alpha");
      const text = formatBoard(reloaded.board, 2);
      expect(text).toContain("BOARD alpha · partial");
      expect(text).toContain("✓ general@m1");
      expect(text).toContain("2 mail");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("board names are validated", () => {
    expect(() => new TeamBoard("../escape")).toThrow();
    expect(() => new TeamBoard("")).toThrow();
  });
});

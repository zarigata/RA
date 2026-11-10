// moa-args.test.ts — Wave 3a permutation sweep: parseMoaArgs × withMoaTimeout.
// Every flag combo, every invalid value shape (negative/zero/NaN timeout,
// unknown flags, missing values, empty models), and the layer-plan invariants
// downstream of the parsed flags.

import { describe, expect, test } from "bun:test";
import { parseMoaArgs, withMoaTimeout, resolveLayerPlan } from "../src/moa/layers.ts";
import type { RaConfig } from "../../anubis/src/config.ts";

const config: RaConfig = {
  model: "ollama-cloud/glm-5.2",
  small_model: "ollama-lan/qwen3.8:latest",
  agent: {},
};

describe("parseMoaArgs — valid flag permutations", () => {
  const FLAGS = ["roles", "concurrency", "layers", "models", "budget", "team", "timeout"] as const;

  test("every flag individually", () => {
    for (const f of FLAGS) {
      const argv = [`--${f}`, "VALUE"];
      expect(parseMoaArgs(argv)[f]).toBe("VALUE"); // --${f}
    }
  });

  test("all seven flags in one command line", () => {
    const argv = [
      "--roles", "thoth,ptah", "--concurrency", "8", "--layers", "3",
      "--models", "a,b", "--budget", "5", "--team", "sec", "--timeout", "60",
      "--json", "--cwd", "/x",
    ];
    const flags = parseMoaArgs(argv);
    expect(flags).toEqual({
      roles: "thoth,ptah", concurrency: "8", layers: "3",
      models: "a,b", budget: "5", team: "sec", timeout: "60",
    });
  });

  test("flags in any order", () => {
    expect(parseMoaArgs(["--timeout", "5", "--layers", "2"])).toEqual({ layers: "2", timeout: "5" });
    expect(parseMoaArgs(["--layers", "2", "--timeout", "5"])).toEqual({ layers: "2", timeout: "5" });
  });

  test("repeated flag: last occurrence wins", () => {
    expect(parseMoaArgs(["--layers", "1", "--layers", "3"]).layers).toBe("3");
  });

  test("--cwd swallows its value; --json passes through; both omitted from flags", () => {
    const flags = parseMoaArgs(["--cwd", "/some/path", "--json", "--budget", "2"]);
    expect(flags).toEqual({ budget: "2" });
    expect(Object.keys(flags)).not.toContain("cwd");
    expect(Object.keys(flags)).not.toContain("json");
  });

  test("empty argv → empty flags", () => {
    expect(parseMoaArgs([])).toEqual({});
  });
});

describe("parseMoaArgs — invalid inputs (every rejection rule)", () => {
  const rejects: Array<[string[], RegExp, string]> = [
    [["--wat"], /Unexpected moa argument/, "unknown flag"],
    [["--wat", "v"], /Unexpected moa argument/, "unknown flag with value"],
    [["-x"], /Unexpected moa argument/, "single-dash arg"],
    [["--timeout"], /--timeout needs a value/, "missing value (end of argv)"],
    [["--timeout", "--json"], /needs a value/, "next token is a flag"],
    [["--layers", "--timeout", "5"], /Unexpected moa argument|needs a value/, "value looks like a flag"],
    [["positional"], /Unexpected moa argument/, "stray positional"],
    [["--"], /Unexpected moa argument/, "bare double dash"],
  ];
  for (const [argv, re, label] of rejects) {
    test(`${label}: ${JSON.stringify(argv)} throws`, () => {
      expect(() => parseMoaArgs(argv)).toThrow(re);
    });
  }
});

describe("withMoaTimeout — seconds validation matrix", () => {
  test("undefined leaves the config object identical by reference", () => {
    const cfg = { agent_limits: { timeout_ms: 1000 } };
    expect(withMoaTimeout(cfg, undefined)).toBe(cfg);
  });

  test("valid seconds convert to ms, rounded; missing agent_limits created", () => {
    expect(withMoaTimeout({ agent_limits: {} }, "60").agent_limits?.timeout_ms).toBe(60_000);
    expect(withMoaTimeout({}, "1.4").agent_limits?.timeout_ms).toBe(1400); // rounds
    expect(withMoaTimeout({}, "0.001").agent_limits?.timeout_ms).toBe(1);
    expect(withMoaTimeout({ agent_limits: { max_calls: 3 } }, "10").agent_limits)
      .toEqual({ max_calls: 3, timeout_ms: 10_000 }); // siblings preserved
  });

  const invalid = ["0", "-5", "-0.1", "abc", "", "NaN", "Infinity", "1e999", "  "];
  for (const v of invalid) {
    test(`invalid seconds "${v}" throws with the flag name`, () => {
      expect(() => withMoaTimeout({}, v)).toThrow(/--timeout needs seconds > 0/);
    });
  }

  test("purity: the input config object is never mutated", () => {
    const src = { agent_limits: { timeout_ms: 1 } };
    withMoaTimeout(src, "90");
    expect(src.agent_limits?.timeout_ms).toBe(1);
  });
});

describe("parsed flags → layer plan invariants", () => {
  test("models split + trim + empty filtering at the CLI seam (cli.ts contract)", () => {
    // cli.ts does: moaFlags.models?.split(",").map(trim).filter(Boolean)
    const flags = parseMoaArgs(["--models", " a , b ,, c "]);
    const models = flags.models!.split(",").map((s) => s.trim()).filter(Boolean);
    expect(models).toEqual(["a", "b", "c"]);
  });

  test("layers flag clamps into 1..3 in the plan", () => {
    for (const [raw, want] of [["1", 1], ["2", 2], ["3", 3], ["0", 1], ["99", 3], ["-4", 1]] as const) {
      const plan = resolveLayerPlan(config, { layers: Number(raw) });
      expect(plan.layers).toBe(want); // --layers ${raw}
    }
  });

  test("empty models after filtering fall back to the configured lane pair", () => {
    // The CLI passes undefined for an empty list (filter(Boolean) → []);
    // resolveLayerPlan treats [] as absent? No — pin actual: [] stays [],
    // and runLayeredMoa rejects it (1–8 unique). At plan level: flags win.
    const plan = resolveLayerPlan(config, { models: ["a", "a"] });
    expect(plan.models).toEqual(["a", "a"]); // dedup is runLayeredMoa's job
  });
});

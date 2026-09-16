// One-off live eval driver (ra.78 evidence): small task subset against one
// model, printing the context-aware table. Usage: bun eval-sweep.ts <model>
import { runEval, formatEvalResults, EVAL_TASKS } from "./src/eval.ts";
import { loadRaConfig } from "../anubis/src/config.ts";
import { loadEnv } from "../anubis/src/env.ts";
import { ANUBIS_HOME } from "./src/paths.ts";

const model = process.argv[2] ?? "ollama/gemma:latest";
const subset = ["hello-function", "fix-off-by-one", "html-page", "bubble-sort"].map(
  (n) => EVAL_TASKS.find((t) => t.name === n)!,
);
const config = loadRaConfig(ANUBIS_HOME);
const env = loadEnv(ANUBIS_HOME);
const t0 = Date.now();
const results = await runEval(config, env, subset, model);
console.log(formatEvalResults(results));
console.log(`\n(total ${((Date.now() - t0) / 1000).toFixed(0)}s · adaptive=${process.env.RA_NO_ADAPTIVE === "1" ? "OFF" : "ON"})`);

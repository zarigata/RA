// regression-pins.test.ts — Wave 3a: named pins for every RA-side defect
// fixed this session that lacked its own regression test. Existing pins
// (verified present): dangling-symlink listDir (runtime.test.ts), RA_LOCAL_ONLY
// (ollama-routing.test.ts), codder lane-kind (mosaic.test.ts), routing
// baseURLs (routing.test.ts), /sessions metadata-only (daemon.test.ts),
// moa --timeout (moa-layers.test.ts), benchmark --cwd (benchmark-artifacts.test.ts),
// help drift (help-drift.test.ts), quota provider-prefixed marking semantics
// (router-fallback.test.ts quotaKey, added this wave).
// Missing pins added here: provider-block openaiCompat contract (Wave 2),
// GAP-19 ${VAR} hook expansion (Wave D).

import { describe, expect, test } from "bun:test";
import { resolveProviderClient } from "../../anubis/src/ollama.ts";
import { runHookCommand, type RegisteredHook } from "../src/plugins/hook-shim.ts";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Wave 2 pin: provider blocks are OpenAI-compatible by contract", () => {
  // Defect: local provider blocks (LM Studio, llama.cpp, LAN shims) took the
  // native /api/chat path and 404'd on OpenAI-compat-only servers. Fix:
  // resolveProviderClient ALWAYS sets openaiCompat.
  test("a local provider block (LM Studio baseURL) resolves with openaiCompat: true", () => {
    const client = resolveProviderClient("lmstudio/model-x", {
      lmstudio: { options: { baseURL: "http://localhost:1234/v1" } },
    }, {});
    expect(client).not.toBeNull();
    expect(client!.openaiCompat).toBe(true);
    expect(client!.kind).toBe("local");
  });

  test("a LAN-prefixed provider block resolves OpenAI-compat too (never native /api/chat)", () => {
    const client = resolveProviderClient("shim/model-y", {
      shim: { options: { baseURL: "http://192.168.1.40:8080/v1" } },
    }, {});
    expect(client!.openaiCompat).toBe(true);
    expect(client!.kind).toBe("local");
  });

  test("a cloud custom gateway resolves OpenAI-compat with cloud kind", () => {
    const client = resolveProviderClient("codder/claude-sonnet-5-5", {
      codder: { options: { baseURL: "https://cloud-gw.example.test/v1", apiKey: "{env:CODDER_API_KEY}" } },
    }, { CODDER_API_KEY: "k" });
    expect(client!.openaiCompat).toBe(true);
    expect(client!.kind).toBe("cloud");
  });
});

describe("Wave D pin (GAP-19): $CLAUDE_PLUGIN_ROOT exported as an env var", () => {
  // Defect: only the bare $VAR form was string-substituted; ${VAR} inside a
  // hook command failed. Fix: export the env var so the shell expands both.
  let CWD = "";
  test("${VAR} form expands to the imported artifact dir", async () => {
    CWD = mkdtempSync(join(tmpdir(), "ra-gap19-"));
    try {
      writeFileSync(join(CWD, "out.txt"), "");
      const hook: RegisteredHook = {
        id: "g", raHook: "session.start", event: "SessionStart",
        handler: { type: "command", command: 'echo "${CLAUDE_PLUGIN_ROOT}" > out.txt' },
        pluginRoot: "/opt/artifacts/caveman",
      };
      await runHookCommand(hook, {}, CWD);
      expect(readFileSync(join(CWD, "out.txt"), "utf-8").trim()).toBe("/opt/artifacts/caveman");
    } finally {
      rmSync(CWD, { recursive: true, force: true });
    }
  });
});

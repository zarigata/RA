import { describe, expect, test } from "bun:test";
import { dispatchRpc, raHandlers } from "../src/ide.ts";

describe("IDE JSON-RPC bridge", () => {
  test("dispatchRpc returns result for a known method", async () => {
    const res = await dispatchRpc(
      { jsonrpc: "2.0", id: 1, method: "ra/health" },
      raHandlers(),
    );
    expect(res.id).toBe(1);
    expect((res.result as { ok: boolean }).ok).toBe(true);
  });

  test("dispatchRpc returns method-not-found for unknown method", async () => {
    const res = await dispatchRpc(
      { jsonrpc: "2.0", id: 2, method: "ra/nope" },
      raHandlers(),
    );
    expect(res.error?.code).toBe(-32601);
  });

  test("dispatchRpc returns invalid-params on handler error", async () => {
    const res = await dispatchRpc(
      { jsonrpc: "2.0", id: 3, method: "ra/run", params: {} },
      raHandlers(),
    );
    expect(res.error?.code).toBe(-32602);
  });

  test("ra/sessions returns an array", async () => {
    const res = await dispatchRpc(
      { jsonrpc: "2.0", id: 4, method: "ra/sessions" },
      raHandlers(),
    );
    expect(Array.isArray((res.result as { sessions: unknown[] }).sessions)).toBe(true);
  });
});

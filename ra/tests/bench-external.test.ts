// Wave 5 external-bench adapter tests — fully offline. Fixture task files are
// hand-written mini-tasks shaped like each suite (HumanEval+ jsonl, MBPP+ json,
// polyglot exercise dir). No network: loadSuiteFromDir + verifiers only.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadSuiteFromDir,
  makeScratch,
  parseHumanevalPlus,
  parseMbppPlus,
  loadPolyglotTasks,
} from "../src/benchmark/external/tasks.ts";
import {
  extractPythonCode,
  verifyExternalTask,
  polyglotCheck,
  runPython,
} from "../src/benchmark/external/verify.ts";
import { pinModel } from "../src/benchmark/external/run.ts";

// --- fixtures ------------------------------------------------------------

function heplusFixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ra-w5-heplus-"));
  const task = {
    task_id: "HumanEval/900",
    prompt: "def double(x: int) -> int:\n    \"\"\" Return x times two.\n    >>> double(3)\n    6\n    \"\"\"\n",
    entry_point: "double",
    test: "def check(candidate):\n    assert candidate(3) == 6\n    assert candidate(0) == 0\n    assert candidate(-4) == -8\n",
  };
  writeFileSync(join(dir, "humanevalplus.jsonl"), JSON.stringify(task) + "\n");
  return dir;
}

function mbppFixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ra-w5-mbpp-"));
  writeFileSync(
    join(dir, "mbppplus.json"),
    JSON.stringify([
      {
        task_id: 901,
        prompt: "Write a function to add two numbers.",
        test_imports: [],
        test_list: ["assert add(2, 3) == 5", "assert add(-1, 1) == 0"],
      },
    ]),
  );
  return dir;
}

function polyglotFixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ra-w5-poly-"));
  const ex = join(dir, "mini-cipher");
  mkdirSync(join(ex, ".docs"), { recursive: true });
  writeFileSync(
    join(ex, ".docs", "instructions.md"),
    "# Mini cipher\n\nImplement `rot(s)` returning the string with each letter shifted by 13.",
  );
  writeFileSync(join(ex, "mini_cipher.py"), "def rot(s):\n    pass\n");
  writeFileSync(
    join(ex, "mini_cipher_test.py"),
    "import unittest\nfrom mini_cipher import rot\n\nclass T(unittest.TestCase):\n    def test_rot(self):\n        self.assertEqual(rot(\"ab\"), \"no\")\n\nif __name__ == \"__main__\":\n    unittest.main()\n",
  );
  return dir;
}

// --- tasks.ts ------------------------------------------------------------

describe("external suites: parse + loadSuiteFromDir", () => {
  test("humanevalplus fixture parses into one task with raw payload", () => {
    const dir = heplusFixtureDir();
    try {
      const tasks = loadSuiteFromDir("humanevalplus", dir);
      expect(tasks.length).toBe(1);
      expect(tasks[0].id).toBe("HumanEval/900");
      expect(tasks[0].prompt).toContain("solution.py");
      expect(tasks[0].prompt).toContain("def double");
      expect(tasks[0].raw?.heplus?.entry_point).toBe("double");
      expect(Object.keys(tasks[0].files!)).toEqual(["solution.py"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("mbppplus fixture parses with asserts embedded in prompt", () => {
    const dir = mbppFixtureDir();
    try {
      const tasks = loadSuiteFromDir("mbppplus", dir);
      expect(tasks.length).toBe(1);
      expect(tasks[0].id).toBe("901");
      expect(tasks[0].prompt).toContain("assert add(2, 3) == 5");
      expect(tasks[0].raw?.mbpp?.test_list.length).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("polyglot fixture loads instructions + stub, excludes .meta reference", () => {
    const dir = polyglotFixtureDir();
    try {
      const tasks = loadPolyglotTasks(dir);
      expect(tasks.length).toBe(1);
      expect(tasks[0].id).toBe("mini-cipher");
      expect(tasks[0].prompt).toContain("rot(s)");
      expect(tasks[0].files!["mini_cipher.py"]).toContain("pass");
      // a .meta/example.py (reference solution) must never be seeded
      const t2 = loadSuiteFromDir("polyglot-py", dir)[0];
      expect(Object.keys(t2.files!)).toEqual(["mini_cipher.py"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("unknown suite throws", () => {
    expect(() => loadSuiteFromDir("swebench", "/nonexistent")).toThrow("unknown suite");
  });
});

describe("makeScratch", () => {
  test("seeds task files and never collides on re-run", () => {
    const root = mkdtempSync(join(tmpdir(), "ra-w5-scratch-"));
    try {
      const task = parseHumanevalPlus([
        { task_id: "HumanEval/0", prompt: "def f():\n    pass\n", entry_point: "f", test: "def check(c):\n    pass\n" },
      ])[0];
      const a = makeScratch(task, root);
      const b = makeScratch(task, root);
      expect(a).not.toBe(b);
      expect(readFileSync(join(a, "solution.py"), "utf-8")).toBe("");
      // polyglot scratch copies the test file but not .meta
      const polyRoot = polyglotFixtureDir();
      try {
        const pt = loadPolyglotTasks(polyRoot)[0];
        const c = makeScratch(pt, root, polyRoot);
        expect(readFileSync(join(c, "mini_cipher.py"), "utf-8")).toContain("pass");
      } finally {
        rmSync(polyRoot, { recursive: true, force: true });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// --- verify.ts -----------------------------------------------------------

describe("verifyExternalTask (humanevalplus)", () => {
  test("correct solution.py passes", async () => {
    const dir = heplusFixtureDir();
    const scratch = mkdtempSync(join(tmpdir(), "ra-w5-v-"));
    try {
      const task = loadSuiteFromDir("humanevalplus", dir)[0];
      writeFileSync(join(scratch, "solution.py"), "def double(x: int) -> int:\n    return x * 2\n");
      const out = await verifyExternalTask(task, scratch);
      expect(out.passed).toBe(true);
      expect(out.failure).toBe("none");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("wrong logic classified as wrong-logic with reason", async () => {
    const dir = heplusFixtureDir();
    const scratch = mkdtempSync(join(tmpdir(), "ra-w5-v-"));
    try {
      const task = loadSuiteFromDir("humanevalplus", dir)[0];
      writeFileSync(join(scratch, "solution.py"), "def double(x: int) -> int:\n    return x * 3\n");
      const out = await verifyExternalTask(task, scratch);
      expect(out.passed).toBe(false);
      expect(out.failure).toBe("wrong-logic");
      expect(out.reason).toContain("AssertionError");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("syntax error classified as syntax", async () => {
    const dir = heplusFixtureDir();
    const scratch = mkdtempSync(join(tmpdir(), "ra-w5-v-"));
    try {
      const task = loadSuiteFromDir("humanevalplus", dir)[0];
      writeFileSync(join(scratch, "solution.py"), "def double(x: int) -> int:\n    return x * 2  (oops\n");
      const out = await verifyExternalTask(task, scratch);
      expect(out.passed).toBe(false);
      expect(out.failure).toBe("syntax");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("missing solution.py with fenced-block transcript falls back to extraction", async () => {
    const dir = heplusFixtureDir();
    const scratch = mkdtempSync(join(tmpdir(), "ra-w5-v-"));
    try {
      const task = loadSuiteFromDir("humanevalplus", dir)[0];
      const transcript = "Here you go:\n```python\ndef double(x: int) -> int:\n    return x * 2\n```\ndone";
      const out = await verifyExternalTask(task, scratch, transcript);
      expect(out.passed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("missing solution.py and no extractable code → harness miss", async () => {
    const dir = heplusFixtureDir();
    const scratch = mkdtempSync(join(tmpdir(), "ra-w5-v-"));
    try {
      const task = loadSuiteFromDir("humanevalplus", dir)[0];
      const out = await verifyExternalTask(task, scratch, "I would write a function that multiplies.");
      expect(out.passed).toBe(false);
      expect(out.failure).toBe("harness");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("solution.py appended to prompt — prompt ends mid-function is still valid", async () => {
    const dir = heplusFixtureDir();
    const scratch = mkdtempSync(join(tmpdir(), "ra-w5-v-"));
    try {
      const task = loadSuiteFromDir("humanevalplus", dir)[0];
      // solution contains ONLY the body continuation, not the signature — the
      // harness prepends the prompt (signature) so the file must still run.
      writeFileSync(join(scratch, "solution.py"), "    return x * 2\n");
      const out = await verifyExternalTask(task, scratch);
      expect(out.passed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("verifyExternalTask (mbppplus)", () => {
  test("passes on correct solution, fails on wrong one", async () => {
    const dir = mbppFixtureDir();
    const scratch = mkdtempSync(join(tmpdir(), "ra-w5-v-"));
    try {
      const task = loadSuiteFromDir("mbppplus", dir)[0];
      writeFileSync(join(scratch, "solution.py"), "def add(a, b):\n    return a + b\n");
      expect((await verifyExternalTask(task, scratch)).passed).toBe(true);
      writeFileSync(join(scratch, "solution.py"), "def add(a, b):\n    return a - b\n");
      const bad = await verifyExternalTask(task, scratch);
      expect(bad.passed).toBe(false);
      expect(bad.failure).toBe("wrong-logic");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("test_imports are included in the harness", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-w5-mbpp2-"));
    const scratch = mkdtempSync(join(tmpdir(), "ra-w5-v-"));
    try {
      writeFileSync(
        join(dir, "mbppplus.json"),
        JSON.stringify([
          {
            task_id: 902,
            prompt: "Write a function to floor a number.",
            test_imports: ["import math"],
            test_list: ["assert my_floor(2.7) == 2"],
          },
        ]),
      );
      const task = loadSuiteFromDir("mbppplus", dir)[0];
      writeFileSync(join(scratch, "solution.py"), "def my_floor(x):\n    return math.floor(x)\n");
      const out = await verifyExternalTask(task, scratch);
      expect(out.passed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("polyglotCheck", () => {
  test("implemented stub passes pristine test; tampered test file cannot fake it", async () => {
    const practice = polyglotFixtureDir();
    const scratch = mkdtempSync(join(tmpdir(), "ra-w5-v-"));
    try {
      writeFileSync(join(scratch, "mini_cipher.py"), "def rot(s):\n    import string\n    return s.translate(str.maketrans(string.ascii_lowercase + string.ascii_uppercase, string.ascii_lowercase[13:] + string.ascii_lowercase[:13] + string.ascii_uppercase[13:] + string.ascii_uppercase[:13]))\n");
      const out = await polyglotCheck(practice, "mini-cipher", scratch);
      expect(out.passed).toBe(true);

      // Agent overwrites the scratch test to always pass — pristine check still fails
      writeFileSync(join(scratch, "mini_cipher.py"), "def rot(s):\n    return s\n");
      writeFileSync(join(scratch, "mini_cipher_test.py"), "import unittest\nclass T(unittest.TestCase):\n    def test_ok(self):\n        self.assertTrue(True)\n");
      const tampered = await polyglotCheck(practice, "mini-cipher", scratch);
      expect(tampered.passed).toBe(false);
    } finally {
      rmSync(practice, { recursive: true, force: true });
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("extractPythonCode", () => {
  test("extracts ```python block, bare code fence, rejects prose", () => {
    expect(extractPythonCode("```python\ndef f():\n    pass\n```")).toBe("def f():\n    pass\n");
    expect(extractPythonCode("```\ndef g():\n    pass\n```")).toBe("def g():\n    pass\n");
    expect(extractPythonCode("no code here")).toBeNull();
    expect(extractPythonCode("```\nplain text fence\n```")).toBeNull();
  });
});

describe("runPython timeout + classification", () => {
  test("infinite loop is killed and classified timeout", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-w5-to-"));
    try {
      const f = join(dir, "loop.py");
      writeFileSync(f, "while True:\n    pass\n");
      const r = await runPython(f, { timeoutMs: 500 });
      expect(r.timedOut).toBe(true);
      expect(r.code).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 10_000);
});

describe("pinModel (orchestrator model pinning, no LLM)", () => {
  test("pins model across tier/role/router surfaces", () => {
    const cfg = pinModel({ model: "a/x", small_model: "a/y" } as never, "codder/claude-sonnet-5-5");
    expect(cfg.model).toBe("codder/claude-sonnet-5-5");
    expect(cfg.small_model).toBe("codder/claude-sonnet-5-5");
    expect(cfg.agent?.ptah?.model).toBe("codder/claude-sonnet-5-5");
    expect(cfg.capability_router?.enabled).toBe(false);
    expect((cfg as { tier_models?: Record<string, string> }).tier_models?.code).toBe("codder/claude-sonnet-5-5");
  });
});

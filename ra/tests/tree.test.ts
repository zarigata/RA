import { describe, expect, test } from "bun:test";
import { SubagentTree } from "../src/tui/tree.ts";

describe("subagent tree", () => {
  test("empty tree renders nothing", () => {
    const tree = new SubagentTree();
    expect(tree.hasTree).toBe(false);
    expect(tree.render()).toBe("");
  });

  test("startRoot creates root node", () => {
    const tree = new SubagentTree();
    tree.startRoot("ptah", "write a hello world function");
    expect(tree.hasTree).toBe(true);
    const flat = tree.flatten();
    expect(flat.length).toBe(1);
    expect(flat[0].role).toBe("ptah");
    expect(flat[0].status).toBe("running");
  });

  test("spawn + complete tracks subagent", () => {
    const tree = new SubagentTree();
    tree.startRoot("ptah", "build a todo app");
    tree.spawn("explore", "find existing files");
    tree.complete("found 3 files");
    
    const flat = tree.flatten();
    expect(flat.length).toBe(2);
    expect(flat[1].role).toBe("explore");
    expect(flat[1].status).toBe("done");
    expect(flat[1].result).toBe("found 3 files");
    expect(flat[1].depth).toBe(1);
  });

  test("error marks subagent as errored", () => {
    const tree = new SubagentTree();
    tree.startRoot("ptah", "build something");
    tree.spawn("scout", "search the codebase");
    tree.error("connection failed");
    
    const flat = tree.flatten();
    expect(flat[1].status).toBe("error");
    expect(flat[1].result).toBe("connection failed");
  });

  test("render shows tree structure with status icons", () => {
    const tree = new SubagentTree();
    tree.startRoot("ptah", "build app");
    tree.spawn("explore", "find files");
    tree.complete("found 2 files");
    tree.spawn("general", "write tests");
    tree.complete("tests written");
    tree.complete("app built");
    
    const rendered = tree.render();
    expect(rendered).toContain("subagents");
    expect(rendered).toContain("ptah");
    expect(rendered).toContain("explore");
    expect(rendered).toContain("general");
    expect(rendered).toContain("✓");
  });

  test("clear resets the tree", () => {
    const tree = new SubagentTree();
    tree.startRoot("ptah", "task");
    tree.spawn("explore", "subtask");
    tree.clear();
    expect(tree.hasTree).toBe(false);
    expect(tree.flatten().length).toBe(0);
  });

  test("nested spawns create deeper trees", () => {
    const tree = new SubagentTree();
    tree.startRoot("ptah", "root task");
    tree.spawn("explore", "level 1");
    tree.spawn("scout", "level 2");
    tree.complete("done 2");
    tree.complete("done 1");
    tree.complete("done root");
    
    const flat = tree.flatten();
    expect(flat.length).toBe(3);
    expect(flat[0].depth).toBe(0);
    expect(flat[1].depth).toBe(1);
    expect(flat[2].depth).toBe(2);
  });

  test("createSubagentTracker returns a SubagentTree", async () => {
    const { createSubagentTracker } = await import("../src/agent.ts");
    const tree = createSubagentTracker();
    expect(tree).toBeDefined();
    expect(tree.hasTree).toBe(false);
  });
});
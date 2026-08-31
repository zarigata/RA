// Subagent tree — tracks spawned subagents and renders a visual tree for the TUI.
// When an agent spawns a subagent via TASK, the tree records the parent→child
// relationship and can render it as an indented tree.

export interface SubagentNode {
  role: string;
  task: string;
  status: "running" | "done" | "error" | "cancelled";
  model?: string;
  started?: number;
  ended?: number;
  result?: string;
  children: SubagentNode[];
  depth: number;
}

export class SubagentTree {
  private root: SubagentNode | null = null;
  private stack: SubagentNode[] = [];

  /** Start tracking a root agent (e.g. ptah). */
  startRoot(role: string, task: string): SubagentNode {
    this.root = { role, task, status: "running", children: [], depth: 0, started: Date.now() };
    this.stack = [this.root];
    return this.root;
  }

  /** Explicit ownership is safe when sibling agents complete out of order. */
  beginNode(role: string, task: string, parent: SubagentNode): SubagentNode {
    const node: SubagentNode = { role, task, status: "running", children: [], depth: parent.depth + 1, started: Date.now() };
    parent.children.push(node);
    return node;
  }

  finishNode(node: SubagentNode, status: SubagentNode["status"], result?: string): void {
    node.status = status;
    node.result = result?.slice(0, 300);
    node.ended = Date.now();
  }

  /** Begin a subagent spawn. Must be called inside the parent's execution. */
  spawn(role: string, task: string): SubagentNode {
    const parent = this.stack[this.stack.length - 1] ?? this.root;
    const node: SubagentNode = { role, task, status: "running", children: [], depth: (parent?.depth ?? 0) + 1 };
    if (parent) parent.children.push(node);
    this.stack.push(node);
    return node;
  }

  /** Mark the current subagent as complete. */
  complete(result?: string): void {
    const node = this.stack.pop();
    if (node) {
      node.status = "done";
      node.result = result?.slice(0, 200);
    }
  }

  /** Mark the current subagent as errored. */
  error(msg?: string): void {
    const node = this.stack.pop();
    if (node) {
      node.status = "error";
      node.result = msg?.slice(0, 200);
    }
  }

  /** Reset the tree for a new run. */
  clear(): void {
    this.root = null;
    this.stack = [];
  }

  /** Whether any agents have been tracked. */
  get hasTree(): boolean {
    return this.root !== null;
  }

  /** Render the tree as a string with indentation and status indicators. */
  render(): string {
    if (!this.root) return "";
    const lines: string[] = ["╭ subagents ──────────────"];
    this.renderNode(this.root, lines, "");
    lines.push("╰─");
    return lines.join("\n");
  }

  private renderNode(node: SubagentNode, lines: string[], prefix: string): void {
    const icon = node.status === "running" ? "⏳" : node.status === "error" ? "✗" : node.status === "cancelled" ? "⏹" : "✓";
    const task = node.task.length > 60 ? node.task.slice(0, 57) + "…" : node.task;
    lines.push(`${prefix}${icon} ${node.role}${node.model ? ` [${node.model}]` : ""}: ${task}`);
    for (let i = 0; i < node.children.length; i++) {
      const isLast = i === node.children.length - 1;
      const childPrefix = prefix + (isLast ? "  " : "  ");
      this.renderNode(node.children[i], lines, childPrefix);
    }
  }

  /** Get a flat list of all nodes (for testing or compact display). */
  flatten(): SubagentNode[] {
    if (!this.root) return [];
    const out: SubagentNode[] = [];
    const walk = (n: SubagentNode) => {
      out.push(n);
      n.children.forEach(walk);
    };
    walk(this.root);
    return out;
  }
}
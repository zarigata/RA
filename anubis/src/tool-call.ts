/** Normalize provider tool encodings into RA's permission-checked tool grammar.
 * Unsupported calls remain visible to the agent; they are never executed.
 */
export function toolCallText(name: string, args: Record<string, unknown>): string {
  const tool = name.toUpperCase();
  const value = (...keys: string[]): string => {
    for (const key of keys) if (typeof args[key] === "string") return args[key] as string;
    return "";
  };
  const path = value("path", "file_path", "filename", "file");
  switch (tool) {
    case "READ": case "OUTLINE": case "DIAGNOSE": return `${tool} ${path}`;
    case "WRITE": {
      const body = value("content", "contents", "text");
      const fence = "`".repeat(Math.max(3, ...[...body.matchAll(/`+/g)].map(m => m[0].length + 1)));
      return `WRITE ${path}\n${fence}\n${body}\n${fence}`;
    }
    case "EDIT": return `EDIT ${path}\n<<<<<<< OLD\n${value("old", "old_string", "old_text")}\n=======\n${value("new", "new_string", "new_text")}\n>>>>>>> NEW`;
    case "BASH": return `BASH ${value("command", "cmd")}`;
    case "GLOB": return `GLOB ${value("pattern", "glob")}`;
    case "GREP": return `GREP ${value("pattern")} ${value("glob", "include")}`.trim();
    case "WEBFETCH": return `WEBFETCH ${value("url")}`;
    case "TODO": return `TODO ${value("command", "action")}`;
    case "TASK": return `TASK ${value("role", "agent")} ${value("task", "prompt")}`;
    case "DONE": return `DONE ${value("summary", "message")}`;
    default: return `UNSUPPORTED_TOOL ${name}`;
  }
}

export function normalizeToolText(content: string): string {
  const invoke = content.match(/<invoke\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/invoke>/i);
  if (!invoke) return content;
  const args: Record<string, string> = {};
  const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  for (const p of invoke[2].matchAll(/<parameter\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/parameter>/gi)) args[p[1]] = decode(p[2]);
  return toolCallText(invoke[1], args);
}

export interface StreamToolCall { index?: number; function?: { name?: string; arguments?: string | Record<string, unknown> } }
export function collectToolCalls(target: Map<number, { name: string; args: string }>, calls: StreamToolCall[]): void {
  for (const call of calls) {
    const i = call.index ?? 0;
    const entry = target.get(i) ?? { name: "", args: "" };
    if (call.function?.name) entry.name += call.function.name;
    const args = call.function?.arguments;
    if (typeof args === "string") entry.args += args;
    else if (args) entry.args += JSON.stringify(args);
    target.set(i, entry);
  }
}
export function collectedToolText(calls: Map<number, { name: string; args: string }>): string {
  const first = calls.values().next().value;
  if (!first) return "";
  try { return toolCallText(first.name, JSON.parse(first.args || "{}")); }
  catch { throw new Error(`Invalid tool arguments for ${first.name}`); }
}

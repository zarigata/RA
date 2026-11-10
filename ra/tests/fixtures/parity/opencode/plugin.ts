// Canonical OpenCode plugin (source: https://opencode.ai/docs/plugins +
// github.com/anomalyco/opencode packages/web/src/content/docs/plugins.mdx)
// Lives at .opencode/plugins/*.ts (project) or ~/.config/opencode/plugins/ (global).
import type { Plugin } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool === "bash") {
        console.log("Running:", output.args.command)
      }
    },
    "tool.execute.after": async (input, output) => {
      // input: { tool, sessionID, callID }; output: { title, output, metadata }
    },
  }
}

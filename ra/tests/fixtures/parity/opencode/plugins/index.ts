// Alternative layout: .opencode/plugins/<name>/index.ts (directory plugin)
export const EchoPlugin = async (ctx) => ({
  "tool.execute.before": async (input, output) => {
    if (input.tool === "read" && String(output.args.filePath).includes(".env")) {
      throw new Error("Do not read .env files")
    }
  },
})

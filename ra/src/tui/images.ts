// tui/images.ts — inline image display for the TUI: detection + placeholder.
// ponytail: ceiling — kitty/iTerm2 OSC 1338 / sixel ESC-sequences are gated
// behind detection and NOT emitted by default; we render an honest placeholder
// (dimensions + path + `open` hint). Emission is a one-line upgrade in
// renderImageBlock once a real terminal quirk table earns it; risk of glyph
// corruption in untested terminals outweighs the value today.

/** What the terminal is known to support for inline images. */
export type ImageSupport = "kitty" | "iterm" | "sixel" | "none";

/**
 * Detect inline-image support from the environment (no queries, no side
 * effects): TERM_PROGRAM (iTerm2/wezTerm/kitty; ghostty speaks kitty too),
 * TERM (xterm-kitty / sixel), plus explicit RA_IMAGE opt-in/kill.
 */
export function detectImageSupport(env: Record<string, string | undefined> = process.env): ImageSupport {
  if (env.RA_IMAGES === "0" || env.RA_IMAGES === "off") return "none";
  const program = env.TERM_PROGRAM ?? "";
  if (env.TERM === "xterm-kitty" || program === "kitty" || program === "ghostty") return "kitty";
  if (program === "vscode" || env.TERM_PROGRAM_VERSION?.startsWith("3.")) return "iterm"; // VS Code / iTerm2
  if (program === "WezTerm" || program === "wezterm") return "iterm"; // OSC 1338 family
  if ((env.TERM ?? "").includes("sixel")) return "sixel";
  if (env.RA_IMAGES === "kitty" || env.RA_IMAGES === "iterm") return env.RA_IMAGES;
  return "none";
}

/** Image file extensions we treat as renderable. */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

/** Is this path an image reference the TUI could display? */
export function isImagePath(p: string): boolean {
  return IMAGE_EXT.test(p.trim());
}

/**
 * Render an image reference for the transcript: a placeholder box with
 * dimensions (when provided by the caller), the path, and an `open`
 * hint. `sizeBytes` (from an fs stat by the caller) switches the size line
 * on. Pure — no terminal I/O, safe in logs and tests.
 */
export function renderImageBlock(path: string, opts: { width?: number; height?: number; sizeBytes?: number; support?: ImageSupport } = {}): string {
  const dims = opts.width && opts.height ? `${opts.width}x${opts.height}` : "";
  const size = typeof opts.sizeBytes === "number"
    ? opts.sizeBytes < 1024 ? `${opts.sizeBytes} B` : `${(opts.sizeBytes / 1024).toFixed(1)} KB` : "";
  const meta = [dims, size].filter(Boolean).join(" · ");
  const lines = [
    `┌─ image${meta ? ` · ${meta}` : ""} ${"─".repeat(Math.max(1, 40 - meta.length))}┐`,
    `│ ${path}`,
    `└${"─".repeat(42)}┘`,
    opts.support && opts.support !== "none"
      ? `(terminal supports ${opts.support} graphics — inline emission is a known ceiling; use: open ${path})`
      : `(view with: open ${path})`,
  ];
  return lines.join("\n");
}

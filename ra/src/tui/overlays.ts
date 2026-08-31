// tui/overlays.ts — floating menu, shortcuts modal, and onboarding wizard
// renderers (pure: lines in → lines + hitboxes out).

import { visibleWidth, truncateVisible } from "./markdown.ts";

export interface MenuEntry {
  label: string;
  detail?: string;
  /** PaletteAction-style payload consumed by the app */
  run?: Record<string, unknown>;
  /** open a submenu with these entries instead of running */
  submenu?: MenuEntry[];
  separator?: boolean;
}

export interface MenuFrame {
  lines: Array<{ y: number; text: string }>;
  /** screen y → item index (separators excluded) */
  hitbox: Map<number, number>;
}

const fit = (width: number, s: string) => {
  const v = visibleWidth(s);
  return v > width ? truncateVisible(s, width) : s + " ".repeat(width - v);
};

export interface MenuStyle {
  accent: (s: string) => string;
  strong: (s: string) => string;
  muted: (s: string) => string;
  bar: (s: string) => string;
}

/**
 * Render a floating menu box anchored at (x, y), clamped to the screen.
 * Returns overlay lines (absolute y) plus the click hitbox.
 */
export function renderMenuOverlay(opts: {
  base: string[];
  screenW: number;
  screenH: number;
  x: number;
  y: number;
  title: string;
  entries: MenuEntry[];
  selected: number;
  style: MenuStyle;
}): MenuFrame {
  const W = opts.screenW, H = opts.screenH;
  const inner = opts.entries.map((e) => (e.separator ? "───" : e.label + (e.submenu ? "  ▸" : "")));
  const maxLabel = Math.max(10, ...inner.map((l) => visibleWidth(l)));
  const boxW = Math.min(W - 2, maxLabel + 12);
  const boxH = Math.min(H - 3, opts.entries.length + 3); // borders + title + rows
  const x0 = Math.max(1, Math.min(opts.x, W - boxW - 1));
  const y0 = Math.max(2, Math.min(opts.y, H - boxH - 2));
  const lines: MenuFrame["lines"] = [];
  const hitbox = new Map<number, number>();
  lines.push({ y: y0, text: opts.style.accent(`╭${"─".repeat(Math.max(0, boxW - 2))}╮`) });
  lines.push({ y: y0 + 1, text: opts.style.accent("│") + fit(boxW - 2, opts.style.strong(` ${opts.title} `)) + opts.style.accent("│") });
  let itemIndex = -1;
  for (let i = 0; i < opts.entries.length && i < boxH - 3; i++) {
    const e = opts.entries[i];
    const yy = y0 + 2 + i;
    if (e.separator) {
      lines.push({ y: yy, text: opts.style.accent("│") + opts.style.muted(fit(boxW - 2, ` ${"─".repeat(Math.max(2, boxW - 6))} `)) + opts.style.accent("│") });
      continue;
    }
    itemIndex++;
    const selected = itemIndex === opts.selected;
    const marker = selected ? opts.style.accent("▌") : " ";
    const label = selected ? opts.style.strong(e.label) : e.label;
    const detail = e.detail ? opts.style.muted(` — ${truncateVisible(e.detail, Math.max(6, boxW - visibleWidth(e.label) - 10))}`) : "";
    lines.push({ y: yy, text: opts.style.accent("│") + fit(boxW - 2, `${marker}${label}${detail}`) + opts.style.accent("│") });
    hitbox.set(yy, itemIndex);
  }
  lines.push({ y: y0 + boxH - 1, text: opts.style.accent(`╰${"─".repeat(Math.max(0, boxW - 2))}╯`) });
  // Paint over the base frame (later y wins).
  const painted = [...opts.base];
  for (const l of lines) painted[l.y] = l.text;
  return { lines: painted.map((text, y) => ({ y, text })), hitbox };
}

const SHORTCUTS: Array<[string, string]> = [
  ["/", "search everything — commands, agents, files, models, themes"],
  ["ctrl+p", "open the palette"],
  ["?", "this shortcuts panel"],
  ["tab", "complete the highlighted palette entry"],
  ["esc", "close overlay · cancel the running task"],
  ["ctrl+c", "cancel task / clear input"],
  ["ctrl+d", "quit RA"],
  ["ctrl+l", "clear the screen"],
  ["ctrl+u", "clear the input line"],
  ["↑ ↓ / pgup pgdn", "scroll history or palette"],
  ["right-click", "context menu at the mouse"],
  ["click header", "logo = main menu · model chips = model menu"],
  ["wheel", "scroll the conversation"],
  ["agent:<name> <task>", "delegate directly to one agent"],
  ["@file", "attach a project file to the prompt"],
  ["!shell", "run a shell command (standard tools apply)"],
];

/** Full-screen shortcuts modal ("?"). */
export function renderShortcutsOverlay(opts: {
  screenW: number;
  screenH: number;
  style: MenuStyle;
  themeName: string;
}): string[] {
  const W = opts.screenW, H = opts.screenH;
  const out: string[] = [];
  out.push(opts.style.bar(fit(W, "  ?  RA shortcuts — click or press any key to close  ")));
  out.push("");
  for (const [k, v] of SHORTCUTS) {
    const key = opts.style.bar(` ${k} `);
    const rest = opts.style.muted(` ${v}`);
    out.push(fit(Math.max(10, W - 2), "   " + key + rest));
  }
  out.push("");
  out.push(opts.style.muted(fit(W, `  theme: ${opts.themeName} — change with /theme or the theme menu`)));
  while (out.length < H - 1) out.push("");
  out.push(opts.style.muted(fit(W, "  press any key to close  ")));
  return out;
}

export const SHORTCUT_COUNT = SHORTCUTS.length;

export interface OnboardFrame {
  lines: string[];
  themeHit: Map<number, string>;
  actionHit: Map<number, string>;
}

/** First-run wizard: step 0 = pick a look, step 1 = pick a first move. */
export function renderOnboardingOverlay(opts: {
  screenW: number;
  screenH: number;
  style: MenuStyle;
  step: 0 | 1;
  themes: Array<{ id: string; name: string }>;
  selectedTheme: number;
  version: string;
}): OnboardFrame {
  const W = opts.screenW, H = opts.screenH;
  const st = opts.style;
  const lines: string[] = [];
  const themeHit = new Map<number, string>();
  const actionHit = new Map<number, string>();
  const boxW = Math.min(W - 4, 72);
  const x0 = Math.max(2, Math.floor((W - boxW) / 2));
  const pad = (s: string) => st.accent("│") + fit(boxW - 2, s) + st.accent("│");

  lines.push("");
  lines.push(fit(W, " ".repeat(x0) + st.accent(`╭${"─".repeat(boxW - 2)}╮`)));
  lines.push(fit(W, " ".repeat(x0) + pad(st.strong(`  Welcome to RA (${opts.version})`))));
  lines.push(fit(W, " ".repeat(x0) + pad(st.muted("  the swiss-army terminal agent — for first-timers and pros"))));

  if (opts.step === 0) {
    lines.push(fit(W, " ".repeat(x0) + pad("")));
    lines.push(fit(W, " ".repeat(x0) + pad("  Step 1/2 — pick a look (↑↓ + enter, or click):")));
    opts.themes.slice(0, 8).forEach((t, i) => {
      const selected = i === opts.selectedTheme;
      const marker = selected ? st.accent("▌") : " ";
      const label = `${marker}${selected ? st.strong(t.name) : t.name}${st.muted(`   · ${t.id}`)}`;
      lines.push(fit(W, " ".repeat(x0) + pad(`  ${label}`)));
      themeHit.set(lines.length, t.id);
    });
    lines.push(fit(W, " ".repeat(x0) + pad("")));
    lines.push(fit(W, " ".repeat(x0) + pad(st.muted("  enter confirms · you can change it any time with /theme"))));
  } else {
    lines.push(fit(W, " ".repeat(x0) + pad("")));
    lines.push(fit(W, " ".repeat(x0) + pad("  Step 2/2 — what do you want to do first? (click or ↑↓ + enter)")));
    const actions: Array<[string, string, string]> = [
      ["Build something", "/quick ", "describe an app — RA plans, codes and verifies it"],
      ["Get opinions", "/moa ", "several agents review a problem and synthesize"],
      ["Just chat", "", "type anything — RA answers and can use tools"],
    ];
    actions.forEach(([label, prefix, detail], i) => {
      const marker = i === opts.selectedTheme ? st.accent("▌") : " ";
      lines.push(fit(W, " ".repeat(x0) + pad(`  ${marker}${st.strong(label)}${st.muted(` — ${detail}`)}`)));
      actionHit.set(lines.length, prefix);
    });
    lines.push(fit(W, " ".repeat(x0) + pad("")));
    lines.push(fit(W, " ".repeat(x0) + pad(st.muted("  ? shows every shortcut · / searches everything"))));
  }
  lines.push(fit(W, " ".repeat(x0) + st.accent(`╰${"─".repeat(boxW - 2)}╯`)));
  while (lines.length < H - 1) lines.push("");
  return { lines, themeHit, actionHit };
}

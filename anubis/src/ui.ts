// src/ui.ts — UI customization and color palettes (pure, testable)

export interface ColorPalette {
  name: string;
  foreground: string;
  background: string;
  accent: string;
  muted: string;
  success: string;
  warning: string;
  error: string;
}

const PALETTES: Record<string, ColorPalette> = {
  obsidian: {
    name: "Obsidian",
    foreground: "#e2e8f0",
    background: "#0f172a",
    accent: "#38bdf8",
    muted: "#64748b",
    success: "#22c55e",
    warning: "#eab308",
    error: "#ef4444",
  },
  emerald: {
    name: "Emerald",
    foreground: "#ecfdf5",
    background: "#064e3b",
    accent: "#34d399",
    muted: "#6ee7b7",
    success: "#10b981",
    warning: "#fbbf24",
    error: "#f87171",
  },
  desert: {
    name: "Desert",
    foreground: "#fef3c7",
    background: "#78350f",
    accent: "#f59e0b",
    muted: "#d97706",
    success: "#84cc16",
    warning: "#eab308",
    error: "#dc2626",
  },
  neon: {
    name: "Neon",
    foreground: "#ffffff",
    background: "#000000",
    accent: "#00ffcc",
    muted: "#888888",
    success: "#00ff00",
    warning: "#ffff00",
    error: "#ff0055",
  },
  classic: {
    name: "Classic",
    foreground: "#c0c0c0",
    background: "#000080",
    accent: "#00ffff",
    muted: "#808080",
    success: "#00ff00",
    warning: "#ffff00",
    error: "#ff0000",
  },
  monochrome: {
    name: "Monochrome",
    foreground: "#ffffff",
    background: "#111111",
    accent: "#cccccc",
    muted: "#777777",
    success: "#ffffff",
    warning: "#cccccc",
    error: "#ffffff",
  },
  cyberpunk: {
    name: "Cyberpunk",
    foreground: "#f43f5e",
    background: "#1e1b4b",
    accent: "#06b6d4",
    muted: "#818cf8",
    success: "#10b981",
    warning: "#f59e0b",
    error: "#e11d48",
  },
  royal: {
    name: "Royal",
    foreground: "#f3e8ff",
    background: "#3b0764",
    accent: "#c084fc",
    muted: "#a855f7",
    success: "#4ade80",
    warning: "#facc15",
    error: "#f87171",
  },
  sunset: {
    name: "Sunset",
    foreground: "#fff7ed",
    background: "#431407",
    accent: "#fb923c",
    muted: "#ea580c",
    success: "#48bb78",
    warning: "#ecc94b",
    error: "#e53e3e",
  },
  nord: {
    name: "Nord",
    foreground: "#eceff4",
    background: "#2e3440",
    accent: "#88c0d0",
    muted: "#4c566a",
    success: "#a3be8c",
    warning: "#ebcb8b",
    error: "#bf616a",
  },
  pharaonic: {
    name: "Pharaonic",
    foreground: "#fef08a",
    background: "#3f2c00",
    accent: "#fbbf24",
    muted: "#78350f",
    success: "#84cc16",
    warning: "#eab308",
    error: "#ef4444",
  },
};

export interface UiConfig {
  palette: string;
  unicodeBanners: boolean;
  compactLogs: boolean;
  borderStyle: "single" | "double" | "rounded" | "none";
}

export const DEFAULT_UI_CONFIG: UiConfig = {
  palette: "pharaonic",
  unicodeBanners: true,
  compactLogs: false,
  borderStyle: "rounded",
};

export const HIEROGLYPHS = {
  THOTH: "𓁹",      // Visão / Planejamento
  PTAH: "𓃠",       // Criação / Implementação
  MAAT: "⚖️",       // Justiça / Diagnóstico
  SEKHMET: "𓄿",    // Poder / Review Adversarial
  SESHAT: "𓏟",     // Escrita / Documentação
  OSIRIS: "𓇋",     // Ressurreição / Fix
  ANUBIS: "𓃡",     // Orquestrador
};

export function getPalette(name: string): ColorPalette {
  return PALETTES[name.toLowerCase()] ?? PALETTES["pharaonic"];
}

export function listPalettes(): ColorPalette[] {
  return Object.values(PALETTES);
}

export function formatBox(title: string, content: string, style: UiConfig["borderStyle"] = "rounded"): string {
  if (style === "none") return `[${title}]\n${content}`;
  const h = style === "double" ? "═" : style === "single" ? "─" : "─";
  const tl = style === "double" ? "╔" : style === "rounded" ? "╭" : "┌";
  const tr = style === "double" ? "╗" : style === "rounded" ? "╮" : "┐";
  const bl = style === "double" ? "╚" : style === "rounded" ? "╰" : "└";
  const br = style === "double" ? "╝" : style === "rounded" ? "╯" : "┘";
  const v = style === "double" ? "║" : "│";

  const lines = content.split("\n");
  const maxLen = Math.max(title.length + 2, ...lines.map((l) => l.length));
  const top = `${tl} ${title} ` + h.repeat(Math.max(0, maxLen - title.length - 1)) + ` ${tr}`;
  const body = lines.map((l) => `${v} ${l.padEnd(maxLen)} ${v}`).join("\n");
  const bottom = `${bl} ` + h.repeat(maxLen + 2) + ` ${br}`;
  return [top, body, bottom].join("\n");
}

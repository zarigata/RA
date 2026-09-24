// Small, deterministic ambient scene. Uses the local clock and a slow phase;
// no terminal control codes or external animation dependencies.
export type DayPhase = "dawn" | "day" | "sunset" | "night";

export function dayPhase(date: Date): DayPhase {
  const h = date.getHours();
  if (h >= 5 && h < 8) return "dawn";
  if (h >= 8 && h < 17) return "day";
  if (h >= 17 && h < 20) return "sunset";
  return "night";
}

export function ambientScene(date: Date, tick = 0, width = 50): string {
  const phase = dayPhase(date);
  const celestial = phase === "night" ? "☾" : "☼";
  const sky = phase === "night" ? ["·", "✦", "·", "✧"] : ["·", "·", "✧", "·"];
  const label = `${celestial} ${phase.toUpperCase()}  𓂀  ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  const room = Math.max(0, Math.min(32, width - label.length - 2));
  const stars = Array.from({ length: room }, (_, i) => sky[(i + Math.floor(tick / 4)) % sky.length]).join("");
  return `${label} ${stars}`.trimEnd();
}

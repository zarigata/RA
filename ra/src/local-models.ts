/** Conservative starting points, not a guarantee of GPU support or context capacity. */
export function localModelPreset(freeVramGB: number) {
  if (!Number.isFinite(freeVramGB) || freeVramGB < 0) throw new Error("Free VRAM must be a non-negative number");
  const model = freeVramGB >= 12 ? "qwen3:14b" : freeVramGB >= 8 ? "qwen3:8b" : freeVramGB >= 4 ? "qwen3:4b" : "qwen3:1.7b";
  return { model: `ollama/${model}`, contextTokens: 4096, pull: ["ollama", "pull", model] };
}

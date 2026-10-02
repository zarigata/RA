import { localModelPreset } from "../ra/src/local-models.ts";
const [vram, cloudModel] = process.argv.slice(2);
if (!vram || !cloudModel) throw new Error("Usage: node scripts/local-controller-config.ts FREE_VRAM_GB PROVIDER/MODEL");
const preset = localModelPreset(Number(vram));
console.log(JSON.stringify({ model: cloudModel, small_model: preset.model, agent: {}, routing: { mode: "local-controller" }, capability_router: { enabled: false }, context: { min_context_tokens: preset.contextTokens, server_cap: { ollama: preset.contextTokens, "ollama-lan": preset.contextTokens, "ollama-local": preset.contextTokens } } }, null, 2));
console.error(`Install local model: ${preset.pull.join(" ")}`);

# BUILD/07 — LAN

**Phase:** 07
**Objective:** Multi-machine LAN support. Anubis discovers model servers on the local network (Ollama, LM Studio, llama.cpp) and registers them as first-class providers. LAN models are free — ideal for `reviewer`, `swift`, `scribe`, and meta tasks.
**Gate:** `/lan-scan` finds LAN hosts; LAN models appear in `/models`; a LAN model answers a prompt.

---

## 1. LAN provider model

| Provider ID | Default port | Server | OpenAI-compatible? |
|---|---|---|---|
| `ollama-lan` | 11434 | Ollama on another machine | yes (`/v1`) |
| `lmstudio-lan` | 1234 | LM Studio on another machine | yes (`/v1`) |
| `llamacpp-lan` | 8080 | llama.cpp server on another machine | yes (`/v1`) |

All three expose OpenAI-compatible APIs, so opencode's `@ai-sdk/openai-compatible` provider handles them.

---

## 2. Static config (manual, always works)

Add to `opencode.json`:

```jsonc
{
  "provider": {
    "ollama-lan": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama (LAN)",
      "options": { "baseURL": "http://192.168.1.50:11434/v1" },
      "models": {
        "gemma:latest": { "name": "Gemma (LAN)" },
        "qwen3-coder:30b": { "name": "Qwen3 Coder 30B (LAN)" }
      }
    },
    "lmstudio-lan": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio (LAN)",
      "options": { "baseURL": "http://192.168.1.60:1234/v1" },
      "models": {
        "google/gemma-3n-e4b": { "name": "Gemma 3n (LAN)" }
      }
    },
    "llamacpp-lan": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "llama.cpp (LAN)",
      "options": { "baseURL": "http://192.168.1.70:8080/v1" },
      "models": {
        "qwen3-coder:a3b": { "name": "Qwen3 Coder a3b (LAN)" }
      }
    }
  }
}
```

---

## 3. `/lan-scan` plugin (automatic discovery)

### 3.1 File

`.opencode/plugins/lan.ts`

### 3.2 Behavior

1. Determine local subnet from the machine's IP + netmask (e.g. `192.168.1.0/24`).
2. For each host in the subnet, probe ports 11434, 1234, 8080 with a short timeout (300ms).
3. For each open port, call `GET /v1/models`.
4. If models are returned, register the host as a custom provider (write to `opencode.json` or a `lan.json` the plugin reads).
5. Report found hosts + models in the TUI.

### 3.3 Code skeleton

```ts
import type { Plugin } from "@opencode-ai/plugin"

const PORTS = [
  { port: 11434, provider: "ollama-lan", name: "Ollama" },
  { port: 1234,  provider: "lmstudio-lan", name: "LM Studio" },
  { port: 8080,  provider: "llamacpp-lan", name: "llama.cpp" },
]

async function getSubnet(): Promise<string> {
  // Use `ipconfig`/`ifconfig`/`ip addr` to find the local IP and netmask.
  // Return CIDR, e.g. "192.168.1.0/24".
}

async function scanHost(host: string, port: number): Promise<string[] | null> {
  try {
    const res = await fetch(`http://${host}:${port}/v1/models`, { signal: AbortSignal.timeout(300) })
    if (!res.ok) return null
    const data = await res.json()
    return (data.data ?? []).map((m: any) => m.id)
  } catch {
    return null
  }
}

export const LanPlugin: Plugin = async ({ client, $ }) => {
  return {
    "tui.command.execute": async (input, output) => {
      if (input.command.startsWith("/lan-scan")) {
        output.handled = true
        const subnet = await getSubnet()
        // iterate hosts, probe ports, collect results
        // write lan.json with discovered providers
        // report to user
      }
    },
  }
}
```

### 3.4 Discovery output

```
LAN SCAN — 192.168.1.0/24
  ✓ 192.168.1.50:11434  Ollama      models: gemma:latest, qwen3-coder:30b
  ✓ 192.168.1.60:1234   LM Studio   models: google/gemma-3n-e4b
  ✗ 192.168.1.70:8080   llama.cpp   no response
Registered 2 LAN providers. Use /models to select LAN models.
```

### 3.5 Persistence

Write discovered providers to `.opencode/lan.json`:

```json
{
  "providers": {
    "ollama-lan": {
      "baseURL": "http://192.168.1.50:11434/v1",
      "models": ["gemma:latest", "qwen3-coder:30b"]
    }
  }
}
```

The plugin merges `lan.json` into the provider config at startup. (If the SDK exposes a config-write API, use it; otherwise the plugin reads `lan.json` and the user's `opencode.json` references it via a documented include.)

---

## 4. Security notes

- LAN model servers are **unauthenticated by default**. Only scan/use hosts you trust.
- Do not send secrets to LAN models unless you control the host.
- `vibeguard` (BUILD/08) redacts secrets before any LLM call, including LAN.

---

## 5. Definition of Done (gate)

```bash
cd anubis
bun run build
bun run cli
# in TUI:
#   /lan-scan
#   /models  → LAN models visible
#   @reviewer "review this"  → uses a LAN model if assigned
```

**Gate PASSED** when:
- [ ] `/lan-scan` probes the subnet
- [ ] Working LAN hosts are registered
- [ ] LAN models appear in `/models`
- [ ] A LAN model answers a prompt
- [ ] Dead hosts are skipped without hanging

**Gate FAILED** → BUILD/11-BUGFIX.md.

---

## 6. Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| scan hangs | timeout too long | reduce to 300ms; use AbortSignal |
| no hosts found | wrong subnet | verify subnet detection; allow manual CIDR override |
| models not in picker | provider not merged | ensure `lan.json` merged at startup |
| LAN model slow | network latency | expected; assign LAN to non-interactive roles |
| firewall blocks | host firewall | open port on host; test with curl |

---

## 7. Handoff

Gate passed → **BUILD/08-PLUGINS.md**.

Log in `BUILD/LOG.md`:
```
## Phase 07 — PASSED
- Date: <date>
- LAN hosts found: <n>
- Providers registered: <list>
```

# Setup Guide — Anubis

Get Anubis running in 10 minutes.

---

## Prerequisites

- **bun** runtime: `curl -fsSL https://bun.sh | bash`
- **Node 18+** (for some providers): `node --version`
- **One API key** from:
  - Ollama Cloud (free tier)
  - OpenAI (ChatGPT)
  - Google (Gemini)
  - Anthropic (Claude)
  - Z.AI (GLM)
  - Ollama local (no key needed)

---

## Step 1: Clone & Enter

```bash
git clone <repo> anubis
cd anubis
```

---

## Step 2: Environment Setup

```bash
cp .env.example .env
```

Edit `.env`:
```bash
# Option A: Use Ollama Cloud (recommended for quick start)
OLLAMA_API_KEY=your-ollama-cloud-key-here
OLLAMA_BASE_URL=https://ollama.com/v1

# Option B: Use local Ollama (free, no key)
# First: brew install ollama && ollama serve
# Then uncomment:
# OLLAMA_LOCAL_URL=http://localhost:11434
```

Get your Ollama Cloud key: https://ollama.com/auth → copy API key → paste into .env

---

## Step 3: Verify Installation

```bash
bun run start --version
```

Expected output: `Anubis 1.0.0-anubis.1`

---

## Step 4: Run Tests

```bash
bun test
```

All 91 tests should pass.

---

## Step 5: Start Anubis

```bash
bun run start
```

You should see a TUI (Terminal User Interface) with a prompt.

---

## Step 6: Check Roles

Type:
```
/roles
```

Output shows all 8 role→model assignments:
```
ROLE        MODEL                          SOURCE
anubis      ollama-cloud/glm-5.2          config
thoth       ollama-cloud/glm-5.2          config
ptah        ollama-cloud/glm-5.2          config
maat        ollama-cloud/gemma4:31b       config
sekhmet     ollama-cloud/deepseek-v4-pro  config
isis        ollama-cloud/glm-5.2          config
seshat      ollama-cloud/gemma4:31b       config
horus       ollama-cloud/gemma4:31b       config
```

---

## Step 7: Try Your First MOA

Type:
```
/moa "write a hello world in TypeScript"
```

Watch Anubis:
1. Spawn all 4 default roles (thoth, ptah, maat, sekhmet) **in parallel**
2. Each role gets its assigned model
3. Aggregate results into one coherent answer

Expected runtime: 10-30 seconds (depends on provider latency).

---

## Step 8: Check Cost

Type:
```
/cost
```

See tokens used per model and total session cost.

---

## Troubleshooting

### "Module not found"
```bash
bun install
```

### "OLLAMA_API_KEY not set"
Edit `.env` and add your key, then restart:
```bash
bun run start
```

### "Provider unreachable"
Check:
- Internet connection
- API key is valid (test in browser: https://api.ollama.com/)
- Firewall not blocking

### "Tests fail"
Some tests require live provider access. If provider is down, retry:
```bash
bun test tests/ci  # skip live tests
```

---

## Next Steps

1. **Read [ROLES.md](./ROLES.md)** — understand each role
2. **Read [PROVIDERS.md](./PROVIDERS.md)** — explore 75+ providers
3. **Try `/pipeline`** — sequential execution mode
4. **Configure anubis.json** — customize role→model assignments
5. **Add more providers** via `/models` or `/connect`

---

## Advanced Setup

### Local Ollama (free, no API key)

```bash
# macOS
brew install ollama
ollama serve &

# Linux
curl https://ollama.ai/install.sh | sh
ollama serve &

# Pull a model
ollama pull gemma:latest
ollama pull neural-chat

# Update .env
OLLAMA_LOCAL_URL=http://localhost:11434/v1
```

Then assign to roles:
```jsonc
{
  "agent": {
    "maat": { "model": "ollama/gemma:latest" },
    "horus": { "model": "ollama/neural-chat" }
  }
}
```

### LAN Models (discover on your network)

```
/lan-scan
```

Anubis will:
1. Scan your local network for Ollama, LM Studio, llama.cpp
2. Report found hosts and models
3. Optionally add to config

### Multiple Providers (cloud + local)

Edit `anubis.json`:
```jsonc
{
  "model": "anthropic/claude-sonnet-4-5",  // default (cloud)
  "agent": {
    "anubis": { "model": "anthropic/claude-sonnet-4-5" },
    "thoth": { "model": "google/gemini-2.5-pro" },
    "ptah": { "model": "anthropic/claude-sonnet-4-5" },
    "maat": { "model": "ollama/gemma:latest" },  // local = free!
    "sekhmet": { "model": "zai/glm-5.2" },
    "horus": { "model": "ollama/gemma:latest" }   // local = free!
  }
}
```

Result: Heavy reasoning on Claude, cheap critique on GLM, free review on local Gemma → **60% cost savings**.

---

Done! Ready to use Anubis. See [README.md](../README.md) for next steps.

# Providers Guide — Anubis

Setup instructions and copy-paste configs for all major AI providers.

---

## Quick Reference

| Provider | Free | Cheap | Quality | Copy-Paste |
|---|---|---|---|---|
| **Ollama Cloud** | ✅ (trial) | ✅ | 🌟🌟🌟 | [below](#ollama-cloud) |
| **Ollama Local** | ✅ | ✅ | 🌟🌟 | [below](#ollama-local) |
| **Anthropic Claude** | ❌ | ❌ | 🌟🌟🌟🌟 | [below](#anthropic) |
| **Google Gemini** | ✅ (trial) | ✅ | 🌟🌟🌟 | [below](#google) |
| **OpenAI GPT** | ❌ | ❌ | 🌟🌟🌟 | [below](#openai) |
| **Z.AI (GLM)** | ❌ | ✅ | 🌟🌟🌟 | [below](#zai) |
| **LM Studio Local** | ✅ | ✅ | 🌟🌟 | [below](#lm-studio) |
| **llama.cpp Local** | ✅ | ✅ | 🌟🌟 | [below](#llamacpp) |
| **Deepseek** | ❌ | ✅ | 🌟🌟🌟 | [below](#deepseek) |
| **Groq** | ✅ (trial) | ✅ | 🌟🌟 | [below](#groq) |

---

## Ollama Cloud

**Best for:** Starting out, good balance of speed and price, no setup needed.

### Get Key

1. Go to https://ollama.com/auth
2. Sign up or log in
3. Copy your API key

### Add to .env
```bash
OLLAMA_API_KEY=your-key-here
OLLAMA_BASE_URL=https://ollama.com/v1
```

### Add to anubis.json
```jsonc
{
  "provider": {
    "ollama-cloud": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama Cloud",
      "options": {
        "baseURL": "https://ollama.com/v1",
        "apiKey": "{env:OLLAMA_API_KEY}"
      },
      "models": {
        "glm-5.2": { "name": "GLM 5.2 (Ollama Cloud)" },
        "deepseek-v4-pro": { "name": "DeepSeek V4 Pro" },
        "gemma4:31b": { "name": "Gemma 4 31B" },
        "nemotron-3-ultra": { "name": "Nemotron 3 Ultra" }
      }
    }
  },
  "agent": {
    "anubis": { "model": "ollama-cloud/glm-5.2" },
    "ptah": { "model": "ollama-cloud/glm-5.2" }
  }
}
```

### Cost
- GLM 5.2: $0.60 per 1M input tokens (5x cheaper than Claude)
- DeepSeek V4 Pro: $0.75 per 1M input tokens
- Gemma 4: free tier available

---

## Ollama Local

**Best for:** Zero cost, instant response, offline mode.

### Install

**macOS:**
```bash
brew install ollama
ollama serve &
```

**Linux:**
```bash
curl https://ollama.ai/install.sh | sh
ollama serve &
```

**Windows:**
Download from https://ollama.ai

### Pull Models
```bash
ollama pull gemma:latest          # 5B params, very fast
ollama pull neural-chat           # 7B, good quality
ollama pull mistral               # 7B, coding-focused
ollama pull qwen3-coder:30b       # 30B, best code quality
```

### Add to anubis.json
```jsonc
{
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama (local)",
      "options": {
        "baseURL": "http://localhost:11434/v1"
      },
      "models": {
        "gemma:latest": { "name": "Gemma (local, 5B)" },
        "neural-chat": { "name": "Neural Chat (local, 7B)" },
        "mistral": { "name": "Mistral (local, 7B)" },
        "qwen3-coder:30b": { "name": "Qwen3 Coder (local, 30B)" }
      }
    }
  },
  "agent": {
    "maat": { "model": "ollama/gemma:latest" },
    "seshat": { "model": "ollama/neural-chat" },
    "horus": { "model": "ollama/gemma:latest" }
  }
}
```

### Cost
**FREE.** All local models are 100% free. Use them for review, testing, and quick tasks.

---

## Anthropic (Claude)

**Best for:** Best-in-class reasoning, implementation, long context.

### Get Key

1. Go to https://console.anthropic.com
2. Create account or log in
3. Navigate to API keys → Create key
4. Copy the key

### Add to .env
```bash
ANTHROPIC_API_KEY=sk-ant-...
```

### Add to anubis.json
```jsonc
{
  "provider": {
    "anthropic": {
      "npm": "@ai-sdk/anthropic",
      "name": "Anthropic (Claude)",
      "options": {
        "apiKey": "{env:ANTHROPIC_API_KEY}"
      },
      "models": {
        "claude-sonnet-4-5": { "name": "Claude Sonnet 4.5 (balanced)" },
        "claude-opus-4-5": { "name": "Claude Opus 4.5 (most capable)" },
        "claude-haiku-4-5": { "name": "Claude Haiku 4.5 (fast, cheap)" }
      }
    }
  },
  "agent": {
    "anubis": { "model": "anthropic/claude-sonnet-4-5" },
    "thoth": { "model": "anthropic/claude-sonnet-4-5" },
    "ptah": { "model": "anthropic/claude-sonnet-4-5" }
  }
}
```

### Pricing
- Sonnet 4.5: $3/M in, $15/M out (best value for most tasks)
- Opus 4.5: $15/M in, $75/M out (most capable, expensive)
- Haiku 4.5: $0.80/M in, $4/M out (fast, cheap)

### When to Use
- **thoth**: Claude Opus for deep reasoning
- **ptah**: Claude Sonnet for complex coding
- **maat**: Claude Haiku for fast reviews (cheaper)

---

## Google (Gemini)

**Best for:** Fast, cheap, good at reasoning and coding.

### Get Key

1. Go to https://aistudio.google.com
2. Click "Get API key" → "Create API key in Google Cloud"
3. Copy the key

### Add to .env
```bash
GOOGLE_GENERATIVE_AI_API_KEY=your-key-here
```

### Add to anubis.json
```jsonc
{
  "provider": {
    "google": {
      "npm": "@ai-sdk/google",
      "name": "Google (Gemini)",
      "options": {
        "apiKey": "{env:GOOGLE_GENERATIVE_AI_API_KEY}"
      },
      "models": {
        "gemini-2.5-pro": { "name": "Gemini 2.5 Pro (best)" },
        "gemini-2.5-flash": { "name": "Gemini 2.5 Flash (fast, cheap)" }
      }
    }
  },
  "agent": {
    "sekhmet": { "model": "google/gemini-2.5-pro" },
    "isis": { "model": "google/gemini-2.5-flash" }
  }
}
```

### Pricing
- Gemini 2.5 Pro: $1.25/M in, $10/M out
- Gemini 2.5 Flash: $0.075/M in, $0.3/M out (great for quick tasks!)

### When to Use
- **Fast thinking**: Gemini Flash (2x faster than Claude)
- **Quality review**: Gemini Pro (better than Flash on complex code)

---

## OpenAI (GPT)

**Best for:** Large ecosystem, ChatGPT Plus subscribers, strong reasoning.

### Get Key

1. Go to https://platform.openai.com
2. Login or create account
3. API keys → Create new secret key
4. Copy the key

### Add to .env
```bash
OPENAI_API_KEY=sk-...
```

### Add to anubis.json
```jsonc
{
  "provider": {
    "openai": {
      "npm": "@ai-sdk/openai",
      "name": "OpenAI (GPT)",
      "options": {
        "apiKey": "{env:OPENAI_API_KEY}"
      },
      "models": {
        "gpt-5": { "name": "GPT-5 (upcoming)" },
        "o3-mini": { "name": "o3-mini (reasoning, cheap)" },
        "gpt-4-turbo": { "name": "GPT-4 Turbo" }
      }
    }
  },
  "agent": {
    "thoth": { "model": "openai/o3-mini" }
  }
}
```

### Pricing
- o3-mini: $1.10/M in, $4.4/M out (best for reasoning)
- GPT-4 Turbo: ~$10/M in, ~$30/M out

---

## Z.AI (GLM)

**Best for:** Best Chinese LLM, cheap, great coding, multi-language.

### Get Key

1. Go to https://z.ai (or provider registration)
2. Create account and generate API key
3. Copy the key

### Add to .env
```bash
ZAI_API_KEY=your-key-here
```

### Add to anubis.json
```jsonc
{
  "provider": {
    "zai": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Z.AI (GLM)",
      "options": {
        "baseURL": "https://api.z.ai/v1",
        "apiKey": "{env:ZAI_API_KEY}"
      },
      "models": {
        "glm-5.2": { "name": "GLM 5.2 (best quality)" },
        "glm-4.6": { "name": "GLM 4.6 (faster, cheaper)" }
      }
    }
  },
  "agent": {
    "anubis": { "model": "zai/glm-5.2" }
  }
}
```

### Pricing
- GLM 5.2: $0.6/M in, $2.2/M out (5x cheaper than Claude Opus!)
- GLM 4.6: even cheaper

### When to Use
- **Default for most tasks**: Budget-conscious teams
- **ptah (coder)**: Great at implementation, competitive with Claude

---

## LM Studio

**Best for:** Desktop GUI, easy model management, local development.

### Install

Download from https://lmstudio.ai

### Pull Models

1. Open LM Studio
2. Search for and download:
   - `neural-chat` (7B, fast)
   - `mistral` (7B, coding-focused)
   - `qwen3-coder:30b` (30B, best code)

### Start Server

1. LM Studio → Local Server tab
2. Select model → Start server
3. Note the port (default 1234)

### Add to anubis.json
```jsonc
{
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio (local)",
      "options": {
        "baseURL": "http://localhost:1234/v1"
      },
      "models": {
        "neural-chat": { "name": "Neural Chat (LM Studio)" },
        "mistral": { "name": "Mistral (LM Studio)" }
      }
    }
  },
  "agent": {
    "maat": { "model": "lmstudio/neural-chat" }
  }
}
```

### Cost
**FREE.** Best for local development.

---

## llama.cpp

**Best for:** Minimal dependency, runs on CPU/GPU, most portable.

### Install

```bash
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
make
```

### Download Model

```bash
wget https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/mistral-7b-instruct-v0.2.Q4_K_M.gguf
```

### Start Server

```bash
./server -m mistral-7b-instruct-v0.2.Q4_K_M.gguf -ngl 32 --port 8080
```

### Add to anubis.json
```jsonc
{
  "provider": {
    "llamacpp": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "llama.cpp (local)",
      "options": {
        "baseURL": "http://localhost:8080/v1"
      },
      "models": {
        "mistral": { "name": "Mistral (llama.cpp)" }
      }
    }
  },
  "agent": {
    "horus": { "model": "llamacpp/mistral" }
  }
}
```

### Cost
**FREE.** Most efficient on consumer hardware.

---

## Deepseek

**Best for:** Competitive with Claude, fast reasoning, cheap.

### Get Key

1. Go to https://platform.deepseek.com
2. Create account → API keys
3. Copy the key

### Add to .env
```bash
DEEPSEEK_API_KEY=sk-...
```

### Add to anubis.json
```jsonc
{
  "provider": {
    "deepseek": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Deepseek",
      "options": {
        "baseURL": "https://api.deepseek.com/v1",
        "apiKey": "{env:DEEPSEEK_API_KEY}"
      },
      "models": {
        "deepseek-chat": { "name": "Deepseek Chat" },
        "deepseek-coder": { "name": "Deepseek Coder (best for code)" }
      }
    }
  },
  "agent": {
    "ptah": { "model": "deepseek/deepseek-coder" }
  }
}
```

### Pricing
- Chat: $0.14/M in, $0.28/M out
- Coder: $0.14/M in, $0.28/M out

---

## Groq

**Best for:** Ultra-fast (20+ tokens/sec), free tier, real-time inference.

### Get Key

1. Go to https://console.groq.com
2. Create account → API keys
3. Copy the key

### Add to .env
```bash
GROQ_API_KEY=gsk_...
```

### Add to anubis.json
```jsonc
{
  "provider": {
    "groq": {
      "npm": "@ai-sdk/groq",
      "name": "Groq (fast!)",
      "options": {
        "apiKey": "{env:GROQ_API_KEY}"
      },
      "models": {
        "mixtral-8x7b-32768": { "name": "Mixtral 8x7B (fast)" },
        "llama2-70b-4096": { "name": "Llama 2 70B (capable)" }
      }
    }
  },
  "agent": {
    "horus": { "model": "groq/mixtral-8x7b-32768" }
  }
}
```

### Pricing
- **Free tier**: 30 requests/minute (great for quick tasks)
- Paid: $0.27/M in, $0.27/M out (cheap and fast)

---

## Recommended Team Setup (balanced cost + quality)

```jsonc
{
  "model": "zai/glm-5.2",  // Default: cheap, good quality
  "agent": {
    "anubis": { "model": "anthropic/claude-sonnet-4-5" },  // Orchestration: best reasoning
    "thoth": { "model": "anthropic/claude-sonnet-4-5" },   // Planning: best reasoning
    "ptah": { "model": "anthropic/claude-sonnet-4-5" },    // Coding: best quality
    "maat": { "model": "ollama/gemma:latest" },            // Review: local = FREE
    "sekhmet": { "model": "zai/glm-5.2" },                 // Critique: cheap, good
    "isis": { "model": "google/gemini-2.5-flash" },        // Research: fast, cheap
    "seshat": { "model": "ollama/neural-chat" },           // Docs: local = FREE
    "horus": { "model": "groq/mixtral-8x7b-32768" }        // Quick tasks: fast, free tier
  }
}
```

**Result:**
- High-quality main tasks on Claude
- Free local models for reviews
- Cheap alternatives for critique and research
- **~60% cost savings vs. all-Claude**

---

## Testing Providers

Test any provider:
```bash
/connect <provider>
```

Then:
```bash
/moa "write hello world"
```

If it works, add to `anubis.json` permanently.

---

Done! Pick your providers, paste configs, and scale your AI team.

# Roles Guide — Anubis

Understanding the 8 role agents and how to assign models to them.

---

## The 8 Roles

### Anubis (Orchestrator)

**Function:** Main agent. Understands user intent, decides which roles to invoke, aggregates results.

**Permissions:**
- Read/write code
- Execute bash
- Invoke subagents
- Fetch web
- Load skills

**Temperature:** 0.3 (deterministic, stable)

**Best Models:**
- `anthropic/claude-sonnet-4-5` (balanced reasoning + speed)
- `anthropic/claude-opus-4-5` (maximum capability, expensive)
- `zai/glm-5.2` (cheap, good reasoning)

**When to upgrade model:**
- Tasks are complex (use Opus)
- You need best-possible reasoning (use Opus)

**When to downgrade:**
- Latency matters (use GLM or Haiku)
- Budget tight (use Haiku)

**Example assignment:**
```jsonc
{
  "agent": {
    "anubis": { "model": "anthropic/claude-sonnet-4-5" }
  }
}
```

---

### Thoth (Planning & Reasoning)

**Function:** Breaks problems into steps, identifies risks, designs solutions.

**Permissions:**
- Read-only (cannot edit files)
- No bash
- Can fetch web
- Can load skills

**Temperature:** 0.1 (low, logical, precise)

**Best Models:**
- `anthropic/claude-opus-4-5` (deep reasoning)
- `google/gemini-2.5-pro` (fast reasoning)
- `openai/o3-mini` (reasoning with computation time)

**When to use this role:**
- Architecture decisions
- Complex multi-step problems
- Risk analysis
- Planning before coding

**Example:**
```bash
/moa "plan a migration from REST to GraphQL"
# thoth will analyze, plan steps, identify risks
```

**Model assignment:**
```jsonc
{
  "agent": {
    "thoth": { "model": "anthropic/claude-opus-4-5" }
  }
}
```

---

### Ptah (Implementation/Coding)

**Function:** Writes code. Implements features. Full permissions.

**Permissions:**
- Read/write code
- Execute bash
- Can load skills
- Can invoke subagents (for testing)

**Temperature:** 0.2 (moderate, deliberate)

**Best Models:**
- `anthropic/claude-sonnet-4-5` (best code quality)
- `deepseek/deepseek-coder` (specialized for code, cheaper)
- `zai/glm-5.2` (good coding, cheap)

**When to use this role:**
- Writing features
- Refactoring
- Creating tests
- Any code generation

**Example:**
```bash
/moa "implement a REST API endpoint for creating users"
# ptah will write the code
```

**Model assignment:**
```jsonc
{
  "agent": {
    "ptah": { "model": "anthropic/claude-sonnet-4-5" }
  }
}
```

---

### Maat (Diagnosis & Bug Hunting)

**Function:** Finds bugs, diagnoses crashes, hunts root causes. Read-only, analytical.

**Permissions:**
- Read-only (cannot edit)
- No bash (observes only)
- Can load skills

**Temperature:** 0.1 (low, logical, precise)

**Best Models:**
- `ollama/gemma:latest` (free local, surprisingly good at analysis)
- `google/gemini-2.5-flash` (fast, cheap analysis)
- `anthropic/claude-haiku-4-5` (cheap, capable)

**Cost Strategy:** This is **ideal for local/LAN models** because maat only reads. Use free!

**When to use this role:**
- Debugging crashes
- Code review
- Finding performance issues
- Security analysis (read-only)

**Example:**
```bash
/moa "debug this: the API returns 500 on line 42 of server.ts"
# maat will analyze, find root cause
```

**Model assignment (SAVE MONEY HERE):**
```jsonc
{
  "agent": {
    "maat": { "model": "ollama/gemma:latest" }  // FREE!
  }
}
```

---

### Sekhmet (Adversarial Review)

**Function:** Attacks code from every angle. Finds security issues, edge cases, performance traps. Read-only.

**Permissions:**
- Read-only
- No bash
- Can load skills

**Temperature:** 0.2 (low-moderate, adversarial)

**Best Models:**
- `anthropic/claude-sonnet-4-5` (best at finding problems)
- `zai/glm-5.2` (good adversarial thinking, cheap)
- `google/gemini-2.5-pro` (strong analysis)

**When to use this role:**
- Security review (before shipping)
- Performance audit
- Edge case analysis
- "What could break this?"

**Example:**
```bash
/pipeline "fix the auth bug"
# ... ptah writes code ...
# sekhmet audits for security issues
```

**Model assignment:**
```jsonc
{
  "agent": {
    "sekhmet": { "model": "zai/glm-5.2" }  // Cheap but capable
  }
}
```

---

### Isis (Research & Web)

**Function:** Fetches info, researches solutions, gathers context. Can access web.

**Permissions:**
- Read-only files
- Web fetch / MCP tools
- No bash

**Temperature:** 0.3 (moderate, exploratory)

**Best Models:**
- `google/gemini-2.5-flash` (fast research)
- `zai/glm-5.2` (good reasoning, cheap)
- `groq/mixtral-8x7b-32768` (fast, free tier)

**Cost Strategy:** Ideal for fast, cheap models because speed matters for research.

**When to use this role:**
- "What's the latest Node.js best practice?"
- Finding examples on GitHub
- Gathering context for decisions

**Example:**
```bash
/moa "plan a migration to WebAssembly — research first"
# isis gathers context, thoth plans based on research
```

**Model assignment:**
```jsonc
{
  "agent": {
    "isis": { "model": "google/gemini-2.5-flash" }  // Fast!
  }
}
```

---

### Seshat (Documentation)

**Function:** Writes docs, README, inline comments. No bash execution.

**Permissions:**
- Write docs/README
- Read-only code
- No bash

**Temperature:** 0.3 (moderate, clear)

**Best Models:**
- `ollama/neural-chat` (free local, decent writing)
- `anthropic/claude-haiku-4-5` (cheap, good English)
- `zai/glm-5.2` (good writing, cheap)

**Cost Strategy:** Can use local for documentation (fast enough).

**When to use this role:**
- Writing README
- Creating API docs
- Inline comments
- User guides

**Example:**
```bash
/pipeline "implement feature X then document"
# ... ptah codes ...
# seshat documents
```

**Model assignment:**
```jsonc
{
  "agent": {
    "seshat": { "model": "ollama/neural-chat" }  // FREE!
  }
}
```

---

### Horus (Fast/Cheap Quick Tasks)

**Function:** Quick, lightweight tasks. Fast turnaround. Full permissions but 4-step limit.

**Permissions:**
- Read/write code
- Execute bash
- Can load skills
- **Limited to 4 steps** (prevents runaway)

**Temperature:** 0.3 (moderate, creative)

**Best Models:**
- `ollama/gemma:latest` (free, fast)
- `groq/mixtral-8x7b-32768` (free tier, ultra-fast)
- `google/gemini-2.5-flash` (cheap, fast)

**Cost Strategy:** **Always use cheap/free models here.** No time for reasoning.

**When to use this role:**
- Quick syntax checks
- One-liner fixes
- Format conversions
- Fast summaries

**Example:**
```bash
/moa "fix this typo: print(helo)"
# horus: Quick fix, done in 1 step
```

**Model assignment:**
```jsonc
{
  "agent": {
    "horus": { "model": "groq/mixtral-8x7b-32768" }  // Free tier!
  }
}
```

---

## Role Assignment Strategies

### Strategy 1: Budget (60% savings)
```jsonc
{
  "model": "zai/glm-5.2",  // Default cheap model
  "agent": {
    "anubis": { "model": "anthropic/claude-sonnet-4-5" },  // Main task
    "thoth": { "model": "zai/glm-5.2" },                    // Reasoning (cheap)
    "ptah": { "model": "zai/glm-5.2" },                     // Coding (cheap)
    "maat": { "model": "ollama/gemma:latest" },             // Review (free)
    "sekhmet": { "model": "zai/glm-5.2" },                  // Critique (cheap)
    "isis": { "model": "google/gemini-2.5-flash" },         // Research (cheap)
    "seshat": { "model": "ollama/neural-chat" },            // Docs (free)
    "horus": { "model": "ollama/gemma:latest" }             // Quick (free)
  }
}
```
**Cost per MOA:** ~$0.05 (vs $0.30 all-Claude)

### Strategy 2: Quality (40% more cost, best results)
```jsonc
{
  "agent": {
    "anubis": { "model": "anthropic/claude-opus-4-5" },    // Best reasoning
    "thoth": { "model": "anthropic/claude-opus-4-5" },     // Best planning
    "ptah": { "model": "anthropic/claude-sonnet-4-5" },    // Best coding
    "maat": { "model": "anthropic/claude-haiku-4-5" },     // Cheap review
    "sekhmet": { "model": "anthropic/claude-sonnet-4-5" }, // Quality critique
    "isis": { "model": "google/gemini-2.5-pro" },          // Good research
    "seshat": { "model": "anthropic/claude-haiku-4-5" },   // Decent docs
    "horus": { "model": "anthropic/claude-haiku-4-5" }     // Quick tasks
  }
}
```
**Cost per MOA:** ~$0.15

### Strategy 3: Mixed (balanced, recommended)
```jsonc
{
  "agent": {
    "anubis": { "model": "anthropic/claude-sonnet-4-5" },  // Good orchestration
    "thoth": { "model": "anthropic/claude-sonnet-4-5" },   // Quality reasoning
    "ptah": { "model": "anthropic/claude-sonnet-4-5" },    // Quality coding
    "maat": { "model": "ollama/gemma:latest" },            // Free review
    "sekhmet": { "model": "zai/glm-5.2" },                 // Cheap critique
    "isis": { "model": "google/gemini-2.5-flash" },        // Fast research
    "seshat": { "model": "ollama/neural-chat" },           // Free docs
    "horus": { "model": "groq/mixtral-8x7b-32768" }        // Free quick
  }
}
```
**Cost per MOA:** ~$0.08 (RECOMMENDED)

---

## Assigning Models

### Option 1: anubis.json (persistent, recommended)
```jsonc
{
  "agent": {
    "ptah": { "model": "anthropic/claude-sonnet-4-5" }
  }
}
```
Save and commit to git. This is your team config.

### Option 2: CLI flag (session-wide)
```bash
anubis --model anthropic/claude-sonnet-4-5
# All roles use this model (unless overridden in anubis.json)
```

### Option 3: Environment variable
```bash
export ANUBIS_MODEL=anthropic/claude-sonnet-4-5
anubis
```

### Option 4: Runtime picker
```bash
anubis
# Then in TUI:
/models
# Pick model for each role interactively
```

**Priority (highest to lowest):**
1. `--model` flag
2. `agent.<role>.model` in anubis.json
3. `/models` picker
4. Global default in anubis.json

---

## Performance Baseline

Average response times with recommended mixed strategy:

| Role | Model | Typical Time | Cost |
|---|---|---|---|
| anubis | Claude Sonnet | 5-8s | $0.010 |
| thoth | Claude Sonnet | 8-15s | $0.015 |
| ptah | Claude Sonnet | 10-20s | $0.025 |
| maat | Gemma local | 1-3s | $0.000 |
| sekhmet | GLM | 5-10s | $0.008 |
| isis | Gemini Flash | 2-4s | $0.002 |
| seshat | Neural Chat | 2-5s | $0.000 |
| horus | Groq | 0.5-1s | $0.000 |

**Total MOA time:** ~20-40 seconds  
**Total cost:** ~$0.06-0.12

---

## Debugging Role Issues

### Role doesn't respond
```bash
/roles
# Check: is the role's model reachable?
# Check: does the model have tool-calling enabled?
```

### Role is too slow
Try cheaper model:
```jsonc
{
  "agent": {
    "slow_role": { "model": "google/gemini-2.5-flash" }
  }
}
```

### Role doesn't understand task
Upgrade model:
```jsonc
{
  "agent": {
    "confused_role": { "model": "anthropic/claude-opus-4-5" }
  }
}
```

### Role makes mistakes
Add sekhmet review:
```bash
/pipeline "task" @sekhmet
# sekhmet will audit the output
```

---

Done! You now understand roles and how to assign models. See [README.md](../README.md) for next steps.

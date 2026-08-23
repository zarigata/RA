# Troubleshooting Guide — Anubis

Common issues and how to fix them.

---

## Installation & Setup

### "Module not found" / "Cannot find module"

**Cause:** Dependencies not installed.

**Fix:**
```bash
cd anubis
bun install
bun run start
```

### "OLLAMA_API_KEY not set"

**Cause:** .env file missing or incomplete.

**Fix:**
```bash
cp .env.example .env
# Edit .env and add your API key
bun run start
```

### "bun: command not found"

**Cause:** bun not installed.

**Fix:**
```bash
curl -fsSL https://bun.sh | bash
# Add to PATH as suggested by installer
bun --version
```

---

## Provider & Authentication

### "401 Unauthorized" / "Invalid API key"

**Cause:** Wrong or expired API key.

**Fix:**
1. Verify key is correct (copy from provider dashboard again)
2. Check for trailing/leading spaces in .env
3. Test key independently:
   ```bash
   curl -H "Authorization: Bearer $YOUR_KEY" https://api.provider.com/models
   ```
4. Regenerate key if expired

### "404 Not Found" / "Provider not found"

**Cause:** Wrong base URL or provider no longer exists.

**Fix:**
1. Verify provider URL in .env or anubis.json
2. Test connectivity:
   ```bash
   curl https://api.provider.com/v1/models
   ```
3. Check documentation for current endpoint

### "Network error" / "Connection refused"

**Cause:** Provider unreachable (network issue, firewall, wrong URL).

**Fix:**
1. Check internet connection: `ping 8.8.8.8`
2. Check firewall: `sudo lsof -i :port` (if local)
3. Verify URL is correct in config
4. Retry: providers may have temporary outages

### "SSL certificate error"

**Cause:** Certificate validation issue (rare).

**Fix:**
```bash
# Only if absolutely necessary (not recommended for production):
NODE_TLS_REJECT_UNAUTHORIZED=0 bun run start
```

---

## Roles & Model Assignment

### "Role X not responding"

**Cause:** Role's assigned model is unreachable or misconfigured.

**Fix:**
```bash
/roles
# Check: is the model listed? Is it available?
# If model is wrong, update anubis.json:

{
  "agent": {
    "role": { "model": "working-model/name" }
  }
}
```

### "Task incomplete" / "Role gave bad output"

**Cause:** Model is underpowered for the task.

**Fix:**
Upgrade to a more capable model:
```jsonc
{
  "agent": {
    "problematic_role": { "model": "anthropic/claude-opus-4-5" }
  }
}
```

### "Role is too slow"

**Cause:** Model is overqualified or remote.

**Fix:**
Use a faster, cheaper model:
```jsonc
{
  "agent": {
    "slow_role": { "model": "google/gemini-2.5-flash" }
  }
}
```

---

## Execution (MOA & Pipeline)

### "/moa command not recognized"

**Cause:** Plugin not loaded.

**Fix:**
1. Verify plugins are in `.anubis/plugins/`
2. Restart: `bun run start`
3. Check logs for plugin load errors

### "MOA runs roles sequentially, not parallel"

**Cause:** SDK version doesn't support parallel execution.

**Fix:**
This is still correct, just slower. No action needed. For parallel execution, ensure:
```jsonc
{
  "moa": { "parallel": true }
}
```

### "/pipeline hangs or doesn't finish"

**Cause:** One stage timed out or failed.

**Fix:**
1. Check if a role is stuck (watch logs)
2. Increase timeout in config
3. Try with fewer stages:
   ```bash
   /pipeline "task" @thoth @ptah @seshat
   ```

### "Task lost after /moa or /pipeline"

**Cause:** Output wasn't saved.

**Fix:**
1. Copy output manually or
2. Redirect to file:
   ```bash
   /moa "task" > output.txt
   ```

---

## Cost & Token Tracking

### "/cost shows no data"

**Cause:** No tokens tracked (no models ran).

**Fix:**
Run a task first:
```bash
/moa "test"
/cost
```

### "Cost seems wrong"

**Cause:** Model not in price table or usage wasn't captured.

**Fix:**
Check if model is in `src/cost.ts` price table. If not, add it:
```ts
const PRICE_TABLE: Record<string, ModelPrice> = {
  "your-provider/model": { in: 0.5, out: 2.0 },
};
```

---

## LAN & Local Models

### "/lan-scan finds nothing"

**Cause:** No LAN servers running or wrong subnet.

**Fix:**
1. Start Ollama/LM Studio/llama.cpp locally:
   ```bash
   ollama serve &
   ```
2. Manually add to config:
   ```jsonc
   {
     "provider": {
       "ollama": {
         "options": { "baseURL": "http://localhost:11434/v1" }
       }
     }
   }
   ```

### "LAN models timeout"

**Cause:** Network latency or scan timeout too short.

**Fix:**
Increase LAN scan timeout:
```bash
export ANUBIS_LAN_SCAN_TIMEOUT=500
bun run start
```

### "Local Ollama won't start"

**Cause:** Model too large for RAM.

**Fix:**
Use smaller model:
```bash
ollama pull gemma:latest    # 5B, very small
ollama run gemma:latest
```

---

## Tests

### "Tests fail with 'Cannot connect to provider'"

**Cause:** Live provider unreachable during tests.

**Fix:**
Run offline tests only:
```bash
bun test tests/ci
```

Or skip live tests:
```bash
bun test -- --skip "live|integration"
```

### "Specific test hangs"

**Cause:** Test timeout too short or infinite loop.

**Fix:**
Increase timeout:
```bash
bun test --timeout 30000
```

Or run specific test:
```bash
bun test tests/aggregator.test.ts
```

---

## Performance & Debugging

### "Anubis is slow"

**Cause:** Network latency, large context, or waiting for all roles.

**Fix:**
1. Check model latency:
   ```bash
   /cost
   # Look for Duration column
   ```
2. Use faster model:
   ```bash
   /models
   # Pick a faster provider
   ```
3. Use fewer roles in MOA:
   ```bash
   /moa "task" @thoth @ptah
   # Skip slow roles
   ```

### "CPU/memory spike"

**Cause:** Local model too large or context too big.

**Fix:**
1. Stop local model: `ollama kill`
2. Use cloud model instead
3. Reduce context with `/dcp` (dynamic context pruning)

### "How do I see debug logs?"

**Enable debug mode:**
```bash
export ANUBIS_DEBUG=true
bun run start
```

---

## Configuration

### "Configuration not loading"

**Cause:** anubis.json has syntax error or wrong location.

**Fix:**
1. Validate JSON:
   ```bash
   jq . anubis.json
   ```
2. Ensure file is at: `anubis/anubis.json`
3. Restart: `bun run start`

### "Changes to anubis.json not taking effect"

**Cause:** Config cached or restart needed.

**Fix:**
1. Restart Anubis: `bun run start`
2. Or use `/models` picker for runtime changes

---

## Common Error Messages

### "Cannot read property 'model' of undefined"
→ Role not found in config. Check spelling.

### "fetch failed: ECONNREFUSED"
→ Provider unreachable. Check URL and internet.

### "Error: Invalid CIDR notation"
→ Subnet format wrong. Use: `192.168.1.0/24`

### "Rate limit exceeded"
→ Too many requests. Wait 1 minute, then retry.

### "Model context length exceeded"
→ Input too large. Use `/dcp` to truncate.

---

## Still Stuck?

1. **Check logs:** `ANUBIS_DEBUG=true bun run start`
2. **Test provider directly:** `curl -H "Authorization: Bearer $KEY" https://api.provider.com/v1/models`
3. **Read provider docs:** Each provider has specific requirements
4. **Post issue:** Include error message, anubis version, OS, and logs

---

Done! If not listed, check provider documentation or open an issue.

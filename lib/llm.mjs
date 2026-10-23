// lib/llm.mjs
// -----------------------------------------------------------------------------
// Provider chain for content generation. Tries, in order:
//   1. Local Ollama (your 3070 Ti)            OLLAMA_URL, OLLAMA_MODEL
//   2. Any OpenAI-compatible free tier         Groq / Gemini / OpenRouter keys
//   3. null  -> caller falls back to templates
// No SDKs, just fetch. Configure via .env (see .env.example).
//
// 3070 Ti = 8 GB VRAM. Good fits: llama3.1:8b, qwen2.5:7b, mistral:7b,
// gemma2:9b (q4). 13B+ models will spill to CPU and crawl.
// -----------------------------------------------------------------------------

const env = process.env;

function providers() {
  const list = [];
  if (env.OLLAMA_DISABLED !== '1') {
    list.push({
      name: `ollama:${env.OLLAMA_MODEL || 'llama3.1:8b'}`,
      async call(system, prompt) {
        const res = await fetch(`${env.OLLAMA_URL || 'http://localhost:11434'}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: env.OLLAMA_MODEL || 'llama3.1:8b',
            stream: false,
            options: { temperature: 0.7, num_ctx: 8192 },
            messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }]
          }),
          signal: AbortSignal.timeout(Number(env.OLLAMA_TIMEOUT_MS || 300000))
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()).message?.content;
      }
    });
  }
  // OpenAI-compatible endpoints. Model names change often — override in .env.
  const compat = [
    ['groq', env.GROQ_API_KEY, 'https://api.groq.com/openai/v1', env.GROQ_MODEL || 'llama-3.3-70b-versatile'],
    ['gemini', env.GEMINI_API_KEY, 'https://generativelanguage.googleapis.com/v1beta/openai', env.GEMINI_MODEL || 'gemini-2.5-flash'],
    ['openrouter', env.OPENROUTER_API_KEY, 'https://openrouter.ai/api/v1', env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free']
  ];
  for (const [name, key, base, model] of compat) {
    if (!key) continue;
    list.push({
      name: `${name}:${model}`,
      async call(system, prompt) {
        const res = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model, temperature: 0.7,
            messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }]
          }),
          signal: AbortSignal.timeout(120000)
        });
        if (res.status === 429) throw new Error('rate limited (free tier)');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()).choices?.[0]?.message?.content;
      }
    });
  }
  return list;
}

const dead = new Set(); // providers that failed this run (don't retry every page)

/** Returns { text, provider } or null if every provider failed/unavailable. */
export async function generate(system, prompt, { quiet = false } = {}) {
  for (const p of providers()) {
    if (dead.has(p.name)) continue;
    try {
      const text = await p.call(system, prompt);
      if (text && text.trim().length > 200) return { text: cleanup(text), provider: p.name };
      throw new Error('empty/short response');
    } catch (e) {
      if (!quiet) console.warn(`  ! ${p.name} failed: ${e.message}`);
      // Connection refused = Ollama not running. Rate limit = move on.
      dead.add(p.name);
    }
  }
  return null;
}

/** Strip chatty preambles and code fences models like to add. */
function cleanup(text) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/, '')
    .replace(/^(sure|here is|here's|certainly)[^\n]*\n+/i, '')
    .replace(/^#\s+[^\n]*\n+/, '') // the page renders its own H1
    .trim();
}

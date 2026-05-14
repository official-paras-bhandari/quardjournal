function envValue(...names) {
  return names
    .map((name) => process.env[name]?.trim())
    .find((value) => value && !/^your_.+_here$/i.test(value));
}

export function aiConfig() {
  const provider = (process.env.AI_PROVIDER ?? "deepseek").toLowerCase();
  const providerDefaults = {
    deepseek: {
      baseUrl: process.env.AI_BASE_URL ?? process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      apiKey: envValue("AI_API_KEY", "DEEPSEEK_API_KEY", "deepseek"),
      model: envValue("AI_MODEL", "DEEPSEEK_MODEL") ?? "deepseek-v4-flash"
    },
    openai: {
      baseUrl: process.env.AI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      apiKey: envValue("AI_API_KEY", "OPENAI_API_KEY"),
      model: envValue("AI_MODEL", "OPENAI_MODEL") ?? "gpt-4.1-mini"
    },
    compatible: {
      baseUrl: process.env.AI_BASE_URL ?? process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      apiKey: envValue("AI_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_API_KEY", "deepseek"),
      model: envValue("AI_MODEL", "DEEPSEEK_MODEL", "OPENAI_MODEL") ?? "deepseek-v4-flash"
    }
  };
  const config = providerDefaults[provider] ?? providerDefaults.compatible;
  return { provider, ...config };
}

export function requireAiKey(res) {
  const config = aiConfig();
  if (!config.apiKey) {
    res.status(503).json({ error: "AI API key is not configured. Set AI_API_KEY or the provider-specific key." });
    return null;
  }
  return config;
}

export async function askModel(messages, options = {}) {
  const config = aiConfig();
  if (!config.apiKey) throw new Error("AI API key is not configured");

  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: options.model ?? config.model,
      temperature: options.temperature ?? 0.25,
      max_tokens: options.maxTokens ?? 900,
      messages
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${config.provider} returned ${response.status}: ${body.slice(0, 240)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "No analysis returned.";
}

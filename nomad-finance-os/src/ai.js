function mapCategoriesForPrompt(categoriesMap) {
  return Object.entries(categoriesMap)
    .filter(([, cfg]) => cfg.active)
    .map(([l1, cfg]) => ({
      l1,
      l2: cfg.l2.filter((x) => x.active).map((x) => x.name)
    }));
}

function extractJsonFromText(text) {
  const content = String(text || "").trim();
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(content.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createAgentConfigError() {
  const error = new Error(
    "AI agent is not configured. Set NOMAD_AGENT_API_KEY (or OPENAI_API_KEY) on the server."
  );
  error.code = "AI_AGENT_NOT_CONFIGURED";
  return error;
}

function getAgentConfig() {
  const apiKey = String(process.env.NOMAD_AGENT_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return null;
  const baseUrl = String(process.env.NOMAD_AGENT_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1")
    .trim()
    .replace(/\/+$/, "");
  const model = String(process.env.NOMAD_AGENT_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
  return {
    apiKey,
    baseUrl,
    model: model || "gpt-4o-mini"
  };
}

async function parseAgentError(response) {
  let payload = null;
  let rawText = "";
  try {
    rawText = await response.text();
  } catch {
    rawText = "";
  }
  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = null;
    }
  }
  const message =
    payload?.error?.message ||
    payload?.message ||
    (typeof payload?.error === "string" ? payload.error : "") ||
    rawText ||
    "";
  const code = payload?.error?.code || payload?.code || payload?.error?.type || "";
  const retryAfterHeader = response.headers?.get?.("retry-after");
  const retryAfterSec = Number.parseInt(retryAfterHeader || "", 10);
  return {
    message: String(message || "").trim(),
    code: String(code || "").trim(),
    retryAfterSec: Number.isFinite(retryAfterSec) ? retryAfterSec : null
  };
}

async function parseWithAgent(config, { text, imageBase64 }, { categories, accounts }) {
  const schemaHint = {
    type: "expense|income|transfer",
    date: "YYYY-MM-DD",
    amount_original: 123.45,
    currency_original: "USD",
    category_l1: "Living",
    category_l2: "Groceries",
    account_from_id: 1,
    account_to_id: 2,
    transfer_reason: "normal|deposit_lock|deposit_release",
    note: "short note",
    tags: ["tag-a", "tag-b"],
    confidence: 0.0
  };
  const prompt = [
    "You are a finance parser. Return JSON only, no markdown.",
    "Normalize currency aliases (e.g. baht/泰铢/บาท => THB, 人民币/元 => CNY).",
    "For daily Chinese phrasing, infer intent from verbs like 花了/买了/收到/转账.",
    "If user text mentions travel/tourism spend (旅游/旅行/trip), prefer Lifestyle/Entertainment unless explicit transport or hotel terms exist.",
    `Allowed categories: ${JSON.stringify(mapCategoriesForPrompt(categories))}`,
    `Known accounts: ${JSON.stringify(accounts.map((a) => ({ id: a.id, name: a.name, type: a.type })))}`,
    `Output schema example: ${JSON.stringify(schemaHint)}`,
    "Few-shot examples:",
    'Input: "旅游花了10000泰铢" -> {"type":"expense","amount_original":10000,"currency_original":"THB"}',
    'Input: "收到项目款 800 USDT" -> {"type":"income","amount_original":800,"currency_original":"USDT"}',
    'Input: "Wise -> Thai Bank 500 USD" -> {"type":"transfer","amount_original":500,"currency_original":"USD"}',
    `Text: ${text || "(empty)"}`
  ].join("\n");

  const userContent =
    imageBase64 && !text
      ? [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageBase64 } }
        ]
      : prompt;

  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        messages: [
          { role: "system", content: "Return strict JSON object only." },
          { role: "user", content: userContent }
        ]
      })
    });

    if (response.ok) {
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content || "";
      const parsed = extractJsonFromText(content);
      if (!parsed) {
        throw new Error("AI response is not valid JSON.");
      }
      return parsed;
    }

    const agentError = await parseAgentError(response);
    const code = agentError.code.toLowerCase();
    const quotaExhausted =
      response.status === 429 &&
      (code.includes("insufficient_quota") ||
        code.includes("billing_hard_limit_reached") ||
        agentError.message.toLowerCase().includes("insufficient_quota"));
    const retryableRateLimit = response.status === 429 && !quotaExhausted;

    if (retryableRateLimit && attempt < maxRetries) {
      const backoffMs = agentError.retryAfterSec
        ? agentError.retryAfterSec * 1000
        : 500 * 2 ** attempt + Math.floor(Math.random() * 250);
      await delay(backoffMs);
      continue;
    }

    if (quotaExhausted) {
      throw new Error(
        "AI call failed (429): quota exhausted. Check OpenAI billing/project budget and retry."
      );
    }
    if (retryableRateLimit) {
      throw new Error("AI call failed (429): rate limit exceeded. Please wait a few seconds and retry.");
    }

    let detail = `AI call failed (${response.status}).`;
    if (agentError.message) {
      detail = `AI call failed (${response.status}): ${agentError.message.slice(0, 240)}`;
    }
    throw new Error(detail);
  }

  throw new Error("AI call failed (429): rate limit exceeded.");
}

async function buildExtractionDraft({ text, imageBase64, categories, accounts }) {
  if ((!text || !String(text).trim()) && !imageBase64) {
    throw new Error("No text or image payload provided for AI parsing.");
  }
  const config = getAgentConfig();
  if (!config) {
    throw createAgentConfigError();
  }
  const draft = await parseWithAgent(config, { text, imageBase64 }, { categories, accounts });
  return {
    draft,
    fallback_used: false,
    error_message: ""
  };
}

module.exports = {
  buildExtractionDraft
};

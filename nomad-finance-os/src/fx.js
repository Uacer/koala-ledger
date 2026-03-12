const FALLBACK_USD_RATES = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  THB: 35.5,
  RMB: 7.2,
  CNY: 7.2,
  SGD: 1.34,
  JPY: 148,
  KRW: 1365,
  USDT: 1
};

const EXCHANGERATE_HOST_KEY = String(
  process.env.EXCHANGERATE_HOST_ACCESS_KEY || process.env.EXCHANGERATE_HOST_API_KEY || ""
).trim();

function normalizeCurrency(currency) {
  const raw = String(currency || "USD").trim();
  const upper = raw.toUpperCase();
  const aliasMap = {
    BAHT: "THB",
    THAIBAHT: "THB",
    "泰铢": "THB",
    "บาท": "THB",
    CNH: "CNY",
    RMB: "CNY",
    "人民币": "CNY",
    "人民幣": "CNY",
    "元": "CNY",
    "美元": "USD",
    "美金": "USD",
    "欧元": "EUR",
    "英镑": "GBP",
    "日元": "JPY",
    "韩元": "KRW",
    "韓元": "KRW",
    WON: "KRW",
    "원": "KRW",
    "新币": "SGD",
    "新元": "SGD"
  };
  return aliasMap[upper] || aliasMap[raw] || upper;
}

function fallbackFxRate(from, to) {
  const f = normalizeCurrency(from);
  const t = normalizeCurrency(to);
  if (f === t) return 1;
  const fToUsd = 1 / (FALLBACK_USD_RATES[f] || 1);
  const usdToT = FALLBACK_USD_RATES[t] || 1;
  return Number((fToUsd * usdToT).toFixed(8));
}

async function fetchFxRate(from, to) {
  const f = normalizeCurrency(from);
  const t = normalizeCurrency(to);
  if (f === t) {
    return { rate: 1, source: "identity" };
  }

  if (EXCHANGERATE_HOST_KEY) {
    try {
      return await fetchFromExchangeRateHostLive(f, t, EXCHANGERATE_HOST_KEY);
    } catch {
      // continue to next provider
    }
  }

  try {
    return await fetchFromFrankfurter(f, t);
  } catch {
    // continue to next provider
  }

  try {
    return await fetchFromExchangeRateHostLegacy(f, t);
  } catch {
    return { rate: fallbackFxRate(f, t), source: "fallback_static" };
  }
}

async function fetchFromExchangeRateHostLive(from, to, accessKey) {
  const url = `https://api.exchangerate.host/live?access_key=${encodeURIComponent(
    accessKey
  )}&source=${encodeURIComponent(from)}&currencies=${encodeURIComponent(to)}`;
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`FX provider failed: ${response.status}`);
  }
  const payload = await response.json();
  if (!payload?.success) {
    throw new Error(payload?.error?.info || "Invalid FX payload from exchangerate.host/live.");
  }
  const quoteKey = `${from}${to}`;
  const rate = Number(payload?.quotes?.[quoteKey]);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Invalid FX rate from exchangerate.host/live.");
  }
  return { rate: Number(rate.toFixed(8)), source: "exchangerate.host_live" };
}

async function fetchFromFrankfurter(from, to) {
  const url = `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(
    from
  )}&symbols=${encodeURIComponent(to)}`;
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`FX provider failed: ${response.status}`);
  }
  const payload = await response.json();
  const rate = Number(payload?.rates?.[to]);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Invalid FX rate from frankfurter.");
  }
  return { rate: Number(rate.toFixed(8)), source: "frankfurter" };
}

async function fetchFromExchangeRateHostLegacy(from, to) {
  const url = `https://api.exchangerate.host/latest?base=${encodeURIComponent(
    from
  )}&symbols=${encodeURIComponent(to)}`;
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`FX provider failed: ${response.status}`);
  }
  const payload = await response.json();
  if (payload?.success === false) {
    throw new Error(payload?.error?.info || "Invalid FX payload from exchangerate.host/latest.");
  }
  const rate = Number(payload?.rates?.[to]);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Invalid FX rate from exchangerate.host/latest.");
  }
  return { rate: Number(rate.toFixed(8)), source: "exchangerate.host_latest" };
}

module.exports = {
  normalizeCurrency,
  fetchFxRate,
  fallbackFxRate
};

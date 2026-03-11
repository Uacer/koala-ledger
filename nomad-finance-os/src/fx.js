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

  try {
    const url = `https://api.exchangerate.host/latest?base=${encodeURIComponent(
      f
    )}&symbols=${encodeURIComponent(t)}`;
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) {
      throw new Error(`FX provider failed: ${response.status}`);
    }
    const payload = await response.json();
    const rate = Number(payload?.rates?.[t]);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error("Invalid FX rate from provider.");
    }
    return { rate: Number(rate.toFixed(8)), source: "exchangerate.host" };
  } catch {
    return { rate: fallbackFxRate(f, t), source: "fallback_static" };
  }
}

module.exports = {
  normalizeCurrency,
  fetchFxRate,
  fallbackFxRate
};

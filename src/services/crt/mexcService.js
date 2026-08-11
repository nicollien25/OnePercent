const SPOT_BASE_URL = process.env.MEXC_SPOT_BASE_URL || 'https://api.mexc.com';
const FUTURES_BASE_URL = process.env.MEXC_FUTURES_BASE_URL || 'https://api.mexc.com';

const INTERVALS = {
  '5m': { spot: '5m', futures: 'Min5' },
  '15m': { spot: '15m', futures: 'Min15' },
  '30m': { spot: '30m', futures: 'Min30' },
  '1h': { spot: '60m', futures: 'Min60' },
  '4h': { spot: '4h', futures: 'Hour4' },
  '1d': { spot: '1d', futures: 'Day1' },
};

function assertTimeframe(timeframe) {
  if (!INTERVALS[timeframe]) throw new Error(`Unsupported MEXC timeframe: ${timeframe}`);
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.MEXC_HTTP_TIMEOUT_MS || 10000));
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`MEXC returned non-JSON (${response.status})`); }
    if (!response.ok) throw new Error(`MEXC HTTP ${response.status}: ${JSON.stringify(data)}`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSpotKlines(rows) {
  return rows.map((row) => ({
    openTime: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    closeTime: Number(row[6]),
    closed: Number(row[6]) <= Date.now(),
  }));
}

function normalizeFuturesKlines(data, timeframe) {
  const times = data?.time || [];
  const opens = data?.open || [];
  const highs = data?.high || [];
  const lows = data?.low || [];
  const closes = data?.close || [];
  const vols = data?.vol || [];
  const intervalMs = { '5m': 5 * 60_000, '15m': 15 * 60_000, '30m': 30 * 60_000, '1h': 60 * 60_000, '4h': 4 * 60 * 60_000, '1d': 24 * 60 * 60_000 }[timeframe];

  return times.map((time, i) => {
    const openTime = Number(time) * 1000;
    const closeTime = openTime + intervalMs - 1;
    return {
      openTime,
      open: Number(opens[i]),
      high: Number(highs[i]),
      low: Number(lows[i]),
      close: Number(closes[i]),
      volume: Number(vols[i] || 0),
      closeTime,
      closed: closeTime <= Date.now(),
    };
  });
}

export async function getSpotKlines(symbol, timeframe, limit = 100) {
  assertTimeframe(timeframe);
  const params = new URLSearchParams({ symbol, interval: INTERVALS[timeframe].spot, limit: String(Math.min(limit, 1000)) });
  const data = await requestJson(`${SPOT_BASE_URL}/api/v3/klines?${params}`);
  if (!Array.isArray(data)) throw new Error(`Unexpected spot kline response for ${symbol}`);
  return normalizeSpotKlines(data);
}

export async function getFuturesKlines(symbol, timeframe, limit = 100) {
  assertTimeframe(timeframe);
  const interval = INTERVALS[timeframe].futures;
  const params = new URLSearchParams({ interval });
  const data = await requestJson(`${FUTURES_BASE_URL}/api/v1/contract/kline/${encodeURIComponent(symbol)}?${params}`);
  if (!data?.success || !data?.data) throw new Error(`Unexpected futures kline response for ${symbol}`);
  return normalizeFuturesKlines(data.data, timeframe);
}

export async function getKlines({ market, symbol, timeframe, limit = 100 }) {
  return market === 'futures'
    ? getFuturesKlines(symbol, timeframe, limit)
    : getSpotKlines(symbol, timeframe, limit);
}

export async function getSpotSymbols() {
  const data = await requestJson(`${SPOT_BASE_URL}/api/v3/exchangeInfo`);
  const symbols = Array.isArray(data?.symbols) ? data.symbols : [];
  return symbols
    .filter((s) => s.status === 'ENABLED' || s.isSpotTradingAllowed === true)
    .map((s) => s.symbol)
    .filter(Boolean);
}

export async function getFuturesContracts() {
  const data = await requestJson(`${FUTURES_BASE_URL}/api/v1/contract/detail`);
  if (!data?.success || !Array.isArray(data?.data)) throw new Error('Unexpected futures contract response');
  return data.data
    .filter((c) => c?.symbol && c?.quoteCoin)
    .map((c) => ({ symbol: c.symbol, baseCoin: c.baseCoin, quoteCoin: c.quoteCoin, apiAllowed: c.apiAllowed }));
}

export function getConfiguredSymbols(market) {
  const key = market === 'futures' ? 'MEXC_FUTURES_SYMBOLS' : 'MEXC_SPOT_SYMBOLS';
  return String(process.env[key] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export { INTERVALS };

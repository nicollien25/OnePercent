// ============================================================
// PDYN MEXC MARKET DATA SERVICE
// ============================================================
//
// PURPOSE:
//
//   Provide normalized MEXC candle data to the CRT system.
//
// MARKET:
//
//   MEXC FUTURES ONLY for CRT.
//
// IMPORTANT:
//
//   MEXC Futures candle timestamps are treated as the
//   authoritative exchange candle OPEN timestamps.
//
//   Candle CLOSE is calculated from:
//
//       openTime + timeframe duration - 1ms
//
//   NO Asia/Manila offset is applied.
//
//   NO local wall-clock candle calculation is used.
//
//   This keeps:
//
//       5m
//       15m
//       30m
//       1h
//       4h
//       1d
//
//   aligned to the actual MEXC Futures candle boundaries.
//
// ============================================================

// ============================================================
// BASE URL
// ============================================================

const FUTURES_BASE_URL =
  process.env.MEXC_FUTURES_BASE_URL ||
  'https://api.mexc.com';

const SPOT_BASE_URL =
  process.env.MEXC_SPOT_BASE_URL ||
  'https://api.mexc.com';

// ============================================================
// TIMEFRAME DEFINITIONS
// ============================================================
//
// MEXC Futures API interval names:
//
//   5m  -> Min5
//   15m -> Min15
//   30m -> Min30
//   1h  -> Min60
//   4h  -> Hour4
//   1d  -> Day1
//
// These are the exchange/API intervals.
//
// The left side is what crtService.js / crtEngine.js use.
// The right side is what MEXC Futures receives.
//
// ============================================================

const INTERVALS = {
  '5m': {
    futures: 'Min5',
    spot: '5m',
    ms: 5 * 60 * 1000,
  },

  '15m': {
    futures: 'Min15',
    spot: '15m',
    ms: 15 * 60 * 1000,
  },

  '30m': {
    futures: 'Min30',
    spot: '30m',
    ms: 30 * 60 * 1000,
  },

  '1h': {
    futures: 'Min60',
    spot: '60m',
    ms: 60 * 60 * 1000,
  },

  '4h': {
    futures: 'Hour4',
    spot: '4h',
    ms: 4 * 60 * 60 * 1000,
  },

  '1d': {
    futures: 'Day1',
    spot: '1d',
    ms: 24 * 60 * 60 * 1000,
  },
};

// ============================================================
// SUPPORTED TIMEFRAMES
// ============================================================

const SUPPORTED_TIMEFRAMES = [
  '5m',
  '15m',
  '30m',
  '1h',
  '4h',
  '1d',
];

// ============================================================
// ASSERT TIMEFRAME
// ============================================================

function assertTimeframe(timeframe) {
  if (
    !INTERVALS[
      timeframe
    ]
  ) {
    throw new Error(
      `Unsupported MEXC timeframe: ${timeframe}`
    );
  }
}

// ============================================================
// HTTP TIMEOUT
// ============================================================

const HTTP_TIMEOUT_MS =
  Math.max(
    3000,
    Number(
      process.env.MEXC_HTTP_TIMEOUT_MS ||
      10000
    )
  );

// ============================================================
// REQUEST JSON
// ============================================================

async function requestJson(
  url,
  options = {}
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      HTTP_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        url,
        {
          ...options,
          signal:
            controller.signal,
        }
      );

    const text =
      await response.text();

    let data;

    try {
      data =
        JSON.parse(
          text
        );
    } catch {
      throw new Error(
        `MEXC returned non-JSON response ` +
        `(${response.status})`
      );
    }

    if (
      !response.ok
    ) {
      throw new Error(
        `MEXC HTTP ${response.status}: ` +
        JSON.stringify(data)
      );
    }

    return data;

  } finally {
    clearTimeout(
      timeout
    );
  }
}

// ============================================================
// NUMBER HELPER
// ============================================================

function toFiniteNumber(
  value,
  fallback = 0
) {
  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : fallback;
}

// ============================================================
// NORMALIZE TIMESTAMP
// ============================================================
//
// MEXC Futures returns candle timestamps in seconds.
//
// Internally PDYN uses milliseconds.
//
// This helper protects against accidental millisecond
// timestamps as well.
//
// ============================================================

function normalizeTimestamp(
  value
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(
      number
    ) ||
    number <= 0
  ) {
    return NaN;
  }

  // MEXC Futures normally returns seconds.
  //
  // If a millisecond timestamp somehow arrives,
  // keep it in milliseconds.

  if (
    number < 100000000000
  ) {
    return number * 1000;
  }

  return number;
}

// ============================================================
// CALCULATE CANDLE BOUNDARY
// ============================================================
//
// IMPORTANT:
//
// This is NOT calculated from Manila time.
//
// It is calculated directly from the MEXC candle's
// exchange-provided OPEN timestamp.
//
// Example:
//
// 15m candle:
//
// open = 08:00:00.000
// close boundary = 08:15:00.000
//
// Therefore the candle is closed when:
//
// Date.now() >= 08:15:00.000
//
// The stored closeTime is:
//
// 08:14:59.999
//
// ============================================================

function getCandleBoundary(
  openTime,
  timeframe
) {
  assertTimeframe(
    timeframe
  );

  const intervalMs =
    INTERVALS[
      timeframe
    ].ms;

  const closeBoundary =
    openTime +
    intervalMs;

  const closeTime =
    closeBoundary - 1;

  return {
    openTime,
    closeTime,
    closeBoundary,
    intervalMs,
  };
}

// ============================================================
// CLOSED CHECK
// ============================================================
//
// We intentionally use the exact close BOUNDARY:
//
//     now >= closeBoundary
//
// rather than relying on a local timezone.
//
// ============================================================

function isCandleClosed(
  openTime,
  timeframe,
  now = Date.now()
) {
  const boundary =
    getCandleBoundary(
      openTime,
      timeframe
    );

  return (
    now >=
    boundary.closeBoundary
  );
}

// ============================================================
// NORMALIZE FUTURES KLINES
// ============================================================
//
// MEXC Futures response:
//
//   {
//      time: [],
//      open: [],
//      high: [],
//      low: [],
//      close: [],
//      vol: []
//   }
//
// Each array uses the same index.
//
// ============================================================

function normalizeFuturesKlines(
  data,
  timeframe
) {
  assertTimeframe(
    timeframe
  );

  const times =
    Array.isArray(
      data?.time
    )
      ? data.time
      : [];

  const opens =
    Array.isArray(
      data?.open
    )
      ? data.open
      : [];

  const highs =
    Array.isArray(
      data?.high
    )
      ? data.high
      : [];

  const lows =
    Array.isArray(
      data?.low
    )
      ? data.low
      : [];

  const closes =
    Array.isArray(
      data?.close
    )
      ? data.close
      : [];

  const volumes =
    Array.isArray(
      data?.vol
    )
      ? data.vol
      : [];

  const now =
    Date.now();

  const candles = [];

  for (
    let i = 0;
    i < times.length;
    i++
  ) {
    const openTime =
      normalizeTimestamp(
        times[i]
      );

    if (
      !Number.isFinite(
        openTime
      )
    ) {
      continue;
    }

    const boundary =
      getCandleBoundary(
        openTime,
        timeframe
      );

    const open =
      toFiniteNumber(
        opens[i],
        NaN
      );

    const high =
      toFiniteNumber(
        highs[i],
        NaN
      );

    const low =
      toFiniteNumber(
        lows[i],
        NaN
      );

    const close =
      toFiniteNumber(
        closes[i],
        NaN
      );

    const volume =
      toFiniteNumber(
        volumes[i],
        0
      );

    // --------------------------------------------------------
    // Reject malformed candles.
    // --------------------------------------------------------

    if (
      !Number.isFinite(
        open
      ) ||
      !Number.isFinite(
        high
      ) ||
      !Number.isFinite(
        low
      ) ||
      !Number.isFinite(
        close
      )
    ) {
      continue;
    }

    // --------------------------------------------------------
    // Store normalized MEXC Futures candle.
    // --------------------------------------------------------

    candles.push({
      openTime:
        boundary.openTime,

      open,

      high,

      low,

      close,

      volume,

      closeTime:
        boundary.closeTime,

      // Exact boundary used by the service.
      closeBoundary:
        boundary.closeBoundary,

      // True ONLY after the exchange candle's calculated
      // boundary has passed.
      closed:
        now >=
        boundary.closeBoundary,

      timeframe,

      intervalMs:
        boundary.intervalMs,
    });
  }

  // ----------------------------------------------------------
  // Ensure chronological ordering.
  // ----------------------------------------------------------

  candles.sort(
    (
      a,
      b
    ) =>
      a.openTime -
      b.openTime
  );

  return candles;
}

// ============================================================
// NORMALIZE SPOT KLINES
//
// Kept for compatibility with other parts of the project.
//
// CRT SERVICE MUST NOT USE THIS.
//
// ============================================================

function normalizeSpotKlines(
  rows
) {
  if (
    !Array.isArray(
      rows
    )
  ) {
    return [];
  }

  const now =
    Date.now();

  return rows
    .map(
      (
        row
      ) => {
        const openTime =
          normalizeTimestamp(
            row?.[0]
          );

        const closeTime =
          normalizeTimestamp(
            row?.[6]
          );

        return {
          openTime,

          open:
            toFiniteNumber(
              row?.[1],
              NaN
            ),

          high:
            toFiniteNumber(
              row?.[2],
              NaN
            ),

          low:
            toFiniteNumber(
              row?.[3],
              NaN
            ),

          close:
            toFiniteNumber(
              row?.[4],
              NaN
            ),

          volume:
            toFiniteNumber(
              row?.[5],
              0
            ),

          closeTime,

          closeBoundary:
            closeTime,

          closed:
            Number.isFinite(
              closeTime
            ) &&
            closeTime <=
              now,
        };
      }
    )
    .filter(
      (
        candle
      ) =>
        Number.isFinite(
          candle.openTime
        ) &&
        Number.isFinite(
          candle.open
        ) &&
        Number.isFinite(
          candle.high
        ) &&
        Number.isFinite(
          candle.low
        ) &&
        Number.isFinite(
          candle.close
        )
    );
}

// ============================================================
// GET MEXC FUTURES KLINES
// ============================================================
//
// THIS IS THE PRIMARY FUNCTION USED BY CRT SERVICE.
//
// ============================================================

export async function getFuturesKlines(
  symbol,
  timeframe,
  limit = 100
) {
  assertTimeframe(
    timeframe
  );

  const safeLimit =
    Math.min(
      Math.max(
        1,
        Number(limit) || 100
      ),
      1000
    );

  const interval =
    INTERVALS[
      timeframe
    ].futures;

  const params =
    new URLSearchParams({
      interval,
    });

  // ----------------------------------------------------------
  // MEXC Futures contract kline endpoint.
  // ----------------------------------------------------------

  const url =
    `${FUTURES_BASE_URL}` +
    `/api/v1/contract/kline/` +
    `${encodeURIComponent(symbol)}` +
    `?${params.toString()}`;

  const data =
    await requestJson(
      url
    );

  if (
    !data?.success ||
    !data?.data
  ) {
    throw new Error(
      `Unexpected MEXC Futures kline response ` +
      `for ${symbol} ${timeframe}`
    );
  }

  const candles =
    normalizeFuturesKlines(
      data.data,
      timeframe
    );

  // ----------------------------------------------------------
  // MEXC normally returns the latest candles.
  //
  // Keep the requested number after normalization.
  // ----------------------------------------------------------

  return candles
    .slice(
      -safeLimit
    );
}

// ============================================================
// GET NORMALIZED KLINES
// ============================================================
//
// CRT SERVICE calls:
//
//   getKlines({
//      market: 'futures',
//      symbol,
//      timeframe,
//      limit
//   })
//
// ============================================================

export async function getKlines({
  market,
  symbol,
  timeframe,
  limit = 100,
}) {
  // ----------------------------------------------------------
  // HARD LOCK
  //
  // CRT system is MEXC FUTURES ONLY.
  //
  // ----------------------------------------------------------

  if (
    market !==
    'futures'
  ) {
    throw new Error(
      `PDYN CRT only supports MEXC Futures. ` +
      `Received market: ${market}`
    );
  }

  return getFuturesKlines(
    symbol,
    timeframe,
    limit
  );
}

// ============================================================
// GET SPOT KLINES
//
// Compatibility only.
//
// CRT SERVICE DOES NOT CALL THIS.
//
// ============================================================

export async function getSpotKlines(
  symbol,
  timeframe,
  limit = 100
) {
  assertTimeframe(
    timeframe
  );

  const safeLimit =
    Math.min(
      Math.max(
        1,
        Number(limit) || 100
      ),
      1000
    );

  const params =
    new URLSearchParams({
      symbol,
      interval:
        INTERVALS[
          timeframe
        ].spot,
      limit:
        String(
          safeLimit
        ),
    });

  const url =
    `${SPOT_BASE_URL}` +
    `/api/v3/klines?` +
    `${params.toString()}`;

  const data =
    await requestJson(
      url
    );

  if (
    !Array.isArray(
      data
    )
  ) {
    throw new Error(
      `Unexpected MEXC Spot kline response ` +
      `for ${symbol}`
    );
  }

  return normalizeSpotKlines(
    data
  ).slice(
    -safeLimit
  );
}

// ============================================================
// GET FUTURES CONTRACTS
// ============================================================
//
// Returns MEXC Futures contracts.
//
// ============================================================

export async function getFuturesContracts() {
  const url =
    `${FUTURES_BASE_URL}` +
    `/api/v1/contract/detail`;

  const data =
    await requestJson(
      url
    );

  if (
    !data?.success ||
    !Array.isArray(
      data?.data
    )
  ) {
    throw new Error(
      'Unexpected MEXC Futures contract response'
    );
  }

  return data.data
    .filter(
      (
        contract
      ) =>
        contract?.symbol &&
        contract?.quoteCoin
    )
    .map(
      (
        contract
      ) => ({
        symbol:
          contract.symbol,

        baseCoin:
          contract.baseCoin,

        quoteCoin:
          contract.quoteCoin,

        apiAllowed:
          contract.apiAllowed,
      })
    );
}

// ============================================================
// GET CONFIGURED SYMBOLS
// ============================================================
//
// Futures:
//   MEXC_FUTURES_SYMBOLS
//
// Spot:
//   MEXC_SPOT_SYMBOLS
//
// CRT SERVICE uses FUTURES only.
//
// ============================================================

export function getConfiguredSymbols(
  market
) {
  const key =
    market ===
    'futures'
      ? 'MEXC_FUTURES_SYMBOLS'
      : 'MEXC_SPOT_SYMBOLS';

  return String(
    process.env[key] ||
    ''
  )
    .split(',')
    .map(
      (
        symbol
      ) =>
        symbol.trim()
    )
    .filter(
      Boolean
    );
}

// ============================================================
// TIMEFRAME HELPERS
// ============================================================
//
// These functions allow crtService.js to use the exact
// MEXC-normalized candle boundaries.
//
// ============================================================

export function getTimeframeMilliseconds(
  timeframe
) {
  assertTimeframe(
    timeframe
  );

  return INTERVALS[
    timeframe
  ].ms;
}

// ============================================================
// GET CANDLE OPEN TIME
// ============================================================
//
// Returns the exact normalized MEXC candle open time.
//
// No timezone conversion.
//
// ============================================================

export function getCandleOpenTime(
  timestamp,
  timeframe
) {
  assertTimeframe(
    timeframe
  );

  const openTime =
    normalizeTimestamp(
      timestamp
    );

  if (
    !Number.isFinite(
      openTime
    )
  ) {
    return NaN;
  }

  return openTime;
}

// ============================================================
// GET CANDLE CLOSE BOUNDARY
// ============================================================
//
// Example:
//
// 15m:
//
// 08:00:00 -> 08:15:00
// 08:15:00 -> 08:30:00
//
// 1h:
//
// 08:00:00 -> 09:00:00
//
// 4h:
//
// 08:00:00 -> 12:00:00
//
// Daily:
//
// 00:00:00 -> next 00:00:00
//
// The boundary is based on MEXC candle timestamps.
//
// ============================================================

export function getCandleCloseBoundary(
  timestamp,
  timeframe
) {
  const openTime =
    getCandleOpenTime(
      timestamp,
      timeframe
    );

  if (
    !Number.isFinite(
      openTime
    )
  ) {
    return NaN;
  }

  return (
    openTime +
    getTimeframeMilliseconds(
      timeframe
    )
  );
}

// ============================================================
// GET CANDLE CLOSE TIME
// ============================================================
//
// Stored candle closeTime:
//
//   boundary - 1ms
//
// This is useful for display.
//
// ============================================================

export function getCandleCloseTime(
  timestamp,
  timeframe
) {
  const boundary =
    getCandleCloseBoundary(
      timestamp,
      timeframe
    );

  if (
    !Number.isFinite(
      boundary
    )
  ) {
    return NaN;
  }

  return (
    boundary - 1
  );
}

// ============================================================
// IS MEXC CANDLE CLOSED
// ============================================================
//
// This is the authoritative closed-candle check.
//
// ============================================================

export function isMexcCandleClosed(
  timestamp,
  timeframe,
  now = Date.now()
) {
  const boundary =
    getCandleCloseBoundary(
      timestamp,
      timeframe
    );

  if (
    !Number.isFinite(
      boundary
    )
  ) {
    return false;
  }

  return (
    Number(now) >=
    boundary
  );
}

// ============================================================
// GET NEXT MEXC CANDLE BOUNDARY
// ============================================================
//
// Used by scheduling logic.
//
// IMPORTANT:
//
// This does NOT calculate Manila candle boundaries.
//
// It uses the actual MEXC candle open timestamp.
//
// ============================================================

export function getNextCandleBoundary(
  timestamp,
  timeframe
) {
  const boundary =
    getCandleCloseBoundary(
      timestamp,
      timeframe
    );

  if (
    !Number.isFinite(
      boundary
    )
  ) {
    return NaN;
  }

  return boundary;
}

// ============================================================
// GET CURRENT MEXC CANDLE OPEN
// ============================================================
//
// This helper is based on UNIX epoch boundaries.
//
// It is NOT based on Asia/Manila.
//
// For crypto Futures, the exchange candle boundaries are
// represented by the exchange timestamp itself.
//
// ============================================================

export function getCurrentCandleOpen(
  timeframe,
  now = Date.now()
) {
  assertTimeframe(
    timeframe
  );

  const intervalMs =
    getTimeframeMilliseconds(
      timeframe
    );

  const timestamp =
    Number(now);

  if (
    !Number.isFinite(
      timestamp
    )
  ) {
    return NaN;
  }

  return (
    Math.floor(
      timestamp /
      intervalMs
    ) *
    intervalMs
  );
}

// ============================================================
// GET CURRENT MEXC CANDLE BOUNDARY
// ============================================================

export function getCurrentCandleBoundary(
  timeframe,
  now = Date.now()
) {
  const open =
    getCurrentCandleOpen(
      timeframe,
      now
    );

  if (
    !Number.isFinite(
      open
    )
  ) {
    return NaN;
  }

  return (
    open +
    getTimeframeMilliseconds(
      timeframe
    )
  );
}

// ============================================================
// GET TIMEFRAME INFORMATION
// ============================================================
//
// Useful for diagnostics.
//
// ============================================================

export function getTimeframeInfo(
  timeframe
) {
  assertTimeframe(
    timeframe
  );

  const config =
    INTERVALS[
      timeframe
    ];

  return {
    timeframe,

    futuresInterval:
      config.futures,

    intervalMs:
      config.ms,

    intervalMinutes:
      config.ms /
      60000,
  };
}

// ============================================================
// EXPORTS
// ============================================================

export {
  INTERVALS,
  SUPPORTED_TIMEFRAMES,
  normalizeFuturesKlines,
  normalizeSpotKlines,
  isCandleClosed,
  getCandleBoundary,
};

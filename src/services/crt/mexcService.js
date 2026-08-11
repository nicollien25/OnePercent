// ============================================================
// PDYN MEXC MARKET DATA SERVICE
// ============================================================
//
// PURPOSE:
//
//   Provide normalized MEXC Futures candle data to the CRT
//   system.
//
// MARKET:
//
//   MEXC FUTURES ONLY for CRT.
//
// IMPORTANT:
//
//   MEXC Futures is the authoritative source.
//
//   Futures endpoint:
//
//      https://contract.mexc.com
//
//   Kline endpoint:
//
//      /api/v1/contract/kline/{symbol}
//
//   MEXC Futures returns candle OPEN timestamps in seconds.
//
//   PDYN converts them to milliseconds internally.
//
//   Candle boundaries are calculated from the MEXC candle
//   OPEN timestamp:
//
//      closeBoundary = openTime + timeframe duration
//
//   closeTime:
//
//      closeBoundary - 1ms
//
//   NO Asia/Manila offset is applied.
//
//   NO local wall-clock timezone conversion is applied.
//
// ============================================================

// ============================================================
// BASE URL
// ============================================================
//
// IMPORTANT:
//
// MEXC Futures uses:
//
//     https://contract.mexc.com
//
// NOT:
//
//     https://api.mexc.com
//
// ============================================================

const DEFAULT_FUTURES_BASE_URL =
  'https://contract.mexc.com';

const DEFAULT_SPOT_BASE_URL =
  'https://api.mexc.com';

const configuredFuturesBase =
  String(
    process.env.MEXC_FUTURES_BASE_URL ||
      DEFAULT_FUTURES_BASE_URL
  )
    .trim()
    .replace(/\/+$/, '');

const configuredSpotBase =
  String(
    process.env.MEXC_SPOT_BASE_URL ||
      DEFAULT_SPOT_BASE_URL
  )
    .trim()
    .replace(/\/+$/, '');

// ============================================================
// HARD SAFETY
//
// If an old deployment still has:
//
// MEXC_FUTURES_BASE_URL=https://api.mexc.com
//
// automatically redirect it to the correct Futures API.
//
// ============================================================

const FUTURES_BASE_URL =
  /(^|\/\/)api\.mexc\.com$/i.test(
    configuredFuturesBase
  )
    ? DEFAULT_FUTURES_BASE_URL
    : configuredFuturesBase;

const SPOT_BASE_URL =
  configuredSpotBase;

// ============================================================
// TIMEFRAME DEFINITIONS
// ============================================================
//
// MEXC Futures intervals:
//
//   Min5
//   Min15
//   Min30
//   Min60
//   Hour4
//   Day1
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

function assertTimeframe(
  timeframe
) {
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

          headers: {
            Accept:
              'application/json',

            ...(options.headers ||
              {}),
          },
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
        `${JSON.stringify(data)}`
      );
    }

    return data;

  } catch (
    error
  ) {

    if (
      error?.name ===
      'AbortError'
    ) {
      throw new Error(
        `MEXC request timed out after ` +
        `${HTTP_TIMEOUT_MS}ms`
      );
    }

    throw error;

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
  fallback = NaN
) {
  const number =
    Number(
      value
    );

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
// MEXC Futures:
//
//     seconds
//
// PDYN internally:
//
//     milliseconds
//
// This function safely handles either.
//
// ============================================================

function normalizeTimestamp(
  value
) {
  const number =
    Number(
      value
    );

  if (
    !Number.isFinite(
      number
    ) ||
    number <= 0
  ) {
    return NaN;
  }

  // Seconds timestamp.
  if (
    number <
    100000000000
  ) {
    return (
      number *
      1000
    );
  }

  // Already milliseconds.
  return number;
}

// ============================================================
// GET CANDLE BOUNDARY
// ============================================================
//
// IMPORTANT:
//
// The candle OPEN timestamp comes directly from MEXC.
//
// Example 15m:
//
//     08:00:00.000
//             |
//             +----> 08:15:00.000 boundary
//
// Candle closeTime:
//
//     08:14:59.999
//
// ============================================================

function getCandleBoundary(
  openTime,
  timeframe
) {
  assertTimeframe(
    timeframe
  );

  const normalizedOpen =
    Number(
      openTime
    );

  if (
    !Number.isFinite(
      normalizedOpen
    )
  ) {
    return {
      openTime:
        NaN,

      closeTime:
        NaN,

      closeBoundary:
        NaN,

      intervalMs:
        INTERVALS[
          timeframe
        ].ms,
    };
  }

  const intervalMs =
    INTERVALS[
      timeframe
    ].ms;

  const closeBoundary =
    normalizedOpen +
    intervalMs;

  const closeTime =
    closeBoundary -
    1;

  return {
    openTime:
      normalizedOpen,

    closeTime,

    closeBoundary,

    intervalMs,
  };
}

// ============================================================
// CLOSED CHECK
// ============================================================
//
// A candle becomes closed at:
//
//     openTime + timeframe duration
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

  if (
    !Number.isFinite(
      boundary.closeBoundary
    )
  ) {
    return false;
  }

  return (
    Number(now) >=
    boundary.closeBoundary
  );
}

// ============================================================
// NORMALIZE MEXC FUTURES KLINES
// ============================================================
//
// Official MEXC Futures response:
//
// {
//   success: true,
//   code: 0,
//   data: {
//      time: [],
//      open: [],
//      close: [],
//      high: [],
//      low: [],
//      vol: [],
//      amount: []
//   }
// }
//
// ============================================================

function normalizeFuturesKlines(
  data,
  timeframe
) {
  assertTimeframe(
    timeframe
  );

  // ----------------------------------------------------------
  // Accept the normal MEXC object format.
  // ----------------------------------------------------------

  let source =
    data;

  // ----------------------------------------------------------
  // Defensive support if the caller passes the full
  // response object instead of data.data.
  // ----------------------------------------------------------

  if (
    source?.data &&
    !Array.isArray(
      source?.time
    )
  ) {
    source =
      source.data;
  }

  // ----------------------------------------------------------
  // MEXC Futures uses parallel arrays.
  // ----------------------------------------------------------

  const times =
    Array.isArray(
      source?.time
    )
      ? source.time
      : [];

  const opens =
    Array.isArray(
      source?.open
    )
      ? source.open
      : [];

  const highs =
    Array.isArray(
      source?.high
    )
      ? source.high
      : [];

  const lows =
    Array.isArray(
      source?.low
    )
      ? source.low
      : [];

  const closes =
    Array.isArray(
      source?.close
    )
      ? source.close
      : [];

  const volumes =
    Array.isArray(
      source?.vol
    )
      ? source.vol
      : [];

  // ----------------------------------------------------------
  // Validate that the response actually contains candles.
  // ----------------------------------------------------------

  if (
    !times.length
  ) {
    return [];
  }

  const now =
    Date.now();

  const candles =
    [];

  // ----------------------------------------------------------
  // Build normalized candles.
  // ----------------------------------------------------------

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

    const open =
      toFiniteNumber(
        opens[i]
      );

    const high =
      toFiniteNumber(
        highs[i]
      );

    const low =
      toFiniteNumber(
        lows[i]
      );

    const close =
      toFiniteNumber(
        closes[i]
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
    // Validate OHLC relationship.
    //
    // This prevents malformed API rows from entering the
    // fractal engine.
    // --------------------------------------------------------

    if (
      high <
      Math.max(
        open,
        close
      )
    ) {
      continue;
    }

    if (
      low >
      Math.min(
        open,
        close
      )
    ) {
      continue;
    }

    const boundary =
      getCandleBoundary(
        openTime,
        timeframe
      );

    // --------------------------------------------------------
    // Store normalized candle.
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

      closeBoundary:
        boundary.closeBoundary,

      closed:
        now >=
        boundary.closeBoundary,

      timeframe,

      intervalMs:
        boundary.intervalMs,
    });
  }

  // ----------------------------------------------------------
  // Chronological ordering.
  // ----------------------------------------------------------

  candles.sort(
    (
      a,
      b
    ) =>
      a.openTime -
      b.openTime
  );

  // ----------------------------------------------------------
  // Remove duplicate MEXC candle opens.
  // ----------------------------------------------------------

  const unique =
    [];

  let previousOpen =
    null;

  for (
    const candle of
    candles
  ) {
    if (
      candle.openTime ===
      previousOpen
    ) {
      continue;
    }

    unique.push(
      candle
    );

    previousOpen =
      candle.openTime;
  }

  return unique;
}

// ============================================================
// NORMALIZE SPOT KLINES
//
// Compatibility only.
//
// CRT SERVICE DOES NOT USE SPOT.
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

        const open =
          toFiniteNumber(
            row?.[1]
          );

        const high =
          toFiniteNumber(
            row?.[2]
          );

        const low =
          toFiniteNumber(
            row?.[3]
          );

        const close =
          toFiniteNumber(
            row?.[4]
          );

        const volume =
          toFiniteNumber(
            row?.[5],
            0
          );

        return {
          openTime,

          open,

          high,

          low,

          close,

          volume,

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
// PRIMARY FUNCTION USED BY CRT SERVICE.
//
// IMPORTANT:
//
// The Futures API uses:
//
//     start
//     end
//
// timestamps in SECONDS.
//
// We request enough history to cover the desired number of
// candles plus one extra candle.
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
        Number(
          limit
        ) || 100
      ),
      1000
    );

  const interval =
    INTERVALS[
      timeframe
    ].futures;

  const intervalMs =
    INTERVALS[
      timeframe
    ].ms;

  const intervalSeconds =
    Math.floor(
      intervalMs /
        1000
    );

  // ----------------------------------------------------------
  // Current UNIX time in seconds.
  // ----------------------------------------------------------

  const nowMs =
    Date.now();

  const nowSeconds =
    Math.floor(
      nowMs /
        1000
    );

  // ----------------------------------------------------------
  // Request extra history.
  //
  // Extra candles protect the engine from missing the
  // previous confirmed fractal at the edge of the dataset.
  // ----------------------------------------------------------

  const requestedSeconds =
    (
      safeLimit +
      10
    ) *
    intervalSeconds;

  const startSeconds =
    Math.max(
      0,
      nowSeconds -
        requestedSeconds
    );

  const endSeconds =
    nowSeconds;

  // ----------------------------------------------------------
  // Build MEXC Futures request.
  // ----------------------------------------------------------

  const params =
    new URLSearchParams({
      interval,

      start:
        String(
          startSeconds
        ),

      end:
        String(
          endSeconds
        ),
    });

  const url =
    `${FUTURES_BASE_URL}` +
    `/api/v1/contract/kline/` +
    `${encodeURIComponent(
      symbol
    )}` +
    `?${params.toString()}`;

  // ----------------------------------------------------------
  // Request.
  // ----------------------------------------------------------

  const response =
    await requestJson(
      url
    );

  // ----------------------------------------------------------
  // Validate MEXC envelope.
  //
  // Official success response:
  //
  // success: true
  // code: 0
  // data: {...}
  //
  // ----------------------------------------------------------

  const success =
    response?.success ===
    true;

  const code =
    Number(
      response?.code
    );

  if (
    !success ||
    (
      Number.isFinite(
        code
      ) &&
      code !== 0
    )
  ) {
    throw new Error(
      `MEXC Futures kline API error ` +
      `for ${symbol} ${timeframe}: ` +
      `${JSON.stringify(
        response
      )}`
    );
  }

  // ----------------------------------------------------------
  // Validate the actual candle data.
  // ----------------------------------------------------------

  const data =
    response?.data;

  if (
    !data ||
    typeof data !==
      'object'
  ) {
    throw new Error(
      `Unexpected MEXC Futures kline response ` +
      `for ${symbol} ${timeframe}: missing data object`
    );
  }

  // ----------------------------------------------------------
  // Normalize.
  // ----------------------------------------------------------

  const candles =
    normalizeFuturesKlines(
      data,
      timeframe
    );

  if (
    !candles.length
  ) {
    return [];
  }

  // ----------------------------------------------------------
  // Return the requested number of latest candles.
  // ----------------------------------------------------------

  return candles.slice(
    -safeLimit
  );
}

// ============================================================
// GET NORMALIZED KLINES
// ============================================================
//
// CRT SERVICE:
//
// getKlines({
//   market: 'futures',
//   symbol,
//   timeframe,
//   limit
// })
//
// ============================================================

export async function getKlines({
  market,
  symbol,
  timeframe,
  limit = 100,
}) {
  // ----------------------------------------------------------
  // HARD FUTURES-ONLY LOCK.
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

  if (
    !symbol
  ) {
    throw new Error(
      'MEXC Futures symbol is required'
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
        Number(
          limit
        ) || 100
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
// GET MEXC FUTURES CONTRACTS
// ============================================================
//
// Endpoint:
//
//     /api/v1/contract/detail
//
// ============================================================

export async function getFuturesContracts() {
  const url =
    `${FUTURES_BASE_URL}` +
    `/api/v1/contract/detail`;

  const response =
    await requestJson(
      url
    );

  const success =
    response?.success ===
    true;

  const code =
    Number(
      response?.code
    );

  if (
    !success ||
    (
      Number.isFinite(
        code
      ) &&
      code !== 0
    )
  ) {
    throw new Error(
      `MEXC Futures contract API error: ` +
      `${JSON.stringify(
        response
      )}`
    );
  }

  if (
    !Array.isArray(
      response?.data
    )
  ) {
    throw new Error(
      'Unexpected MEXC Futures contract response: data is not an array'
    );
  }

  return response.data
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

        settleCoin:
          contract.settleCoin,

        state:
          contract.state,

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
//
//     MEXC_FUTURES_SYMBOLS
//
// Spot:
//
//     MEXC_SPOT_SYMBOLS
//
// CRT uses Futures only.
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
// GET TIMEFRAME MILLISECONDS
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
// Returns the normalized MEXC candle OPEN timestamp.
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
// Stored closeTime:
//
//     boundary - 1ms
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
    boundary -
    1
  );
}

// ============================================================
// IS MEXC CANDLE CLOSED
// ============================================================
//
// Authoritative closed-candle check.
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
// This uses the provided MEXC candle OPEN timestamp.
//
// ============================================================

export function getNextCandleBoundary(
  timestamp,
  timeframe
) {
  return getCandleCloseBoundary(
    timestamp,
    timeframe
  );
}

// ============================================================
// GET CURRENT CANDLE OPEN
// ============================================================
//
// This helper is useful when scheduling.
//
// It uses UNIX epoch boundaries.
//
// No Manila offset is applied.
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
    Number(
      now
    );

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
// GET CURRENT CANDLE BOUNDARY
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
// GET NEXT CURRENT MEXC BOUNDARY
// ============================================================
//
// This returns the next boundary after `now`.
//
// Useful for scheduling:
//
//     15m
//     1h
//     4h
//     1d
//
// ============================================================

export function getNextCurrentCandleBoundary(
  timeframe,
  now = Date.now()
) {
  const currentBoundary =
    getCurrentCandleBoundary(
      timeframe,
      now
    );

  if (
    !Number.isFinite(
      currentBoundary
    )
  ) {
    return NaN;
  }

  if (
    Number(now) <
    currentBoundary
  ) {
    return currentBoundary;
  }

  return (
    currentBoundary +
    getTimeframeMilliseconds(
      timeframe
    )
  );
}

// ============================================================
// GET TIMEFRAME INFORMATION
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

    spotInterval:
      config.spot,

    intervalMs:
      config.ms,

    intervalSeconds:
      config.ms /
      1000,

    intervalMinutes:
      config.ms /
      60000,
  };
}

// ============================================================
// GET MEXC FUTURES BASE URL
//
// Diagnostic helper.
//
// ============================================================

export function getFuturesBaseUrl() {
  return FUTURES_BASE_URL;
}

// ============================================================
// SERVICE STARTUP DIAGNOSTICS
// ============================================================

console.log(
  `[MEXC] Futures API: ${FUTURES_BASE_URL}`
);

console.log(
  `[MEXC] Futures market data: ENABLED`
);

console.log(
  `[MEXC] Spot market data: COMPATIBILITY ONLY`
);

console.log(
  `[MEXC] Timeframes: ${SUPPORTED_TIMEFRAMES.join(
    ', '
  )}`
);

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

  normalizeTimestamp,
};

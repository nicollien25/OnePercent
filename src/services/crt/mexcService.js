// ============================================================
// PDYN MEXC SERVICE
// ============================================================
//
// PURPOSE:
//
//   Centralized MEXC market-data service for PDYN CRT.
//
// PRIMARY SOURCE:
//
//   MEXC FUTURES
//
// FUTURES API:
//
//   https://api.mexc.com
//
// SUPPORTED TIMEFRAMES:
//
//   5m
//   15m
//   30m
//   1h
//   4h
//   1d
//
// MEXC FUTURES INTERVALS:
//
//   Min5
//   Min15
//   Min30
//   Min60
//   Hour4
//   Day1
//
// IMPORTANT:
//
//   Candle timestamps returned by MEXC are treated as UTC
//   epoch timestamps.
//
//   The service NEVER converts candle timestamps to Manila
//   time for candle calculations.
//
//   Asia/Manila should only be used for human-readable
//   Discord display.
//
// ============================================================


// ============================================================
// BASE URL
// ============================================================

const FUTURES_BASE_URL =
  process.env.MEXC_FUTURES_BASE_URL ||
  'https://api.mexc.com';


// ============================================================
// SPOT BASE URL
//
// Kept for compatibility with existing imports.
//
// CRT itself should use futures.
// ============================================================

const SPOT_BASE_URL =
  process.env.MEXC_SPOT_BASE_URL ||
  'https://api.mexc.com';


// ============================================================
// HTTP SETTINGS
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
// RETRY SETTINGS
// ============================================================

const MAX_RETRIES =
  Math.max(
    0,
    Math.min(
      5,
      Number(
        process.env.MEXC_MAX_RETRIES ||
        2
      )
    )
  );


// ============================================================
// RETRY DELAY
// ============================================================

const RETRY_DELAY_MS =
  Math.max(
    100,
    Number(
      process.env.MEXC_RETRY_DELAY_MS ||
      500
    )
  );


// ============================================================
// MEXC INTERVAL CONFIGURATION
// ============================================================
//
// Internal PDYN timeframe
//       ↓
// MEXC Futures interval
//
// ============================================================

const INTERVALS = {

  '5m': {
    spot:
      '5m',

    futures:
      'Min5',

    milliseconds:
      5 *
      60 *
      1000,
  },

  '15m': {
    spot:
      '15m',

    futures:
      'Min15',

    milliseconds:
      15 *
      60 *
      1000,
  },

  '30m': {
    spot:
      '30m',

    futures:
      'Min30',

    milliseconds:
      30 *
      60 *
      1000,
  },

  '1h': {
    spot:
      '60m',

    futures:
      'Min60',

    milliseconds:
      60 *
      60 *
      1000,
  },

  '4h': {
    spot:
      '4h',

    futures:
      'Hour4',

    milliseconds:
      4 *
      60 *
      60 *
      1000,
  },

  '1d': {
    spot:
      '1d',

    futures:
      'Day1',

    milliseconds:
      24 *
      60 *
      60 *
      1000,
  },

};


// ============================================================
// TIMEFRAME ALIASES
// ============================================================

const TIMEFRAME_ALIASES = {

  '5':
    '5m',

  '5min':
    '5m',

  '5mins':
    '5m',

  '5minute':
    '5m',

  '5minutes':
    '5m',


  '15':
    '15m',

  '15min':
    '15m',

  '15mins':
    '15m',

  '15minute':
    '15m',

  '15minutes':
    '15m',


  '30':
    '30m',

  '30min':
    '30m',

  '30mins':
    '30m',

  '30minute':
    '30m',

  '30minutes':
    '30m',


  '60':
    '1h',

  '60m':
    '1h',

  '1hr':
    '1h',

  '1hour':
    '1h',


  '240':
    '4h',

  '240m':
    '4h',

  '4hr':
    '4h',

  '4hour':
    '4h',


  '1440':
    '1d',

  '1440m':
    '1d',

  '1day':
    '1d',

  'day':
    '1d',

  'daily':
    '1d',

};


// ============================================================
// NORMALIZE TIMEFRAME
// ============================================================

export function normalizeTimeframe(
  timeframe
) {

  const value =
    String(
      timeframe ||
      ''
    )
      .trim()
      .toLowerCase();

  return (
    TIMEFRAME_ALIASES[value] ||
    value
  );
}


// ============================================================
// ASSERT VALID TIMEFRAME
// ============================================================

function assertTimeframe(
  timeframe
) {

  const normalized =
    normalizeTimeframe(
      timeframe
    );

  if (
    !INTERVALS[
      normalized
    ]
  ) {

    throw new Error(
      `Unsupported MEXC timeframe: ${timeframe}`
    );

  }

  return normalized;
}


// ============================================================
// GET TIMEFRAME MS
// ============================================================

export function getTimeframeMs(
  timeframe
) {

  const normalized =
    assertTimeframe(
      timeframe
    );

  return (
    INTERVALS[
      normalized
    ].milliseconds
  );
}


// ============================================================
// SLEEP
// ============================================================

function sleep(
  milliseconds
) {

  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        milliseconds
      )
  );

}


// ============================================================
// HTTP REQUEST
// ============================================================
//
// Features:
//
//   • Abort timeout
//   • Retry
//   • JSON validation
//   • HTTP error handling
//   • MEXC API error handling
//
// ============================================================

async function requestJson(
  url,
  options = {}
) {

  let lastError =
    null;

  for (
    let attempt = 0;
    attempt <= MAX_RETRIES;
    attempt++
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
          `(HTTP ${response.status})`
        );

      }

      if (
        !response.ok
      ) {

        const error =
          new Error(
            `MEXC HTTP ${response.status}: ` +
            JSON.stringify(
              data
            )
          );

        error.status =
          response.status;

        error.data =
          data;

        throw error;
      }


      // ------------------------------------------------------
      // MEXC API-level failure
      // ------------------------------------------------------

      if (
        data &&
        data.success ===
        false
      ) {

        const error =
          new Error(
            `MEXC API error: ` +
            JSON.stringify(
              data
            )
          );

        error.data =
          data;

        throw error;
      }


      return data;

    } catch (
      error
    ) {

      lastError =
        error;

      const isLastAttempt =
        attempt >=
        MAX_RETRIES;

      if (
        isLastAttempt
      ) {

        break;
      }

      await sleep(
        RETRY_DELAY_MS *
        (
          attempt +
          1
        )
      );

    } finally {

      clearTimeout(
        timeout
      );

    }

  }

  throw (
    lastError ||
    new Error(
      'MEXC request failed'
    )
  );

}


// ============================================================
// SAFE NUMBER
// ============================================================

function toNumber(
  value
) {

  const number =
    Number(
      value
    );

  return Number.isFinite(
    number
  )
    ? number
    : null;
}


// ============================================================
// NORMALIZE SYMBOL
// ============================================================
//
// MEXC Futures normally uses:
//
//   BTC_USDT
//
// Configuration may contain:
//
//   BTC_USDT
//   BTCUSDT
//   BTC-USDT
//
// We preserve the configured symbol when possible but provide
// a consistent helper for comparisons.
//
// ============================================================

export function normalizeSymbol(
  symbol
) {

  return String(
    symbol ||
    ''
  )
    .trim()
    .toUpperCase()
    .replace(
      /-/g,
      '_'
    );

}


// ============================================================
// FUTURES SYMBOL FOR API
// ============================================================

function futuresApiSymbol(
  symbol
) {

  const normalized =
    normalizeSymbol(
      symbol
    );

  return normalized;

}


// ============================================================
// SPOT SYMBOL FOR API
// ============================================================

function spotApiSymbol(
  symbol
) {

  return String(
    symbol ||
    ''
  )
    .trim()
    .toUpperCase()
    .replace(
      /_/g,
      ''
    )
    .replace(
      /-/g,
      ''
    );

}


// ============================================================
// GET CANDLE OPEN TIME
// ============================================================

export function getCandleOpenTime(
  candle
) {

  if (
    !candle
  ) {
    return null;
  }

  const raw =
    candle.openTime ??
    candle.time ??
    candle.timestamp ??
    candle.ts ??
    null;

  let value =
    Number(
      raw
    );

  if (
    !Number.isFinite(
      value
    )
  ) {
    return null;
  }


  // ----------------------------------------------------------
  // Seconds → milliseconds
  // ----------------------------------------------------------

  if (
    value > 0 &&
    value <
    100000000000
  ) {

    value *=
      1000;

  }

  return value;

}


// ============================================================
// GET CANDLE CLOSE TIME
// ============================================================

export function getCandleCloseTime(
  candle,
  timeframe
) {

  if (
    !candle
  ) {
    return null;
  }

  const explicit =
    candle.closeTime ??
    candle.endTime ??
    candle.closeTimestamp ??
    null;

  if (
    explicit !==
    null &&
    explicit !==
    undefined
  ) {

    let value =
      Number(
        explicit
      );

    if (
      Number.isFinite(
        value
      )
    ) {

      if (
        value > 0 &&
        value <
        100000000000
      ) {

        value *=
          1000;

      }

      return value;

    }

  }


  const openTime =
    getCandleOpenTime(
      candle
    );

  if (
    openTime ===
    null
  ) {
    return null;
  }

  const intervalMs =
    getTimeframeMs(
      timeframe
    );

  return (
    openTime +
    intervalMs -
    1
  );

}


// ============================================================
// IS CANDLE CLOSED
// ============================================================
//
// IMPORTANT:
//
// We use the candle's actual MEXC timestamp.
//
// We do NOT determine candle closure from Manila time.
//
// ============================================================

export function isCandleClosed(
  candle,
  timeframe,
  now = Date.now()
) {

  if (
    !candle
  ) {
    return false;
  }


  // ----------------------------------------------------------
  // Explicit MEXC/service state
  // ----------------------------------------------------------

  if (
    candle.closed ===
    true
  ) {

    return true;

  }

  if (
    candle.closed ===
    false
  ) {

    return false;

  }


  const closeTime =
    getCandleCloseTime(
      candle,
      timeframe
    );

  if (
    closeTime ===
    null
  ) {

    return false;

  }

  return (
    closeTime <=
    now
  );

}


// ============================================================
// VALID OHLC
// ============================================================

function hasValidOHLC(
  candle
) {

  if (
    !candle
  ) {
    return false;
  }

  const open =
    toNumber(
      candle.open
    );

  const high =
    toNumber(
      candle.high
    );

  const low =
    toNumber(
      candle.low
    );

  const close =
    toNumber(
      candle.close
    );

  if (
    open ===
    null ||
    high ===
    null ||
    low ===
    null ||
    close ===
    null
  ) {

    return false;

  }

  if (
    high <
    low
  ) {

    return false;

  }

  return true;

}


// ============================================================
// NORMALIZE SPOT KLINES
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

        if (
          !Array.isArray(
            row
          )
        ) {
          return null;
        }

        const openTime =
          toNumber(
            row[0]
          );

        const closeTime =
          toNumber(
            row[6]
          );

        if (
          openTime ===
          null
        ) {
          return null;
        }

        return {

          openTime,

          open:
            toNumber(
              row[1]
            ),

          high:
            toNumber(
              row[2]
            ),

          low:
            toNumber(
              row[3]
            ),

          close:
            toNumber(
              row[4]
            ),

          volume:
            toNumber(
              row[5]
            ) ??
            0,

          closeTime,

          closed:
            closeTime !==
              null &&
            closeTime <=
              now,

        };

      }
    )
    .filter(
      Boolean
    );

}


// ============================================================
// NORMALIZE FUTURES KLINES
// ============================================================
//
// MEXC Futures response:
//
// {
//   time:  [...],
//   open:  [...],
//   high:  [...],
//   low:   [...],
//   close: [...],
//   vol:   [...]
// }
//
// MEXC Futures time is normalized to milliseconds.
//
// ============================================================

function normalizeFuturesKlines(
  data,
  timeframe
) {

  const normalized =
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

  const intervalMs =
    getTimeframeMs(
      normalized
    );

  const now =
    Date.now();

  const result =
    [];

  const length =
    times.length;


  for (
    let i = 0;
    i < length;
    i++
  ) {

    let openTime =
      Number(
        times[i]
      );

    if (
      !Number.isFinite(
        openTime
      )
    ) {
      continue;
    }


    // --------------------------------------------------------
    // Futures API timestamps are normally seconds.
    //
    // Convert seconds → milliseconds.
    // --------------------------------------------------------

    if (
      openTime > 0 &&
      openTime <
      100000000000
    ) {

      openTime *=
        1000;

    }


    const closeTime =
      openTime +
      intervalMs -
      1;


    const candle = {

      openTime,

      open:
        toNumber(
          opens[i]
        ),

      high:
        toNumber(
          highs[i]
        ),

      low:
        toNumber(
          lows[i]
        ),

      close:
        toNumber(
          closes[i]
        ),

      volume:
        toNumber(
          volumes[i]
        ) ??
        0,

      closeTime,

      closed:
        closeTime <=
        now,

    };


    if (
      !hasValidOHLC(
        candle
      )
    ) {
      continue;
    }

    result.push(
      candle
    );

  }


  // ----------------------------------------------------------
  // Sort oldest → newest
  // ----------------------------------------------------------

  result.sort(
    (
      a,
      b
    ) =>
      a.openTime -
      b.openTime
  );


  // ----------------------------------------------------------
  // Remove duplicate candle timestamps
  // ----------------------------------------------------------

  const unique =
    [];

  const seen =
    new Set();

  for (
    const candle of
    result
  ) {

    if (
      seen.has(
        candle.openTime
      )
    ) {

      continue;

    }

    seen.add(
      candle.openTime
    );

    unique.push(
      candle
    );

  }


  return unique;

}


// ============================================================
// GET CLOSED CANDLES
// ============================================================
//
// This helper is useful to crtService.js.
//
// The last MEXC candle can still be forming.
//
// We remove it unless it has demonstrably closed.
//
// ============================================================

export function getClosedCandles(
  candles,
  timeframe,
  now = Date.now()
) {

  if (
    !Array.isArray(
      candles
    )
  ) {

    return [];

  }

  const result =
    [];

  const seen =
    new Set();

  for (
    const candle of
    candles
  ) {

    if (
      !hasValidOHLC(
        candle
      )
    ) {

      continue;

    }

    const openTime =
      getCandleOpenTime(
        candle
      );

    if (
      openTime ===
      null
    ) {

      continue;

    }

    if (
      seen.has(
        openTime
      )
    ) {

      continue;

    }

    if (
      !isCandleClosed(
        candle,
        timeframe,
        now
      )
    ) {

      continue;

    }

    seen.add(
      openTime
    );

    result.push(
      candle
    );

  }


  result.sort(
    (
      a,
      b
    ) =>
      getCandleOpenTime(
        a
      ) -
      getCandleOpenTime(
        b
      )
  );


  return result;

}


// ============================================================
// GET LATEST CLOSED CANDLE
// ============================================================

export function getLatestClosedCandle(
  candles,
  timeframe,
  now = Date.now()
) {

  const closed =
    getClosedCandles(
      candles,
      timeframe,
      now
    );

  if (
    !closed.length
  ) {

    return null;

  }

  return (
    closed[
      closed.length -
      1
    ]
  );

}


// ============================================================
// GET FUTURES KLINES
// ============================================================
//
// This is the PRIMARY function used by CRT.
//
// ============================================================

export async function getFuturesKlines(
  symbol,
  timeframe,
  limit = 100
) {

  const normalized =
    assertTimeframe(
      timeframe
    );

  const apiSymbol =
    futuresApiSymbol(
      symbol
    );


  if (
    !apiSymbol
  ) {

    throw new Error(
      'MEXC Futures symbol is required'
    );

  }


  const safeLimit =
    Math.max(
      1,
      Math.min(
        1000,
        Number(
          limit
        ) ||
        100
      )
    );


  const interval =
    INTERVALS[
      normalized
    ].futures;


  const params =
    new URLSearchParams({

      interval,

      limit:
        String(
          safeLimit
        ),

    });


  const url =
    `${FUTURES_BASE_URL}` +
    `/api/v1/contract/kline/` +
    `${encodeURIComponent(
      apiSymbol
    )}` +
    `?${params.toString()}`;


  const data =
    await requestJson(
      url
    );


  if (
    !data?.success
  ) {

    throw new Error(
      `Unexpected MEXC Futures kline response for ${apiSymbol}`
    );

  }


  const candles =
    normalizeFuturesKlines(
      data.data,
      normalized
    );


  if (
    !candles.length
  ) {

    throw new Error(
      `MEXC returned no valid Futures candles for ` +
      `${apiSymbol} ${normalized}`
    );

  }


  return candles;

}


// ============================================================
// GET FUTURES CLOSED KLINES
// ============================================================
//
// Convenience function.
//
// crtService.js can use this if needed.
//
// ============================================================

export async function getFuturesClosedKlines(
  symbol,
  timeframe,
  limit = 100
) {

  const candles =
    await getFuturesKlines(
      symbol,
      timeframe,
      limit
    );

  return getClosedCandles(
    candles,
    timeframe
  );

}


// ============================================================
// GET LATEST FUTURES CLOSED CANDLE
// ============================================================

export async function getLatestFuturesClosedCandle(
  symbol,
  timeframe,
  limit = 100
) {

  const candles =
    await getFuturesKlines(
      symbol,
      timeframe,
      limit
    );

  return getLatestClosedCandle(
    candles,
    timeframe
  );

}


// ============================================================
// GET SPOT KLINES
//
// Kept for compatibility.
//
// CRT should NOT use this path.
// ============================================================

export async function getSpotKlines(
  symbol,
  timeframe,
  limit = 100
) {

  const normalized =
    assertTimeframe(
      timeframe
    );

  const apiSymbol =
    spotApiSymbol(
      symbol
    );


  if (
    !apiSymbol
  ) {

    throw new Error(
      'MEXC Spot symbol is required'
    );

  }


  const safeLimit =
    Math.max(
      1,
      Math.min(
        1000,
        Number(
          limit
        ) ||
        100
      )
    );


  const params =
    new URLSearchParams({

      symbol:
        apiSymbol,

      interval:
        INTERVALS[
          normalized
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
      `Unexpected MEXC Spot kline response for ${apiSymbol}`
    );

  }


  return normalizeSpotKlines(
    data
  );

}


// ============================================================
// GENERIC GET KLINES
// ============================================================
//
// Existing crtService.js calls:
//
//   getKlines({
//     market,
//     symbol,
//     timeframe,
//     limit
//   })
//
// Keep this interface compatible.
//
// ============================================================

export async function getKlines({
  market,
  symbol,
  timeframe,
  limit = 100,
}) {

  const normalizedMarket =
    String(
      market ||
      'futures'
    )
      .trim()
      .toLowerCase();


  // ----------------------------------------------------------
  // HARD FUTURES PATH
  // ----------------------------------------------------------

  if (
    normalizedMarket ===
    'futures'
  ) {

    return getFuturesKlines(
      symbol,
      timeframe,
      limit
    );

  }


  // ----------------------------------------------------------
  // Spot compatibility path
  // ----------------------------------------------------------

  if (
    normalizedMarket ===
    'spot'
  ) {

    return getSpotKlines(
      symbol,
      timeframe,
      limit
    );

  }


  throw new Error(
    `Unsupported MEXC market: ${market}`
  );

}


// ============================================================
// GET SPOT SYMBOLS
// ============================================================
//
// Compatibility only.
//
// CRT uses Futures symbols.
//
// ============================================================

export async function getSpotSymbols() {

  const data =
    await requestJson(
      `${SPOT_BASE_URL}` +
      `/api/v3/exchangeInfo`
    );


  const symbols =
    Array.isArray(
      data?.symbols
    )
      ? data.symbols
      : [];


  return symbols

    .filter(
      (
        item
      ) =>
        item?.status ===
          'ENABLED' ||
        item?.isSpotTradingAllowed ===
          true
    )

    .map(
      (
        item
      ) =>
        item.symbol
    )

    .filter(
      Boolean
    );

}


// ============================================================
// GET FUTURES CONTRACTS
// ============================================================
//
// MEXC endpoint:
//
//   /api/v1/contract/detail
//
// This endpoint is also documented by MEXC as the Futures
// symbol source. :contentReference[oaicite:2]{index=2}
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
      ) => {

        if (
          !contract?.symbol
        ) {

          return false;

        }

        if (
          !contract?.quoteCoin
        ) {

          return false;

        }

        return true;

      }
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

        settleCoin:
          contract.settleCoin,

        contractSize:
          contract.contractSize,

        state:
          contract.state,

      })
    );

}


// ============================================================
// GET FUTURES SYMBOL NAMES ONLY
// ============================================================

export async function getFuturesSymbols() {

  const contracts =
    await getFuturesContracts();


  return contracts

    .map(
      (
        contract
      ) =>
        contract.symbol
    )

    .filter(
      Boolean
    );

}


// ============================================================
// CONFIGURED SYMBOLS
// ============================================================
//
// Environment variables:
//
//   MEXC_FUTURES_SYMBOLS=BTC_USDT,ETH_USDT
//
//   MEXC_SPOT_SYMBOLS=BTCUSDT,ETHUSDT
//
// ============================================================

export function getConfiguredSymbols(
  market
) {

  const normalizedMarket =
    String(
      market ||
      'futures'
    )
      .trim()
      .toLowerCase();


  const key =
    normalizedMarket ===
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
// GET CONFIGURED FUTURES SYMBOLS
// ============================================================

export function getConfiguredFuturesSymbols() {

  return getConfiguredSymbols(
    'futures'
  );

}


// ============================================================
// GET CONFIGURED SPOT SYMBOLS
// ============================================================

export function getConfiguredSpotSymbols() {

  return getConfiguredSymbols(
    'spot'
  );

}


// ============================================================
// GET FUTURES INTERVAL
// ============================================================

export function getFuturesInterval(
  timeframe
) {

  const normalized =
    assertTimeframe(
      timeframe
    );

  return (
    INTERVALS[
      normalized
    ].futures
  );

}


// ============================================================
// GET SPOT INTERVAL
// ============================================================

export function getSpotInterval(
  timeframe
) {

  const normalized =
    assertTimeframe(
      timeframe
    );

  return (
    INTERVALS[
      normalized
    ].spot
  );

}


// ============================================================
// GET ALL SUPPORTED TIMEFRAMES
// ============================================================

export function getSupportedTimeframes() {

  return Object.keys(
    INTERVALS
  );

}


// ============================================================
// MEXC FUTURES SERVICE STATUS
// ============================================================

export function getMexcServiceInfo() {

  return {

    futuresBaseUrl:
      FUTURES_BASE_URL,

    spotBaseUrl:
      SPOT_BASE_URL,

    futuresOnlyForCRT:
      true,

    supportedTimeframes:
      getSupportedTimeframes(),

    intervals:
      Object.fromEntries(
        Object.entries(
          INTERVALS
        ).map(
          (
            [
              timeframe,
              config,
            ]
          ) => [

            timeframe,

            {

              futures:
                config.futures,

              milliseconds:
                config.milliseconds,

            },

          ]
        )
      ),

    httpTimeoutMs:
      HTTP_TIMEOUT_MS,

    maxRetries:
      MAX_RETRIES,

  };

}


// ============================================================
// EXPORT INTERVAL CONFIG
// ============================================================

export {
  INTERVALS,
};


// ============================================================
// SERVICE LOADED
// ============================================================

console.log(
  `[MEXC] Service loaded`
);

console.log(
  `[MEXC] Futures endpoint: ${FUTURES_BASE_URL}`
);

console.log(
  `[MEXC] Futures timeframes: ${Object.keys(INTERVALS).join(', ')}`
);

console.log(
  `[MEXC] Futures candle timing: exchange UTC timestamps`
);

console.log(
  `[MEXC] CRT market path: FUTURES ONLY`
);

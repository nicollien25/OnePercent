import { EmbedBuilder } from 'discord.js';
import botConfig from '../../config/bot.js';

import {
  buildSignal,
  normalizeTimeframe,
} from './crtEngine.js';

import {
  getKlines,
  getFuturesContracts,
  getConfiguredSymbols,
  getNextCurrentCandleBoundary,
} from './mexcService.js';

import { isNewSignal } from './signalManager.js';

// ============================================================
// OnePERCENT CRT SERVICE
// ============================================================
//
// PRIMARY:
//
//   Rachel T Fractal + CRT Confirmation
//
// SOURCE:
//
//   MEXC FUTURES ONLY
//
// IMPORTANT:
//
//   This version is specifically designed to prevent:
//
//   • MEXC code 510 rate limiting
//   • simultaneous timeframe request storms
//   • missed candle-boundary scans
//   • losing a candle after a failed API request
//   • duplicate alerts after Railway restart
//
// ============================================================


// ============================================================
// CONFIG
// ============================================================

const CRT_CONFIG =
  botConfig.crt || {};


// ============================================================
// TIMEFRAMES
// ============================================================

const DEFAULT_TIMEFRAMES = {
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
};

const TIMEFRAMES =
  CRT_CONFIG.timeframes ||
  DEFAULT_TIMEFRAMES;


// ============================================================
// TIMEFRAME PRIORITY
// ============================================================
//
// Lower timeframe first.
//
// When multiple timeframes close together:
//
//   5m
//   15m
//   30m
//   1h
//   4h
//   1d
//
// are processed in this order.
//
// ============================================================

const TIMEFRAME_PRIORITY = [
  '5m',
  '15m',
  '30m',
  '1h',
  '4h',
  '1d',
];


// ============================================================
// TIMEFRAME MILLISECONDS
// ============================================================

const TIMEFRAME_MS = {
  '5m':
    5 * 60 * 1000,

  '15m':
    15 * 60 * 1000,

  '30m':
    30 * 60 * 1000,

  '1h':
    60 * 60 * 1000,

  '4h':
    4 * 60 * 60 * 1000,

  '1d':
    24 * 60 * 60 * 1000,
};


// ============================================================
// DISCORD CHANNELS
// ============================================================

const CHANNELS =
  CRT_CONFIG.channels || {};


// ============================================================
// HARD MARKET LOCK
// ============================================================

const MARKET =
  'futures';


// ============================================================
// KLINE LIMIT
// ============================================================

const KLINE_LIMIT =
  Math.max(
    50,
    Number(
      CRT_CONFIG.klineLimit ||
      100
    )
  );


// ============================================================
// MAX SYMBOLS
// ============================================================

const MAX_SYMBOLS =
  Math.max(
    1,
    Number(
      CRT_CONFIG.maxSymbolsPerMarket ||
      30
    )
  );


// ============================================================
// SYMBOL REFRESH
// ============================================================

const SYMBOL_REFRESH_MS =
  Math.max(
    60 * 1000,
    Number(
      CRT_CONFIG.symbolRefreshMs ||
      15 * 60 * 1000
    )
  );


// ============================================================
// RSI
// ============================================================

const RSI_PERIOD =
  Number(
    CRT_CONFIG.rsi?.period ||
    14
  );

const OVERSOLD =
  Number(
    CRT_CONFIG.rsi?.oversold ||
    30
  );

const OVERBOUGHT =
  Number(
    CRT_CONFIG.rsi?.overbought ||
    70
  );


// ============================================================
// AUTO SYMBOLS
// ============================================================

const AUTO_SYMBOLS =
  CRT_CONFIG.autoSymbols !== false;


// ============================================================
// CANDLE BOUNDARY DELAY
// ============================================================
//
// Wait after the MEXC boundary before requesting.
//
// 1500ms gives MEXC enough time to publish the newly closed
// candle.
//
// ============================================================

const BOUNDARY_DELAY_MS =
  Math.max(
    500,
    Number(
      CRT_CONFIG.boundaryDelayMs ||
      1500
    )
  );


// ============================================================
// MEXC REQUEST SPACING
// ============================================================
//
// IMPORTANT.
//
// DO NOT run multiple MEXC KLINE requests concurrently.
//
// The previous service used:
//
//   concurrency = 3
//
// which caused:
//
//   code 510
//   Requests are too frequent
//
// We intentionally use ONE request at a time.
//
// Default:
//
//   450ms between requests
//
// ============================================================

const REQUEST_SPACING_MS =
  Math.max(
    250,
    Number(
      CRT_CONFIG.requestSpacingMs ||
      450
    )
  );


// ============================================================
// RATE LIMIT RETRIES
// ============================================================

const RATE_LIMIT_RETRIES =
  Math.max(
    1,
    Number(
      CRT_CONFIG.rateLimitRetries ||
      4
    )
  );


// ============================================================
// RATE LIMIT BACKOFF
// ============================================================
//
// Retry delays:
//
//   attempt 1 -> 1500ms
//   attempt 2 -> 3000ms
//   attempt 3 -> 6000ms
//   attempt 4 -> 10000ms
//
// ============================================================

const RATE_LIMIT_BACKOFF =
  Math.max(
    500,
    Number(
      CRT_CONFIG.rateLimitBackoffMs ||
      1500
    )
  );


// ============================================================
// CATCH-UP WINDOW
// ============================================================
//
// If Railway starts just AFTER a candle closes:
//
// Example:
//
//   22:00:03 Manila
//
// The 15m candle closing at:
//
//   22:00:00
//
// is still eligible.
//
// This prevents the service from jumping directly to:
//
//   22:15
//
// ============================================================

const CATCHUP_WINDOW_MS =
  Math.max(
    5000,
    Number(
      CRT_CONFIG.catchupWindowMs ||
      90 * 1000
    )
  );


// ============================================================
// MINIMUM CANDLES
// ============================================================

const MINIMUM_CANDLES =
  Math.max(
    30,
    RSI_PERIOD + 10
  );


// ============================================================
// STATE
// ============================================================

let monitorStarted =
  false;


// ============================================================
// SCAN STATE
// ============================================================

const scanRunning =
  new Set();


// ============================================================
// SYMBOL CACHE
// ============================================================

let cachedSymbols =
  [];

let lastSymbolRefresh =
  0;


// ============================================================
// LAST PROCESSED CANDLE
// ============================================================
//
// Key:
//
//   timeframe:symbol
//
// Value:
//
//   candle openTime
//
// IMPORTANT:
//
// This is ONLY updated after the MEXC request succeeds.
//
// Therefore:
//
//   API error
//        ↓
//   NOT marked processed
//        ↓
//   retry possible
//
// ============================================================

const lastProcessedCandle =
  new Map();


// ============================================================
// STARTUP BASELINE
// ============================================================
//
// Key:
//
//   timeframe:symbol
//
// Value:
//
//   true
//
// ============================================================

const bootstrapped =
  new Set();


// ============================================================
// TIMEFRAME TIMERS
// ============================================================

const timeframeTimers =
  new Map();


// ============================================================
// GLOBAL REQUEST LOCK
// ============================================================
//
// Only ONE MEXC request may be active through this service.
//
// ============================================================

let mexcRequestChain =
  Promise.resolve();

let lastMexcRequestTime =
  0;


// ============================================================
// GLOBAL TIMEFRAME SCAN LOCK
// ============================================================
//
// This prevents:
//
//   15m scan
//   30m scan
//   1h scan
//
// from executing simultaneously.
//
// ============================================================

let timeframeScanChain =
  Promise.resolve();


// ============================================================
// HELPER: SLEEP
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
// GET CONFIGURED TIMEFRAMES
// ============================================================

function getConfiguredTimeframes() {
  const configured =
    Object.keys(
      TIMEFRAMES
    );

  const result =
    [];

  for (
    const timeframe of
      TIMEFRAME_PRIORITY
  ) {
    if (
      configured.includes(
        timeframe
      )
    ) {
      result.push(
        timeframe
      );
    }
  }

  for (
    const timeframe of
      configured
  ) {
    if (
      !result.includes(
        timeframe
      )
    ) {
      result.push(
        timeframe
      );
    }
  }

  return result;
}


// ============================================================
// NORMALIZE TIMEFRAME
// ============================================================

function normalizeTF(
  timeframe
) {
  const value =
    String(
      timeframe || ''
    )
      .trim()
      .toLowerCase();

  const aliases = {
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

  return (
    aliases[value] ||
    normalizeTimeframe(
      value
    )
  );
}


// ============================================================
// TIMEFRAME LABEL
// ============================================================

function timeframeLabel(
  timeframe
) {
  const normalized =
    normalizeTF(
      timeframe
    );

  const labels = {
    '5m':
      '5 MINUTES',

    '15m':
      '15 MINUTES',

    '30m':
      '30 MINUTES',

    '1h':
      '1 HOUR',

    '4h':
      '4 HOURS',

    '1d':
      'DAILY',
  };

  return (
    labels[
      normalized
    ] ||
    String(
      timeframe
    )
  );
}


// ============================================================
// TIMEFRAME MS
// ============================================================

function getTimeframeMs(
  timeframe
) {
  return (
    TIMEFRAME_MS[
      normalizeTF(
        timeframe
      )
    ] ||
    null
  );
}


// ============================================================
// MEXC CURRENT BOUNDARY
// ============================================================
//
// Uses the authoritative helper from mexcService.
//
// ============================================================

function getCurrentBoundary(
  timeframe,
  now = Date.now()
) {
  const normalized =
    normalizeTF(
      timeframe
    );

  const interval =
    getTimeframeMs(
      normalized
    );

  if (
    !interval
  ) {
    return null;
  }

  return (
    Math.floor(
      now / interval
    ) * interval
  );
}


// ============================================================
// GET PREVIOUS CLOSED BOUNDARY
// ============================================================

function getPreviousBoundary(
  timeframe,
  now = Date.now()
) {
  const boundary =
    getCurrentBoundary(
      timeframe,
      now
    );

  if (
    boundary ===
    null
  ) {
    return null;
  }

  if (
    now >= boundary
  ) {
    return boundary;
  }

  return (
    boundary -
    getTimeframeMs(
      timeframe
    )
  );
}


// ============================================================
// GET NEXT BOUNDARY
// ============================================================

function getNextBoundary(
  timeframe,
  now = Date.now()
) {
  const normalized =
    normalizeTF(
      timeframe
    );

  try {
    const boundary =
      getNextCurrentCandleBoundary(
        normalized,
        now
      );

    if (
      Number.isFinite(
        Number(boundary)
      )
    ) {
      return Number(
        boundary
      );
    }
  } catch {
    // Fallback below.
  }

  const current =
    getCurrentBoundary(
      normalized,
      now
    );

  if (
    current ===
    null
  ) {
    return null;
  }

  return (
    current +
    getTimeframeMs(
      normalized
    )
  );
}


// ============================================================
// GET SCHEDULE TIME
// ============================================================
//
// IMPORTANT:
//
// If we are just after a candle boundary, scan that candle.
//
// Example:
//
// now = 22:00:03 Manila
//
// 15m boundary = 22:00:00 Manila
//
// difference = 3 seconds
//
// Therefore:
//
// scan NOW
//
// rather than waiting for 22:15.
//
// ============================================================

function getNextScanTime(
  timeframe,
  now = Date.now()
) {
  const normalized =
    normalizeTF(
      timeframe
    );

  const currentBoundary =
    getCurrentBoundary(
      normalized,
      now
    );

  if (
    currentBoundary ===
    null
  ) {
    return null;
  }

  const sinceBoundary =
    now -
    currentBoundary;

  if (
    sinceBoundary >= 0 &&
    sinceBoundary <=
      CATCHUP_WINDOW_MS
  ) {
    return (
      now +
      BOUNDARY_DELAY_MS
    );
  }

  const nextBoundary =
    getNextBoundary(
      normalized,
      now
    );

  if (
    nextBoundary ===
    null
  ) {
    return null;
  }

  return (
    nextBoundary +
    BOUNDARY_DELAY_MS
  );
}


// ============================================================
// FORMAT UTC
// ============================================================

function formatUTC(
  timestamp
) {
  const number =
    Number(
      timestamp
    );

  if (
    !Number.isFinite(
      number
    )
  ) {
    return 'N/A';
  }

  return new Date(
    number
  )
    .toISOString()
    .replace(
      'T',
      ' '
    )
    .replace(
      '.000Z',
      ' UTC'
    );
}


// ============================================================
// FORMAT NUMBER
// ============================================================

function fmtNumber(
  value,
  decimals = 2
) {
  const number =
    Number(
      value
    );

  if (
    !Number.isFinite(
      number
    )
  ) {
    return 'N/A';
  }

  return number.toFixed(
    decimals
  );
}


// ============================================================
// RSI DISPLAY
// ============================================================

function formatRSIState(
  state
) {
  const normalized =
    String(
      state ||
      'Neutral'
    )
      .trim()
      .toUpperCase();

  if (
    normalized ===
    'OVERBOUGHT'
  ) {
    return '**OVERBOUGHT**';
  }

  if (
    normalized ===
    'OVERSOLD'
  ) {
    return '**OVERSOLD**';
  }

  return 'Neutral';
}


// ============================================================
// MARKET STRUCTURE
// ============================================================

function getMarketStructure(
  signal
) {
  const raw =
    signal?.marketStructure ??
    signal?.structure ??
    signal?.market_structure ??
    '';

  const normalized =
    String(
      raw
    )
      .trim()
      .toUpperCase();

  if (
    normalized ===
    'BULLISH'
  ) {
    return 'Bullish';
  }

  if (
    normalized ===
    'BEARISH'
  ) {
    return 'Bearish';
  }

  return 'N/A';
}


// ============================================================
// STD DEVIATION
// ============================================================

function getStdDeviation(
  signal
) {
  return fmtNumber(
    signal?.stdDeviation ??
      signal?.stdDev ??
      signal?.standardDeviation,
    2
  );
}


// ============================================================
// CONFIRMED FRACTALS
// ============================================================

function getConfirmedFractals(
  signal
) {
  if (
    Array.isArray(
      signal?.confirmedFractals
    )
  ) {
    return (
      signal.confirmedFractals
    );
  }

  return [];
}


// ============================================================
// LATEST FRACTAL
// ============================================================

function getLatestConfirmedFractal(
  signal
) {
  const fractals =
    getConfirmedFractals(
      signal
    );

  if (
    !fractals.length
  ) {
    return null;
  }

  return (
    fractals[
      fractals.length - 1
    ]
  );
}


// ============================================================
// LATEST TOP
// ============================================================

function getLatestConfirmedTop(
  signal
) {
  const fractals =
    getConfirmedFractals(
      signal
    );

  for (
    let i =
      fractals.length - 1;
    i >= 0;
    i--
  ) {
    const type =
      String(
        fractals[i]?.type ||
          ''
      )
        .trim()
        .toUpperCase();

    if (
      type ===
      'TOP'
    ) {
      return fractals[i];
    }
  }

  return null;
}


// ============================================================
// LATEST BOTTOM
// ============================================================

function getLatestConfirmedBottom(
  signal
) {
  const fractals =
    getConfirmedFractals(
      signal
    );

  for (
    let i =
      fractals.length - 1;
    i >= 0;
    i--
  ) {
    const type =
      String(
        fractals[i]?.type ||
          ''
      )
        .trim()
        .toUpperCase();

    if (
      type ===
      'BOTTOM'
    ) {
      return fractals[i];
    }
  }

  return null;
}


// ============================================================
// FRACTAL DISPLAY
// ============================================================

function getFractalType(
  signal
) {
  const structure =
    getMarketStructure(
      signal
    ).toUpperCase();

  if (
    structure ===
    'BEARISH'
  ) {
    if (
      getLatestConfirmedTop(
        signal
      )
    ) {
      return 'TOP';
    }
  }

  if (
    structure ===
    'BULLISH'
  ) {
    if (
      getLatestConfirmedBottom(
        signal
      )
    ) {
      return 'BOTTOM';
    }
  }

  const latest =
    getLatestConfirmedFractal(
      signal
    );

  if (
    latest
  ) {
    const type =
      String(
        latest.type ||
          ''
      )
        .trim()
        .toUpperCase();

    if (
      type ===
      'TOP'
    ) {
      return 'TOP';
    }

    if (
      type ===
      'BOTTOM'
    ) {
      return 'BOTTOM';
    }
  }

  const raw =
    signal?.fractalType ??
    signal?.fractal?.type ??
    '';

  const normalized =
    String(
      raw
    )
      .trim()
      .toUpperCase();

  if (
    normalized.includes(
      'TOP'
    )
  ) {
    return 'TOP';
  }

  if (
    normalized.includes(
      'BOTTOM'
    )
  ) {
    return 'BOTTOM';
  }

  return 'N/A';
}


// ============================================================
// LIQUIDITY
// ============================================================

function getLiquiditySweep(
  signal
) {
  const sweep =
    signal?.liquiditySweep;

  if (
    !sweep ||
    typeof sweep !==
      'object'
  ) {
    return 'None';
  }

  if (
    typeof sweep.label ===
      'string' &&
    sweep.label.trim()
  ) {
    return sweep.label;
  }

  if (
    sweep.swept ===
    true
  ) {
    const type =
      String(
        sweep.type ||
          ''
      )
        .trim()
        .toUpperCase();

    if (
      type ===
      'HIGH'
    ) {
      return (
        '**PREVIOUS HIGH SWEPT**'
      );
    }

    if (
      type ===
      'LOW'
    ) {
      return (
        '**PREVIOUS LOW SWEPT**'
      );
    }

    return (
      '**LIQUIDITY SWEPT**'
    );
  }

  return 'None';
}


// ============================================================
// CONFIRMED SIGNAL
// ============================================================

function isConfirmedSignal(
  signal
) {
  if (
    signal?.confirmed ===
    false
  ) {
    return false;
  }

  if (
    signal?.confirmedCRT ===
    false
  ) {
    return false;
  }

  if (
    signal?.crtConfirmed ===
    false
  ) {
    return false;
  }

  return true;
}


// ============================================================
// STRUCTURE EMOJI
// ============================================================

function structureEmoji(
  signal
) {
  const structure =
    getMarketStructure(
      signal
    ).toUpperCase();

  if (
    structure ===
    'BULLISH'
  ) {
    return '🟢';
  }

  if (
    structure ===
    'BEARISH'
  ) {
    return '🔴';
  }

  return '🟡';
}


// ============================================================
// EMBED COLOR
// ============================================================

function signalColor(
  signal
) {
  const structure =
    getMarketStructure(
      signal
    ).toUpperCase();

  if (
    structure ===
    'BULLISH'
  ) {
    return 0x57f287;
  }

  if (
    structure ===
    'BEARISH'
  ) {
    return 0xed4245;
  }

  return 0xfee75c;
}


// ============================================================
// COIN FORMAT
// ============================================================

function formatCoin(
  symbol
) {
  return String(
    symbol ||
    'UNKNOWN'
  )
    .replace(
      /[-_]USDT$/i,
      ''
    )
    .replace(
      /USDT$/i,
      ''
    )
    .replace(
      /[-_]USD$/i,
      ''
    )
    .replace(
      /USD$/i,
      ''
    )
    .replace(
      /[-_]$/g,
      ''
    )
    .toUpperCase();
}


// ============================================================
// CANDLE OPEN TIME
// ============================================================

function getCandleOpenTime(
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

  const value =
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

  if (
    value > 0 &&
    value <
      100000000000
  ) {
    return (
      value * 1000
    );
  }

  return value;
}


// ============================================================
// CANDLE CLOSE TIME
// ============================================================

function getCandleCloseTime(
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

  const explicitNumber =
    Number(
      explicit
    );

  if (
    Number.isFinite(
      explicitNumber
    )
  ) {
    if (
      explicitNumber > 0 &&
      explicitNumber <
        100000000000
    ) {
      return (
        explicitNumber *
        1000
      );
    }

    return explicitNumber;
  }

  const openTime =
    getCandleOpenTime(
      candle
    );

  const interval =
    getTimeframeMs(
      timeframe
    );

  if (
    openTime === null ||
    interval === null
  ) {
    return null;
  }

  return (
    openTime +
    interval -
    1
  );
}


// ============================================================
// IS CANDLE CLOSED
// ============================================================

function isCandleClosed(
  candle,
  timeframe,
  now = Date.now()
) {
  if (
    !candle
  ) {
    return false;
  }

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
    Number(
      candle.open
    );

  const high =
    Number(
      candle.high
    );

  const low =
    Number(
      candle.low
    );

  const close =
    Number(
      candle.close
    );

  return (
    Number.isFinite(
      open
    ) &&
    Number.isFinite(
      high
    ) &&
    Number.isFinite(
      low
    ) &&
    Number.isFinite(
      close
    )
  );
}


// ============================================================
// GET CLOSED CANDLES
// ============================================================

function getClosedCandles(
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
    candles
      .filter(
        (candle) =>
          hasValidOHLC(
            candle
          ) &&
          isCandleClosed(
            candle,
            timeframe,
            now
          )
      )
      .sort(
        (a, b) =>
          (
            getCandleOpenTime(
              a
            ) || 0
          ) -
          (
            getCandleOpenTime(
              b
            ) || 0
          )
      );

  const unique =
    [];

  const seen =
    new Set();

  for (
    const candle of
      result
  ) {
    const time =
      getCandleOpenTime(
        candle
      );

    if (
      time ===
      null
    ) {
      continue;
    }

    if (
      seen.has(
        time
      )
    ) {
      continue;
    }

    seen.add(
      time
    );

    unique.push(
      candle
    );
  }

  return unique;
}


// ============================================================
// SIGNAL CRT CANDLE TIME
// ============================================================

function getSignalCRTCandleTime(
  signal
) {
  if (
    !signal
  ) {
    return null;
  }

  const direct =
    Number(
      signal.crtCandleTime
    );

  if (
    Number.isFinite(
      direct
    )
  ) {
    if (
      direct > 0 &&
      direct <
        100000000000
    ) {
      return (
        direct * 1000
      );
    }

    return direct;
  }

  const nested =
    getCandleOpenTime(
      signal
        ?.crtConfirmation
        ?.signalCandle
    );

  if (
    nested !==
    null
  ) {
    return nested;
  }

  const compatibility =
    getCandleOpenTime(
      signal?.crtCandle
    );

  if (
    compatibility !==
    null
  ) {
    return compatibility;
  }

  return null;
}


// ============================================================
// SIGNAL MATCHES NEW CLOSED CANDLE
// ============================================================

function signalMatchesLatestClosedCandle(
  signal,
  latestClosedCandle
) {
  if (
    !signal ||
    !latestClosedCandle
  ) {
    return false;
  }

  const signalTime =
    getSignalCRTCandleTime(
      signal
    );

  const latestTime =
    getCandleOpenTime(
      latestClosedCandle
    );

  if (
    signalTime ===
      null ||
    latestTime ===
      null
  ) {
    return false;
  }

  return (
    signalTime ===
    latestTime
  );
}


// ============================================================
// STATE KEY
// ============================================================

function getStateKey(
  symbol,
  timeframe
) {
  return [
    normalizeTF(
      timeframe
    ),
    symbol,
  ].join(':');
}


// ============================================================
// CREATE EMBED
// ============================================================

function createSignalEmbed(
  signal
) {
  const structure =
    getMarketStructure(
      signal
    );

  const emoji =
    structureEmoji(
      signal
    );

  const coin =
    formatCoin(
      signal.symbol
    );

  const fractalType =
    getFractalType(
      signal
    );

  const liquidity =
    getLiquiditySweep(
      signal
    );

  const rsi =
    formatRSIState(
      signal.rsiState
    );

  const stdDeviation =
    getStdDeviation(
      signal
    );

  const crtTime =
    getSignalCRTCandleTime(
      signal
    );

  return new EmbedBuilder()

    .setTitle(
      `${emoji} ${coin}`
    )

    .setDescription(
      '**OnePERCENT CRT Signal**'
    )

    .addFields(

      {
        name:
          'Source',

        value:
          '**MEXC Futures**',

        inline:
          false,
      },

      {
        name:
          'Timeframe',

        value:
          timeframeLabel(
            signal.timeframe
          ),

        inline:
          true,
      },

      {
        name:
          'Market Structure',

        value:
          structure,

        inline:
          true,
      },

      {
        name:
          'STD Deviation',

        value:
          stdDeviation,

        inline:
          true,
      },

      {
        name:
          'Fractal',

        value:
          fractalType,

        inline:
          true,
      },

      {
        name:
          'Liquidity',

        value:
          liquidity,

        inline:
          true,
      },

      {
        name:
          'Potential CRT',

        value:
          '**CONFIRMED**',

        inline:
          true,
      },

      {
        name:
          'RSI',

        value:
          rsi,

        inline:
          true,
      }

    )

    .setColor(
      signalColor(
        signal
      )
    )

    .setFooter({
      text:
        'PDYN • Rachel T CRT • MEXC Futures',
    })

    .setTimestamp(
      crtTime !==
        null
        ? new Date(
            crtTime
          )
        : new Date()
    );
}


// ============================================================
// SEND SIGNAL
// ============================================================

async function sendSignal(
  client,
  signal
) {
  const timeframe =
    normalizeTF(
      signal.timeframe
    );

  const channelId =
    CHANNELS[
      timeframe
    ];

  if (
    !channelId
  ) {
    console.warn(
      `[CRT] No Discord channel configured for ${timeframe}`
    );

    return false;
  }

  const channel =
    await client.channels.fetch(
      channelId
    );

  if (
    !channel ||
    typeof channel.send !==
      'function'
  ) {
    console.warn(
      `[CRT] Invalid Discord channel for ${timeframe}`
    );

    return false;
  }

  const coin =
    formatCoin(
      signal.symbol
    );

  const emoji =
    structureEmoji(
      signal
    );

  await channel.send({
    content:
      `${emoji} **${coin}**`,

    embeds: [
      createSignalEmbed(
        signal
      ),
    ],
  });

  return true;
}


// ============================================================
// FILTER FUTURES SYMBOLS
// ============================================================

function filterSymbols(
  symbols
) {
  const configured =
    getConfiguredSymbols(
      MARKET
    );

  if (
    Array.isArray(
      configured
    ) &&
    configured.length
  ) {
    return [
      ...new Set(
        configured
          .map(
            (symbol) =>
              String(
                symbol
              ).trim()
          )
          .filter(
            Boolean
          )
      ),
    ].slice(
      0,
      MAX_SYMBOLS
    );
  }

  if (
    !Array.isArray(
      symbols
    )
  ) {
    return [];
  }

  const quote =
    String(
      CRT_CONFIG.quoteAsset ||
      'USDT'
    ).toUpperCase();

  const result =
    symbols
      .filter(
        (item) => {
          const symbol =
            typeof item ===
              'string'
              ? item
              : item?.symbol;

          if (
            !symbol
          ) {
            return false;
          }

          const normalized =
            String(
              symbol
            ).toUpperCase();

          const quoteCoin =
            String(
              item?.quoteCoin ||
                ''
            ).toUpperCase();

          return (
            quoteCoin ===
              quote ||
            normalized.endsWith(
              `_${quote}`
            ) ||
            normalized.endsWith(
              `${quote}`
            )
          );
        }
      )
      .map(
        (item) =>
          typeof item ===
            'string'
            ? item
            : item.symbol
      )
      .filter(
        Boolean
      );

  return [
    ...new Set(
      result
    ),
  ].slice(
    0,
    MAX_SYMBOLS
  );
}


// ============================================================
// REFRESH SYMBOLS
// ============================================================

async function refreshSymbols(
  force = false
) {
  if (
    !force &&
    cachedSymbols.length &&
    Date.now() -
      lastSymbolRefresh <
      SYMBOL_REFRESH_MS
  ) {
    return;
  }

  try {
    const contracts =
      await queueMexcRequest(
        () =>
          getFuturesContracts()
      );

    cachedSymbols =
      filterSymbols(
        contracts
      );

    lastSymbolRefresh =
      Date.now();

    console.log(
      `[CRT] MEXC Futures symbols loaded: ${cachedSymbols.length}`
    );

  } catch (
    error
  ) {
    console.error(
      '[CRT] Failed to refresh MEXC Futures symbols:',
      error?.message ||
        error
    );

    // Keep old cache if available.

    if (
      !cachedSymbols.length
    ) {
      cachedSymbols =
        [];
    }
  }
}


// ============================================================
// IS RATE LIMIT ERROR
// ============================================================

function isRateLimitError(
  error
) {
  const message =
    String(
      error?.message ||
        error ||
        ''
    ).toLowerCase();

  return (
    message.includes(
      'code":510'
    ) ||
    message.includes(
      'code:510'
    ) ||
    message.includes(
      'requests are too frequent'
    ) ||
    message.includes(
      'too frequent'
    ) ||
    message.includes(
      'rate limit'
    )
  );
}


// ============================================================
// MEXC REQUEST QUEUE
// ============================================================
//
// ALL MEXC requests go through here.
//
// This guarantees:
//
//   1 request at a time
//
// and:
//
//   spacing between requests
//
// ============================================================

function queueMexcRequest(
  request
) {
  const run =
    mexcRequestChain.then(
      async () => {

        const now =
          Date.now();

        const elapsed =
          now -
          lastMexcRequestTime;

        if (
          elapsed <
          REQUEST_SPACING_MS
        ) {
          await sleep(
            REQUEST_SPACING_MS -
              elapsed
          );
        }

        let attempt =
          0;

        while (
          true
        ) {
          try {

            lastMexcRequestTime =
              Date.now();

            const result =
              await request();

            return result;

          } catch (
            error
          ) {

            if (
              !isRateLimitError(
                error
              ) ||
              attempt >=
                RATE_LIMIT_RETRIES
            ) {
              throw error;
            }

            attempt +=
              1;

            const backoff =
              Math.min(
                15000,
                RATE_LIMIT_BACKOFF *
                  Math.pow(
                    2,
                    attempt - 1
                  )
              );

            console.warn(
              `[CRT] MEXC rate limit detected. ` +
              `Retry ${attempt}/${RATE_LIMIT_RETRIES} ` +
              `in ${backoff}ms.`
            );

            await sleep(
              backoff
            );

            lastMexcRequestTime =
              Date.now();
          }
        }
      }
    );

  mexcRequestChain =
    run.catch(
      () => {}
    );

  return run;
}


// ============================================================
// FETCH CLOSED CANDLES
// ============================================================
//
// IMPORTANT:
//
// This request is queued.
//
// Therefore symbols are NOT requested concurrently.
//
// ============================================================

async function fetchClosedCandles(
  symbol,
  timeframe
) {
  const normalized =
    normalizeTF(
      timeframe
    );

  const candles =
    await queueMexcRequest(
      () =>
        getKlines({
          market:
            MARKET,

          symbol,

          timeframe:
            normalized,

          limit:
            KLINE_LIMIT,
        })
    );

  if (
    !Array.isArray(
      candles
    )
  ) {
    return [];
  }

  return getClosedCandles(
    candles,
    normalized
  );
}


// ============================================================
// GET LATEST CLOSED CANDLE
// ============================================================

function getLatestClosedCandle(
  candles
) {
  if (
    !Array.isArray(
      candles
    ) ||
    !candles.length
  ) {
    return null;
  }

  return (
    candles[
      candles.length - 1
    ]
  );
}


// ============================================================
// BOOTSTRAP SYMBOL
// ============================================================
//
// Startup baseline.
//
// This DOES NOT send an alert.
//
// ============================================================

async function bootstrapSymbol(
  symbol,
  timeframe
) {
  const normalized =
    normalizeTF(
      timeframe
    );

  const key =
    getStateKey(
      symbol,
      normalized
    );

  if (
    bootstrapped.has(
      key
    )
  ) {
    return true;
  }

  try {
    const candles =
      await fetchClosedCandles(
        symbol,
        normalized
      );

    const latest =
      getLatestClosedCandle(
        candles
      );

    if (
      !latest
    ) {
      return false;
    }

    const latestTime =
      getCandleOpenTime(
        latest
      );

    if (
      latestTime ===
      null
    ) {
      return false;
    }

    lastProcessedCandle.set(
      key,
      latestTime
    );

    bootstrapped.add(
      key
    );

    console.log(
      `[CRT] Bootstrap ${symbol}:${normalized} -> ${formatUTC(latestTime)}`
    );

    return true;

  } catch (
    error
  ) {
    console.error(
      `[CRT] Bootstrap failed ${symbol}:${normalized}:`,
      error?.message ||
        error
    );

    // IMPORTANT:
    //
    // Do not mark it bootstrapped after failure.

    return false;
  }
}


// ============================================================
// SCAN ONE SYMBOL
// ============================================================

async function scanSymbol(
  client,
  symbol,
  timeframe
) {
  const normalized =
    normalizeTF(
      timeframe
    );

  const key =
    getStateKey(
      symbol,
      normalized
    );

  try {

    // --------------------------------------------------------
    // FETCH MEXC DATA
    // --------------------------------------------------------

    const closed =
      await fetchClosedCandles(
        symbol,
        normalized
      );

    if (
      closed.length <
      MINIMUM_CANDLES
    ) {
      console.log(
        `[CRT] Not enough candles ${symbol}:${normalized} ` +
        `(${closed.length}/${MINIMUM_CANDLES})`
      );

      return;
    }

    // --------------------------------------------------------
    // LATEST CLOSED MEXC CANDLE
    // --------------------------------------------------------

    const latestClosed =
      getLatestClosedCandle(
        closed
      );

    if (
      !latestClosed
    ) {
      return;
    }

    const latestClosedTime =
      getCandleOpenTime(
        latestClosed
      );

    if (
      latestClosedTime ===
      null
    ) {
      return;
    }

    // --------------------------------------------------------
    // STARTUP BASELINE
    // --------------------------------------------------------

    if (
      !bootstrapped.has(
        key
      )
    ) {
      lastProcessedCandle.set(
        key,
        latestClosedTime
      );

      bootstrapped.add(
        key
      );

      console.log(
        `[CRT] Startup baseline ${symbol}:${normalized} -> ${formatUTC(latestClosedTime)}`
      );

      return;
    }

    // --------------------------------------------------------
    // DUPLICATE CANDLE
    // --------------------------------------------------------

    const previousProcessed =
      lastProcessedCandle.get(
        key
      );

    if (
      previousProcessed ===
      latestClosedTime
    ) {
      return;
    }

    // --------------------------------------------------------
    // BUILD SIGNAL
    //
    // IMPORTANT:
    //
    // We DO NOT mark the candle processed yet.
    //
    // If engine/API/Discord fails, the candle can be retried.
    //
    // --------------------------------------------------------

    const signal =
      buildSignal({
        symbol,

        market:
          MARKET,

        timeframe:
          normalized,

        candles:
          closed,

        rsiPeriod:
          RSI_PERIOD,

        oversold:
          OVERSOLD,

        overbought:
          OVERBOUGHT,

        crtOptions: {
          requireCloseInside:
            CRT_CONFIG
              .requireCloseInside !==
            false,

          useCloseDirection:
            CRT_CONFIG
              .useCloseDirection ===
            true,

          minBodyRatio:
            Number(
              CRT_CONFIG
                .minBodyRatio ||
                0
            ),
        },
      });

    // --------------------------------------------------------
    // NO SIGNAL
    // --------------------------------------------------------

    if (
      !signal
    ) {
      lastProcessedCandle.set(
        key,
        latestClosedTime
      );

      return;
    }

    // --------------------------------------------------------
    // SIGNAL CONFIRMATION
    // --------------------------------------------------------

    if (
      !isConfirmedSignal(
        signal
      )
    ) {
      lastProcessedCandle.set(
        key,
        latestClosedTime
      );

      return;
    }

    // --------------------------------------------------------
    // CRITICAL CRT CANDLE CHECK
    // --------------------------------------------------------
    //
    // The current engine exposes:
    //
    // signal.crtCandleTime
    //
    // and it represents the actual CRT signal candle.
    //
    // We only alert if it is exactly the newly closed MEXC
    // candle.
    //
    // --------------------------------------------------------

    if (
      !signalMatchesLatestClosedCandle(
        signal,
        latestClosed
      )
    ) {

      console.log(
        `[CRT] Ignored old CRT ${symbol}:${normalized}` +
        ` | Latest=${formatUTC(latestClosedTime)}` +
        ` | SignalCRT=${formatUTC(getSignalCRTCandleTime(signal))}`
      );

      // This candle has been checked successfully.
      lastProcessedCandle.set(
        key,
        latestClosedTime
      );

      return;
    }

    // --------------------------------------------------------
    // SIGNAL ID
    // --------------------------------------------------------

    if (
      !signal.id
    ) {
      console.warn(
        `[CRT] Signal rejected: missing signal.id ` +
        `${symbol}:${normalized}`
      );

      lastProcessedCandle.set(
        key,
        latestClosedTime
      );

      return;
    }

    // --------------------------------------------------------
    // DUPLICATE SIGNAL MANAGER
    // --------------------------------------------------------

    if (
      !isNewSignal(
        signal.id
      )
    ) {

      lastProcessedCandle.set(
        key,
        latestClosedTime
      );

      return;
    }

    // --------------------------------------------------------
    // SEND DISCORD
    // --------------------------------------------------------

    const sent =
      await sendSignal(
        client,
        signal
      );

    // --------------------------------------------------------
    // ONLY MARK PROCESSED AFTER SUCCESS
    // --------------------------------------------------------

    if (
      sent
    ) {
      lastProcessedCandle.set(
        key,
        latestClosedTime
      );

      console.log(
        `[CRT] RACHEL T CRT CONFIRMED` +
        ` | ${symbol}` +
        ` | ${normalized}` +
        ` | CRT=${formatUTC(getSignalCRTCandleTime(signal))}` +
        ` | Structure=${getMarketStructure(signal)}` +
        ` | Fractal=${getFractalType(signal)}` +
        ` | STD=${getStdDeviation(signal)}` +
        ` | Liquidity=${getLiquiditySweep(signal)}` +
        ` | RSI=${signal.rsiState || 'Neutral'}`
      );

    } else {

      console.warn(
        `[CRT] Discord send failed; candle remains retryable ` +
        `${symbol}:${normalized}`
      );
    }

  } catch (
    error
  ) {

    // --------------------------------------------------------
    // CRITICAL:
    //
    // DO NOT update lastProcessedCandle here.
    //
    // If MEXC returned 510, this candle must remain eligible
    // for retry.
    // --------------------------------------------------------

    console.error(
      `[CRT] Scan failed ${symbol}:${normalized}:`,
      error?.message ||
        error
    );
  }
}


// ============================================================
// SCAN SYMBOLS SEQUENTIALLY
// ============================================================
//
// This is intentional.
//
// No Promise.all().
//
// No worker pool.
//
// No concurrency.
//
// MEXC requests are therefore controlled and predictable.
//
// ============================================================

async function scanSymbols(
  client,
  symbols,
  timeframe
) {
  if (
    !Array.isArray(
      symbols
    ) ||
    !symbols.length
  ) {
    return;
  }

  for (
    const symbol of
      symbols
  ) {
    await scanSymbol(
      client,
      symbol,
      timeframe
    );
  }
}


// ============================================================
// SCAN TIMEFRAME INTERNAL
// ============================================================

async function scanTimeframeInternal(
  client,
  timeframe
) {
  const normalized =
    normalizeTF(
      timeframe
    );

  if (
    !TIMEFRAME_MS[
      normalized
    ]
  ) {
    console.warn(
      `[CRT] Unsupported timeframe: ${timeframe}`
    );

    return;
  }

  if (
    scanRunning.has(
      normalized
    )
  ) {
    console.warn(
      `[CRT] ${normalized} scan already running.`
    );

    return;
  }

  scanRunning.add(
    normalized
  );

  try {

    await refreshSymbols();

    const symbols =
      [
        ...cachedSymbols,
      ];

    if (
      !symbols.length
    ) {
      console.warn(
        `[CRT] No MEXC Futures symbols for ${normalized}`
      );

      return;
    }

    console.log(
      `[CRT] TIMEFRAME SCAN -> ${normalized}` +
      ` | UTC=${formatUTC(Date.now())}` +
      ` | Symbols=${symbols.length}`
    );

    await scanSymbols(
      client,
      symbols,
      normalized
    );

  } finally {

    scanRunning.delete(
      normalized
    );
  }
}


// ============================================================
// GLOBAL PRIORITY SCAN
// ============================================================
//
// If several timeframe boundaries happen together:
//
//   5m
//   15m
//   30m
//   1h
//
// they are queued instead of running together.
//
// ============================================================

function queueTimeframeScan(
  client,
  timeframe
) {
  timeframeScanChain =
    timeframeScanChain
      .then(
        () =>
          scanTimeframeInternal(
            client,
            timeframe
          )
      )
      .catch(
        (error) => {
          console.error(
            `[CRT] Queued ${timeframe} scan failed:`,
            error?.message ||
              error
          );
        }
      );

  return timeframeScanChain;
}


// ============================================================
// SCHEDULE ONE TIMEFRAME
// ============================================================

function scheduleTimeframe(
  client,
  timeframe
) {
  const normalized =
    normalizeTF(
      timeframe
    );

  if (
    !TIMEFRAME_MS[
      normalized
    ]
  ) {
    console.warn(
      `[CRT] Cannot schedule unsupported timeframe: ${timeframe}`
    );

    return;
  }

  const existing =
    timeframeTimers.get(
      normalized
    );

  if (
    existing
  ) {
    clearTimeout(
      existing
    );
  }

  const now =
    Date.now();

  const currentBoundary =
    getCurrentBoundary(
      normalized,
      now
    );

  const scanTime =
    getNextScanTime(
      normalized,
      now
    );

  if (
    scanTime ===
    null
  ) {
    return;
  }

  const catchup =
    currentBoundary !==
      null &&
    now >=
      currentBoundary &&
    now -
        currentBoundary <=
      CATCHUP_WINDOW_MS;

  const delay =
    Math.max(
      100,
      scanTime -
        now
    );

  console.log(
    `[CRT] ${normalized} next scan: ${formatUTC(scanTime)}` +
    ` | Catch-up=${catchup ? 'YES' : 'NO'}`
  );

  const timer =
    setTimeout(
      async () => {

        try {

          console.log(
            `[CRT] ${normalized} boundary reached -> queueing scan`
          );

          await queueTimeframeScan(
            client,
            normalized
          );

        } catch (
          error
        ) {

          console.error(
            `[CRT] Scheduled ${normalized} scan failed:`,
            error?.message ||
              error
          );

        } finally {

          // --------------------------------------------------
          // ALWAYS schedule the next boundary.
          // --------------------------------------------------

          scheduleTimeframe(
            client,
            normalized
          );
        }
      },
      delay
    );

  timeframeTimers.set(
    normalized,
    timer
  );
}


// ============================================================
// SCHEDULE ALL TIMEFRAMES
// ============================================================

function scheduleAllTimeframes(
  client
) {
  const timeframes =
    getConfiguredTimeframes();

  for (
    const timeframe of
      timeframes
  ) {
    scheduleTimeframe(
      client,
      timeframe
    );
  }
}


// ============================================================
// INITIALIZE BASELINE
// ============================================================
//
// IMPORTANT:
//
// Startup baseline is also sequential.
//
// This avoids a Railway restart generating a massive burst
// of MEXC requests.
//
// ============================================================

async function initializeBaseline() {
  const timeframes =
    getConfiguredTimeframes();

  await refreshSymbols();

  if (
    !cachedSymbols.length
  ) {
    console.warn(
      '[CRT] Cannot initialize baseline: no MEXC Futures symbols.'
    );

    return;
  }

  console.log(
    `[CRT] Initializing baseline for ${cachedSymbols.length} symbols.`
  );

  for (
    const timeframe of
      timeframes
  ) {

    console.log(
      `[CRT] Baseline timeframe -> ${timeframe}`
    );

    for (
      const symbol of
        cachedSymbols
    ) {
      await bootstrapSymbol(
        symbol,
        timeframe
      );
    }
  }

  console.log(
    '[CRT] Startup baseline initialized.'
  );
}


// ============================================================
// START CRT MONITOR
// ============================================================

export function startCRTMonitor(
  client
) {
  if (
    monitorStarted
  ) {
    return;
  }

  // ----------------------------------------------------------
  // CONFIG DISABLE
  // ----------------------------------------------------------

  if (
    CRT_CONFIG.enabled ===
      false ||
    CRT_CONFIG.autoAlerts ===
      false
  ) {
    console.log(
      '[CRT] Signal monitor disabled by configuration.'
    );

    return;
  }

  if (
    !client
  ) {
    throw new Error(
      'Discord client is required for CRT monitor'
    );
  }

  monitorStarted =
    true;

  console.log(
    '============================================================'
  );

  console.log(
    '[CRT] PDYN CRT MONITOR STARTED'
  );

  console.log(
    '[CRT] MARKET SOURCE: MEXC FUTURES ONLY'
  );

  console.log(
    '[CRT] SPOT: DISABLED'
  );

  console.log(
    '[CRT] PRIMARY: Rachel T Fractal + CRT Confirmation'
  );

  console.log(
    `[CRT] TIMEFRAMES: ${getConfiguredTimeframes().join(', ')}`
  );

  console.log(
    `[CRT] KLINE LIMIT: ${KLINE_LIMIT}`
  );

  console.log(
    `[CRT] MAX SYMBOLS: ${MAX_SYMBOLS}`
  );

  console.log(
    '[CRT] REQUEST CONCURRENCY: 1'
  );

  console.log(
    `[CRT] REQUEST SPACING: ${REQUEST_SPACING_MS}ms`
  );

  console.log(
    `[CRT] RATE LIMIT RETRIES: ${RATE_LIMIT_RETRIES}`
  );

  console.log(
    `[CRT] BOUNDARY DELAY: ${BOUNDARY_DELAY_MS}ms`
  );

  console.log(
    `[CRT] CATCH-UP WINDOW: ${CATCHUP_WINDOW_MS}ms`
  );

  console.log(
    '[CRT] TIME STANDARD: MEXC FUTURES UTC'
  );

  console.log(
    '[CRT] RESTART REPLAY: DISABLED'
  );

  console.log(
    '[CRT] FAILED REQUEST RETRY: ENABLED'
  );

  console.log(
    '[CRT] GLOBAL TIMEFRAME QUEUE: ENABLED'
  );

  console.log(
    '============================================================'
  );


  // ==========================================================
  // STARTUP
  // ==========================================================

  void (
    async () => {

      try {

        await initializeBaseline();

      } catch (
        error
      ) {

        console.error(
          '[CRT] Startup baseline failed:',
          error?.message ||
            error
        );
      }

      // ------------------------------------------------------
      // IMPORTANT:
      //
      // Schedule AFTER baseline.
      //
      // If the bot starts at 22:00:03, the 15m scheduler
      // detects that the 22:00 boundary is still inside the
      // catch-up window and scans it.
      //
      // ------------------------------------------------------

      scheduleAllTimeframes(
        client
      );
    }
  )();
}


// ============================================================
// MANUAL CRT SCAN
// ============================================================

export async function scanCRTNow(
  client
) {
  if (
    !client
  ) {
    throw new Error(
      'Discord client is required for CRT scan'
    );
  }

  await refreshSymbols();

  const timeframes =
    getConfiguredTimeframes();

  for (
    const timeframe of
      timeframes
  ) {

    await queueTimeframeScan(
      client,
      timeframe
    );
  }
}


// ============================================================
// GET CRT CONFIG
// ============================================================

export function getCRTConfig() {
  return {

    markets: [
      'futures',
    ],

    timeframes:
      getConfiguredTimeframes(),

    timeframeMs:
      Object.fromEntries(
        getConfiguredTimeframes()
          .map(
            (timeframe) => [
              timeframe,
              getTimeframeMs(
                timeframe
              ),
            ]
          )
      ),

    klineLimit:
      KLINE_LIMIT,

    maxSymbolsPerMarket:
      MAX_SYMBOLS,

    autoSymbols:
      AUTO_SYMBOLS,

    boundaryDelayMs:
      BOUNDARY_DELAY_MS,

    requestSpacingMs:
      REQUEST_SPACING_MS,

    rateLimitRetries:
      RATE_LIMIT_RETRIES,

    catchupWindowMs:
      CATCHUP_WINDOW_MS,

    requestConcurrency:
      1,

    globalTimeframeQueue:
      true,

    rsi: {
      period:
        RSI_PERIOD,

      oversold:
        OVERSOLD,

      overbought:
        OVERBOUGHT,
    },

    primarySignal:
      'RACHEL_T_FRACTAL_CRT',

    supportingData: [
      'MARKET_STRUCTURE',
      'STD_DEVIATION',
      'FRACTAL',
      'LIQUIDITY_SWEEP',
      'RSI',
    ],

    source:
      'MEXC_FUTURES_ONLY',

    timing: {

      source:
        'MEXC_FUTURES_CANDLE_BOUNDARY',

      timezone:
        'UTC',

      restartReplay:
        false,

      onlyNewClosedCandle:
        true,

      requireCRTOnLatestClosedCandle:
        true,

      catchUpAfterBoundary:
        true,
    },

    rateLimitProtection: {

      singleRequestAtATime:
        true,

      spacingMs:
        REQUEST_SPACING_MS,

      retries:
        RATE_LIMIT_RETRIES,

      exponentialBackoff:
        true,
    },

    display: {

      fractalRule:
        'BEARISH=TOP | BULLISH=BOTTOM',

      crtField:
        'Potential CRT',

      showFractalPrice:
        false,
    },
  };
}


// ============================================================
// SERVICE LOADED
// ============================================================

console.log(
  `[CRT] Service loaded • Rachel T Fractal PRIMARY • MEXC FUTURES ONLY • ${getConfiguredTimeframes().join(', ')}`
);

console.log(
  '[CRT] Candle timing: MEXC Futures UTC boundaries'
);

console.log(
  '[CRT] Fractal display: Bearish → TOP | Bullish → BOTTOM'
);

console.log(
  '[CRT] Discord field: Potential CRT'
);

console.log(
  '[CRT] Fractal Price: DISABLED'
);

console.log(
  '[CRT] Spot scanning: DISABLED'
);

console.log(
  '[CRT] Historical restart replay: DISABLED'
);

console.log(
  `[CRT] MEXC request spacing: ${REQUEST_SPACING_MS}ms`
);

console.log(
  '[CRT] MEXC request concurrency: 1'
);

console.log(
  '[CRT] MEXC rate-limit retry protection: ENABLED'
);

console.log(
  '[CRT] Boundary catch-up protection: ENABLED'
);

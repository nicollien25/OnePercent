// ============================================================
// OnePERCENT CRT SERVICE
// ============================================================
//
// Rachel T Fractal + CRT Confirmation
//
// DATA SOURCE:
//   MEXC FUTURES ONLY
//
// TIMEFRAMES:
//   5m
//   15m
//   30m
//   1h
//   4h
//   1d
//
// IMPORTANT:
//
// This service is synchronized to MEXC Futures candle boundaries.
//
// MEXC Futures candle timestamps are UTC.
//
// Discord display timezone can be Manila,
// but candle calculations remain UTC.
//
// ============================================================

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
} from './mexcService.js';

import { isNewSignal } from './signalManager.js';

// ============================================================
// CONFIG
// ============================================================

const CRT_CONFIG =
  botConfig?.crt || {};

// ============================================================
// MARKET
// ============================================================

const MARKET =
  'futures';

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
// KLINE LIMIT
// ============================================================

const KLINE_LIMIT =
  Math.max(
    50,
    Number(
      CRT_CONFIG.klineLimit || 100
    )
  );

// ============================================================
// MAX SYMBOLS
// ============================================================

const MAX_SYMBOLS =
  Math.max(
    1,
    Number(
      CRT_CONFIG.maxSymbolsPerMarket || 30
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
    CRT_CONFIG.rsi?.period || 14
  );

const OVERSOLD =
  Number(
    CRT_CONFIG.rsi?.oversold || 30
  );

const OVERBOUGHT =
  Number(
    CRT_CONFIG.rsi?.overbought || 70
  );

// ============================================================
// AUTO SYMBOLS
// ============================================================

const AUTO_SYMBOLS =
  CRT_CONFIG.autoSymbols !== false;

// ============================================================
// BOUNDARY DELAY
// ============================================================
//
// MEXC candle boundary:
//
// 22:15:00 UTC
//
// Scan:
//
// 22:15:00 + delay
//
// This gives MEXC a short amount of time to publish the
// completed candle.
//
// ============================================================

const BOUNDARY_DELAY_MS =
  Math.max(
    250,
    Number(
      CRT_CONFIG.boundaryDelayMs || 1500
    )
  );

// ============================================================
// MEXC REQUEST SPACING
// ============================================================
//
// Only ONE request is allowed at a time.
//
// This protects against MEXC 510.
//
// ============================================================

const REQUEST_SPACING_MS =
  Math.max(
    250,
    Number(
      CRT_CONFIG.requestSpacingMs || 450
    )
  );

// ============================================================
// RATE LIMIT RETRIES
// ============================================================

const RATE_LIMIT_RETRIES =
  Math.max(
    1,
    Number(
      CRT_CONFIG.rateLimitRetries || 4
    )
  );

// ============================================================
// RATE LIMIT BACKOFF
// ============================================================

const RATE_LIMIT_BACKOFF =
  Math.max(
    500,
    Number(
      CRT_CONFIG.rateLimitBackoffMs || 1500
    )
  );

// ============================================================
// CATCH-UP WINDOW
// ============================================================
//
// If the service is slightly late:
//
// boundary = 22:15:00
// current   = 22:15:04
//
// it is still allowed to scan the 22:15 candle.
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
// TIMEFRAME SCAN STATE
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
// ============================================================

const lastProcessedCandle =
  new Map();

// ============================================================
// STARTUP BASELINE
// ============================================================

const bootstrapped =
  new Set();

// ============================================================
// TIMEFRAME TIMERS
// ============================================================

const timeframeTimers =
  new Map();

// ============================================================
// GLOBAL MEXC REQUEST QUEUE
// ============================================================
//
// Every MEXC request passes through this queue.
//
// This prevents:
//
// Promise.all()
// request storms
// MEXC code 510
//
// ============================================================

let mexcRequestChain =
  Promise.resolve();

let lastMexcRequestTime =
  0;

// ============================================================
// GLOBAL TIMEFRAME QUEUE
// ============================================================
//
// If 5m, 15m, 30m and 1h close together,
// they are processed in priority order.
//
// ============================================================

let timeframeScanChain =
  Promise.resolve();

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
// CONFIGURED TIMEFRAMES
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

    '5m':
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

    '15m':
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

    '30m':
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

    '1h':
      '1h',

    '1hr':
      '1h',

    '1hour':
      '1h',

    '240':
      '4h',

    '240m':
      '4h',

    '4h':
      '4h',

    '4hr':
      '4h',

    '4hour':
      '4h',

    '1440':
      '1d',

    '1440m':
      '1d',

    '1d':
      '1d',

    '1day':
      '1d',

    'day':
      '1d',

    'daily':
      '1d',
  };

  const normalized =
    aliases[value] ||
    value;

  try {
    return normalizeTimeframe(
      normalized
    );
  } catch {
    return normalized;
  }
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
  const normalized =
    normalizeTF(
      timeframe
    );

  return (
    TIMEFRAME_MS[
      normalized
    ] ||
    null
  );
}

// ============================================================
// CURRENT UTC CANDLE BOUNDARY
// ============================================================
//
// MEXC Futures timestamps are UTC.
//
// DO NOT apply Manila offset here.
//
// ============================================================

function getCurrentBoundary(
  timeframe,
  now = Date.now()
) {
  const interval =
    getTimeframeMs(
      timeframe
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
// NEXT UTC CANDLE BOUNDARY
// ============================================================

function getNextBoundary(
  timeframe,
  now = Date.now()
) {
  const interval =
    getTimeframeMs(
      timeframe
    );

  if (
    !interval
  ) {
    return null;
  }

  const current =
    getCurrentBoundary(
      timeframe,
      now
    );

  return (
    current + interval
  );
}

// ============================================================
// NEXT SCAN TIME
// ============================================================
//
// Handles both:
//
// 1. normal scheduling
// 2. late boundary catch-up
//
// ============================================================

function getNextScanTime(
  timeframe,
  now = Date.now()
) {
  const interval =
    getTimeframeMs(
      timeframe
    );

  if (
    !interval
  ) {
    return null;
  }

  const currentBoundary =
    getCurrentBoundary(
      timeframe,
      now
    );

  if (
    currentBoundary ===
    null
  ) {
    return null;
  }

  const elapsed =
    now -
    currentBoundary;

  // ----------------------------------------------------------
  // We are shortly after a boundary.
  // ----------------------------------------------------------

  if (
    elapsed >= 0 &&
    elapsed <=
      CATCHUP_WINDOW_MS
  ) {
    return (
      now +
      BOUNDARY_DELAY_MS
    );
  }

  // ----------------------------------------------------------
  // Normal next boundary.
  // ----------------------------------------------------------

  return (
    currentBoundary +
    interval +
    BOUNDARY_DELAY_MS
  );
}

// ============================================================
// FORMAT UTC
// ============================================================

function formatUTC(
  timestamp
) {
  const value =
    Number(
      timestamp
    );

  if (
    !Number.isFinite(
      value
    )
  ) {
    return 'N/A';
  }

  return new Date(
    value
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
// FORMAT MANILA
// ============================================================

function formatManila(
  timestamp
) {
  const value =
    Number(
      timestamp
    );

  if (
    !Number.isFinite(
      value
    )
  ) {
    return 'N/A';
  }

  return new Intl.DateTimeFormat(
    'en-PH',
    {
      timeZone:
        'Asia/Manila',

      year:
        'numeric',

      month:
        '2-digit',

      day:
        '2-digit',

      hour:
        '2-digit',

      minute:
        '2-digit',

      second:
        '2-digit',

      hour12:
        false,
    }
  ).format(
    new Date(
      value
    )
  );
}

// ============================================================
// NUMBER FORMAT
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
    return signal.confirmedFractals;
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
    fractals.length
  ) {
    return (
      fractals[
        fractals.length - 1
      ]
    );
  }

  return (
    signal?.latestConfirmedFractal ??
    signal?.latestFractal ??
    signal?.crtFractal ??
    signal?.displayFractal ??
    signal?.fractal ??
    null
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

  const latest =
    getLatestConfirmedFractal(
      signal
    );

  return (
    String(
      latest?.type ||
      ''
    )
      .toUpperCase() ===
      'TOP'
      ? latest
      : null
  );
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

  const latest =
    getLatestConfirmedFractal(
      signal
    );

  return (
    String(
      latest?.type ||
      ''
    )
      .toUpperCase() ===
      'BOTTOM'
      ? latest
      : null
  );
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

  const latestType =
    String(
      latest?.type ||
      latest?.fractalType ||
      ''
    )
      .trim()
      .toUpperCase();

  if (
    latestType.includes(
      'TOP'
    )
  ) {
    return 'TOP';
  }

  if (
    latestType.includes(
      'BOTTOM'
    )
  ) {
    return 'BOTTOM';
  }

  const raw =
    signal?.fractalType ??
    signal?.fractal?.type ??
    signal?.type ??
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
      return '**PREVIOUS HIGH SWEPT**';
    }

    if (
      type ===
      'LOW'
    ) {
      return '**PREVIOUS LOW SWEPT**';
    }

    return '**LIQUIDITY SWEPT**';
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
    !signal
  ) {
    return false;
  }

  if (
    signal.confirmed ===
    false
  ) {
    return false;
  }

  if (
    signal.confirmedCRT ===
    false
  ) {
    return false;
  }

  if (
    signal.crtConfirmed ===
    false
  ) {
    return false;
  }

  if (
    signal.potentialCRT ===
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
// SIGNAL COLOR
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
      /[_-]USDT$/i,
      ''
    )
    .replace(
      /USDT$/i,
      ''
    )
    .replace(
      /[_-]USD$/i,
      ''
    )
    .replace(
      /USD$/i,
      ''
    )
    .replace(
      /[_-]+$/,
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
    openTime ===
      null ||
    interval ===
      null
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
// CANDLE CLOSED
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

  return (
    Number.isFinite(
      Number(
        candle.open
      )
    ) &&
    Number.isFinite(
      Number(
        candle.high
      )
    ) &&
    Number.isFinite(
      Number(
        candle.low
      )
    ) &&
    Number.isFinite(
      Number(
        candle.close
      )
    )
  );
}

// ============================================================
// CLOSED CANDLES
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

  const directCandle =
    getCandleOpenTime(
      signal?.crtCandle
    );

  if (
    directCandle !==
    null
  ) {
    return directCandle;
  }

  return null;
}

// ============================================================
// SIGNAL MATCHES CURRENT CLOSED CANDLE
// ============================================================

function signalMatchesLatestClosedCandle(
  signal,
  candle
) {
  const signalTime =
    getSignalCRTCandleTime(
      signal
    );

  const candleTime =
    getCandleOpenTime(
      candle
    );

  if (
    signalTime ===
      null ||
    candleTime ===
      null
  ) {
    return false;
  }

  return (
    signalTime ===
    candleTime
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
    String(
      symbol
    ).toUpperCase(),
  ].join(':');
}

// ============================================================
// SIGNAL EMBED
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

  const fractal =
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

  const std =
    getStdDeviation(
      signal
    );

  const crtTime =
    getSignalCRTCandleTime(
      signal
    );

  const direction =
    String(
      signal.direction ||
      ''
    )
      .toUpperCase();

  const embed =
    new EmbedBuilder()
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
            'Direction',

          value:
            direction ||
            'N/A',

          inline:
            true,
        },

        {
          name:
            'STD Deviation',

          value:
            std,

          inline:
            true,
        },

        {
          name:
            'Fractal',

          value:
            fractal,

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
        },

        {
          name:
            'Candle Close',

          value:
            crtTime !==
            null
              ? `${formatUTC(
                  crtTime
                )}\n${formatManila(
                  crtTime
                )} Manila`
              : 'N/A',

          inline:
            false,
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

  return embed;
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

  let channel;

  try {
    channel =
      await client.channels.fetch(
        channelId
      );
  } catch (
    error
  ) {
    console.error(
      `[CRT] Failed to fetch Discord channel ${timeframe}:`,
      error?.message ||
        error
    );

    return false;
  }

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

  try {
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
  } catch (
    error
  ) {
    console.error(
      `[CRT] Discord send failed ${coin}:${timeframe}:`,
      error?.message ||
        error
    );

    return false;
  }
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

  // ----------------------------------------------------------
  // Explicit environment symbols have priority.
  // ----------------------------------------------------------

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
    !AUTO_SYMBOLS
  ) {
    return [];
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
    )
      .trim()
      .toUpperCase();

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
            )
              .toUpperCase();

          const quoteCoin =
            String(
              item?.quoteCoin ||
              ''
            )
              .toUpperCase();

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

    const filtered =
      filterSymbols(
        contracts
      );

    if (
      filtered.length
    ) {
      cachedSymbols =
        filtered;

      lastSymbolRefresh =
        Date.now();

      console.log(
        `[CRT] MEXC Futures symbols loaded: ${cachedSymbols.length}`
      );

      return;
    }

    console.warn(
      '[CRT] MEXC returned no usable Futures symbols.'
    );

    if (
      !cachedSymbols.length
    ) {
      cachedSymbols =
        [];
    }
  } catch (
    error
  ) {
    console.error(
      '[CRT] Failed to refresh MEXC Futures symbols:',
      error?.message ||
        error
    );

    // Keep existing cache.
  }
}

// ============================================================
// RATE LIMIT DETECTION
// ============================================================

function isRateLimitError(
  error
) {
  const message =
    String(
      error?.message ||
      error ||
      ''
    )
      .toLowerCase();

  return (
    message.includes(
      '510'
    ) ||
    message.includes(
      'too frequent'
    ) ||
    message.includes(
      'rate limit'
    ) ||
    message.includes(
      'requests are too frequent'
    )
  );
}

// ============================================================
// MEXC REQUEST QUEUE
// ============================================================
//
// IMPORTANT:
//
// Do not remove this.
//
// The updated mexcService performs the actual HTTP request,
// while this service controls request frequency.
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

            return await request();
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
              `[CRT] MEXC rate limit. ` +
              `Retry ${attempt}/${RATE_LIMIT_RETRIES} ` +
              `in ${backoff}ms`
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
// Compatible with the updated mexcService:
//
// getKlines({
//   market,
//   symbol,
//   timeframe,
//   limit
// })
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
// LATEST CLOSED CANDLE
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
// IMPORTANT:
//
// Startup does not alert.
//
// The latest already-closed candle becomes the baseline.
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
      `[CRT] Bootstrap ${symbol}:${normalized}` +
      ` -> ${formatUTC(latestTime)}`
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

    return false;
  }
}

// ============================================================
// BUILD ENGINE SIGNAL
// ============================================================

function buildCurrentSignal(
  symbol,
  timeframe,
  closed
) {
  const normalized =
    normalizeTF(
      timeframe
    );

  return buildSignal({
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
        CRT_CONFIG.requireCloseInside !==
        false,

      useCloseDirection:
        CRT_CONFIG.useCloseDirection ===
        true,

      minBodyRatio:
        Number(
          CRT_CONFIG.minBodyRatio ||
          0
        ),
    },
  });
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
    // FETCH CLOSED MEXC CANDLES
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
        `[CRT] Not enough candles ` +
        `${symbol}:${normalized} ` +
        `(${closed.length}/${MINIMUM_CANDLES})`
      );

      return;
    }

    // --------------------------------------------------------
    // LATEST CLOSED CANDLE
    // --------------------------------------------------------

    const latest =
      getLatestClosedCandle(
        closed
      );

    if (
      !latest
    ) {
      return;
    }

    const latestTime =
      getCandleOpenTime(
        latest
      );

    if (
      latestTime ===
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
        latestTime
      );

      bootstrapped.add(
        key
      );

      console.log(
        `[CRT] Startup baseline ` +
        `${symbol}:${normalized} ` +
        `-> ${formatUTC(latestTime)}`
      );

      return;
    }

    // --------------------------------------------------------
    // SAME CANDLE
    // --------------------------------------------------------

    const previous =
      lastProcessedCandle.get(
        key
      );

    if (
      previous ===
      latestTime
    ) {
      return;
    }

    // --------------------------------------------------------
    // LOG NEW CANDLE
    // --------------------------------------------------------

    console.log(
      `[CRT] NEW CLOSED CANDLE ` +
      `${symbol}:${normalized}` +
      ` | UTC=${formatUTC(latestTime)}` +
      ` | Manila=${formatManila(latestTime)}`
    );

    // --------------------------------------------------------
    // BUILD SIGNAL
    // --------------------------------------------------------

    const signal =
      buildCurrentSignal(
        symbol,
        normalized,
        closed
      );

    // --------------------------------------------------------
    // ENGINE RETURNED NOTHING
    // --------------------------------------------------------

    if (
      !signal
    ) {
      lastProcessedCandle.set(
        key,
        latestTime
      );

      return;
    }

    // --------------------------------------------------------
    // MUST BE CONFIRMED
    // --------------------------------------------------------

    if (
      !isConfirmedSignal(
        signal
      )
    ) {
      console.log(
        `[CRT] Not confirmed ` +
        `${symbol}:${normalized}`
      );

      lastProcessedCandle.set(
        key,
        latestTime
      );

      return;
    }

    // --------------------------------------------------------
    // CRITICAL CURRENT-CANDLE CHECK
    // --------------------------------------------------------
    //
    // The updated crtEngine exposes:
    //
    // signal.crtCandleTime
    //
    // We require:
    //
    // signal.crtCandleTime === latest MEXC candle
    //
    // This prevents old fractals from generating a new alert.
    //
    // --------------------------------------------------------

    const signalCRTTime =
      getSignalCRTCandleTime(
        signal
      );

    if (
      signalCRTTime ===
      null
    ) {
      console.log(
        `[CRT] Rejected: no CRT candle time ` +
        `${symbol}:${normalized}`
      );

      lastProcessedCandle.set(
        key,
        latestTime
      );

      return;
    }

    if (
      signalCRTTime !==
      latestTime
    ) {
      console.log(
        `[CRT] Old CRT rejected ` +
        `${symbol}:${normalized}` +
        ` | Latest=${formatUTC(latestTime)}` +
        ` | CRT=${formatUTC(signalCRTTime)}`
      );

      lastProcessedCandle.set(
        key,
        latestTime
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
        `[CRT] Signal missing ID ` +
        `${symbol}:${normalized}`
      );

      lastProcessedCandle.set(
        key,
        latestTime
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
      console.log(
        `[CRT] Duplicate signal blocked ` +
        `${signal.id}`
      );

      lastProcessedCandle.set(
        key,
        latestTime
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
    // ONLY MARK SUCCESSFULLY SENT CANDLE
    // --------------------------------------------------------

    if (
      sent
    ) {
      lastProcessedCandle.set(
        key,
        latestTime
      );

      console.log(
        `[CRT] ==================================================`
      );

      console.log(
        `[CRT] RACHEL T CRT CONFIRMED`
      );

      console.log(
        `[CRT] Symbol: ${symbol}`
      );

      console.log(
        `[CRT] Timeframe: ${normalized}`
      );

      console.log(
        `[CRT] Candle UTC: ${formatUTC(latestTime)}`
      );

      console.log(
        `[CRT] Candle Manila: ${formatManila(latestTime)}`
      );

      console.log(
        `[CRT] Structure: ${getMarketStructure(signal)}`
      );

      console.log(
        `[CRT] Direction: ${signal.direction || 'N/A'}`
      );

      console.log(
        `[CRT] Fractal: ${getFractalType(signal)}`
      );

      console.log(
        `[CRT] STD: ${getStdDeviation(signal)}`
      );

      console.log(
        `[CRT] Liquidity: ${getLiquiditySweep(signal)}`
      );

      console.log(
        `[CRT] RSI: ${signal.rsiState || 'Neutral'}`
      );

      console.log(
        `[CRT] ==================================================`
      );
    } else {
      console.warn(
        `[CRT] Discord send failed. ` +
        `Candle remains retryable: ` +
        `${symbol}:${normalized}`
      );
    }
  } catch (
    error
  ) {
    // --------------------------------------------------------
    // DO NOT MARK CANDLE PROCESSED.
    //
    // This is important for MEXC/API failures.
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
// NEVER use Promise.all here.
//
// This works together with queueMexcRequest().
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
// SCAN ONE TIMEFRAME
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
      `[CRT] ${normalized} scan already running`
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
        `[CRT] No Futures symbols available for ${normalized}`
      );

      return;
    }

    console.log(
      `[CRT] ==================================================`
    );

    console.log(
      `[CRT] TIMEFRAME SCAN`
    );

    console.log(
      `[CRT] Timeframe: ${normalized}`
    );

    console.log(
      `[CRT] UTC: ${formatUTC(Date.now())}`
    );

    console.log(
      `[CRT] Manila: ${formatManila(Date.now())}`
    );

    console.log(
      `[CRT] Symbols: ${symbols.length}`
    );

    console.log(
      `[CRT] ==================================================`
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
// GLOBAL TIMEFRAME QUEUE
// ============================================================
//
// When several timeframes close simultaneously:
//
// 5m
// 15m
// 30m
// 1h
//
// they are processed sequentially.
//
// ============================================================

function queueTimeframeScan(
  client,
  timeframe
) {
  const normalized =
    normalizeTF(
      timeframe
    );

  timeframeScanChain =
    timeframeScanChain
      .then(
        () =>
          scanTimeframeInternal(
            client,
            normalized
          )
      )
      .catch(
        (error) => {
          console.error(
            `[CRT] Queued ${normalized} scan failed:`,
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
      `[CRT] Cannot schedule ${timeframe}`
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

  const elapsed =
    now -
    currentBoundary;

  let scanTime;

  // ----------------------------------------------------------
  // CATCH-UP
  // ----------------------------------------------------------

  if (
    elapsed >= 0 &&
    elapsed <=
      CATCHUP_WINDOW_MS
  ) {
    scanTime =
      now +
      BOUNDARY_DELAY_MS;
  } else {
    scanTime =
      getNextScanTime(
        normalized,
        now
      );
  }

  if (
    scanTime ===
    null
  ) {
    return;
  }

  const delay =
    Math.max(
      100,
      scanTime -
        now
    );

  console.log(
    `[CRT] ${normalized} scheduled`
  );

  console.log(
    `[CRT] Current boundary: ${formatUTC(currentBoundary)}`
  );

  console.log(
    `[CRT] Scan time: ${formatUTC(scanTime)}`
  );

  console.log(
    `[CRT] Catch-up: ${
      elapsed >= 0 &&
      elapsed <=
        CATCHUP_WINDOW_MS
        ? 'YES'
        : 'NO'
    }`
  );

  const timer =
    setTimeout(
      async () => {
        try {
          console.log(
            `[CRT] ${normalized} candle boundary reached`
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
// INITIALIZE STARTUP BASELINE
// ============================================================
//
// Sequential on purpose.
//
// This prevents Railway restart request storms.
//
// ============================================================

async function initializeBaseline() {
  const timeframes =
    getConfiguredTimeframes();

  await refreshSymbols(
    true
  );

  if (
    !cachedSymbols.length
  ) {
    console.warn(
      '[CRT] Startup baseline skipped: no MEXC Futures symbols.'
    );

    return;
  }

  console.log(
    `[CRT] Startup baseline: ${cachedSymbols.length} symbols`
  );

  for (
    const timeframe of
      timeframes
  ) {
    console.log(
      `[CRT] Baseline timeframe: ${timeframe}`
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
    '[CRT] Startup baseline complete.'
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
    console.warn(
      '[CRT] Monitor already started.'
    );

    return;
  }

  if (
    CRT_CONFIG.enabled ===
      false ||
    CRT_CONFIG.autoAlerts ===
      false
  ) {
    console.log(
      '[CRT] CRT monitor disabled by configuration.'
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
    '[CRT] SOURCE: MEXC FUTURES ONLY'
  );

  console.log(
    '[CRT] PRIMARY: Rachel T Fractal + CRT Confirmation'
  );

  console.log(
    `[CRT] TIMEFRAMES: ${getConfiguredTimeframes().join(', ')}`
  );

  console.log(
    `[CRT] MAX SYMBOLS: ${MAX_SYMBOLS}`
  );

  console.log(
    `[CRT] KLINE LIMIT: ${KLINE_LIMIT}`
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
    '[CRT] REQUEST CONCURRENCY: 1'
  );

  console.log(
    '[CRT] GLOBAL TIMEFRAME QUEUE: ENABLED'
  );

  console.log(
    '[CRT] RESTART REPLAY: DISABLED'
  );

  console.log(
    '[CRT] ONLY NEW CLOSED CANDLES: ENABLED'
  );

  console.log(
    '[CRT] CURRENT CRT CANDLE MATCH: REQUIRED'
  );

  console.log(
    '[CRT] CANDLE TIMEZONE: UTC'
  );

  console.log(
    '[CRT] DISPLAY TIMEZONE: Asia/Manila'
  );

  console.log(
    '============================================================'
  );

  void (
    async () => {
      try {
        await initializeBaseline();
      } catch (
        error
      ) {
        console.error(
          '[CRT] Startup baseline error:',
          error?.message ||
            error
        );
      }

      // ------------------------------------------------------
      // IMPORTANT:
      //
      // Scheduling happens AFTER baseline.
      //
      // The scheduler still checks whether the current
      // boundary is inside the catch-up window.
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

  await refreshSymbols(
    true
  );

  for (
    const timeframe of
      getConfiguredTimeframes()
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

    source:
      'MEXC_FUTURES_ONLY',

    primarySignal:
      'RACHEL_T_FRACTAL_CRT',

    timeframes:
      getConfiguredTimeframes(),

    timeframeMs:
      Object.fromEntries(
        getConfiguredTimeframes().map(
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

    catchupWindowMs:
      CATCHUP_WINDOW_MS,

    requestSpacingMs:
      REQUEST_SPACING_MS,

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

    timing: {
      source:
        'MEXC_FUTURES_CANDLE_BOUNDARY',

      timezone:
        'UTC',

      displayTimezone:
        'Asia/Manila',

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

      source:
        'MEXC Futures',
    },
  };
}

// ============================================================
// SERVICE LOADED
// ============================================================

console.log(
  `[CRT] Service loaded | MEXC Futures | ` +
  `${getConfiguredTimeframes().join(', ')}`
);

console.log(
  '[CRT] Rachel T Filtered Top / Bottom Fractal'
);

console.log(
  '[CRT] CRT confirmation must belong to latest closed candle'
);

console.log(
  '[CRT] MEXC candle timing: UTC'
);

console.log(
  '[CRT] Display timezone: Asia/Manila'
);

console.log(
  '[CRT] Spot scanning: DISABLED'
);

console.log(
  '[CRT] Restart replay: DISABLED'
);

console.log(
  `[CRT] Request spacing: ${REQUEST_SPACING_MS}ms`
);

console.log(
  '[CRT] Request concurrency: 1'
);

console.log(
  '[CRT] Rate-limit protection: ENABLED'
);

console.log(
  '[CRT] Boundary catch-up: ENABLED'
);

import { EmbedBuilder } from 'discord.js';
import botConfig from '../../config/bot.js';

import { buildSignal } from './crtEngine.js';

import {
  getKlines,
  getFuturesContracts,
  getConfiguredSymbols,
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
// IMPORTANT TIME RULE:
//
//   This service does NOT use one generic polling interval
//   to decide when a timeframe closes.
//
//   Every timeframe has its own MEXC candle boundary.
//
//   5m  -> every 5 minutes
//   15m -> every 15 minutes
//   30m -> every 30 minutes
//   1h  -> every hour
//   4h  -> every 4 hours
//   1d  -> every 24 hours
//
// MEXC Futures candle boundaries are UTC based.
//
// Example:
//
//   08:00
//
//   15m candle:
//     08:00 -> 08:14:59
//     closes at 08:15
//
//   1h candle:
//     08:00 -> 08:59:59
//     closes at 09:00
//
//   4h candle:
//     08:00 -> 11:59:59
//     closes at 12:00
//
// Therefore:
//
//   At 08:15:
//
//      15m -> scan
//      1h  -> DO NOT scan
//      4h  -> DO NOT scan
//
//   At 09:00:
//
//      15m -> scan
//      30m -> scan
//      1h  -> scan
//      4h  -> DO NOT scan
//
//   At 12:00:
//
//      15m -> scan
//      30m -> scan
//      1h  -> scan
//      4h  -> scan
//
// ============================================================
//
// SIGNAL RULE:
//
//   The engine may find an older confirmed fractal from the
//   historical candle set.
//
//   That is NOT enough to create a new Discord alert.
//
//   The CRT candle itself must equal the newly closed MEXC
//   candle for that timeframe.
//
// Therefore:
//
//   signal.crtCandleTime === latestClosedCandle.openTime
//
// must be true before an alert is sent.
//
// ============================================================
//
// STARTUP RULE:
//
//   When Railway/bot starts, the service bootstraps the latest
//   closed candle for each symbol/timeframe.
//
//   That candle is marked as already seen.
//
//   It is NOT alerted immediately.
//
// This prevents:
//
//   Railway restart
//        ↓
//   old confirmed candle
//        ↓
//   duplicate Discord alert
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
// TIMEFRAME DURATION
//
// These values MUST remain synchronized with MEXC Futures.
//
// MEXC:
//
//   Min5
//   Min15
//   Min30
//   Min60
//   Hour4
//   Day1
//
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
//
// MEXC FUTURES ONLY.
//
// Spot is intentionally impossible to scan through this
// service.
//
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
// SCAN DELAY
//
// MEXC candle boundary:
//
//   08:15:00
//
// We wait a small amount after the exact boundary before
// requesting the candle.
//
// This gives the exchange/API a moment to expose the newly
// closed candle consistently.
//
// ============================================================

const BOUNDARY_DELAY_MS =
  Math.max(
    250,
    Number(
      CRT_CONFIG.boundaryDelayMs ||
      1500
    )
  );

// ============================================================
// REQUEST CONCURRENCY
//
// We process a few symbols in parallel instead of sending
// hundreds of requests at exactly the same millisecond.
//
// ============================================================

const SCAN_CONCURRENCY =
  Math.max(
    1,
    Math.min(
      10,
      Number(
        CRT_CONFIG.scanConcurrency ||
        3
      )
    )
  );

// ============================================================
// STATE
// ============================================================

let monitorStarted =
  false;

let scanRunning =
  new Set();

let cachedSymbols =
  [];

let lastSymbolRefresh =
  0;

// ============================================================
// LAST PROCESSED CANDLE
//
// Key:
//
//   timeframe:symbol
//
// Value:
//
//   MEXC candle openTime
//
// This is separate from signalManager.
//
// signalManager prevents duplicate SIGNAL IDs.
//
// This map prevents the service from repeatedly processing
// the same MEXC candle boundary.
//
// ============================================================

const lastProcessedCandle =
  new Map();

// ============================================================
// BOOTSTRAP STATE
//
// Key:
//
//   timeframe:symbol
//
// Value:
//
//   true
//
// On the first scan after startup we mark the current latest
// closed candle as seen without sending an alert.
//
// ============================================================

const bootstrapped =
  new Set();

// ============================================================
// TIMER STATE
// ============================================================

const timeframeTimers =
  new Map();

// ============================================================
// TIMEFRAME PRIORITY
//
// Lower timeframe first.
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

function normalizeTimeframe(
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
    value
  );
}

// ============================================================
// TIMEFRAME LABEL
// ============================================================

function timeframeLabel(
  timeframe
) {
  const normalized =
    normalizeTimeframe(
      timeframe
    );

  return (
    {
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
    }[normalized] ||
    String(
      timeframe
    )
  );
}

// ============================================================
// TIMEFRAME MILLISECONDS
// ============================================================

function getTimeframeMs(
  timeframe
) {
  return (
    TIMEFRAME_MS[
      normalizeTimeframe(
        timeframe
      )
    ] ||
    null
  );
}

// ============================================================
// MEXC CANDLE BOUNDARY
//
// IMPORTANT:
//
// MEXC Futures timestamps are UTC based.
//
// We intentionally DO NOT use Asia/Manila here.
//
// TradingView/MEXC candle construction is based on the
// exchange candle timestamps.
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
// NEXT CANDLE BOUNDARY
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

  const currentBoundary =
    getCurrentBoundary(
      timeframe,
      now
    );

  return (
    currentBoundary +
    interval
  );
}

// ============================================================
// NEXT SCAN TIME
// ============================================================
//
// Example:
//
// 15m:
//
// current:
// 08:12
//
// next boundary:
// 08:15
//
// scan:
// 08:15 + boundary delay
//
// ============================================================

function getNextScanTime(
  timeframe,
  now = Date.now()
) {
  const boundary =
    getNextBoundary(
      timeframe,
      now
    );

  if (
    boundary ===
    null
  ) {
    return null;
  }

  return (
    boundary +
    BOUNDARY_DELAY_MS
  );
}

// ============================================================
// FORMAT UTC
// ============================================================

function formatUTC(
  timestamp
) {
  if (
    !Number.isFinite(
      Number(timestamp)
    )
  ) {
    return 'N/A';
  }

  return new Date(
    Number(timestamp)
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
// NUMBER FORMATTER
// ============================================================

function fmtNumber(
  value,
  decimals = 2
) {
  const number =
    Number(value);

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
  const value =
    signal?.stdDeviation ??
    signal?.stdDev ??
    signal?.standardDeviation;

  return fmtNumber(
    value,
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
// LATEST CONFIRMED FRACTAL
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
// LATEST CONFIRMED TOP
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
    const fractal =
      fractals[i];

    const type =
      String(
        fractal?.type ||
        ''
      )
        .trim()
        .toUpperCase();

    if (
      type ===
      'TOP'
    ) {
      return fractal;
    }
  }

  return null;
}

// ============================================================
// LATEST CONFIRMED BOTTOM
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
    const fractal =
      fractals[i];

    const type =
      String(
        fractal?.type ||
        ''
      )
        .trim()
        .toUpperCase();

    if (
      type ===
      'BOTTOM'
    ) {
      return fractal;
    }
  }

  return null;
}

// ============================================================
// FRACTAL DISPLAY
//
// Bearish:
//
//   TOP
//
// Bullish:
//
//   BOTTOM
//
// Neutral:
//
//   Latest confirmed fractal
//
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
    const top =
      getLatestConfirmedTop(
        signal
      );

    if (
      top
    ) {
      return 'TOP';
    }
  }

  if (
    structure ===
    'BULLISH'
  ) {
    const bottom =
      getLatestConfirmedBottom(
        signal
      );

    if (
      bottom
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
      ).toUpperCase();

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
// CONFIRMED SIGNAL SAFETY
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
// POTENTIAL CRT DISPLAY
// ============================================================

function formatPotentialCRT(
  signal
) {
  return isConfirmedSignal(
    signal
  )
    ? '**CONFIRMED**'
    : 'NOT CONFIRMED';
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
// COIN FORMATTER
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
    Number(raw);

  if (
    !Number.isFinite(
      value
    )
  ) {
    return null;
  }

  if (
    value > 0 &&
    value < 100000000000
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
// PROVABLY CLOSED
// ============================================================
//
// Do not rely only on:
//
//   candle.closed === false
//
// The candle must be demonstrably closed.
//
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
// GET LATEST CLOSED CANDLE
// ============================================================

function getLatestClosedCandle(
  candles,
  timeframe
) {
  const closed =
    getClosedCandles(
      candles,
      timeframe
    );

  if (
    !closed.length
  ) {
    return null;
  }

  return (
    closed[
      closed.length - 1
    ]
  );
}

// ============================================================
// SIGNAL CRT CANDLE TIME
//
// crtEngine.js returns:
//
//   crtCandleTime
//
// This is the actual candle on which the CRT confirmation
// occurred.
//
// ============================================================

function getSignalCRTCandleTime(
  signal
) {
  const direct =
    Number(
      signal?.crtCandleTime
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
      signal?.crtConfirmation
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
// SIGNAL IS FOR NEWEST CLOSED CANDLE
//
// This is one of the most important safety checks.
//
// If the engine returns an old confirmed fractal/CRT signal,
// it is not emitted again.
//
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
// SIGNAL KEY
// ============================================================

function getStateKey(
  symbol,
  timeframe
) {
  return [
    timeframe,
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

  const potentialCRT =
    formatPotentialCRT(
      signal
    );

  // IMPORTANT:
  //
  // Use CRT candle time in Discord.
  //
  // NOT fractal pivot time.
  //
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
          potentialCRT,

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
    normalizeTimeframe(
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

    return;
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

    return;
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
  // Explicit configured symbols have priority.
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
// REFRESH FUTURES SYMBOLS
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
      await getFuturesContracts();

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

    // Do NOT destroy an existing valid cache if a refresh
    // temporarily fails.
    if (
      !cachedSymbols.length
    ) {
      cachedSymbols =
        [];
    }

    lastSymbolRefresh =
      Date.now();
  }
}

// ============================================================
// FETCH CLOSED CANDLES
// ============================================================

async function fetchClosedCandles(
  symbol,
  timeframe
) {
  const candles =
    await getKlines({
      market:
        MARKET,

      symbol,

      timeframe,

      limit:
        KLINE_LIMIT,
    });

  if (
    !Array.isArray(
      candles
    )
  ) {
    return [];
  }

  return getClosedCandles(
    candles,
    timeframe
  );
}

// ============================================================
// BOOTSTRAP SYMBOL
//
// IMPORTANT:
//
// First observation after restart does NOT send an alert.
//
// It only records the latest already-closed candle.
//
// ============================================================

async function bootstrapSymbol(
  symbol,
  timeframe
) {
  const key =
    getStateKey(
      symbol,
      timeframe
    );

  if (
    bootstrapped.has(
      key
    )
  ) {
    return;
  }

  try {
    const candles =
      await fetchClosedCandles(
        symbol,
        timeframe
      );

    if (
      !candles.length
    ) {
      return;
    }

    const latest =
      candles[
        candles.length - 1
      ];

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

    lastProcessedCandle.set(
      key,
      latestTime
    );

    bootstrapped.add(
      key
    );

    console.log(
      `[CRT] Bootstrap ${symbol}:${timeframe} -> ${formatUTC(latestTime)}`
    );
  } catch (
    error
  ) {
    console.error(
      `[CRT] Bootstrap failed ${symbol}:${timeframe}:`,
      error?.message ||
      error
    );
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
  const normalizedTimeframe =
    normalizeTimeframe(
      timeframe
    );

  const key =
    getStateKey(
      symbol,
      normalizedTimeframe
    );

  try {

    // ========================================================
    // FUTURES ONLY
    // ========================================================

    if (
      MARKET !==
      'futures'
    ) {
      return;
    }

    // ========================================================
    // GET MEXC CLOSED CANDLES
    // ========================================================

    const closed =
      await fetchClosedCandles(
        symbol,
        normalizedTimeframe
      );

    if (
      closed.length <
      Math.max(
        30,
        RSI_PERIOD + 10,
        7
      )
    ) {
      return;
    }

    // ========================================================
    // LATEST MEXC CLOSED CANDLE
    // ========================================================

    const latestClosed =
      closed[
        closed.length - 1
      ];

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

    // ========================================================
    // STARTUP SAFETY
    //
    // If this symbol/timeframe has not been bootstrapped,
    // mark current candle and DO NOT alert.
    // ========================================================

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
        `[CRT] Startup baseline ${symbol}:${normalizedTimeframe} -> ${formatUTC(latestClosedTime)}`
      );

      return;
    }

    // ========================================================
    // DUPLICATE CANDLE CHECK
    // ========================================================

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

    // ========================================================
    // NEW MEXC CANDLE
    //
    // Record it BEFORE engine processing.
    //
    // This prevents repeated processing if the same scan
    // is retried.
    // ========================================================

    lastProcessedCandle.set(
      key,
      latestClosedTime
    );

    console.log(
      `[CRT] NEW MEXC CLOSED CANDLE ${symbol}:${normalizedTimeframe} -> ${formatUTC(latestClosedTime)}`
    );

    // ========================================================
    // BUILD SIGNAL
    // ========================================================

    const signal =
      buildSignal({
        symbol,

        market:
          'futures',

        timeframe:
          normalizedTimeframe,

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

    // ========================================================
    // NO SIGNAL
    // ========================================================

    if (
      !signal
    ) {
      return;
    }

    // ========================================================
    // CONFIRMATION SAFETY
    // ========================================================

    if (
      !isConfirmedSignal(
        signal
      )
    ) {
      return;
    }

    // ========================================================
    // CRITICAL TIMEFRAME SAFETY
    //
    // The engine may return the latest confirmed fractal
    // from an older candle.
    //
    // We ONLY want a signal if the CRT candle is the NEW
    // MEXC candle that just closed.
    //
    // ========================================================

    if (
      !signalMatchesLatestClosedCandle(
        signal,
        latestClosed
      )
    ) {
      console.log(
        `[CRT] Ignored old CRT ${symbol}:${normalizedTimeframe}` +
        ` | Latest=${formatUTC(latestClosedTime)}` +
        ` | SignalCRT=${formatUTC(getSignalCRTCandleTime(signal))}`
      );

      return;
    }

    // ========================================================
    // SIGNAL ID
    // ========================================================

    if (
      !signal.id
    ) {
      console.warn(
        `[CRT] Signal rejected because signal.id is missing: ${symbol}:${normalizedTimeframe}`
      );

      return;
    }

    // ========================================================
    // SIGNAL MANAGER
    // ========================================================

    if (
      !isNewSignal(
        signal.id
      )
    ) {
      return;
    }

    // ========================================================
    // SEND DISCORD
    // ========================================================

    await sendSignal(
      client,
      signal
    );

    // ========================================================
    // LOG
    // ========================================================

    console.log(
      `[CRT] RACHEL T CRT CONFIRMED` +
      ` | ${symbol}` +
      ` | ${normalizedTimeframe}` +
      ` | CRT=${formatUTC(getSignalCRTCandleTime(signal))}` +
      ` | Structure=${getMarketStructure(signal)}` +
      ` | Fractal=${getFractalType(signal)}` +
      ` | STD=${getStdDeviation(signal)}` +
      ` | Liquidity=${getLiquiditySweep(signal)}` +
      ` | RSI=${signal.rsiState || 'Neutral'}`
    );

  } catch (
    error
  ) {
    console.error(
      `[CRT] Scan failed ${symbol}:${normalizedTimeframe}:`,
      error?.message ||
      error
    );
  }
}

// ============================================================
// CONCURRENT SYMBOL SCAN
//
// Uses a small worker pool.
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

  let index =
    0;

  async function worker() {
    while (
      true
    ) {
      const current =
        index++;

      if (
        current >=
        symbols.length
      ) {
        return;
      }

      await scanSymbol(
        client,
        symbols[
          current
        ],
        timeframe
      );
    }
  }

  const workers =
    Math.min(
      SCAN_CONCURRENCY,
      symbols.length
    );

  await Promise.all(
    Array.from(
      {
        length:
          workers,
      },
      () =>
        worker()
    )
  );
}

// ============================================================
// SCAN ONE TIMEFRAME
// ============================================================

async function scanTimeframe(
  client,
  timeframe
) {
  const normalized =
    normalizeTimeframe(
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
      `[CRT] ${normalized} scan already running. Skipping overlapping scan.`
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
        `[CRT] No MEXC Futures symbols available for ${normalized}`
      );

      return;
    }

    console.log(
      `[CRT] TIMEFRAME BOUNDARY SCAN -> ${normalized}` +
      ` | UTC=${formatUTC(Date.now())}` +
      ` | Symbols=${symbols.length}`
    );

    await scanSymbols(
      client,
      symbols,
      normalized
    );

  } catch (
    error
  ) {
    console.error(
      `[CRT] Timeframe scan failed ${normalized}:`,
      error?.message ||
      error
    );
  } finally {
    scanRunning.delete(
      normalized
    );
  }
}

// ============================================================
// BOOTSTRAP ALL SYMBOLS FOR TIMEFRAME
// ============================================================

async function bootstrapTimeframe(
  timeframe
) {
  const normalized =
    normalizeTimeframe(
      timeframe
    );

  await refreshSymbols();

  const symbols =
    [
      ...cachedSymbols,
    ];

  if (
    !symbols.length
  ) {
    return;
  }

  let index =
    0;

  async function worker() {
    while (
      true
    ) {
      const current =
        index++;

      if (
        current >=
        symbols.length
      ) {
        return;
      }

      await bootstrapSymbol(
        symbols[
          current
        ],
        normalized
      );
    }
  }

  const workers =
    Math.min(
      SCAN_CONCURRENCY,
      symbols.length
    );

  await Promise.all(
    Array.from(
      {
        length:
          workers,
      },
      () =>
        worker()
    )
  );
}

// ============================================================
// SCHEDULE ONE TIMEFRAME
// ============================================================
//
// Every timeframe receives its own timer.
//
// This is the key difference from the old service.
//
// ============================================================

function scheduleTimeframe(
  client,
  timeframe
) {
  const normalized =
    normalizeTimeframe(
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

  // ----------------------------------------------------------
  // Clear old timer
  // ----------------------------------------------------------

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

  const nextScan =
    getNextScanTime(
      normalized,
      now
    );

  if (
    nextScan ===
    null
  ) {
    return;
  }

  const delay =
    Math.max(
      100,
      nextScan -
        now
    );

  console.log(
    `[CRT] ${normalized} next MEXC boundary scan: ${formatUTC(nextScan)}`
  );

  const timer =
    setTimeout(
      async () => {

        try {
          await scanTimeframe(
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
          // Always schedule the NEXT boundary.
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
// CREATE STARTUP BASELINE
//
// This prevents historical signal replay after Railway restart.
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
    `[CRT] Initializing MEXC candle baseline for ${cachedSymbols.length} symbols.`
  );

  for (
    const timeframe of
    timeframes
  ) {
    await bootstrapTimeframe(
      timeframe
    );
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

  // ==========================================================
  // CONFIG DISABLE
  // ==========================================================

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
    `[CRT] SCAN CONCURRENCY: ${SCAN_CONCURRENCY}`
  );

  console.log(
    `[CRT] BOUNDARY DELAY: ${BOUNDARY_DELAY_MS}ms`
  );

  console.log(
    '[CRT] TIME STANDARD: MEXC FUTURES UTC CANDLE BOUNDARIES'
  );

  console.log(
    '[CRT] RESTART REPLAY: DISABLED'
  );

  console.log(
    '[CRT] FRACTAL DISPLAY: BEARISH=TOP | BULLISH=BOTTOM'
  );

  console.log(
    '[CRT] DISCORD FIELD: Potential CRT'
  );

  console.log(
    '============================================================'
  );

  // ==========================================================
  // INITIALIZE BASELINE
  //
  // IMPORTANT:
  //
  // Do NOT call scanAll() immediately.
  //
  // The initial operation only establishes which candle is
  // already closed.
  //
  // ==========================================================

  void (
    async () => {

      try {
        await initializeBaseline();

        // ----------------------------------------------------
        // Schedule each timeframe independently.
        // ----------------------------------------------------

        scheduleAllTimeframes(
          client
        );

      } catch (
        error
      ) {
        console.error(
          '[CRT] Startup initialization failed:',
          error?.message ||
          error
        );

        // ----------------------------------------------------
        // Still schedule the timers so the service can recover.
        // ----------------------------------------------------

        scheduleAllTimeframes(
          client
        );
      }

    }
  )();
}

// ============================================================
// MANUAL SCAN
//
// IMPORTANT:
//
// Manual scan respects the same MEXC candle state.
//
// It does NOT intentionally replay historical signals.
//
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
    await scanTimeframe(
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

    scanConcurrency:
      SCAN_CONCURRENCY,

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

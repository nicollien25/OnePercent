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
// PURPOSE:
//
//   Rachel T Fractal + CRT Confirmation
//
// SOURCE:
//
//   MEXC FUTURES ONLY
//
// IMPORTANT TIMEFRAME RULE:
//
//   Each timeframe is evaluated independently.
//
//   Example:
//
//     08:00
//       15m -> eligible
//       1h  -> eligible
//       4h  -> eligible
//
//     08:15
//       15m -> eligible
//       1h  -> NOT a new 1h candle
//       4h  -> NOT a new 4h candle
//
//   Therefore:
//
//     08:00
//       15m / 1h / 4h may produce signals.
//
//     08:15
//       Only a new 15m signal may be produced.
//
//     08:30
//       Only a new 15m signal may be produced.
//
//     09:00
//       15m / 30m / 1h may produce signals.
//
//     12:00
//       15m / 30m / 1h / 4h may produce signals.
//
// ============================================================
//
// MEXC CANDLE TIMESTAMP RULE:
//
// Futures candles from mexcService.js are normalized as:
//
//   openTime
//   closeTime = openTime + intervalMs - 1
//
// Example:
//
//   15m candle:
//
//   open:
//     07:45:00.000
//
//   close:
//     07:59:59.999
//
//   next candle boundary:
//     08:00:00.000
//
// Therefore:
//
//   closeTime !== boundary
//
// Instead:
//
//   closeTime + 1 === boundary
//
// DO NOT reject a candle because:
//
//   1786445999999
//
// does not equal:
//
//   1786446000000
//
// That is NORMAL and CORRECT.
//
// ============================================================
//
// crtEngine.js remains the authority for:
//
//   • Rachel T fractal
//   • CRT confirmation
//   • Market structure
//   • Standard deviation
//   • Liquidity sweep
//   • RSI
//
// crtService.js is responsible for:
//
//   1. Loading MEXC Futures candles
//   2. Removing active candles
//   3. Validating timeframe alignment
//   4. Passing closed candles to crtEngine.js
//   5. Preventing duplicate signals
//   6. Sending Discord alerts
//
// ============================================================
//
// SPOT:
//
//   COMPLETELY DISABLED
//
// ============================================================


// ============================================================
// CONFIG
// ============================================================

const CRT_CONFIG =
  botConfig.crt || {};


// ============================================================
// TIMEFRAMES
//
// Standard PDYN timeframes.
//
// These are MEXC Futures timeframe identifiers.
// ============================================================

const TIMEFRAMES =
  CRT_CONFIG.timeframes || {
    '5m': 5,
    '15m': 15,
    '30m': 30,
    '1h': 60,
    '4h': 240,
    '1d': 1440,
  };


// ============================================================
// DISCORD CHANNELS
// ============================================================

const CHANNELS =
  CRT_CONFIG.channels || {};


// ============================================================
// HARD MARKET LOCK
//
// FUTURES ONLY
//
// No Spot scanning.
// ============================================================

const MARKET =
  'futures';

const MARKET_TYPES = [
  MARKET,
];


// ============================================================
// SCAN INTERVAL
//
// The monitor checks frequently.
//
// It does NOT mean a signal is generated every 30 seconds.
//
// Signal generation remains dependent on CLOSED candles.
// ============================================================

const SCAN_INTERVAL =
  Math.max(
    5000,
    Number(
      CRT_CONFIG.scanInterval ||
      15000
    )
  );


// ============================================================
// KLINE LIMIT
//
// Enough historical data for:
//
//   Rachel T fractal
//   CRT
//   RSI
//   Standard deviation
//   Market structure
// ============================================================

const KLINE_LIMIT =
  Math.max(
    50,
    Number(
      CRT_CONFIG.klineLimit ||
      150
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
// AUTO SYMBOL MODE
// ============================================================

const AUTO_SYMBOLS =
  CRT_CONFIG.autoSymbols !== false;


// ============================================================
// TIMEFRAME MILLISECONDS
//
// IMPORTANT:
//
// These are used for candle boundary validation.
//
// Epoch timestamps are UTC based.
// No Manila timezone conversion is required.
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
// STATE
// ============================================================

let monitorStarted =
  false;

let scanRunning =
  false;

const cachedSymbols =
  new Map();

let lastSymbolRefresh =
  0;


// ============================================================
// TIMEFRAME PRIORITY
//
// Explicit order.
//
// This prevents JavaScript object/config ordering from changing
// the intended scan sequence.
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
// TIMEFRAME LABEL
// ============================================================

function timeframeLabel(
  timeframe
) {
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
    }[timeframe] ||
    String(
      timeframe
    )
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
// TIMESTAMP NORMALIZER
//
// Supports:
//
//   milliseconds
//   seconds
//   Date
// ============================================================

function normalizeTimestamp(
  value
) {
  if (
    value instanceof Date
  ) {
    const time =
      value.getTime();

    return Number.isFinite(
      time
    )
      ? time
      : null;
  }

  const number =
    Number(
      value
    );

  if (
    !Number.isFinite(
      number
    )
  ) {
    return null;
  }

  // Unix seconds
  if (
    number > 0 &&
    number < 100000000000
  ) {
    return number * 1000;
  }

  return number;
}


// ============================================================
// GET CANDLE OPEN TIME
// ============================================================

function getCandleOpenTime(
  candle
) {
  if (
    !candle
  ) {
    return null;
  }

  return normalizeTimestamp(
    candle.openTime ??
    candle.time ??
    candle.timestamp ??
    candle.ts
  );
}


// ============================================================
// GET CANDLE CLOSE TIME
// ============================================================

function getCandleCloseTime(
  candle
) {
  if (
    !candle
  ) {
    return null;
  }

  return normalizeTimestamp(
    candle.closeTime ??
    candle.endTime ??
    candle.closeTimestamp
  );
}


// ============================================================
// GET TIMEFRAME MS
// ============================================================

function getTimeframeMs(
  timeframe
) {
  return (
    TIMEFRAME_MS[
      timeframe
    ] ||
    null
  );
}


// ============================================================
// GET NEXT CANDLE BOUNDARY
//
// Example:
//
// closeTime:
//
//   1786445999999
//
// boundary:
//
//   1786446000000
//
// ============================================================

function getCandleBoundary(
  candle,
  timeframe
) {
  const timeframeMs =
    getTimeframeMs(
      timeframe
    );

  if (
    !timeframeMs
  ) {
    return null;
  }

  const openTime =
    getCandleOpenTime(
      candle
    );

  if (
    openTime !== null
  ) {
    return (
      openTime +
      timeframeMs
    );
  }

  const closeTime =
    getCandleCloseTime(
      candle
    );

  if (
    closeTime !== null
  ) {
    return (
      closeTime + 1
    );
  }

  return null;
}


// ============================================================
// GET CLOSE BOUNDARY FROM CANDLE
//
// This is the IMPORTANT FIX.
//
// We consider:
//
//   closeTime + 1
//
// to be the candle boundary.
//
// NOT:
//
//   closeTime === boundary
//
// ============================================================

function getCloseBoundary(
  candle,
  timeframe
) {
  const closeTime =
    getCandleCloseTime(
      candle
    );

  if (
    closeTime !== null
  ) {
    return (
      closeTime + 1
    );
  }

  return getCandleBoundary(
    candle,
    timeframe
  );
}


// ============================================================
// IS TIMEFRAME ALIGNED
//
// We validate the candle OPEN time against the timeframe.
//
// Example:
//
// 15m:
//
//   08:00
//   08:15
//   08:30
//   08:45
//
// are valid boundaries.
//
// This is safer than comparing closeTime directly to a
// boundary because MEXC closeTime is:
//
//   boundary - 1ms
//
// ============================================================

function isTimeframeAligned(
  candle,
  timeframe
) {
  const timeframeMs =
    getTimeframeMs(
      timeframe
    );

  if (
    !timeframeMs
  ) {
    return false;
  }

  const openTime =
    getCandleOpenTime(
      candle
    );

  if (
    openTime === null
  ) {
    return false;
  }

  return (
    openTime %
      timeframeMs ===
    0
  );
}


// ============================================================
// IS CANDLE CLOSED
//
// A candle is closed when:
//
//   closeTime <= now
//
// OR:
//
//   openTime + timeframeMs <= now
//
// IMPORTANT:
//
// We intentionally do NOT compare:
//
//   closeTime === boundary
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
    const closeTime =
      getCandleCloseTime(
        candle
      );

    if (
      closeTime !== null
    ) {
      return (
        closeTime <=
        now
      );
    }

    const openTime =
      getCandleOpenTime(
        candle
      );

    const timeframeMs =
      getTimeframeMs(
        timeframe
      );

    if (
      openTime !== null &&
      timeframeMs
    ) {
      return (
        openTime +
          timeframeMs <=
        now
      );
    }

    return false;
  }

  const closeTime =
    getCandleCloseTime(
      candle
    );

  if (
    closeTime !== null
  ) {
    return (
      closeTime <=
      now
    );
  }

  const openTime =
    getCandleOpenTime(
      candle
    );

  const timeframeMs =
    getTimeframeMs(
      timeframe
    );

  if (
    openTime === null ||
    !timeframeMs
  ) {
    return false;
  }

  return (
    openTime +
      timeframeMs <=
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
//
// This service-level filter:
//
//   • removes active candles
//   • validates OHLC
//   • validates timeframe alignment
//   • sorts chronologically
//   • removes duplicate timestamps
//
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

  const result = [];

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

    if (
      !isTimeframeAligned(
        candle,
        timeframe
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

    result.push(
      candle
    );
  }

  // ==========================================================
  // CHRONOLOGICAL ORDER
  // ==========================================================

  result.sort(
    (a, b) =>
      (
        getCandleOpenTime(
          a
        ) ?? 0
      ) -
      (
        getCandleOpenTime(
          b
        ) ?? 0
      )
  );

  // ==========================================================
  // REMOVE DUPLICATES
  // ==========================================================

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

    const key =
      time !== null
        ? String(
            time
          )
        : JSON.stringify(
            candle
          );

    if (
      seen.has(
        key
      )
    ) {
      continue;
    }

    seen.add(
      key
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

  return candles[
    candles.length - 1
  ];
}


// ============================================================
// FORMAT BOUNDARY FOR LOGGING
//
// Uses ISO because the actual timestamp is unambiguous.
//
// ============================================================

function formatBoundary(
  timestamp
) {
  if (
    !Number.isFinite(
      Number(
        timestamp
      )
    )
  ) {
    return 'N/A';
  }

  return new Date(
    Number(
      timestamp
    )
  ).toISOString();
}


// ============================================================
// RSI DISPLAY
//
// No RSI number is displayed.
//
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
    !signal
  ) {
    return [];
  }

  if (
    Array.isArray(
      signal.confirmedFractals
    )
  ) {
    return signal.confirmedFractals;
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

  return fractals[
    fractals.length - 1
  ];
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

  if (
    !fractals.length
  ) {
    return null;
  }

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

  if (
    !fractals.length
  ) {
    return null;
  }

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
// FRACTAL DISPLAY ALIGNMENT
//
// RULE:
//
//   BEARISH
//      -> TOP
//
//   BULLISH
//      -> BOTTOM
//
//   NEUTRAL
//      -> latest confirmed fractal
//
// IMPORTANT:
//
// This only controls the Discord DISPLAY.
//
// It does not alter crtEngine.js.
// ============================================================

function getFractalType(
  signal
) {
  if (
    !signal
  ) {
    return 'N/A';
  }

  const structure =
    String(
      signal.marketStructure ??
      signal.structure ??
      signal.market_structure ??
      ''
    )
      .trim()
      .toUpperCase();

  // ==========================================================
  // BEARISH
  // ==========================================================

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

  // ==========================================================
  // BULLISH
  // ==========================================================

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

  // ==========================================================
  // NEUTRAL
  // ==========================================================

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

  // ==========================================================
  // FALLBACK
  // ==========================================================

  const raw =
    signal.fractalType ??
    signal.fractal?.type ??
    signal.type ??
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
// LIQUIDITY SWEEP
//
// crtEngine.js is the authority.
//
// This service does NOT calculate another sweep.
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
// CONFIRMED SIGNAL CHECK
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

  if (
    signal?.fractalConfirmed ===
    false
  ) {
    return false;
  }

  return true;
}


// ============================================================
// POTENTIAL CRT DISPLAY
//
// The field is called:
//
//   Potential CRT
//
// But the service only sends signals that have passed the
// engine's confirmation checks.
//
// Therefore:
//
//   Potential CRT = CONFIRMED
//
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
// CREATE SIGNAL EMBED
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

  const rsi =
    formatRSIState(
      signal.rsiState
    );

  const stdDeviation =
    getStdDeviation(
      signal
    );

  const fractalType =
    getFractalType(
      signal
    );

  const liquidity =
    getLiquiditySweep(
      signal
    );

  const potentialCRT =
    formatPotentialCRT(
      signal
    );

  return new EmbedBuilder()

    // ========================================================
    // TITLE
    // ========================================================

    .setTitle(
      `${emoji} ${coin}`
    )

    // ========================================================
    // DESCRIPTION
    // ========================================================

    .setDescription(
      '**OnePERCENT CRT Signal**'
    )

    // ========================================================
    // FIELDS
    // ========================================================

    .addFields(

      // ------------------------------------------------------
      // SOURCE
      // ------------------------------------------------------

      {
        name:
          'Source',

        value:
          '**MEXC Futures**',

        inline:
          false,
      },

      // ------------------------------------------------------
      // TIMEFRAME
      // ------------------------------------------------------

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

      // ------------------------------------------------------
      // MARKET STRUCTURE
      // ------------------------------------------------------

      {
        name:
          'Market Structure',

        value:
          structure,

        inline:
          true,
      },

      // ------------------------------------------------------
      // STD DEVIATION
      // ------------------------------------------------------

      {
        name:
          'STD Deviation',

        value:
          stdDeviation,

        inline:
          true,
      },

      // ------------------------------------------------------
      // FRACTAL
      //
      // Bearish -> TOP
      // Bullish -> BOTTOM
      // ------------------------------------------------------

      {
        name:
          'Fractal',

        value:
          fractalType,

        inline:
          true,
      },

      // ------------------------------------------------------
      // LIQUIDITY
      // ------------------------------------------------------

      {
        name:
          'Liquidity',

        value:
          liquidity,

        inline:
          true,
      },

      // ------------------------------------------------------
      // POTENTIAL CRT
      // ------------------------------------------------------

      {
        name:
          'Potential CRT',

        value:
          potentialCRT,

        inline:
          true,
      },

      // ------------------------------------------------------
      // RSI
      // ------------------------------------------------------

      {
        name:
          'RSI',

        value:
          rsi,

        inline:
          true,
      }
    )

    // ========================================================
    // COLOR
    // ========================================================

    .setColor(
      signalColor(
        signal
      )
    )

    // ========================================================
    // FOOTER
    // ========================================================

    .setFooter({
      text:
        'PDYN • Rachel T CRT • MEXC Futures',
    })

    // ========================================================
    // TIMESTAMP
    //
    // Prefer CRT candle time.
    // ========================================================

    .setTimestamp(
      signal.crtCandleTime
        ? new Date(
            signal.crtCandleTime
          )
        : signal.candleTime
        ? new Date(
            signal.candleTime
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
    signal.timeframe;

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
      `[CRT] Failed to fetch Discord channel for ${timeframe}:`,
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

  const emoji =
    structureEmoji(
      signal
    );

  const coin =
    formatCoin(
      signal.symbol
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
//
// HARD LOCK:
//
//   futures only
// ============================================================

function filterSymbols(
  symbols,
  market
) {
  if (
    market !==
    MARKET
  ) {
    return [];
  }

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
    return configured
      .slice(
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

  const filtered =
    symbols.filter(
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
    );

  return filtered
    .slice(
      0,
      MAX_SYMBOLS
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
}


// ============================================================
// REFRESH FUTURES SYMBOLS
// ============================================================

async function refreshSymbols(
  force = false
) {
  const ttl =
    Number(
      CRT_CONFIG.symbolRefreshMs ||
      15 * 60 * 1000
    );

  if (
    !force &&
    Date.now() -
      lastSymbolRefresh <
      ttl &&
    cachedSymbols.size
  ) {
    return;
  }

  try {
    const contracts =
      await getFuturesContracts();

    const symbols =
      filterSymbols(
        contracts,
        MARKET
      );

    cachedSymbols.set(
      MARKET,
      symbols
    );

    console.log(
      `[CRT] MEXC Futures symbols loaded: ${symbols.length}`
    );
  } catch (
    error
  ) {
    console.error(
      '[CRT] Failed to refresh MEXC Futures symbols:',
      error?.message ||
        error
    );

    if (
      !cachedSymbols.has(
        MARKET
      )
    ) {
      cachedSymbols.set(
        MARKET,
        []
      );
    }
  }

  lastSymbolRefresh =
    Date.now();
}


// ============================================================
// VALIDATE LATEST CLOSED CANDLE
//
// IMPORTANT:
//
// This function NEVER requires:
//
//   closeTime === boundary
//
// It accepts:
//
//   closeTime + 1 === boundary
//
// which is how MEXC Futures candles are represented.
//
// ============================================================

function validateLatestClosedCandle(
  candle,
  timeframe,
  now
) {
  if (
    !candle
  ) {
    return {
      valid:
        false,

      reason:
        'No closed candle',
    };
  }

  const openTime =
    getCandleOpenTime(
      candle
    );

  const closeTime =
    getCandleCloseTime(
      candle
    );

  const boundary =
    getCloseBoundary(
      candle,
      timeframe
    );

  if (
    openTime === null
  ) {
    return {
      valid:
        false,

      reason:
        'Missing openTime',
    };
  }

  if (
    closeTime === null
  ) {
    return {
      valid:
        false,

      reason:
        'Missing closeTime',
    };
  }

  if (
    !isTimeframeAligned(
      candle,
      timeframe
    )
  ) {
    return {
      valid:
        false,

      reason:
        `open time ${openTime} is not aligned to ${timeframe}`,
    };
  }

  if (
    closeTime >
    now
  ) {
    return {
      valid:
        false,

      reason:
        `candle still active until ${formatBoundary(closeTime + 1)}`,
    };
  }

  return {
    valid:
      true,

    openTime,

    closeTime,

    boundary,
  };
}


// ============================================================
// SCAN ONE SYMBOL / ONE TIMEFRAME
// ============================================================

async function scanSymbol(
  client,
  symbol,
  timeframe
) {
  try {

    // ========================================================
    // HARD MARKET LOCK
    // ========================================================

    const market =
      MARKET;

    if (
      market !==
      'futures'
    ) {
      return;
    }

    // ========================================================
    // GET MEXC FUTURES KLINES
    // ========================================================

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
      ) ||
      !candles.length
    ) {
      return;
    }

    // ========================================================
    // CURRENT TIME
    // ========================================================

    const now =
      Date.now();

    // ========================================================
    // CLOSED CANDLES ONLY
    // ========================================================

    const closedCandles =
      getClosedCandles(
        candles,
        timeframe,
        now
      );

    if (
      closedCandles.length <
      30
    ) {
      return;
    }

    // ========================================================
    // LATEST CLOSED CANDLE
    // ========================================================

    const latestClosed =
      getLatestClosedCandle(
        closedCandles
      );

    if (
      !latestClosed
    ) {
      return;
    }

    // ========================================================
    // VALIDATE TIMEFRAME BOUNDARY
    // ========================================================

    const boundaryCheck =
      validateLatestClosedCandle(
        latestClosed,
        timeframe,
        now
      );

    if (
      !boundaryCheck.valid
    ) {
      return;
    }

    // ========================================================
    // IMPORTANT BOUNDARY INFORMATION
    //
    // Example:
    //
    // closeTime:
    //
    //   1786445999999
    //
    // boundary:
    //
    //   1786446000000
    //
    // This is VALID.
    // ========================================================

    const closeTime =
      boundaryCheck.closeTime;

    const boundary =
      boundaryCheck.boundary;

    // ========================================================
    // BUILD RACHEL T CRT SIGNAL
    //
    // crtEngine.js independently performs its own strict
    // closed-candle validation.
    //
    // ========================================================

    const signal =
      buildSignal({
        symbol,

        market:
          MARKET,

        timeframe,

        candles:
          closedCandles,

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
    // HARD CONFIRMATION CHECK
    //
    // Only confirmed CRT signals are sent.
    // ========================================================

    if (
      !isConfirmedSignal(
        signal
      )
    ) {
      return;
    }

    // ========================================================
    // SIGNAL ID REQUIRED
    // ========================================================

    if (
      !signal.id
    ) {
      console.warn(
        `[CRT] Signal rejected without ID: ${symbol} ${timeframe}`
      );

      return;
    }

    // ========================================================
    // ENSURE SIGNAL BELONGS TO THIS TIMEFRAME
    //
    // This prevents accidental cross-timeframe output.
    // ========================================================

    if (
      String(
        signal.timeframe ||
        ''
      ) !==
      String(
        timeframe
      )
    ) {
      console.warn(
        `[CRT] Signal timeframe mismatch: requested=${timeframe} returned=${signal.timeframe}`
      );

      return;
    }

    // ========================================================
    // NEW SIGNAL CHECK
    //
    // This is what prevents:
    //
    // 08:00 -> 1h signal
    //
    // from being repeated at:
    //
    // 08:15
    // 08:30
    // 08:45
    //
    // until a genuinely new 1h signal exists.
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

    const sent =
      await sendSignal(
        client,
        signal
      );

    if (
      !sent
    ) {
      return;
    }

    // ========================================================
    // LOG
    // ========================================================

    console.log(
      `[CRT] CONFIRMED ${symbol} ${timeframe}` +
      ` | CandleClose=${closeTime}` +
      ` | Boundary=${boundary}` +
      ` | BoundaryISO=${formatBoundary(boundary)}` +
      ` | Structure=${getMarketStructure(signal)}` +
      ` | Fractal=${getFractalType(signal)}` +
      ` | STD=${getStdDeviation(signal)}` +
      ` | Liquidity=${getLiquiditySweep(signal)}` +
      ` | PotentialCRT=${formatPotentialCRT(signal)}` +
      ` | RSI=${signal.rsiState || 'Neutral'}`
    );

  } catch (
    error
  ) {
    console.error(
      `[CRT] Scan failed ${symbol} ${timeframe}:`,
      error?.message ||
        error
    );
  }
}


// ============================================================
// GET CONFIGURED TIMEFRAMES
//
// Standard priority:
//
//   5m
//   15m
//   30m
//   1h
//   4h
//   1d
//
// ============================================================

function getScanTimeframes() {
  const configured =
    Object.keys(
      TIMEFRAMES
    );

  const result =
    TIMEFRAME_PRIORITY.filter(
      (timeframe) =>
        configured.includes(
          timeframe
        )
    );

  // ----------------------------------------------------------
  // Preserve custom configured timeframes.
  // ----------------------------------------------------------

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
// SCAN ALL TIMEFRAMES
//
// IMPORTANT:
//
// Timeframes are independent.
//
// A scan does NOT mean every timeframe gets a signal.
//
// buildSignal() + isNewSignal() determine whether a new
// signal exists for that specific timeframe.
// ============================================================

async function scanAll(
  client
) {
  if (
    scanRunning
  ) {
    return;
  }

  scanRunning =
    true;

  try {

    // ========================================================
    // REFRESH FUTURES SYMBOLS
    // ========================================================

    await refreshSymbols();

    const symbols =
      cachedSymbols.get(
        MARKET
      ) || [];

    if (
      !symbols.length
    ) {
      console.warn(
        '[CRT] No MEXC Futures symbols available.'
      );

      return;
    }

    const timeframes =
      getScanTimeframes();

    // ========================================================
    // TIMEFRAME SCAN
    //
    // We scan each timeframe separately.
    // ========================================================

    for (
      const timeframe of
      timeframes
    ) {

      const timeframeMs =
        getTimeframeMs(
          timeframe
        );

      if (
        !timeframeMs
      ) {
        console.warn(
          `[CRT] Unsupported timeframe skipped: ${timeframe}`
        );

        continue;
      }

      // ======================================================
      // CURRENT BOUNDARY
      //
      // This is diagnostic only.
      //
      // Example:
      //
      // 08:00 boundary
      // 08:15 boundary
      // 08:30 boundary
      //
      // ======================================================

      const now =
        Date.now();

      const currentBoundary =
        Math.floor(
          now /
            timeframeMs
        ) *
        timeframeMs;

      // ======================================================
      // LOG ONLY AT BOUNDARY WINDOWS
      //
      // Do not use this value to reject candles.
      // ======================================================

      const secondsFromBoundary =
        Math.floor(
          (
            now -
            currentBoundary
          ) /
          1000
        );

      if (
        secondsFromBoundary <=
        20
      ) {
        console.log(
          `[CRT] ${timeframe} boundary window: ${formatBoundary(currentBoundary)}`
        );
      }

      // ======================================================
      // SCAN SYMBOLS
      // ======================================================

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

      // ======================================================
      // TIMEFRAME COMPLETE
      // ======================================================

      console.log(
        `[CRT] Completed ${timeframe} scan.`
      );
    }

  } catch (
    error
  ) {
    console.error(
      '[CRT] scanAll failed:',
      error?.message ||
        error
    );

  } finally {
    scanRunning =
      false;
  }
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
  // CONFIGURATION CHECK
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

  // ==========================================================
  // DISCORD CLIENT CHECK
  // ==========================================================

  if (
    !client
  ) {
    throw new Error(
      'Discord client is required for CRT monitor'
    );
  }

  monitorStarted =
    true;

  // ==========================================================
  // STARTUP LOG
  // ==========================================================

  console.log(
    '[CRT] =================================================='
  );

  console.log(
    '[CRT] PDYN CRT MONITOR STARTED'
  );

  console.log(
    '[CRT] SOURCE: MEXC FUTURES ONLY'
  );

  console.log(
    '[CRT] SPOT: DISABLED'
  );

  console.log(
    '[CRT] PRIMARY: RACHEL T FRACTAL + CRT'
  );

  console.log(
    `[CRT] TIMEFRAMES: ${getScanTimeframes().join(', ')}`
  );

  console.log(
    `[CRT] SCAN INTERVAL: ${SCAN_INTERVAL}ms`
  );

  console.log(
    `[CRT] KLINE LIMIT: ${KLINE_LIMIT}`
  );

  console.log(
    `[CRT] MAX SYMBOLS: ${MAX_SYMBOLS}`
  );

  console.log(
    `[CRT] AUTO SYMBOLS: ${AUTO_SYMBOLS}`
  );

  console.log(
    '[CRT] BOUNDARY RULE: closeTime + 1ms = next candle boundary'
  );

  console.log(
    '[CRT] ACTIVE CANDLES: REJECTED'
  );

  console.log(
    '[CRT] DUPLICATES: BLOCKED BY signalManager'
  );

  console.log(
    '[CRT] DISPLAY: Bearish=TOP | Bullish=BOTTOM'
  );

  console.log(
    '[CRT] DISCORD FIELD: Potential CRT'
  );

  console.log(
    '[CRT] =================================================='
  );

  // ==========================================================
  // INITIAL SCAN
  // ==========================================================

  void scanAll(
    client
  );

  // ==========================================================
  // CONTINUOUS MONITOR
  // ==========================================================

  setInterval(
    () =>
      void scanAll(
        client
      ),
    SCAN_INTERVAL
  );
}


// ============================================================
// MANUAL SCAN
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

  await scanAll(
    client
  );
}


// ============================================================
// CRT CONFIG EXPORT
// ============================================================

export function getCRTConfig() {
  return {

    // --------------------------------------------------------
    // HARD MARKET LOCK
    // --------------------------------------------------------

    markets: [
      MARKET,
    ],

    // --------------------------------------------------------
    // TIMEFRAMES
    // --------------------------------------------------------

    timeframes:
      getScanTimeframes(),

    // --------------------------------------------------------
    // SCANNING
    // --------------------------------------------------------

    scanInterval:
      SCAN_INTERVAL,

    klineLimit:
      KLINE_LIMIT,

    maxSymbolsPerMarket:
      MAX_SYMBOLS,

    autoSymbols:
      AUTO_SYMBOLS,

    // --------------------------------------------------------
    // RSI
    // --------------------------------------------------------

    rsi: {
      period:
        RSI_PERIOD,

      oversold:
        OVERSOLD,

      overbought:
        OVERBOUGHT,
    },

    // --------------------------------------------------------
    // PRIMARY SIGNAL
    // --------------------------------------------------------

    primarySignal:
      'RACHEL_T_FRACTAL_CRT',

    // --------------------------------------------------------
    // SUPPORTING DATA
    // --------------------------------------------------------

    supportingData: [
      'MARKET_STRUCTURE',
      'STD_DEVIATION',
      'FRACTAL',
      'LIQUIDITY_SWEEP',
      'RSI',
    ],

    // --------------------------------------------------------
    // SOURCE
    // --------------------------------------------------------

    source:
      'MEXC_FUTURES_ONLY',

    // --------------------------------------------------------
    // TIMEFRAME BOUNDARY
    // --------------------------------------------------------

    boundaryRule:
      'CANDLE_CLOSE_TIME_PLUS_1MS',

    // --------------------------------------------------------
    // DISPLAY
    // --------------------------------------------------------

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
  `[CRT] Service loaded • Rachel T Fractal PRIMARY • MEXC FUTURES ONLY • ${getScanTimeframes().join(', ')}`
);

console.log(
  '[CRT] Candle boundary fix: closeTime + 1ms = boundary'
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

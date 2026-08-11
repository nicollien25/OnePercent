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
// PRIMARY PURPOSE:
//
//   Rachel T Fractal / CRT Confirmation
//
// MARKET:
//
//   MEXC FUTURES ONLY
//
// IMPORTANT:
//
//   This service is synchronized to timeframe candle boundaries.
//
//   It does NOT continuously rescan every timeframe.
//
//   Example:
//
//   08:00
//      5m
//      15m
//      30m
//      1h
//      4h
//      1d
//
//   08:05
//      5m
//
//   08:15
//      5m
//      15m
//
//   08:30
//      5m
//      15m
//      30m
//
//   09:00
//      5m
//      15m
//      30m
//      1h
//
//   12:00
//      5m
//      15m
//      30m
//      1h
//      4h
//
//   00:00
//      5m
//      15m
//      30m
//      1h
//      4h
//      1d
//
// IMPORTANT:
//
//   SPOT IS COMPLETELY DISABLED.
//
//   This service will ONLY scan:
//
//      MEXC FUTURES
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
// TIMEFRAME MILLISECONDS
//
// Used to synchronize scanning to exact candle boundaries.
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
// DISCORD CHANNELS
// ============================================================

const CHANNELS =
  CRT_CONFIG.channels || {};


// ============================================================
// MARKET TYPE
//
// HARD LOCK:
//
//   MEXC FUTURES ONLY
//
// ============================================================

const MARKET_TYPES = [
  'futures',
];


// ============================================================
// SCHEDULER INTERVAL
//
// This is NOT the candle interval.
//
// The scheduler simply checks whether a new candle boundary
// has been reached.
//
// 1000ms = check once per second.
//
// ============================================================

const SCHEDULER_INTERVAL =
  Math.max(
    1000,
    Number(
      CRT_CONFIG.schedulerInterval ||
      1000
    )
  );


// ============================================================
// KLINE LIMIT
//
// Historical candles are still required by crtEngine.js.
//
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
// SYMBOL MODE
// ============================================================

const AUTO_SYMBOLS =
  CRT_CONFIG.autoSymbols !== false;


// ============================================================
// STATE
// ============================================================

let monitorStarted =
  false;

let scanRunning =
  false;

let cachedSymbols =
  new Map();

let lastSymbolRefresh =
  0;


// ============================================================
// TIMEFRAME BOUNDARY STATE
//
// Stores the most recently processed candle boundary for
// every timeframe.
//
// Example:
//
//   15m -> 08:00
//   1h  -> 08:00
//   4h  -> 08:00
//
// This prevents duplicate scans.
//
// ============================================================

const lastProcessedBoundary =
  new Map();


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
// RSI DISPLAY
//
// No RSI number is displayed.
//
// OVERBOUGHT / OVERSOLD = BOLD
// NEUTRAL = NORMAL
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
//
// Accept multiple property names.
//
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
// GET CONFIRMED FRACTAL HISTORY
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
// GET LATEST CONFIRMED FRACTAL
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
// GET LATEST CONFIRMED TOP
//
// Bearish market structure -> TOP
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
// GET LATEST CONFIRMED BOTTOM
//
// Bullish market structure -> BOTTOM
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
// FRACTAL TYPE / MARKET STRUCTURE ALIGNMENT
//
// DISPLAY RULE:
//
//   BEARISH
//      -> latest confirmed TOP
//
//   BULLISH
//      -> latest confirmed BOTTOM
//
//   NEUTRAL
//      -> latest confirmed fractal
//
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
    const latestTop =
      getLatestConfirmedTop(
        signal
      );

    if (
      latestTop
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
    const latestBottom =
      getLatestConfirmedBottom(
        signal
      );

    if (
      latestBottom
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
// crtEngine.js is responsible for this.
//
// The service does NOT calculate another sweep.
//
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
// CRT CONFIRMATION
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
//
// The Discord field is:
//
//   Potential CRT
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
// COIN SYMBOL FORMATTER
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
// CREATE CRT EMBED
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
    // INFORMATION
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
      //
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
    // CANDLE TIME
    // ========================================================

    .setTimestamp(
      signal.candleTime
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
  const channelId =
    CHANNELS[
      signal.timeframe
    ];

  if (
    !channelId
  ) {
    console.warn(
      `[CRT] No Discord channel configured for ${signal.timeframe}`
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
      `[CRT] Invalid Discord channel for ${signal.timeframe}`
    );

    return;
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
}


// ============================================================
// FILTER FUTURES SYMBOLS
//
// MEXC FUTURES ONLY.
//
// No Spot symbols are accepted.
//
// ============================================================

function filterSymbols(
  symbols,
  market
) {
  // ----------------------------------------------------------
  // HARD SAFETY CHECK
  // ----------------------------------------------------------

  if (
    market !==
    'futures'
  ) {
    return [];
  }

  const configured =
    getConfiguredSymbols(
      market
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
//
// ONLY MEXC FUTURES CONTRACTS ARE LOADED.
//
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

    cachedSymbols.set(
      'futures',
      filterSymbols(
        contracts,
        'futures'
      )
    );

    console.log(
      `[CRT] MEXC Futures symbols loaded: ${
        cachedSymbols.get(
          'futures'
        )?.length ||
        0
      }`
    );

  } catch (
    error
  ) {
    console.error(
      '[CRT] Failed to refresh MEXC Futures symbols:',
      error?.message ||
      error
    );

    cachedSymbols.set(
      'futures',
      []
    );
  }

  lastSymbolRefresh =
    Date.now();
}


// ============================================================
// GET TIMEFRAME BOUNDARY
//
// Example:
//
//   08:17 on 15m
//      -> 08:15
//
//   08:59 on 1h
//      -> 08:00
//
//   11:47 on 4h
//      -> 08:00
//
// ============================================================

function getTimeframeBoundary(
  timeframe,
  timestamp = Date.now()
) {
  const timeframeMs =
    TIMEFRAME_MS[
      timeframe
    ];

  if (
    !timeframeMs
  ) {
    return null;
  }

  return (
    Math.floor(
      timestamp /
        timeframeMs
    ) *
    timeframeMs
  );
}


// ============================================================
// GET NEXT TIMEFRAME BOUNDARY
// ============================================================

function getNextTimeframeBoundary(
  timeframe,
  timestamp = Date.now()
) {
  const timeframeMs =
    TIMEFRAME_MS[
      timeframe
    ];

  if (
    !timeframeMs
  ) {
    return null;
  }

  return (
    getTimeframeBoundary(
      timeframe,
      timestamp
    ) +
    timeframeMs
  );
}


// ============================================================
// SHOULD SCAN TIMEFRAME
//
// A timeframe is scanned once for every new boundary.
//
// ============================================================

function shouldScanTimeframe(
  timeframe,
  timestamp = Date.now()
) {
  const boundary =
    getTimeframeBoundary(
      timeframe,
      timestamp
    );

  if (
    boundary ===
    null
  ) {
    return false;
  }

  const previous =
    lastProcessedBoundary.get(
      timeframe
    );

  if (
    previous ===
    boundary
  ) {
    return false;
  }

  return true;
}


// ============================================================
// MARK TIMEFRAME PROCESSED
// ============================================================

function markTimeframeProcessed(
  timeframe,
  timestamp = Date.now()
) {
  const boundary =
    getTimeframeBoundary(
      timeframe,
      timestamp
    );

  if (
    boundary ===
    null
  ) {
    return;
  }

  lastProcessedBoundary.set(
    timeframe,
    boundary
  );
}


// ============================================================
// INITIALIZE RESTART PROTECTION
//
// IMPORTANT:
//
// If Railway restarts at:
//
//   08:07
//
// the bot must NOT process the already-closed 08:05 candle.
//
// Therefore every timeframe starts with its CURRENT boundary
// marked as already processed.
//
// The next boundary is then the first one eligible for scanning.
//
// Example:
//
// Startup 08:07:
//
//   5m  current boundary = 08:05
//   15m current boundary = 08:00
//   30m current boundary = 08:00
//   1h  current boundary = 08:00
//
// The bot waits for:
//
//   08:10 -> 5m
//   08:15 -> 5m + 15m
//   08:30 -> 5m + 15m + 30m
//
// ============================================================

function initializeBoundaryState(
  timestamp = Date.now()
) {
  const configured =
    Object.keys(
      TIMEFRAMES
    );

  for (
    const timeframe of
    configured
  ) {
    const boundary =
      getTimeframeBoundary(
        timeframe,
        timestamp
      );

    if (
      boundary !==
      null
    ) {
      lastProcessedBoundary.set(
        timeframe,
        boundary
      );
    }
  }

  console.log(
    '[CRT] Boundary state initialized. Existing candles will NOT be replayed.'
  );
}


// ============================================================
// GET DUE TIMEFRAMES
//
// Returns only timeframes whose NEW candle boundary has
// been reached.
//
// ============================================================

function getDueTimeframes(
  timestamp = Date.now()
) {
  const configured =
    Object.keys(
      TIMEFRAMES
    );

  const ordered =
    TIMEFRAME_PRIORITY.filter(
      (timeframe) =>
        configured.includes(
          timeframe
        )
    );

  // ----------------------------------------------------------
  // Preserve any custom configured timeframe after the
  // standard priority list.
  // ----------------------------------------------------------

  for (
    const timeframe of
    configured
  ) {
    if (
      !ordered.includes(
        timeframe
      )
    ) {
      ordered.push(
        timeframe
      );
    }
  }

  return ordered.filter(
    (timeframe) =>
      shouldScanTimeframe(
        timeframe,
        timestamp
      )
  );
}


// ============================================================
// GET CANDLE TIME
//
// Handles common MEXC candle timestamp property names.
//
// ============================================================

function getCandleTime(
  candle
) {
  const value =
    candle?.openTime ??
    candle?.time ??
    candle?.timestamp ??
    candle?.ts ??
    null;

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

  // Convert seconds to milliseconds when necessary.
  return number <
    1e12
    ? number * 1000
    : number;
}


// ============================================================
// GET CANDLE CLOSE TIME
//
// Prefer an explicit close timestamp.
//
// Otherwise:
//
//   open time + timeframe duration
//
// ============================================================

function getCandleCloseTime(
  candle,
  timeframe
) {
  const explicit =
    candle?.closeTime ??
    candle?.endTime ??
    candle?.closeTimestamp ??
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
    return explicitNumber <
      1e12
      ? explicitNumber * 1000
      : explicitNumber;
  }

  const openTime =
    getCandleTime(
      candle
    );

  const timeframeMs =
    TIMEFRAME_MS[
      timeframe
    ];

  if (
    openTime ===
      null ||
    !timeframeMs
  ) {
    return null;
  }

  return (
    openTime +
    timeframeMs
  );
}


// ============================================================
// GET LATEST CLOSED CANDLE FOR BOUNDARY
//
// The returned candle must have:
//
//   closeTime === timeframe boundary
//
// This prevents a still-forming candle from being interpreted
// as the confirmation candle.
//
// ============================================================

function getLatestClosedCandleForBoundary(
  candles,
  timeframe,
  boundary
) {
  if (
    !Array.isArray(
      candles
    )
  ) {
    return null;
  }

  const valid =
    candles
      .filter(
        (candle) => {
          if (
            candle?.closed ===
            false
          ) {
            return false;
          }

          const open =
            Number(
              candle?.open
            );

          const high =
            Number(
              candle?.high
            );

          const low =
            Number(
              candle?.low
            );

          const close =
            Number(
              candle?.close
            );

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
            boundary
          );
        }
      )
      .sort(
        (a, b) =>
          (
            getCandleTime(
              a
            ) || 0
          ) -
          (
            getCandleTime(
              b
            ) || 0
          )
      );

  if (
    !valid.length
  ) {
    return null;
  }

  return valid[
    valid.length - 1
  ];
}


// ============================================================
// VERIFY CANDLE VALUES
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
// SCAN SYMBOL
//
// IMPORTANT:
//
// The service does NOT calculate CRT itself.
//
// crtEngine.js is the authority.
//
// ============================================================

async function scanSymbol(
  client,
  market,
  symbol,
  timeframe,
  boundary
) {
  try {

    // ========================================================
    // HARD FUTURES-ONLY SAFETY
    // ========================================================

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
          'futures',

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
      return;
    }


    // ========================================================
    // FIND THE ACTUAL CLOSED CANDLE AT THIS BOUNDARY
    // ========================================================

    const latestClosed =
      getLatestClosedCandleForBoundary(
        candles,
        timeframe,
        boundary
      );

    if (
      !latestClosed
    ) {
      console.warn(
        `[CRT] ${symbol} ${timeframe} skipped: no closed candle available for boundary ${new Date(boundary).toISOString()}`
      );

      return;
    }


    // ========================================================
    // VERIFY THE CANDLE ACTUALLY ENDED AT THE EXPECTED
    // TIMEFRAME BOUNDARY
    //
    // This is the important synchronization check.
    // ========================================================

    const latestCloseTime =
      getCandleCloseTime(
        latestClosed,
        timeframe
      );

    if (
      latestCloseTime !==
      boundary
    ) {
      console.warn(
        `[CRT] ${symbol} ${timeframe} skipped: candle close ${latestCloseTime} does not match boundary ${boundary}`
      );

      return;
    }


    // ========================================================
    // CLOSED CANDLES ONLY
    //
    // Historical candles are passed to the engine.
    // The boundary candle is guaranteed closed.
    //
    // ========================================================

    const closed =
      candles.filter(
        (candle) => {
          if (
            candle?.closed ===
            false
          ) {
            return false;
          }

          return hasValidOHLC(
            candle
          );
        }
      );


    // ========================================================
    // MINIMUM HISTORY
    // ========================================================

    const minimumCandles =
      Math.max(
        30,
        RSI_PERIOD + 10,
        7
      );

    if (
      closed.length <
      minimumCandles
    ) {
      return;
    }


    // ========================================================
    // BUILD RACHEL T CRT SIGNAL
    //
    // crtEngine.js is responsible for:
    //
    //   • Rachel T Fractal
    //   • CRT
    //   • Market Structure
    //   • STD Deviation
    //   • Liquidity
    //   • RSI
    //
    // ========================================================

    const signal =
      buildSignal({
        symbol,

        market:
          'futures',

        timeframe,

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
    // SIGNAL MUST BELONG TO THIS TIMEFRAME
    // ========================================================

    if (
      signal.timeframe &&
      String(
        signal.timeframe
      ) !==
      String(
        timeframe
      )
    ) {
      console.warn(
        `[CRT] ${symbol} rejected: engine timeframe mismatch. Expected=${timeframe}, Received=${signal.timeframe}`
      );

      return;
    }


    // ========================================================
    // SIGNAL ID
    //
    // Prevent duplicate Discord alerts.
    // ========================================================

    if (
      !signal.id
    ) {
      console.warn(
        `[CRT] Signal rejected because no signal.id was returned: futures:${symbol}:${timeframe}:${boundary}`
      );

      return;
    }


    // ========================================================
    // NEW SIGNAL CHECK
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
      `[CRT] RACHEL T CONFIRMED` +
      ` futures:${symbol}:${timeframe}` +
      ` | Boundary=${new Date(boundary).toISOString()}` +
      ` | Structure=${getMarketStructure(signal)}` +
      ` | DisplayFractal=${getFractalType(signal)}` +
      ` | STD=${getStdDeviation(signal)}` +
      ` | Liquidity=${getLiquiditySweep(signal)}` +
      ` | PotentialCRT=${formatPotentialCRT(signal)}` +
      ` | RSI=${signal.rsiState || 'Neutral'}`
    );

  } catch (
    error
  ) {
    console.error(
      `[CRT] Scan failed futures:${symbol}:${timeframe}:`,
      error?.message ||
      error
    );
  }
}


// ============================================================
// SCAN ALL DUE TIMEFRAMES
//
// IMPORTANT:
//
// This does NOT scan all timeframes every scheduler tick.
//
// It scans ONLY timeframes that have reached a NEW candle
// boundary.
//
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
    // CURRENT TIME
    // ========================================================

    const now =
      Date.now();


    // ========================================================
    // DETERMINE WHICH TIMEFRAMES ARE DUE
    // ========================================================

    const dueTimeframes =
      getDueTimeframes(
        now
      );


    // ========================================================
    // NOTHING DUE
    // ========================================================

    if (
      !dueTimeframes.length
    ) {
      return;
    }


    // ========================================================
    // LOAD MEXC FUTURES SYMBOLS
    // ========================================================

    await refreshSymbols();


    const symbols =
      cachedSymbols.get(
        'futures'
      ) || [];


    if (
      !symbols.length
    ) {
      console.warn(
        '[CRT] No MEXC Futures symbols available.'
      );

      return;
    }


    // ========================================================
    // PROCESS EACH DUE TIMEFRAME
    //
    // Lower timeframe first.
    // ========================================================

    for (
      const timeframe of
      dueTimeframes
    ) {

      const boundary =
        getTimeframeBoundary(
          timeframe,
          now
        );

      if (
        boundary ===
        null
      ) {
        continue;
      }


      // ======================================================
      // MARK THIS BOUNDARY AS PROCESSED
      //
      // Prevent another scheduler cycle from processing the
      // same boundary while this scan is running.
      // ======================================================

      markTimeframeProcessed(
        timeframe,
        now
      );


      console.log(
        `[CRT] NEW CLOSED CANDLE → ${timeframe} | ${new Date(boundary).toISOString()}`
      );

      console.log(
        `[CRT] Scanning ${symbols.length} Futures symbols for ${timeframe}`
      );


      // ======================================================
      // SCAN EVERY FUTURES SYMBOL
      // ======================================================

      for (
        const symbol of
        symbols
      ) {
        await scanSymbol(
          client,
          'futures',
          symbol,
          timeframe,
          boundary
        );
      }


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
  // CLIENT CHECK
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
    '[CRT] Signal monitor started.'
  );

  console.log(
    '[CRT] MARKET SOURCE: MEXC FUTURES ONLY'
  );

  console.log(
    '[CRT] SPOT MARKET: DISABLED'
  );

  console.log(
    '[CRT] PRIMARY SIGNAL: Rachel T Fractal + CRT Confirmation'
  );

  console.log(
    '[CRT] Markets: MEXC Futures ONLY'
  );

  console.log(
    `[CRT] Timeframes: ${
      Object.keys(
        TIMEFRAMES
      ).join(', ')
    }`
  );

  console.log(
    '[CRT] TIMEFRAME MODE: CANDLE-BOUNDARY SYNCHRONIZED'
  );

  console.log(
    '[CRT] 5m  → every 5 minutes'
  );

  console.log(
    '[CRT] 15m → every 15 minutes'
  );

  console.log(
    '[CRT] 30m → every 30 minutes'
  );

  console.log(
    '[CRT] 1h  → every hour'
  );

  console.log(
    '[CRT] 4h  → every 4 hours'
  );

  console.log(
    '[CRT] 1d  → every day'
  );

  console.log(
    `[CRT] Scheduler interval: ${SCHEDULER_INTERVAL}ms`
  );

  console.log(
    `[CRT] Kline history: ${KLINE_LIMIT} candles`
  );

  console.log(
    `[CRT] Max symbols: ${MAX_SYMBOLS}`
  );

  console.log(
    `[CRT] Auto symbols: ${AUTO_SYMBOLS}`
  );

  console.log(
    '[CRT] Display Fractal Rule: Bearish=TOP | Bullish=BOTTOM'
  );

  console.log(
    '[CRT] Discord field: Potential CRT'
  );

  console.log(
    '[CRT] Fractal Price display: DISABLED'
  );


  // ==========================================================
  // RESTART PROTECTION
  //
  // IMPORTANT:
  //
  // Do NOT immediately scan the current historical boundary.
  //
  // If Railway starts at 08:07:
  //
  //   08:05 candle already closed.
  //
  // It will NOT be replayed.
  //
  // First eligible:
  //
  //   08:10 -> 5m
  //
  // ==========================================================

  initializeBoundaryState();


  // ==========================================================
  // START SCHEDULER
  //
  // No immediate historical scan.
  // ==========================================================

  setInterval(
    () => {
      void scanAll(
        client
      );
    },
    SCHEDULER_INTERVAL
  );


  console.log(
    '[CRT] Boundary scheduler started.'
  );

  console.log(
    '[CRT] Restart protection: ENABLED'
  );
}


// ============================================================
// MANUAL SCAN
//
// IMPORTANT:
//
// Manual scan does NOT bypass the timeframe boundary rules.
//
// This keeps scanCRTNow() from accidentally replaying an old
// candle.
//
// ============================================================

export async function scanCRTNow(
  client
) {
  await scanAll(
    client
  );
}


// ============================================================
// CRT CONFIG
// ============================================================

export function getCRTConfig() {
  return {

    // --------------------------------------------------------
    // HARD LOCKED TO MEXC FUTURES
    // --------------------------------------------------------

    markets: [
      'futures',
    ],

    // --------------------------------------------------------
    // TIMEFRAMES
    // --------------------------------------------------------

    timeframes:
      Object.keys(
        TIMEFRAMES
      ),

    // --------------------------------------------------------
    // SCHEDULER
    // --------------------------------------------------------

    schedulerInterval:
      SCHEDULER_INTERVAL,

    // --------------------------------------------------------
    // KLINES
    // --------------------------------------------------------

    klineLimit:
      KLINE_LIMIT,

    // --------------------------------------------------------
    // SYMBOL LIMIT
    // --------------------------------------------------------

    maxSymbolsPerMarket:
      MAX_SYMBOLS,

    // --------------------------------------------------------
    // SYMBOL MODE
    // --------------------------------------------------------

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
    // SCHEDULING
    // --------------------------------------------------------

    scheduling: {
      mode:
        'CANDLE_BOUNDARY',

      restartProtection:
        true,

      scanOnlyNewBoundary:
        true,

      priority:
        TIMEFRAME_PRIORITY,
    },

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
  `[CRT] Service loaded • Rachel T Fractal PRIMARY • MEXC FUTURES ONLY • ${
    Object.keys(
      TIMEFRAMES
    ).join(', ')
  }`
);

console.log(
  '[CRT] Fractal display alignment: Bearish → TOP | Bullish → BOTTOM'
);

console.log(
  '[CRT] Discord field renamed: Potential CRT'
);

console.log(
  '[CRT] Fractal Price display: DISABLED'
);

console.log(
  '[CRT] Spot scanning: DISABLED'
);

console.log(
  '[CRT] Timeframe synchronization: ENABLED'
);

console.log(
  '[CRT] Restart replay protection: ENABLED'
);

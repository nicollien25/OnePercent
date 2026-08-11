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
// MARKET:
//
//   MEXC FUTURES ONLY
//
// TIME SOURCE:
//
//   MEXC UTC EPOCH CANDLE BOUNDARIES
//
// IMPORTANT:
//
//   The service does NOT use local Philippine time to calculate
//   candle boundaries.
//
//   MEXC candle boundaries are calculated from UTC epoch time.
//
// Example:
//
//   15m:
//
//      07:45 -> 08:00
//
//   1h:
//
//      07:00 -> 08:00
//
//   4h:
//
//      04:00 -> 08:00
//
//   1d:
//
//      00:00 UTC -> 00:00 UTC next day
//
// Philippines:
//
//   00:00 UTC = 08:00 Manila
//
// ============================================================
//
// SERVICE RESPONSIBILITIES:
//
//   1. Load MEXC Futures symbols.
//   2. Fetch MEXC Futures candles.
//   3. Normalize candle close boundaries.
//   4. Never use the still-forming candle.
//   5. Trigger scans exactly from timeframe boundaries.
//   6. Send candles to crtEngine.js.
//   7. Accept only confirmed CRT signals.
//   8. Prevent duplicate signals.
//   9. Display the Discord signal.
//
// ============================================================
//
// IMPORTANT:
//
//   Spot is completely disabled.
//
// ============================================================


// ============================================================
// CONFIG
// ============================================================

const CRT_CONFIG =
  botConfig.crt || {};


// ============================================================
// DEFAULT TIMEFRAMES
// ============================================================

const DEFAULT_TIMEFRAMES = {
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
};


// ============================================================
// TIMEFRAMES
// ============================================================

const TIMEFRAMES =
  CRT_CONFIG.timeframes ||
  DEFAULT_TIMEFRAMES;


// ============================================================
// DISCORD CHANNELS
// ============================================================

const CHANNELS =
  CRT_CONFIG.channels ||
  {};


// ============================================================
// HARD MARKET LOCK
// ============================================================
//
// MEXC FUTURES ONLY.
//
// ============================================================

const MARKET =
  'futures';


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
//
// These are the exact UTC epoch durations used for boundary
// calculations.
//
// ============================================================

const TIMEFRAME_MS = {

  '5m':
    5 *
    60 *
    1000,

  '15m':
    15 *
    60 *
    1000,

  '30m':
    30 *
    60 *
    1000,

  '1h':
    60 *
    60 *
    1000,

  '4h':
    4 *
    60 *
    60 *
    1000,

  '1d':
    24 *
    60 *
    60 *
    1000,
};


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
  CRT_CONFIG.autoSymbols !==
  false;


// ============================================================
// SYMBOL REFRESH
// ============================================================

const SYMBOL_REFRESH_MS =
  Number(
    CRT_CONFIG.symbolRefreshMs ||
    15 *
      60 *
      1000
  );


// ============================================================
// SCAN CONCURRENCY
// ============================================================
//
// Instead of scanning every symbol sequentially:
//
//   BTC
//   ETH
//   XRP
//   ...
//
// we process several symbols at the same time.
//
// This is important because the scanner must finish quickly
// around MEXC timeframe boundaries.
//
// ============================================================

const SCAN_CONCURRENCY =
  Math.max(
    1,
    Number(
      CRT_CONFIG.scanConcurrency ||
      5
    )
  );


// ============================================================
// BOUNDARY POLL
// ============================================================
//
// The scheduler checks every second by default.
//
// This does NOT define the candle timeframe.
//
// It only checks whether a MEXC boundary has occurred.
//
// ============================================================

const BOUNDARY_POLL_MS =
  Math.max(
    250,
    Number(
      CRT_CONFIG.boundaryPollMs ||
      1000
    )
  );


// ============================================================
// BOUNDARY DELAY
// ============================================================
//
// Wait slightly after the exact MEXC boundary before requesting
// the newly closed candle.
//
// This prevents requesting the API in the tiny transition
// window where the new candle may not yet be available.
//
// ============================================================

const BOUNDARY_DELAY_MS =
  Math.max(
    0,
    Number(
      CRT_CONFIG.boundaryDelayMs ||
      1500
    )
  );


// ============================================================
// API RETRIES
// ============================================================

const API_RETRY_COUNT =
  Math.max(
    0,
    Number(
      CRT_CONFIG.boundaryRetryCount ||
      3
    )
  );


// ============================================================
// API RETRY DELAY
// ============================================================

const API_RETRY_DELAY_MS =
  Math.max(
    250,
    Number(
      CRT_CONFIG.boundaryRetryDelayMs ||
      1000
    )
  );


// ============================================================
// STATE
// ============================================================

let monitorStarted =
  false;

let schedulerTimer =
  null;

let cachedSymbols =
  [];

let lastSymbolRefresh =
  0;

let refreshRunning =
  false;


// ============================================================
// TIMEFRAME STATE
// ============================================================
//
// lastBoundaryScheduled:
//
//   Prevents the same MEXC boundary from being processed
//   multiple times.
//
// timeframeRunning:
//
//   Prevents overlapping scans of the same timeframe.
//
// pendingTimers:
//
//   Holds the post-boundary timers.
//
// ============================================================

const lastBoundaryScheduled =
  new Map();

const timeframeRunning =
  new Map();

const pendingTimers =
  new Map();


// ============================================================
// TIMEFRAME NORMALIZER
// ============================================================

function normalizeTimeframe(
  value
) {

  const v =
    String(
      value ||
      ''
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

    'daily':
      '1d',

    'day':
      '1d',

  };

  return (
    aliases[v] ||
    v
  );
}


// ============================================================
// GET TIMEFRAME MILLISECONDS
// ============================================================

function getTimeframeMs(
  timeframe
) {

  const normalized =
    normalizeTimeframe(
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
// TIMESTAMP NORMALIZER
// ============================================================

function normalizeTimestamp(
  value
) {

  if (
    value instanceof
    Date
  ) {

    const n =
      value.getTime();

    return Number.isFinite(
      n
    )
      ? n
      : null;
  }

  const n =
    Number(
      value
    );

  if (
    !Number.isFinite(
      n
    )
  ) {
    return null;
  }

  // Unix seconds -> milliseconds.

  if (
    n > 0 &&
    n <
      100000000000
  ) {

    return (
      n *
      1000
    );
  }

  return n;
}


// ============================================================
// GET CANDLE OPEN TIME
// ============================================================

function getCandleOpenTime(
  candle
) {

  return normalizeTimestamp(
    candle?.openTime ??
      candle?.time ??
      candle?.timestamp ??
      candle?.ts
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

    }[
      normalized
    ] ||
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

  const n =
    Number(
      value
    );

  if (
    !Number.isFinite(
      n
    )
  ) {

    return 'N/A';
  }

  return n.toFixed(
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

    return (
      '**OVERBOUGHT**'
    );
  }

  if (
    normalized ===
    'OVERSOLD'
  ) {

    return (
      '**OVERSOLD**'
    );
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

    i -= 1
  ) {

    if (
      String(
        fractals[i]?.type ||
        ''
      )
        .trim()
        .toUpperCase() ===
      'TOP'
    ) {

      return fractals[i];
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

    i -= 1
  ) {

    if (
      String(
        fractals[i]?.type ||
        ''
      )
        .trim()
        .toUpperCase() ===
      'BOTTOM'
    ) {

      return fractals[i];
    }
  }

  return null;
}


// ============================================================
// FRACTAL DISPLAY
//
// BEARISH:
//
//   latest confirmed TOP
//
// BULLISH:
//
//   latest confirmed BOTTOM
//
// NEUTRAL:
//
//   latest confirmed fractal
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
      ''
    )
      .trim()
      .toUpperCase();


  if (
    latestType ===
    'TOP'
  ) {

    return 'TOP';
  }


  if (
    latestType ===
    'BOTTOM'
  ) {

    return 'BOTTOM';
  }


  const raw =
    String(
      signal?.fractalType ??
        signal?.fractal?.type ??
        signal?.type ??
        ''
    )
      .trim()
      .toUpperCase();


  if (
    raw.includes(
      'TOP'
    )
  ) {

    return 'TOP';
  }


  if (
    raw.includes(
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
// CONFIRMATION SAFETY
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

  const fractal =
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

  return (
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
            'STD Deviation',

          value:
            getStdDeviation(
              signal
            ),

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
            potentialCRT,

          inline:
            true,
        },

        {
          name:
            'RSI',

          value:
            formatRSIState(
              signal.rsiState
            ),

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
        signal.candleTime
          ? new Date(
              signal.candleTime
            )
          : new Date()
      )
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


  await channel.send({

    content:
      `${structureEmoji(
        signal
      )} **${coin}**`,

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


  if (
    Array.isArray(
      configured
    ) &&
    configured.length
  ) {

    return configured.slice(
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


  return symbols

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
            quote
          )

        );
      }
    )

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

    return cachedSymbols;
  }


  if (
    refreshRunning
  ) {

    return cachedSymbols;
  }


  refreshRunning =
    true;


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

  } finally {

    refreshRunning =
      false;
  }


  return cachedSymbols;
}


// ============================================================
// MEXC CANDLE NORMALIZATION
// ============================================================
//
// IMPORTANT:
//
// MEXC Futures candle data is based on UTC epoch boundaries.
//
// Internally we normalize every candle to:
//
//   openTime
//      = exact MEXC opening boundary
//
//   closeTime
//      = exact MEXC closing boundary
//
//   mexcCloseTime
//      = raw close timestamp returned by the adapter
//
// Example:
//
// 15m candle:
//
//   open:
//     07:45:00
//
//   close boundary:
//     08:00:00
//
// The raw adapter may represent this as:
//
//   07:59:59.999
//
// That 1ms representation must NOT be treated as a different
// timeframe boundary.
//
// ============================================================

function normalizeMexcCandle(
  candle,
  timeframe,
  now = Date.now()
) {

  const intervalMs =
    getTimeframeMs(
      timeframe
    );


  const rawOpenTime =
    getCandleOpenTime(
      candle
    );


  if (
    !intervalMs ||
    rawOpenTime ===
      null
  ) {

    return null;
  }


  // ----------------------------------------------------------
  // Normalize the opening time to the MEXC timeframe boundary.
  // ----------------------------------------------------------

  const openBoundary =
    Math.floor(
      rawOpenTime /
        intervalMs
    ) *
    intervalMs;


  // ----------------------------------------------------------
  // Exact candle close boundary.
  // ----------------------------------------------------------

  const closeBoundary =
    openBoundary +
    intervalMs;


  // ----------------------------------------------------------
  // Preserve raw MEXC close time for diagnostics.
  // ----------------------------------------------------------

  const rawCloseTime =
    normalizeTimestamp(
      candle?.closeTime ??
        candle?.endTime ??
        candle?.closeTimestamp
    );


  // ----------------------------------------------------------
  // Validate OHLC.
  // ----------------------------------------------------------

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
    ![
      open,
      high,
      low,
      close,
    ].every(
      Number.isFinite
    )
  ) {

    return null;
  }


  return {

    ...candle,

    // Exact MEXC UTC opening boundary.
    openTime:
      openBoundary,

    // Exact MEXC close boundary.
    closeTime:
      closeBoundary,

    // Preserve original adapter timestamp.
    mexcCloseTime:
      rawCloseTime ??
      closeBoundary -
        1,

    // Explicit boundary used by the service.
    closeBoundary,

    // A candle is closed only after its exact boundary.
    closed:
      closeBoundary <=
      now,

  };
}


// ============================================================
// NORMALIZE ALL MEXC CANDLES
// ============================================================

function normalizeMexcCandles(
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


  const unique =
    new Map();


  for (
    const candle of
    candles
  ) {

    const normalized =
      normalizeMexcCandle(
        candle,
        timeframe,
        now
      );


    if (
      !normalized
    ) {

      continue;
    }


    unique.set(
      String(
        normalized.openTime
      ),
      normalized
    );
  }


  return [
    ...unique.values(),
  ].sort(
    (a, b) =>
      a.openTime -
      b.openTime
  );
}


// ============================================================
// CURRENT MEXC BOUNDARY
// ============================================================
//
// Example:
//
// 08:07:
//
// 15m current boundary:
//
// 08:00
//
// Meaning:
//
// The candle ending at 08:00 is closed.
//
// ============================================================

function getCurrentBoundary(
  timeframe,
  now = Date.now()
) {

  const intervalMs =
    getTimeframeMs(
      timeframe
    );


  if (
    !intervalMs
  ) {

    return null;
  }


  return (
    Math.floor(
      now /
        intervalMs
    ) *
    intervalMs
  );
}


// ============================================================
// FORMAT BOUNDARY
// ============================================================

function formatBoundary(
  boundary
) {

  if (
    !boundary
  ) {

    return 'N/A';
  }


  return new Date(
    boundary
  ).toISOString();
}


// ============================================================
// ORDER TIMEFRAMES
// ============================================================

function getOrderedTimeframes() {

  const configured =
    Object.keys(
      TIMEFRAMES
    )
      .map(
        normalizeTimeframe
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
      ) &&

      !result.includes(
        timeframe
      )

    ) {

      result.push(
        timeframe
      );
    }
  }


  // Custom supported timeframe
  // values are appended after the
  // standard priority order.

  for (
    const timeframe of
    configured
  ) {

    if (

      getTimeframeMs(
        timeframe
      ) &&

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
// SLEEP
// ============================================================

async function sleep(
  ms
) {

  await new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms
      )
  );
}


// ============================================================
// FETCH + NORMALIZE MEXC CANDLES
// ============================================================
//
// targetBoundary:
//
//   The exact MEXC candle close that triggered the scan.
//
// ============================================================

async function fetchNormalizedCandles(
  symbol,
  timeframe,
  targetBoundary
) {

  for (
    let attempt = 0;

    attempt <=
      API_RETRY_COUNT;

    attempt += 1
  ) {

    try {

      const raw =
        await getKlines({

          market:
            MARKET,

          symbol,

          timeframe,

          limit:
            KLINE_LIMIT,

        });


      const now =
        Date.now();


      const normalized =
        normalizeMexcCandles(
          raw,
          timeframe,
          now
        );


      // ------------------------------------------------------
      // Make sure the exact MEXC boundary exists.
      // ------------------------------------------------------

      const target =
        normalized.find(
          (candle) =>
            candle.closeBoundary ===
            targetBoundary
        );


      if (
        target
      ) {

        // ----------------------------------------------------
        // Only return candles up to the target boundary.
        //
        // This prevents the new active candle from entering
        // the CRT calculation.
        // ----------------------------------------------------

        return normalized.filter(
          (candle) =>
            candle.closeBoundary <=
            targetBoundary
        );
      }


      // ------------------------------------------------------
      // MEXC API may need a short moment after a boundary
      // before the newly closed candle appears.
      // ------------------------------------------------------

      if (
        attempt <
        API_RETRY_COUNT
      ) {

        await sleep(
          API_RETRY_DELAY_MS
        );
      }

    } catch (
      error
    ) {

      if (
        attempt >=
        API_RETRY_COUNT
      ) {

        throw error;
      }


      await sleep(
        API_RETRY_DELAY_MS
      );
    }
  }


  return null;
}


// ============================================================
// SCAN SYMBOL
// ============================================================

async function scanSymbol(
  client,
  symbol,
  timeframe,
  targetBoundary
) {

  try {

    const normalizedTimeframe =
      normalizeTimeframe(
        timeframe
      );


    // --------------------------------------------------------
    // Fetch exact MEXC boundary snapshot.
    // --------------------------------------------------------

    const candles =
      await fetchNormalizedCandles(
        symbol,
        normalizedTimeframe,
        targetBoundary
      );


    if (
      !candles
    ) {

      return;
    }


    const minimumCandles =
      Math.max(
        30,
        RSI_PERIOD +
          10,
        7
      );


    if (
      candles.length <
      minimumCandles
    ) {

      return;
    }


    // --------------------------------------------------------
    // CLOSED CANDLES ONLY.
    //
    // The target boundary is the final candle allowed.
    // --------------------------------------------------------

    const closed =
      candles.filter(
        (candle) =>

          candle.closed ===
            true &&

          candle.closeBoundary <=
            targetBoundary
      );


    if (
      closed.length <
      minimumCandles
    ) {

      return;
    }


    // --------------------------------------------------------
    // BUILD RACHEL T CRT SIGNAL.
    // --------------------------------------------------------

    const signal =
      buildSignal({

        symbol,

        market:
          MARKET,

        source:
          'MEXC',

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


    // --------------------------------------------------------
    // No confirmed CRT.
    // --------------------------------------------------------

    if (
      !signal
    ) {

      return;
    }


    // --------------------------------------------------------
    // Confirmation safety.
    // --------------------------------------------------------

    if (
      !isConfirmedSignal(
        signal
      )
    ) {

      return;
    }


    // --------------------------------------------------------
    // Signal ID is required.
    // --------------------------------------------------------

    if (
      !signal.id
    ) {

      console.warn(

        `[CRT] Signal rejected because no signal.id was returned: ` +

        `futures:${symbol}:${normalizedTimeframe}`

      );

      return;
    }


    // --------------------------------------------------------
    // Duplicate protection.
    // --------------------------------------------------------

    if (
      !isNewSignal(
        signal.id
      )
    ) {

      return;
    }


    // --------------------------------------------------------
    // SEND DISCORD.
    // --------------------------------------------------------

    await sendSignal(
      client,
      signal
    );


    // --------------------------------------------------------
    // LOG.
    // --------------------------------------------------------

    console.log(

      `[CRT] CONFIRMED ${symbol} ${normalizedTimeframe}` +

      ` | Boundary=${formatBoundary(
        targetBoundary
      )}` +

      ` | Structure=${getMarketStructure(
        signal
      )}` +

      ` | Fractal=${getFractalType(
        signal
      )}` +

      ` | STD=${getStdDeviation(
        signal
      )}` +

      ` | Liquidity=${getLiquiditySweep(
        signal
      )}` +

      ` | PotentialCRT=${formatPotentialCRT(
        signal
      )}` +

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
// SCAN ONE TIMEFRAME
// ============================================================
//
// IMPORTANT:
//
// Each timeframe has its OWN scheduler.
//
// Therefore:
//
// 15m:
//
//   08:00
//   08:15
//   08:30
//   08:45
//
// 1h:
//
//   08:00
//   09:00
//   10:00
//
// 4h:
//
//   08:00
//   12:00
//   16:00
//
// They do NOT depend on each other.
//
// ============================================================

async function scanTimeframe(
  client,
  timeframe,
  targetBoundary
) {

  const normalizedTimeframe =
    normalizeTimeframe(
      timeframe
    );


  if (
    !getTimeframeMs(
      normalizedTimeframe
    )
  ) {

    return;
  }


  // ----------------------------------------------------------
  // Prevent overlapping scans of the same timeframe.
  // ----------------------------------------------------------

  if (
    timeframeRunning.get(
      normalizedTimeframe
    )
  ) {

    console.warn(

      `[CRT] ${normalizedTimeframe} scan already running; skipping overlapping scan.`

    );

    return;
  }


  timeframeRunning.set(
    normalizedTimeframe,
    true
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

        `[CRT] No MEXC Futures symbols available for ${normalizedTimeframe}`

      );

      return;
    }


    console.log(

      `[CRT] Starting ${normalizedTimeframe} scan` +

      ` | MEXC close boundary=${formatBoundary(
        targetBoundary
      )}`

    );


    let cursor =
      0;


    const workers =
      Math.min(
        SCAN_CONCURRENCY,
        symbols.length
      );


    async function worker() {

      while (
        true
      ) {

        const index =
          cursor;


        cursor +=
          1;


        if (
          index >=
          symbols.length
        ) {

          return;
        }


        await scanSymbol(

          client,

          symbols[index],

          normalizedTimeframe,

          targetBoundary

        );
      }
    }


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


    console.log(

      `[CRT] Completed ${normalizedTimeframe} scan` +

      ` | Boundary=${formatBoundary(
        targetBoundary
      )}`

    );

  } finally {

    timeframeRunning.set(
      normalizedTimeframe,
      false
    );
  }
}


// ============================================================
// SCHEDULE TIMEFRAME
// ============================================================

function scheduleTimeframeScan(
  client,
  timeframe,
  boundary
) {

  const normalized =
    normalizeTimeframe(
      timeframe
    );


  if (
    pendingTimers.has(
      normalized
    )
  ) {

    return;
  }


  const delay =
    Math.max(

      0,

      boundary +
        BOUNDARY_DELAY_MS -
        Date.now()

    );


  // ----------------------------------------------------------
  // Mark this boundary immediately.
  //
  // This prevents the scheduler from creating another timer
  // for the same boundary.
  // ----------------------------------------------------------

  lastBoundaryScheduled.set(
    normalized,
    boundary
  );


  const timer =
    setTimeout(

      async () => {

        pendingTimers.delete(
          normalized
        );


        try {

          await scanTimeframe(

            client,

            normalized,

            boundary

          );

        } catch (
          error
        ) {

          console.error(

            `[CRT] Scheduled ${normalized} scan failed:`,

            error?.message ||
              error

          );
        }

      },

      delay

    );


  pendingTimers.set(
    normalized,
    timer
  );
}


// ============================================================
// SCHEDULER TICK
// ============================================================
//
// This function does NOT scan candles.
//
// It only determines whether a new MEXC timeframe boundary
// has happened.
//
// ============================================================

function schedulerTick(
  client
) {

  const now =
    Date.now();


  for (
    const timeframe of
    getOrderedTimeframes()
  ) {

    const boundary =
      getCurrentBoundary(
        timeframe,
        now
      );


    if (
      !boundary
    ) {

      continue;
    }


    const last =
      lastBoundaryScheduled.get(
        timeframe
      );


    // --------------------------------------------------------
    // First scheduler observation.
    //
    // Do not backfill the current boundary.
    // --------------------------------------------------------

    if (
      last ===
      undefined
    ) {

      lastBoundaryScheduled.set(
        timeframe,
        boundary
      );


      console.log(

        `[CRT] ${timeframe} scheduler armed at ${formatBoundary(
          boundary
        )}; waiting for next MEXC close.`

      );


      continue;
    }


    // --------------------------------------------------------
    // A NEW MEXC boundary has occurred.
    // --------------------------------------------------------

    if (
      boundary >
      last
    ) {

      scheduleTimeframeScan(

        client,

        timeframe,

        boundary

      );
    }
  }
}


// ============================================================
// MANUAL FULL SCAN
// ============================================================
//
// Manual scan is different from the automatic scheduler.
//
// Automatic:
//
//   only scans when a NEW MEXC boundary occurs.
//
// Manual:
//
//   scans the latest currently closed candle for every
//   configured timeframe.
//
// ============================================================

async function scanAllNow(
  client
) {

  await refreshSymbols(
    true
  );


  const now =
    Date.now();


  for (
    const timeframe of
    getOrderedTimeframes()
  ) {

    const boundary =
      getCurrentBoundary(
        timeframe,
        now
      );


    if (
      !boundary
    ) {

      continue;
    }


    await scanTimeframe(

      client,

      timeframe,

      boundary

    );
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
    '[CRT] ============================================'
  );

  console.log(
    '[CRT] PDYN CRT MONITOR STARTED'
  );

  console.log(
    '[CRT] MARKET: MEXC FUTURES ONLY'
  );

  console.log(
    '[CRT] SPOT: DISABLED'
  );

  console.log(
    '[CRT] CLOCK: MEXC UTC EPOCH BOUNDARIES'
  );

  console.log(
    '[CRT] CLOSE: OPEN TIME + TIMEFRAME DURATION'
  );

  console.log(
    `[CRT] TIMEFRAMES: ${getOrderedTimeframes().join(
      ', '
    )}`
  );

  console.log(
    `[CRT] KLINE LIMIT: ${KLINE_LIMIT}`
  );

  console.log(
    `[CRT] MAX SYMBOLS: ${MAX_SYMBOLS}`
  );

  console.log(
    `[CRT] CONCURRENCY: ${SCAN_CONCURRENCY}`
  );

  console.log(
    `[CRT] BOUNDARY POLL: ${BOUNDARY_POLL_MS}ms`
  );

  console.log(
    `[CRT] POST-CLOSE DELAY: ${BOUNDARY_DELAY_MS}ms`
  );

  console.log(
    '[CRT] FRACTAL DISPLAY: Bearish=TOP | Bullish=BOTTOM'
  );

  console.log(
    '[CRT] DISCORD FIELD: Potential CRT'
  );

  console.log(
    '[CRT] STARTUP BACKFILL: DISABLED'
  );

  console.log(
    '[CRT] ============================================'
  );


  // ==========================================================
  // ARM CURRENT BOUNDARIES
  // ==========================================================
  //
  // This is critical.
  //
  // If Railway restarts at:
  //
  //   08:03
  //
  // the 08:00 candle is NOT treated as a new boundary.
  //
  // The service waits for:
  //
  //   08:05 / 08:15 / 09:00 / etc.
  //
  // ==========================================================

  const now =
    Date.now();


  for (
    const timeframe of
    getOrderedTimeframes()
  ) {

    const boundary =
      getCurrentBoundary(
        timeframe,
        now
      );


    if (
      boundary
    ) {

      lastBoundaryScheduled.set(
        timeframe,
        boundary
      );
    }
  }


  // ==========================================================
  // START 1-SECOND BOUNDARY CLOCK
  // ==========================================================

  schedulerTimer =
    setInterval(

      () =>
        schedulerTick(
          client
        ),

      BOUNDARY_POLL_MS

    );


  // ==========================================================
  // INITIAL SCHEDULER CHECK
  // ==========================================================

  schedulerTick(
    client
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


  await scanAllNow(
    client
  );
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
      getOrderedTimeframes(),

    klineLimit:
      KLINE_LIMIT,

    maxSymbolsPerMarket:
      MAX_SYMBOLS,

    scanConcurrency:
      SCAN_CONCURRENCY,

    boundaryPollMs:
      BOUNDARY_POLL_MS,

    boundaryDelayMs:
      BOUNDARY_DELAY_MS,

    boundaryRetryCount:
      API_RETRY_COUNT,

    boundaryRetryDelayMs:
      API_RETRY_DELAY_MS,

    autoSymbols:
      AUTO_SYMBOLS,

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

    candleClock:
      'MEXC_UTC_EPOCH_BOUNDARY',

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

  `[CRT] Service loaded • ` +

  `MEXC Futures • ` +

  `${getOrderedTimeframes().join(
    ', '
  )} • ` +

  `normalized MEXC close boundaries`

);

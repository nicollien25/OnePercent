import { EmbedBuilder } from 'discord.js';
import botConfig from '../../config/bot.js';

import {
  buildSignal,
  getClosedCandles,
  normalizeTimeframe,
  getTimeframeMs,
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
// DATA SOURCE:
//
//   MEXC FUTURES ONLY
//
// ENGINE:
//
//   ./crtEngine.js
//
// MEXC:
//
//   ./mexcService.js
//
// ============================================================
//
// IMPORTANT:
//
// The CRT ENGINE is responsible for:
//
//   • Rachel T fractals
//   • filtered TOP / BOTTOM
//   • market structure
//   • CRT confirmation
//   • liquidity sweep
//   • RSI
//   • standard deviation
//   • signal ID
//
// This SERVICE is responsible for:
//
//   • MEXC candle timing
//   • symbol scanning
//   • startup baseline
//   • duplicate candle protection
//   • Discord alerts
//
// ============================================================
//
// SIGNAL RULE:
//
// A Discord alert is allowed ONLY when:
//
//   1. MEXC candle is newly closed
//   2. Engine confirms CRT
//   3. signal.crtCandleTime equals that newly closed candle
//   4. signal.id has not already been processed
//
// ============================================================
//
// STARTUP RULE:
//
// When Railway restarts:
//
//   latest closed candle = baseline
//
// It is NOT alerted.
//
// The next newly closed candle can generate an alert.
//
// ============================================================

// ============================================================
// CONFIG
// ============================================================

const CRT_CONFIG =
  botConfig?.crt || {};

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
// BOUNDARY DELAY
//
// Wait slightly after MEXC's exact boundary so the newly
// closed candle is available through the API.
//
// Example:
//
// 15m candle closes:
//
//   08:15:00 UTC
//
// Service scans:
//
//   08:15:01.500 UTC
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
// SCAN CONCURRENCY
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

let cachedSymbols =
  [];

let lastSymbolRefresh =
  0;

// ============================================================
// SCAN LOCK
// ============================================================

const scanRunning =
  new Set();

// ============================================================
// TIMER STATE
// ============================================================

const timeframeTimers =
  new Map();

// ============================================================
// LAST PROCESSED MEXC CANDLE
//
// Key:
//
//   timeframe:symbol
//
// Value:
//
//   candle open timestamp
//
// ============================================================

const lastProcessedCandle =
  new Map();

// ============================================================
// STARTUP BASELINE
//
// Key:
//
//   timeframe:symbol
//
// ============================================================

const bootstrapped =
  new Set();

// ============================================================
// TIMEFRAME HELPERS
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
// TIMEFRAME LABEL
// ============================================================

function timeframeLabel(
  timeframe
) {
  const normalized =
    normalizeTimeframe(
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
    labels[normalized] ||
    String(
      timeframe
    ).toUpperCase()
  );
}

// ============================================================
// TIMEFRAME VALIDATION
// ============================================================

function isSupportedTimeframe(
  timeframe
) {
  const normalized =
    normalizeTimeframe(
      timeframe
    );

  return Boolean(
    getTimeframeMs(
      normalized
    )
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
// NUMBER FORMAT
// ============================================================

function formatNumber(
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
// NORMALIZE TIMESTAMP
// ============================================================

function normalizeTimestamp(
  value
) {
  if (
    value instanceof Date
  ) {
    const timestamp =
      value.getTime();

    return Number.isFinite(
      timestamp
    )
      ? timestamp
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

  if (
    number > 0 &&
    number < 100000000000
  ) {
    return (
      number *
      1000
    );
  }

  return number;
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

  return normalizeTimestamp(
    candle.openTime ??
    candle.time ??
    candle.timestamp ??
    candle.ts ??
    null
  );
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
    normalizeTimestamp(
      candle.closeTime ??
      candle.endTime ??
      candle.closeTimestamp ??
      null
    );

  if (
    explicit !== null
  ) {
    return explicit;
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
// LOCAL CLOSED-CANDLE FILTER
//
// MEXC service already supplies normalized timestamps.
//
// The engine also performs its own closed-candle validation.
//
// This second safety layer prevents the active candle from
// entering the CRT service.
//
// ============================================================

function getServiceClosedCandles(
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

  const normalized =
    candles.filter(
      (candle) => {
        if (
          !hasValidOHLC(
            candle
          )
        ) {
          return false;
        }

        const closeTime =
          getCandleCloseTime(
            candle,
            timeframe
          );

        return (
          closeTime !== null &&
          closeTime <= now
        );
      }
    );

  normalized.sort(
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

  const result =
    [];

  const seen =
    new Set();

  for (
    const candle of
    normalized
  ) {
    const time =
      getCandleOpenTime(
        candle
      );

    if (
      time === null
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

    result.push(
      candle
    );
  }

  return result;
}

// ============================================================
// FETCH MEXC CLOSED CANDLES
// ============================================================

async function fetchClosedCandles(
  symbol,
  timeframe
) {
  const normalized =
    normalizeTimeframe(
      timeframe
    );

  const candles =
    await getKlines({
      market:
        MARKET,

      symbol,

      timeframe:
        normalized,

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

  return getServiceClosedCandles(
    candles,
    normalized,
    Date.now()
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
// SIGNAL CRT CANDLE TIME
//
// UPDATED ENGINE:
//
//   signal.crtCandleTime
//
// Compatibility:
//
//   signal.crtConfirmation.signalCandle
//   signal.crtCandle
//
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
    normalizeTimestamp(
      signal.crtCandleTime
    );

  if (
    direct !== null
  ) {
    return direct;
  }

  const nested =
    getCandleOpenTime(
      signal
        .crtConfirmation
        ?.signalCandle
    );

  if (
    nested !== null
  ) {
    return nested;
  }

  const compatibility =
    getCandleOpenTime(
      signal.crtCandle
    );

  if (
    compatibility !== null
  ) {
    return compatibility;
  }

  return null;
}

// ============================================================
// MATCH NEWEST MEXC CANDLE
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
    signalTime === null ||
    latestTime === null
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
    normalizeTimeframe(
      timeframe
    ),
    String(
      symbol
    ).trim(),
  ].join(':');
}

// ============================================================
// MARKET STRUCTURE
// ============================================================

function getMarketStructure(
  signal
) {
  const value =
    signal?.marketStructure ??
    signal?.structure ??
    signal?.market_structure ??
    'NEUTRAL';

  const normalized =
    String(
      value
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

  return 'Neutral';
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
    );

  if (
    structure ===
    'Bullish'
  ) {
    return '🟢';
  }

  if (
    structure ===
    'Bearish'
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
    );

  if (
    structure ===
    'Bullish'
  ) {
    return 0x57f287;
  }

  if (
    structure ===
    'Bearish'
  ) {
    return 0xed4245;
  }

  return 0xfee75c;
}

// ============================================================
// FRACTAL TYPE
//
// UPDATED ENGINE:
//
//   signal.fractalType
//
// Fallback:
//
//   signal.displayFractal.type
// ============================================================

function getFractalType(
  signal
) {
  const direct =
    String(
      signal?.fractalType ||
      ''
    )
      .trim()
      .toUpperCase();

  if (
    direct.includes(
      'TOP'
    )
  ) {
    return 'TOP';
  }

  if (
    direct.includes(
      'BOTTOM'
    )
  ) {
    return 'BOTTOM';
  }

  const nested =
    String(
      signal
        ?.displayFractal
        ?.type ||
      signal
        ?.fractal
        ?.type ||
      ''
    )
      .trim()
      .toUpperCase();

  if (
    nested ===
    'TOP'
  ) {
    return 'TOP';
  }

  if (
    nested ===
    'BOTTOM'
  ) {
    return 'BOTTOM';
  }

  return 'N/A';
}

// ============================================================
// LIQUIDITY
//
// UPDATED ENGINE:
//
//   signal.liquiditySweep
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
// STD DEVIATION
//
// UPDATED ENGINE exposes:
//
//   stdDeviation
//   stdDev
//   standardDeviation
// ============================================================

function getStdDeviation(
  signal
) {
  return formatNumber(
    signal?.stdDeviation ??
    signal?.stdDev ??
    signal?.standardDeviation,
    2
  );
}

// ============================================================
// RSI DISPLAY
//
// Discord shows state only.
//
// No RSI number.
//
// ============================================================

function formatRSIState(
  state
) {
  const normalized =
    String(
      state ||
      'NEUTRAL'
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
// CRT CONFIRMATION
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
// POTENTIAL CRT DISPLAY
// ============================================================

function formatPotentialCRT(
  signal
) {
  if (
    signal?.potentialCRTStatus
  ) {
    return (
      signal.potentialCRTStatus ===
      'CONFIRMED'
        ? '**CONFIRMED**'
        : 'NOT CONFIRMED'
    );
  }

  return isConfirmedSignal(
    signal
  )
    ? '**CONFIRMED**'
    : 'NOT CONFIRMED';
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

  const timeframe =
    normalizeTimeframe(
      signal.timeframe
    );

  const fractal =
    getFractalType(
      signal
    );

  const liquidity =
    getLiquiditySweep(
      signal
    );

  const stdDeviation =
    getStdDeviation(
      signal
    );

  const potentialCRT =
    formatPotentialCRT(
      signal
    );

  const rsi =
    formatRSIState(
      signal.rsiState
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
            timeframe
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
      crtTime !== null
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
              quote
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

    lastSymbolRefresh =
      Date.now();
  }
}

// ============================================================
// BOOTSTRAP ONE SYMBOL
// ============================================================

async function bootstrapSymbol(
  symbol,
  timeframe
) {
  const normalized =
    normalizeTimeframe(
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
    return;
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
      return;
    }

    const latestTime =
      getCandleOpenTime(
        latest
      );

    if (
      latestTime === null
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
      `[CRT] Bootstrap ${symbol}:${normalized} -> ${formatUTC(latestTime)}`
    );

  } catch (
    error
  ) {
    console.error(
      `[CRT] Bootstrap failed ${symbol}:${normalized}:`,
      error?.message ||
        error
    );
  }
}

// ============================================================
// BOOTSTRAP TIMEFRAME
// ============================================================

async function bootstrapTimeframe(
  timeframe
) {
  const normalized =
    normalizeTimeframe(
      timeframe
    );

  if (
    !isSupportedTimeframe(
      normalized
    )
  ) {
    return;
  }

  await refreshSymbols();

  if (
    !cachedSymbols.length
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
        cachedSymbols.length
      ) {
        return;
      }

      await bootstrapSymbol(
        cachedSymbols[
          current
        ],
        normalized
      );
    }
  }

  const workers =
    Math.min(
      SCAN_CONCURRENCY,
      cachedSymbols.length
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
// SCAN ONE SYMBOL
// ============================================================

async function scanSymbol(
  client,
  symbol,
  timeframe
) {
  const normalized =
    normalizeTimeframe(
      timeframe
    );

  const key =
    getStateKey(
      symbol,
      normalized
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
    // FETCH CLOSED MEXC CANDLES
    // ========================================================

    const closed =
      await fetchClosedCandles(
        symbol,
        normalized
      );

    if (
      closed.length <
      Math.max(
        30,
        RSI_PERIOD + 10,
        5
      )
    ) {
      return;
    }

    // ========================================================
    // LATEST CLOSED MEXC CANDLE
    // ========================================================

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
      latestClosedTime === null
    ) {
      return;
    }

    // ========================================================
    // STARTUP BASELINE SAFETY
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
        `[CRT] Startup baseline ${symbol}:${normalized} -> ${formatUTC(latestClosedTime)}`
      );

      return;
    }

    // ========================================================
    // DUPLICATE CANDLE
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
    // NEW CLOSED MEXC CANDLE
    // ========================================================

    lastProcessedCandle.set(
      key,
      latestClosedTime
    );

    console.log(
      `[CRT] NEW MEXC CLOSED CANDLE ${symbol}:${normalized}` +
      ` -> ${formatUTC(latestClosedTime)}`
    );

    // ========================================================
    // BUILD SIGNAL USING UPDATED CRT ENGINE
    // ========================================================

    const signal =
      buildSignal({
        symbol,

        market:
          'futures',

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

    // ========================================================
    // NO SIGNAL
    // ========================================================

    if (
      !signal
    ) {
      return;
    }

    // ========================================================
    // CONFIRMED CRT ONLY
    // ========================================================

    if (
      !isConfirmedSignal(
        signal
      )
    ) {
      console.log(
        `[CRT] CRT not confirmed ${symbol}:${normalized}`
      );

      return;
    }

    // ========================================================
    // CRITICAL NEW-CANDLE CHECK
    //
    // The updated engine returns:
    //
    //   signal.crtCandleTime
    //
    // It MUST equal:
    //
    //   latestClosed.openTime
    //
    // Otherwise the engine found an older CRT.
    //
    // ========================================================

    if (
      !signalMatchesLatestClosedCandle(
        signal,
        latestClosed
      )
    ) {
      console.log(
        `[CRT] OLD CRT IGNORED ${symbol}:${normalized}` +
        ` | Latest=${formatUTC(latestClosedTime)}` +
        ` | SignalCRT=${formatUTC(
          getSignalCRTCandleTime(
            signal
          )
        )}`
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
        `[CRT] Signal rejected: missing signal.id ${symbol}:${normalized}`
      );

      return;
    }

    // ========================================================
    // DUPLICATE SIGNAL PROTECTION
    // ========================================================

    if (
      !isNewSignal(
        signal.id
      )
    ) {
      console.log(
        `[CRT] Duplicate signal ignored ${signal.id}`
      );

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
    // FINAL LOG
    // ========================================================

    console.log(
      `[CRT] RACHEL T CRT CONFIRMED` +
      ` | ${symbol}` +
      ` | ${normalized}` +
      ` | CRT=${formatUTC(
        getSignalCRTCandleTime(
          signal
        )
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
      ` | RSI=${signal.rsiState || 'Neutral'}`
    );

  } catch (
    error
  ) {
    console.error(
      `[CRT] Scan failed ${symbol}:${normalized}:`,
      error?.message ||
        error
    );
  }
}

// ============================================================
// CONCURRENT SYMBOL SCAN
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
    !isSupportedTimeframe(
      normalized
    )
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
// NEXT MEXC BOUNDARY
//
// IMPORTANT:
//
// Uses the authoritative MEXC helper:
//
//   getNextCurrentCandleBoundary()
//
// No Manila offset.
//
// No manually calculated daily offset.
//
// ============================================================

function getNextScanTime(
  timeframe,
  now = Date.now()
) {
  const normalized =
    normalizeTimeframe(
      timeframe
    );

  const boundary =
    getNextCurrentCandleBoundary(
      normalized,
      now
    );

  if (
    !Number.isFinite(
      boundary
    )
  ) {
    return null;
  }

  return (
    boundary +
    BOUNDARY_DELAY_MS
  );
}

// ============================================================
// SCHEDULE ONE TIMEFRAME
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
    !isSupportedTimeframe(
      normalized
    )
  ) {
    console.warn(
      `[CRT] Cannot schedule unsupported timeframe: ${timeframe}`
    );

    return;
  }

  // ----------------------------------------------------------
  // Clear existing timer
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
    `[CRT] ${normalized} next MEXC boundary scan: ${formatUTC(
      nextScan
    )}`
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
// INITIAL STARTUP BASELINE
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

  // ----------------------------------------------------------
  // CONFIGURATION DISABLE
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
    '[CRT] ACTIVE CANDLE: NEVER USED FOR CRT CONFIRMATION'
  );

  console.log(
    '[CRT] CRT CANDLE: MUST MATCH NEWEST CLOSED MEXC CANDLE'
  );

  console.log(
    '[CRT] FRACTAL DISPLAY: BEARISH=TOP | BULLISH=BOTTOM'
  );

  console.log(
    '[CRT] DISCORD FIELD: Potential CRT'
  );

  console.log(
    '[CRT] FRACTAL PRICE: DISABLED'
  );

  console.log(
    '============================================================'
  );

  // ----------------------------------------------------------
  // START ASYNC INITIALIZATION
  // ----------------------------------------------------------

  void (
    async () => {

      try {

        await initializeBaseline();

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
        // Schedule anyway so service can recover.
        // ----------------------------------------------------

        scheduleAllTimeframes(
          client
        );
      }

    }
  )();
}

// ============================================================
// MANUAL CRT SCAN
// ============================================================
//
// Manual scanning still respects:
//
//   • closed candle
//   • new candle
//   • CRT candle timestamp
//   • signal ID
//
// It does NOT intentionally replay historical CRT signals.
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
  '[CRT] CRT confirmation must match newly closed candle'
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

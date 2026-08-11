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
// ============================================================
//
// IMPORTANT ARCHITECTURE:
//
//   crtService.js
//       |
//       +--> MEXC Futures candles
//       |
//       +--> determine ACTUAL candle close locally
//       |
//       +--> remove currently-forming candle
//       |
//       +--> crtEngine.js
//               |
//               +--> Rachel T Fractal
//               +--> Fractal Confirmation
//               +--> CRT Confirmation
//               +--> Market Structure
//               +--> STD Deviation
//               +--> Liquidity Sweep
//               +--> RSI
//
// NO TRADINGVIEW API
//
// MEXC is the ONLY market data source.
//
// ============================================================
//
// IMPORTANT TIMEFRAME RULE:
//
// The service does NOT guess candle closure.
//
// For every MEXC candle:
//
//     candleCloseTime = candleOpenTime + timeframeDuration
//
// The candle is considered CLOSED only when:
//
//     currentTime >= candleCloseTime
//
// Therefore:
//
//     15m candle -> evaluated after its 15m close
//     1h candle  -> evaluated after its 1h close
//     4h candle  -> evaluated after its 4h close
//     1d candle  -> evaluated after its daily close
//
// ============================================================
//
// IMPORTANT FRACTAL RULE:
//
// Rachel T uses:
//
//     Pivot = [2]
//
// and requires two candles after the pivot.
//
// Example:
//
//     Candle A
//     Candle B
//     PIVOT
//     Confirm Candle 1
//     Confirm Candle 2
//
// Only after the required candles are CLOSED can the fractal
// become confirmed.
//
// ============================================================
//
// IMPORTANT:
//
// The service NEVER creates a CRT signal by itself.
//
// buildSignal() from crtEngine.js is the authority.
//
// If buildSignal() returns null:
//
//     NO CONFIRMED CRT
//
// Nothing is sent to Discord.
//
// ============================================================

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
// CONFIGURATION
// ============================================================

const CRT_CONFIG =
  botConfig.crt || {};

// ============================================================
// TIMEFRAMES
// ============================================================
//
// These are the ONLY timeframes scanned by this service unless
// explicitly configured in bot.js.
//
// ============================================================

const TIMEFRAMES =
  CRT_CONFIG.timeframes || {
    '15m': 15,
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
// MARKET TYPE
// ============================================================
//
// HARD LOCK:
//
//     MEXC FUTURES ONLY
//
// There is intentionally NO spot market.
//
// ============================================================

const MARKET_TYPE =
  'futures';

const MARKET_TYPES = [
  'futures',
];

// ============================================================
// SCAN INTERVAL
// ============================================================
//
// The monitor may wake up every 15 seconds.
//
// This DOES NOT mean it generates a signal every 15 seconds.
//
// The candle-close gate below decides whether a new candle has
// actually closed.
//
// ============================================================

const SCAN_INTERVAL =
  Math.max(
    15000,
    Number(
      CRT_CONFIG.scanInterval ||
        30000
    )
  );

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
// CANDLE PROCESSING STATE
// ============================================================
//
// This is extremely important.
//
// Key:
//
//     futures:BTC_USDT:15m
//
// Value:
//
//     timestamp of the last CLOSED candle that was processed
//
// This prevents the same closed candle from being evaluated
// over and over again during the scan interval.
//
// ============================================================

const lastProcessedCandle =
  new Map();

// ============================================================
// SIGNAL PROCESSING STATE
// ============================================================
//
// This additional state protects against repeated processing
// when the exchange returns identical candle data.
//
// ============================================================

const lastConfirmedCandle =
  new Map();

// ============================================================
// TIMEFRAME PRIORITY
// ============================================================
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
// GET TIMEFRAME MINUTES
// ============================================================

function getTimeframeMinutes(
  timeframe
) {
  const configured =
    Number(
      TIMEFRAMES[
        timeframe
      ]
    );

  if (
    Number.isFinite(
      configured
    ) &&
    configured > 0
  ) {
    return configured;
  }

  const match =
    String(
      timeframe || ''
    )
      .trim()
      .toLowerCase()
      .match(
        /^(\d+)(m|h|d)$/
      );

  if (!match) {
    return null;
  }

  const value =
    Number(
      match[1]
    );

  const unit =
    match[2];

  if (
    !Number.isFinite(
      value
    )
  ) {
    return null;
  }

  if (
    unit === 'm'
  ) {
    return value;
  }

  if (
    unit === 'h'
  ) {
    return value * 60;
  }

  if (
    unit === 'd'
  ) {
    return value * 1440;
  }

  return null;
}

// ============================================================
// GET TIMEFRAME MILLISECONDS
// ============================================================

function getTimeframeMs(
  timeframe
) {
  const minutes =
    getTimeframeMinutes(
      timeframe
    );

  if (
    !minutes
  ) {
    return null;
  }

  return (
    minutes *
    60 *
    1000
  );
}

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
    }[
      timeframe
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
  const numeric =
    Number(
      value
    );

  if (
    !Number.isFinite(
      numeric
    )
  ) {
    return 'N/A';
  }

  return numeric.toFixed(
    decimals
  );
}

// ============================================================
// NORMALIZE TIMESTAMP
// ============================================================
//
// MEXC normally provides milliseconds.
//
// This also supports seconds in case mexcService.js returns
// timestamps in seconds.
//
// ============================================================

function normalizeTimestamp(
  value
) {
  const numeric =
    Number(
      value
    );

  if (
    !Number.isFinite(
      numeric
    ) ||
    numeric <= 0
  ) {
    return null;
  }

  if (
    numeric < 100000000000
  ) {
    return (
      numeric * 1000
    );
  }

  return numeric;
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

  const candidates = [
    candle.openTime,
    candle.open_time,
    candle.timestamp,
    candle.time,
    candle.ts,
    candle.startTime,
    candle.start_time,
  ];

  for (
    const value of
    candidates
  ) {
    const timestamp =
      normalizeTimestamp(
        value
      );

    if (
      timestamp !== null
    ) {
      return timestamp;
    }
  }

  return null;
}

// ============================================================
// GET CANDLE CLOSE TIME
// ============================================================
//
// The exchange candle timestamp represents the beginning of
// the candle.
//
// Therefore:
//
//     close = open + timeframe
//
// ============================================================

function getCandleCloseTime(
  candle,
  timeframe
) {
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
    timeframeMs === null
  ) {
    return null;
  }

  return (
    openTime +
    timeframeMs
  );
}

// ============================================================
// IS CANDLE CLOSED
// ============================================================
//
// This is the primary candle-close protection.
//
// We do NOT rely only on:
//
//     candle.closed
//
// because MEXC data may not always expose that property.
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
    closeTime === null
  ) {
    return false;
  }

  return (
    now >=
    closeTime
  );
}

// ============================================================
// GET CLOSED CANDLES
// ============================================================
//
// This function removes the currently forming candle based on
// the ACTUAL MEXC candle timestamp.
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

  return candles
    .filter(
      (candle) => {
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

        return isCandleClosed(
          candle,
          timeframe,
          now
        );
      }
    )
    .sort(
      (a, b) => {
        const timeA =
          getCandleOpenTime(
            a
          ) || 0;

        const timeB =
          getCandleOpenTime(
            b
          ) || 0;

        return (
          timeA -
          timeB
        );
      }
    );
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
    ] ||
    null
  );
}

// ============================================================
// GET CLOSED CANDLE KEY
// ============================================================
//
// Used for preventing repeated evaluation.
//
// ============================================================

function buildCandleKey(
  market,
  symbol,
  timeframe,
  candle
) {
  const openTime =
    getCandleOpenTime(
      candle
    );

  if (
    openTime === null
  ) {
    return null;
  }

  return [
    market,
    symbol,
    timeframe,
    openTime,
  ].join(':');
}

// ============================================================
// RSI DISPLAY
// ============================================================
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
// FRACTAL TYPE
// ============================================================

function getFractalType(
  signal
) {
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
    ) ||
    normalized.includes(
      'HIGH'
    )
  ) {
    return 'TOP';
  }

  if (
    normalized.includes(
      'BOTTOM'
    ) ||
    normalized.includes(
      'LOW'
    )
  ) {
    return 'BOTTOM';
  }

  return 'N/A';
}

// ============================================================
// LIQUIDITY SWEEP
// ============================================================
//
// The service does NOT calculate liquidity.
//
// crtEngine.js is the authority.
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
    sweep.swept === true
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
        '**PREVIOUS FRACTAL HIGH SWEPT**'
      );
    }

    if (
      type ===
      'LOW'
    ) {
      return (
        '**PREVIOUS FRACTAL LOW SWEPT**'
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
//
// A signal must be explicitly confirmed.
//
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
    signal.confirmed !==
    true
  ) {
    return false;
  }

  if (
    signal.confirmedCRT !==
    true
  ) {
    return false;
  }

  if (
    signal.crtConfirmed !==
    true
  ) {
    return false;
  }

  return true;
}

// ============================================================
// CONFIRMATION DISPLAY
// ============================================================

function formatConfirmation(
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
//
// IMPORTANT:
//
// NO FRACTAL PRICE.
//
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

  const confirmation =
    formatConfirmation(
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
          'CONFIRM CRT Candle',

        value:
          confirmation,

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
    // Prefer the actual CRT candle close/confirmation time.
    // ========================================================

    .setTimestamp(
      new Date(
        getCandleOpenTime(
          signal.crtCandle
        ) ??
          getCandleOpenTime(
            signal.confirmationCandle
          ) ??
          signal.candleTime ??
          Date.now()
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
// ============================================================
//
// HARD LOCK:
//
//     FUTURES ONLY
//
// ============================================================

function filterSymbols(
  symbols,
  market
) {
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
      )
      .filter(
        Boolean
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
            quote
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
//
// NO SPOT API.
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

    const futuresSymbols =
      filterSymbols(
        contracts,
        'futures'
      );

    cachedSymbols.set(
      'futures',
      futuresSymbols
    );

    console.log(
      `[CRT] MEXC Futures symbols loaded: ${futuresSymbols.length}`
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
// SHOULD PROCESS CLOSED CANDLE
// ============================================================
//
// This is the major anti-duplicate / timing gate.
//
// A symbol/timeframe is evaluated only when a NEW closed candle
// appears.
//
// ============================================================

function shouldProcessClosedCandle(
  market,
  symbol,
  timeframe,
  candle
) {
  const key =
    buildCandleKey(
      market,
      symbol,
      timeframe,
      candle
    );

  if (
    !key
  ) {
    return false;
  }

  const openTime =
    getCandleOpenTime(
      candle
    );

  const previous =
    lastProcessedCandle.get(
      key
    );

  if (
    previous ===
    openTime
  ) {
    return false;
  }

  lastProcessedCandle.set(
    key,
    openTime
  );

  return true;
}

// ============================================================
// GET SIGNAL STATE KEY
// ============================================================

function buildSignalStateKey(
  market,
  symbol,
  timeframe
) {
  return [
    market,
    symbol,
    timeframe,
  ].join(':');
}

// ============================================================
// CHECK WHETHER CONFIRMED CANDLE WAS ALREADY SENT
// ============================================================

function wasConfirmedCandleAlreadyHandled(
  market,
  symbol,
  timeframe,
  candle
) {
  const stateKey =
    buildSignalStateKey(
      market,
      symbol,
      timeframe
    );

  const candleTime =
    getCandleOpenTime(
      candle
    );

  if (
    candleTime ===
    null
  ) {
    return true;
  }

  return (
    lastConfirmedCandle.get(
      stateKey
    ) ===
    candleTime
  );
}

// ============================================================
// MARK CONFIRMED CANDLE
// ============================================================

function markConfirmedCandle(
  market,
  symbol,
  timeframe,
  candle
) {
  const stateKey =
    buildSignalStateKey(
      market,
      symbol,
      timeframe
    );

  const candleTime =
    getCandleOpenTime(
      candle
    );

  if (
    candleTime ===
    null
  ) {
    return;
  }

  lastConfirmedCandle.set(
    stateKey,
    candleTime
  );
}

// ============================================================
// SCAN SYMBOL
// ============================================================
//
// IMPORTANT:
//
// 1. Get MEXC Futures candles.
// 2. Determine candle closure locally.
// 3. Ignore active candle.
// 4. Process ONLY a newly closed candle.
// 5. Pass closed history to crtEngine.
// 6. Engine decides whether CRT is confirmed.
// 7. Send only confirmed CRT.
//
// ============================================================

async function scanSymbol(
  client,
  market,
  symbol,
  timeframe
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

    const closed =
      getClosedCandles(
        candles,
        timeframe,
        now
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
    // LATEST CLOSED CANDLE
    // ========================================================

    const latestClosed =
      closed[
        closed.length - 1
      ];

    if (
      !latestClosed
    ) {
      return;
    }

    // ========================================================
    // SAFETY:
    //
    // The latest candle MUST actually be closed.
    // ========================================================

    if (
      !isCandleClosed(
        latestClosed,
        timeframe,
        now
      )
    ) {
      return;
    }

    // ========================================================
    // NEW CLOSED CANDLE GATE
    //
    // If this exact candle has already been processed,
    // STOP.
    //
    // This prevents a daily candle from being scanned every
    // 30 seconds and producing repeated processing.
    // ========================================================

    if (
      !shouldProcessClosedCandle(
        market,
        symbol,
        timeframe,
        latestClosed
      )
    ) {
      return;
    }

    // ========================================================
    // BUILD RACHEL T CRT SIGNAL
    //
    // crtEngine.js is the authority.
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
    // NO CONFIRMED CRT
    //
    // The candle was processed, but there is no confirmed
    // Rachel T CRT.
    //
    // DO NOT SEND ANYTHING.
    // ========================================================

    if (
      !signal
    ) {
      console.log(
        `[CRT] No confirmed CRT ${market}:${symbol}:${timeframe} | closed=${new Date(
          getCandleOpenTime(
            latestClosed
          ) || now
        ).toISOString()}`
      );

      return;
    }

    // ========================================================
    // ENGINE CONFIRMATION SAFETY
    // ========================================================

    if (
      !isConfirmedSignal(
        signal
      )
    ) {
      console.warn(
        `[CRT] Engine returned an unconfirmed signal ${market}:${symbol}:${timeframe}`
      );

      return;
    }

    // ========================================================
    // GET ACTUAL CRT CANDLE
    // ========================================================

    const crtCandle =
      signal.crtCandle ??
      signal.crtConfirmation
        ?.signalCandle ??
      signal.confirmationCandle ??
      null;

    // ========================================================
    // SAFETY:
    //
    // The CRT candle must itself be CLOSED.
    //
    // ========================================================

    if (
      crtCandle
    ) {
      if (
        !isCandleClosed(
          crtCandle,
          timeframe,
          now
        )
      ) {
        console.warn(
          `[CRT] Rejected because CRT confirmation candle is not closed: ${market}:${symbol}:${timeframe}`
        );

        return;
      }
    }

    // ========================================================
    // PREVENT SAME CONFIRMED CANDLE FROM BEING SENT AGAIN
    // ========================================================

    if (
      crtCandle &&
      wasConfirmedCandleAlreadyHandled(
        market,
        symbol,
        timeframe,
        crtCandle
      )
    ) {
      return;
    }

    // ========================================================
    // SIGNAL ID SAFETY
    // ========================================================

    if (
      !signal.id
    ) {
      console.warn(
        `[CRT] Signal rejected because no signal.id was returned: ${market}:${symbol}:${timeframe}`
      );

      return;
    }

    // ========================================================
    // GLOBAL SIGNAL MANAGER
    // ========================================================
//
// This is the second duplicate protection.
//
// Even if the service restarts its local candle state,
// signalManager.js can still reject an already-known signal
// depending on its implementation.
//

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
    // MARK CONFIRMED CANDLE
    // ========================================================

    if (
      crtCandle
    ) {
      markConfirmedCandle(
        market,
        symbol,
        timeframe,
        crtCandle
      );
    }

    // ========================================================
    // LOG
    // ========================================================

    console.log(
      `[CRT] RACHEL T CONFIRMED ${market}:${symbol}:${timeframe}` +
        ` | Closed=${new Date(
          getCandleOpenTime(
            latestClosed
          ) || now
        ).toISOString()}` +
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
        ` | RSI=${
          signal.rsiState ||
          'Neutral'
        }`
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
// SORT TIMEFRAMES BY PRIORITY
// ============================================================

function getOrderedTimeframes() {
  const configured =
    Object.keys(
      TIMEFRAMES
    );

  return configured.sort(
    (a, b) => {
      const indexA =
        TIMEFRAME_PRIORITY.indexOf(
          a
        );

      const indexB =
        TIMEFRAME_PRIORITY.indexOf(
          b
        );

      const safeA =
        indexA === -1
          ? 999
          : indexA;

      const safeB =
        indexB === -1
          ? 999
          : indexB;

      return (
        safeA -
        safeB
      );
    }
  );
}

// ============================================================
// SCAN ALL
// ============================================================
//
// Sequential scanning is intentional.
//
// Priority:
//
//   5m
//   15m
//   30m
//   1h
//   4h
//   1d
//
// Only configured timeframes are actually scanned.
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
    // LOAD MEXC FUTURES SYMBOLS
    // ========================================================

    await refreshSymbols();

    // ========================================================
    // TIMEFRAME PRIORITY
    // ========================================================

    const timeframes =
      getOrderedTimeframes();

    // ========================================================
    // SCAN TIMEFRAMES
    // ========================================================

    for (
      const timeframe of
      timeframes
    ) {
      const market =
        'futures';

      const symbols =
        cachedSymbols.get(
          'futures'
        ) || [];

      // ======================================================
      // SCAN EVERY FUTURES SYMBOL
      // ======================================================

      for (
        const symbol of
        symbols
      ) {
        await scanSymbol(
          client,
          market,
          symbol,
          timeframe
        );
      }
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
    '[CRT] =================================================='
  );

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
    '[CRT] TRADINGVIEW API: NOT USED'
  );

  console.log(
    '[CRT] PRIMARY SIGNAL: Rachel T Fractal + CRT Confirmation'
  );

  console.log(
    `[CRT] Timeframes: ${getOrderedTimeframes().join(
      ', '
    )}`
  );

  console.log(
    `[CRT] Scan interval: ${SCAN_INTERVAL}ms`
  );

  console.log(
    `[CRT] Max symbols: ${MAX_SYMBOLS}`
  );

  console.log(
    `[CRT] Kline history: ${KLINE_LIMIT}`
  );

  console.log(
    `[CRT] Auto symbols: ${AUTO_SYMBOLS}`
  );

  console.log(
    '[CRT] Candle confirmation: MEXC timestamp based'
  );

  console.log(
    '[CRT] Currently-forming candles: REJECTED'
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
  await scanAll(
    client
  );
}

// ============================================================
// GET CRT CONFIG
// ============================================================

export function getCRTConfig() {
  return {
    // --------------------------------------------------------
    // HARD LOCKED MARKET
    // --------------------------------------------------------

    markets: [
      'futures',
    ],

    // --------------------------------------------------------
    // TIMEFRAMES
    // --------------------------------------------------------

    timeframes:
      getOrderedTimeframes(),

    // --------------------------------------------------------
    // SCAN
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
    // SIGNAL
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

    tradingViewApi:
      false,

    // --------------------------------------------------------
    // CANDLE TIMING
    // --------------------------------------------------------

    candleTiming:
      'MEXC_TIMESTAMP_BASED',

    activeCandleRejected:
      true,

    processOnlyNewClosedCandle:
      true,

    // --------------------------------------------------------
    // FRACTAL
    // --------------------------------------------------------

    fractalConfirmation:
      'TWO_CLOSED_CANDLES_AFTER_PIVOT',

    // --------------------------------------------------------
    // LIQUIDITY
    // --------------------------------------------------------

    liquiditySource:
      'CONFIRMED_RACHEL_T_FRACTALS_ONLY',

    liquidityUsesCurrentWick:
      false,

    liquidityUsesPreviousCandleWick:
      false,

    liquidityUsesCRTCandle:
      false,
  };
}

// ============================================================
// SERVICE LOADED
// ============================================================

console.log(
  `[CRT] Service loaded • Rachel T Fractal PRIMARY • MEXC FUTURES ONLY • ${getOrderedTimeframes().join(
    ', '
  )}`
);

console.log(
  '[CRT] TradingView API: DISABLED'
);

console.log(
  '[CRT] Candle timing: MEXC timestamp based'
);

console.log(
  '[CRT] Active candle: REJECTED'
);

console.log(
  '[CRT] CRT confirmation: crtEngine.js ONLY'
);

console.log(
  '[CRT] Liquidity: confirmed fractal history ONLY'
);

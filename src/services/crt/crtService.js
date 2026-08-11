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
//   crtEngine.js is the authority for:
//
//     • Rachel T fractals
//     • CRT logic
//     • Market structure
//     • Standard deviation
//     • Liquidity sweep
//     • RSI
//
//   crtService.js is responsible for:
//
//     1. Loading MEXC Futures symbols
//     2. Loading MEXC Futures candles
//     3. Removing the still-forming candle
//     4. Passing CLOSED candles to crtEngine.js
//     5. Receiving the engine result
//     6. Selecting the structure-aligned confirmed fractal
//     7. Preventing duplicate alerts
//     8. Sending the Discord alert
//
// HARD RULE:
//
//   SPOT IS COMPLETELY DISABLED.
//
//   ONLY:
//
//     MEXC FUTURES
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
//
// Explicit priority:
//
//   5m
//   15m
//   30m
//   1h
//   4h
//   1d
//
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
// MARKET TYPES
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
// SCAN INTERVAL
//
// Minimum 15 seconds.
//
// ============================================================

const SCAN_INTERVAL =
  Math.max(
    15000,
    Number(
      CRT_CONFIG.scanInterval || 30000
    )
  );


// ============================================================
// KLINE LIMIT
//
// Enough history for:
//
//   • Rachel T fractals
//   • Market structure
//   • Standard deviation
//   • RSI
//
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
// SYMBOL MODE
// ============================================================

const AUTO_SYMBOLS =
  CRT_CONFIG.autoSymbols !== false;


// ============================================================
// STATE
// ============================================================

let monitorStarted = false;

let scanRunning = false;

let cachedSymbols =
  new Map();

let lastSymbolRefresh = 0;


// ============================================================
// TIMEFRAME LABEL
// ============================================================

function timeframeLabel(
  timeframe
) {
  return (
    {
      '5m': '5 MINUTES',
      '15m': '15 MINUTES',
      '30m': '30 MINUTES',
      '1h': '1 HOUR',
      '4h': '4 HOURS',
      '1d': 'DAILY',
    }[timeframe] ||
    String(timeframe)
  );
}


// ============================================================
// TIMEFRAME MINUTES
// ============================================================

function timeframeMinutes(
  timeframe
) {
  const configured =
    Number(
      TIMEFRAMES[timeframe]
    );

  if (
    Number.isFinite(configured) &&
    configured > 0
  ) {
    return configured;
  }

  const fallback = {
    '5m': 5,
    '15m': 15,
    '30m': 30,
    '1h': 60,
    '4h': 240,
    '1d': 1440,
  };

  return (
    fallback[timeframe] || 15
  );
}


// ============================================================
// TIMEFRAME MILLISECONDS
// ============================================================

function timeframeMilliseconds(
  timeframe
) {
  return (
    timeframeMinutes(timeframe) *
    60 *
    1000
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
    !Number.isFinite(number)
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
      state || 'Neutral'
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
// Accept multiple property names:
//
//   marketStructure
//   structure
//   market_structure
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
    String(raw)
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
// STANDARD DEVIATION
//
// Accept:
//
//   stdDeviation
//   stdDev
//   standardDeviation
//
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
// CONFIRMED FRACTAL HISTORY
//
// crtEngine.js may return:
//
//   confirmedFractals
//
// Expected format:
//
//   [
//     {
//       type: 'TOP',
//       index: ...,
//       time: ...,
//       price: ...
//     },
//     {
//       type: 'BOTTOM',
//       index: ...,
//       time: ...,
//       price: ...
//     }
//   ]
//
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
// NORMALIZE FRACTAL TYPE
// ============================================================

function normalizeFractalType(
  fractal
) {
  const raw =
    fractal?.type ??
    fractal?.fractalType ??
    fractal?.kind ??
    '';

  const normalized =
    String(raw)
      .trim()
      .toUpperCase();

  if (
    normalized.includes('TOP') ||
    normalized.includes('HIGH')
  ) {
    return 'TOP';
  }

  if (
    normalized.includes('BOTTOM') ||
    normalized.includes('LOW')
  ) {
    return 'BOTTOM';
  }

  return 'N/A';
}


// ============================================================
// GET FRACTAL TIME
//
// Used when determining which confirmed fractal is newest.
//
// ============================================================

function getFractalTime(
  fractal
) {
  const candidates = [
    fractal?.time,
    fractal?.timestamp,
    fractal?.candleTime,
    fractal?.confirmedAt,
  ];

  for (
    const value of candidates
  ) {
    const number =
      Number(value);

    if (
      Number.isFinite(number)
    ) {
      return number;
    }

    if (
      typeof value === 'string' &&
      value.trim()
    ) {
      const parsed =
        Date.parse(value);

      if (
        Number.isFinite(parsed)
      ) {
        return parsed;
      }
    }
  }

  if (
    Number.isFinite(
      Number(fractal?.index)
    )
  ) {
    return Number(
      fractal.index
    );
  }

  return -Infinity;
}


// ============================================================
// GET LATEST CONFIRMED FRACTAL
// ============================================================
//
// IMPORTANT:
//
// Do not blindly assume the last array item is the newest.
//
// We compare its timestamp/index when available.
//
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

  let latest =
    fractals[0];

  let latestTime =
    getFractalTime(
      latest
    );

  for (
    let i = 1;
    i < fractals.length;
    i++
  ) {
    const current =
      fractals[i];

    const currentTime =
      getFractalTime(
        current
      );

    if (
      currentTime >= latestTime
    ) {
      latest =
        current;

      latestTime =
        currentTime;
    }
  }

  return latest;
}


// ============================================================
// GET LATEST CONFIRMED TOP
//
// BEARISH STRUCTURE:
//
//   Display latest confirmed TOP.
//
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

  let latestTop =
    null;

  let latestTime =
    -Infinity;

  for (
    const fractal of
    fractals
  ) {
    if (
      normalizeFractalType(
        fractal
      ) !== 'TOP'
    ) {
      continue;
    }

    const fractalTime =
      getFractalTime(
        fractal
      );

    if (
      fractalTime >= latestTime
    ) {
      latestTop =
        fractal;

      latestTime =
        fractalTime;
    }
  }

  return latestTop;
}


// ============================================================
// GET LATEST CONFIRMED BOTTOM
//
// BULLISH STRUCTURE:
//
//   Display latest confirmed BOTTOM.
//
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

  let latestBottom =
    null;

  let latestTime =
    -Infinity;

  for (
    const fractal of
    fractals
  ) {
    if (
      normalizeFractalType(
        fractal
      ) !== 'BOTTOM'
    ) {
      continue;
    }

    const fractalTime =
      getFractalTime(
        fractal
      );

    if (
      fractalTime >= latestTime
    ) {
      latestBottom =
        fractal;

      latestTime =
        fractalTime;
    }
  }

  return latestBottom;
}


// ============================================================
// GET STRUCTURE-ALIGNED FRACTAL
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
// IMPORTANT:
//
// This function ONLY selects an already-confirmed fractal.
//
// It NEVER creates one.
//
// ============================================================

function getStructureAlignedFractal(
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
    return getLatestConfirmedTop(
      signal
    );
  }

  if (
    structure ===
    'BULLISH'
  ) {
    return getLatestConfirmedBottom(
      signal
    );
  }

  return getLatestConfirmedFractal(
    signal
  );
}


// ============================================================
// FRACTAL DISPLAY
//
// ============================================================

function getFractalType(
  signal
) {
  const aligned =
    getStructureAlignedFractal(
      signal
    );

  if (
    aligned
  ) {
    const type =
      normalizeFractalType(
        aligned
      );

    if (
      type !== 'N/A'
    ) {
      return type;
    }
  }

  // ----------------------------------------------------------
  // Fallback to engine's direct fractal value.
  // ----------------------------------------------------------

  const raw =
    signal?.fractalType ??
    signal?.fractal?.type ??
    signal?.type ??
    '';

  const normalized =
    String(raw)
      .trim()
      .toUpperCase();

  if (
    normalized.includes('TOP') ||
    normalized.includes('HIGH')
  ) {
    return 'TOP';
  }

  if (
    normalized.includes('BOTTOM') ||
    normalized.includes('LOW')
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
// crtService.js does NOT calculate a second sweep.
//
// ============================================================

function getLiquiditySweep(
  signal
) {
  const sweep =
    signal?.liquiditySweep;

  if (
    !sweep ||
    typeof sweep !== 'object'
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
        sweep.type || ''
      ).toUpperCase();

    if (
      type === 'HIGH'
    ) {
      return '**PREVIOUS HIGH SWEPT**';
    }

    if (
      type === 'LOW'
    ) {
      return '**PREVIOUS LOW SWEPT**';
    }

    return '**LIQUIDITY SWEPT**';
  }

  return 'None';
}


// ============================================================
// CRT CONFIRMATION
//
// The engine is responsible for determining whether the
// Rachel T CRT condition is confirmed.
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
    signal.confirmed === false
  ) {
    return false;
  }

  if (
    signal.confirmedCRT === false
  ) {
    return false;
  }

  if (
    signal.crtConfirmed === false
  ) {
    return false;
  }

  return true;
}


// ============================================================
// POTENTIAL CRT DISPLAY
//
// Discord field:
//
//   Potential CRT
//
// IMPORTANT:
//
// This is a display label only.
//
// The service still requires the engine's signal to be
// confirmed before an alert is sent.
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
//
// BULLISH = GREEN
// BEARISH = RED
// UNKNOWN = YELLOW
//
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
//
// Examples:
//
//   BTC_USDT -> BTC
//   BTC-USDT -> BTC
//   BTCUSDT  -> BTC
//   BTC_USD  -> BTC
//   BTCUSD   -> BTC
//
// ============================================================

function formatCoin(
  symbol
) {
  let value =
    String(
      symbol || 'UNKNOWN'
    )
      .trim()
      .toUpperCase();

  value =
    value.replace(
      /[-_]USDT$/i,
      ''
    );

  value =
    value.replace(
      /USDT$/i,
      ''
    );

  value =
    value.replace(
      /[-_]USD$/i,
      ''
    );

  value =
    value.replace(
      /USD$/i,
      ''
    );

  value =
    value.replace(
      /[-_]$/g,
      ''
    );

  return value;
}


// ============================================================
// CREATE CRT EMBED
//
// OUTPUT:
//
//   Source
//   Timeframe
//   Market Structure
//   STD Deviation
//   Fractal
//   Liquidity
//   Potential CRT
//   RSI
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

  const potentialCRT =
    formatPotentialCRT(
      signal
    );

  return new EmbedBuilder()

    // ======================================================
    // TITLE
    // ======================================================

    .setTitle(
      `${emoji} ${coin}`
    )

    // ======================================================
    // DESCRIPTION
    // ======================================================

    .setDescription(
      '**OnePERCENT CRT Signal**'
    )

    // ======================================================
    // INFORMATION
    // ======================================================

    .addFields(

      // ----------------------------------------------------
      // SOURCE
      // ----------------------------------------------------

      {
        name:
          'Source',

        value:
          '**MEXC Futures**',

        inline:
          false,
      },

      // ----------------------------------------------------
      // TIMEFRAME
      // ----------------------------------------------------

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

      // ----------------------------------------------------
      // MARKET STRUCTURE
      // ----------------------------------------------------

      {
        name:
          'Market Structure',

        value:
          structure,

        inline:
          true,
      },

      // ----------------------------------------------------
      // STD DEVIATION
      // ----------------------------------------------------

      {
        name:
          'STD Deviation',

        value:
          stdDeviation,

        inline:
          true,
      },

      // ----------------------------------------------------
      // FRACTAL
      //
      // BEARISH -> TOP
      // BULLISH -> BOTTOM
      //
      // ----------------------------------------------------

      {
        name:
          'Fractal',

        value:
          fractalType,

        inline:
          true,
      },

      // ----------------------------------------------------
      // LIQUIDITY
      // ----------------------------------------------------

      {
        name:
          'Liquidity',

        value:
          liquidity,

        inline:
          true,
      },

      // ----------------------------------------------------
      // POTENTIAL CRT
      //
      // Replaces:
      //
      //   CONFIRM CRT Candle
      //
      // ----------------------------------------------------

      {
        name:
          'Potential CRT',

        value:
          potentialCRT,

        inline:
          true,
      },

      // ----------------------------------------------------
      // RSI
      // ----------------------------------------------------

      {
        name:
          'RSI',

        value:
          rsi,

        inline:
          true,
      }
    )

    // ======================================================
    // COLOR
    // ======================================================

    .setColor(
      signalColor(
        signal
      )
    )

    // ======================================================
    // FOOTER
    // ======================================================

    .setFooter({
      text:
        'PDYN • Rachel T CRT • MEXC Futures',
    })

    // ======================================================
    // CANDLE TIME
    // ======================================================

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

  // ----------------------------------------------------------
  // CONFIGURED SYMBOLS
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // VALIDATE SOURCE
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // FILTER USDT FUTURES
  // ----------------------------------------------------------

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
// ONLY MEXC FUTURES CONTRACTS.
//
// There is intentionally NO Spot API.
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
    // --------------------------------------------------------
    // MEXC FUTURES ONLY
    // --------------------------------------------------------

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
// PARSE CANDLE TIMESTAMP
// ============================================================

function getCandleTimestamp(
  candle
) {
  const candidates = [
    candle?.timestamp,
    candle?.time,
    candle?.openTime,
    candle?.open_time,
    candle?.startTime,
    candle?.start_time,
    candle?.ts,
  ];

  for (
    const candidate of
    candidates
  ) {
    const value =
      Number(candidate);

    if (
      !Number.isFinite(
        value
      )
    ) {
      continue;
    }

    // --------------------------------------------------------
    // Convert seconds to milliseconds.
    // --------------------------------------------------------

    if (
      value > 0 &&
      value < 100000000000
    ) {
      return value * 1000;
    }

    return value;
  }

  return null;
}


// ============================================================
// IS CANDLE FORMING
//
// This is an important accuracy safeguard.
//
// If MEXC/getKlines explicitly provides:
//
//   closed: false
//
// it is rejected.
//
// If there is no closed flag, we calculate the expected candle
// close from its opening timestamp and timeframe.
//
// ============================================================

function isCandleForming(
  candle,
  timeframe,
  now = Date.now()
) {
  // ----------------------------------------------------------
  // Explicit closed flag
  // ----------------------------------------------------------

  if (
    candle?.closed === false
  ) {
    return true;
  }

  if (
    candle?.isClosed === false
  ) {
    return true;
  }

  // ----------------------------------------------------------
  // Explicit true closed flag
  // ----------------------------------------------------------

  if (
    candle?.closed === true ||
    candle?.isClosed === true
  ) {
    return false;
  }

  // ----------------------------------------------------------
  // Timestamp-based detection
  // ----------------------------------------------------------

  const timestamp =
    getCandleTimestamp(
      candle
    );

  if (
    !Number.isFinite(
      timestamp
    )
  ) {
    // No reliable timestamp.
    //
    // Do not reject the candle automatically because some
    // existing mexcService implementations may already return
    // closed candles only.
    //
    return false;
  }

  const duration =
    timeframeMilliseconds(
      timeframe
    );

  const candleClose =
    timestamp +
    duration;

  // ----------------------------------------------------------
  // Small safety buffer.
  //
  // Wait 1 second after expected close before accepting it.
  // ----------------------------------------------------------

  return (
    now <
    candleClose + 1000
  );
}


// ============================================================
// GET CLOSED CANDLES ONLY
//
// IMPORTANT:
//
// The newest candle can still be forming even if the API does
// not provide candle.closed.
//
// We therefore use both:
//
//   • explicit closed flags
//   • candle timestamp + timeframe
//
// ============================================================

function getClosedCandles(
  candles,
  timeframe
) {
  if (
    !Array.isArray(
      candles
    )
  ) {
    return [];
  }

  const now =
    Date.now();

  return candles.filter(
    (candle) => {
      if (
        !candle
      ) {
        return false;
      }

      // ------------------------------------------------------
      // Validate OHLC
      // ------------------------------------------------------

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

      // ------------------------------------------------------
      // Reject still-forming candle.
      // ------------------------------------------------------

      if (
        isCandleForming(
          candle,
          timeframe,
          now
        )
      ) {
        return false;
      }

      return true;
    }
  );
}


// ============================================================
// SORT CLOSED CANDLES
//
// Oldest -> newest.
//
// This makes the input deterministic for crtEngine.js.
//
// ============================================================

function sortCandlesAscending(
  candles
) {
  return [
    ...candles,
  ].sort(
    (a, b) => {
      const timeA =
        getCandleTimestamp(
          a
        );

      const timeB =
        getCandleTimestamp(
          b
        );

      if (
        Number.isFinite(
          timeA
        ) &&
        Number.isFinite(
          timeB
        )
      ) {
        return (
          timeA - timeB
        );
      }

      return 0;
    }
  );
}


// ============================================================
// SCAN SYMBOL
//
// crtEngine.js remains the ONLY CRT authority.
//
// ============================================================

async function scanSymbol(
  client,
  market,
  symbol,
  timeframe
) {
  try {
    // --------------------------------------------------------
    // HARD FUTURES-ONLY SAFETY
    // --------------------------------------------------------

    if (
      market !==
      'futures'
    ) {
      return;
    }

    // --------------------------------------------------------
    // GET MEXC FUTURES KLINES
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // CLOSED CANDLES ONLY
    // --------------------------------------------------------

    const closed =
      sortCandlesAscending(
        getClosedCandles(
          candles,
          timeframe
        )
      );

    // --------------------------------------------------------
    // MINIMUM HISTORY
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // BUILD RACHEL T CRT SIGNAL
    //
    // crtEngine.js is the authority.
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // NO SIGNAL
    // --------------------------------------------------------

    if (
      !signal
    ) {
      return;
    }

    // --------------------------------------------------------
    // CONFIRMATION SAFETY
    //
    // Only confirmed engine signals are allowed to reach
    // Discord.
    // --------------------------------------------------------

    if (
      !isConfirmedSignal(
        signal
      )
    ) {
      return;
    }

    // --------------------------------------------------------
    // SIGNAL ID REQUIRED
    //
    // Prevents duplicate alerts.
    // --------------------------------------------------------

    if (
      !signal.id
    ) {
      console.warn(
        `[CRT] Signal rejected because no signal.id was returned: futures:${symbol}:${timeframe}`
      );

      return;
    }

    // --------------------------------------------------------
    // NEW SIGNAL CHECK
    // --------------------------------------------------------

    if (
      !isNewSignal(
        signal.id
      )
    ) {
      return;
    }

    // --------------------------------------------------------
    // SEND DISCORD
    // --------------------------------------------------------

    await sendSignal(
      client,
      signal
    );

    // --------------------------------------------------------
    // LOG
    // --------------------------------------------------------

    console.log(
      `[CRT] RACHEL T CONFIRMED futures:${symbol}:${timeframe}` +
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
// GET PRIORITY TIMEFRAMES
//
// Ensures the standard order:
//
//   5m
//   15m
//   30m
//   1h
//   4h
//   1d
//
// Any custom configured timeframe is appended afterward.
//
// ============================================================

function getPriorityTimeframes() {
  const configured =
    Object.keys(
      TIMEFRAMES
    );

  const priority = [
    '5m',
    '15m',
    '30m',
    '1h',
    '4h',
    '1d',
  ];

  const result =
    priority.filter(
      (timeframe) =>
        configured.includes(
          timeframe
        )
    );

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
// SCAN ALL
//
// Sequential scanning is intentional.
//
// This reduces the chance of creating a large burst of MEXC
// requests.
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
    // --------------------------------------------------------
    // LOAD MEXC FUTURES SYMBOLS
    // --------------------------------------------------------

    await refreshSymbols();

    const timeframes =
      getPriorityTimeframes();

    // --------------------------------------------------------
    // FUTURES ONLY
    // --------------------------------------------------------

    const market =
      'futures';

    const symbols =
      cachedSymbols.get(
        'futures'
      ) || [];

    if (
      !symbols.length
    ) {
      console.warn(
        '[CRT] No MEXC Futures symbols available for scanning.'
      );

      return;
    }

    // --------------------------------------------------------
    // SCAN TIMEFRAMES
    // --------------------------------------------------------

    for (
      const timeframe of
      timeframes
    ) {
      // ------------------------------------------------------
      // SCAN EVERY FUTURES SYMBOL
      // ------------------------------------------------------

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
  // ----------------------------------------------------------
  // PREVENT MULTIPLE MONITORS
  // ----------------------------------------------------------

  if (
    monitorStarted
  ) {
    return;
  }

  // ----------------------------------------------------------
  // CONFIGURATION CHECK
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

  // ----------------------------------------------------------
  // DISCORD CLIENT CHECK
  // ----------------------------------------------------------

  if (
    !client
  ) {
    throw new Error(
      'Discord client is required for CRT monitor'
    );
  }

  monitorStarted =
    true;

  // ----------------------------------------------------------
  // START LOG
  // ----------------------------------------------------------

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
    `[CRT] Timeframes: ${getPriorityTimeframes().join(', ')}`
  );

  console.log(
    `[CRT] Scan interval: ${SCAN_INTERVAL}ms; max symbols: ${MAX_SYMBOLS}`
  );

  console.log(
    `[CRT] Kline history: ${KLINE_LIMIT} candles`
  );

  console.log(
    `[CRT] Auto symbols: ${AUTO_SYMBOLS}`
  );

  console.log(
    '[CRT] Closed candle protection: ENABLED'
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

  // ----------------------------------------------------------
  // INITIAL SCAN
  //
  // NOTE:
  //
  // Only closed candles are passed to the engine.
  //
  // ----------------------------------------------------------

  void scanAll(
    client
  );

  // ----------------------------------------------------------
  // CONTINUOUS MONITOR
  // ----------------------------------------------------------

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
      getPriorityTimeframes(),

    // --------------------------------------------------------
    // SCAN SETTINGS
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

    // --------------------------------------------------------
    // CANDLE SAFETY
    // --------------------------------------------------------

    candleSafety: {
      closedCandlesOnly:
        true,

      formingCandleRejected:
        true,
    },
  };
}


// ============================================================
// SERVICE LOADED
// ============================================================

console.log(
  `[CRT] Service loaded • Rachel T Fractal PRIMARY • MEXC FUTURES ONLY • ${getPriorityTimeframes().join(', ')}`
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
  '[CRT] Forming candle rejection: ENABLED'
);

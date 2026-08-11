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
// OnePercent CRT SERVICE
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
// The Rachel T Fractal confirmation is the PRIMARY signal.
//
// Supporting information:
//
//   • Market Structure
//   • STD Deviation
//   • Fractal
//   • Liquidity Sweep
//   • RSI
//
// crtEngine.js is responsible for:
//
//   • Rachel T fractal
//   • CRT confirmation
//   • Market structure
//   • STD deviation
//   • Liquidity sweep
//   • RSI
//
// crtService.js only:
//
//   1. Gets MEXC Futures candles
//   2. Removes the still-forming candle
//   3. Sends candles to crtEngine.js
//   4. Receives the confirmed signal
//   5. Displays the signal in Discord
//
// IMPORTANT:
//
//   SPOT IS COMPLETELY DISABLED.
//
//   This service will ONLY scan:
//      MEXC FUTURES
//
// ============================================================


// ============================================================
// CONFIG
// ============================================================

const CRT_CONFIG = botConfig.crt || {};


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
// Even if bot.js contains:
//
//   markets: 'spot,futures'
//
// this service will still use FUTURES ONLY.
//
// ============================================================

const MARKET_TYPES = [
  'futures',
];


// ============================================================
// SCAN INTERVAL
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
//
// Rachel T fractal confirmation needs historical candles.
//
// 100 is a safe default.
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
// Accept multiple property names so the service remains
// compatible with crtEngine.js.
//
// Priority:
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
// STD DEVIATION
//
// Accept all names generated by crtEngine.js.
//
// Priority:
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
// GET CONFIRMED FRACTAL HISTORY
//
// crtEngine.js returns:
//
//   confirmedFractals
//
// This function safely retrieves that history.
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
// ============================================================
//
// Used when:
//
//   Market Structure = Bearish
//
// The service scans ALL confirmed fractals and selects the
// latest confirmed TOP.
//
// It does NOT assume the latest overall fractal is a TOP.
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

  for (
    let i =
      fractals.length - 1;
    i >= 0;
    i--
  ) {
    const fractal =
      fractals[i];

    if (
      String(
        fractal?.type || ''
      )
        .trim()
        .toUpperCase() ===
      'TOP'
    ) {
      return fractal;
    }
  }

  return null;
}


// ============================================================
// GET LATEST CONFIRMED BOTTOM
// ============================================================
//
// Used when:
//
//   Market Structure = Bullish
//
// The service scans ALL confirmed fractals and selects the
// latest confirmed BOTTOM.
//
// It does NOT assume the latest overall fractal is a BOTTOM.
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

  for (
    let i =
      fractals.length - 1;
    i >= 0;
    i--
  ) {
    const fractal =
      fractals[i];

    if (
      String(
        fractal?.type || ''
      )
        .trim()
        .toUpperCase() ===
      'BOTTOM'
    ) {
      return fractal;
    }
  }

  return null;
}


// ============================================================
// FRACTAL TYPE / MARKET STRUCTURE ALIGNMENT
// ============================================================
//
// DISPLAY RULE:
//
//   BEARISH MARKET STRUCTURE
//      -> latest confirmed TOP
//
//   BULLISH MARKET STRUCTURE
//      -> latest confirmed BOTTOM
//
//   NEUTRAL
//      -> latest confirmed fractal
//
// IMPORTANT:
//
// This controls ONLY which confirmed fractal is displayed.
//
// It does NOT create a new fractal.
//
// It does NOT modify crtEngine.js.
//
// It does NOT use TradingView.
//
// It uses only the confirmed fractal history returned by
// crtEngine.js.
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
  //
  // Bearish structure should display the latest confirmed TOP.
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
  //
  // Bullish structure should display the latest confirmed
  // BOTTOM.
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
  //
  // Use the latest confirmed fractal.
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
        latest.type || ''
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
    String(raw)
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
// IMPORTANT:
//
// crtEngine.js is responsible for generating liquiditySweep.
//
// The service DOES NOT calculate another sweep.
//
// This prevents the service from overriding the engine's
// Rachel T fractal interpretation.
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
        sweep.type || ''
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
// CRT CONFIRMATION
//
// The signal only reaches this service after buildSignal()
// confirms the Rachel T fractal + CRT condition.
//
// Still support explicit confirmation fields for compatibility.
//
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
// Discord field:
//
//   Potential CRT
//
// The underlying signal still has to be confirmed by
// crtEngine.js before it reaches this service.
//
// Therefore:
//
//   Potential CRT = CONFIRMED
//
// means the current signal has passed the engine's CRT
// confirmation rules.
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
// BTC_USDT -> BTC
// BTC-USDT -> BTC
// BTCUSDT  -> BTC
// BTC_USD  -> BTC
// BTCUSD   -> BTC
//
// MEXC Futures:
//
// BTC_USDT
//
// ============================================================

function formatCoin(
  symbol
) {
  return String(
    symbol || 'UNKNOWN'
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
//
// PRIMARY:
//
//   Rachel T CRT Signal
//
// SUPPORTING:
//
//   Market Structure
//   STD Deviation
//   Fractal
//   Liquidity
//   Potential CRT
//   RSI
//
// NO FRACTAL PRICE
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

  // ==========================================================
  // IMPORTANT
  //
  // This now displays:
  //
  // Bearish -> latest confirmed TOP
  // Bullish -> latest confirmed BOTTOM
  // Neutral -> latest confirmed fractal
  //
  // ==========================================================

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
      // Neutral -> latest confirmed
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
      //
      // Changed from:
      //
      //   CONFIRM CRT Candle
      //
      // to:
      //
      //   Potential CRT
      //
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
// MEXC FUTURES ONLY
//
// No Spot symbols are accepted here.
//
// ============================================================

function filterSymbols(
  symbols,
  market
) {
  // ----------------------------------------------------------
  // HARD SAFETY CHECK
  //
  // This function must NEVER process Spot.
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
// There is intentionally NO getSpotSymbols() call.
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

  // ==========================================================
  // MEXC FUTURES ONLY
  // ==========================================================

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
        )?.length || 0
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
// SCAN SYMBOL
// ============================================================
//
// IMPORTANT:
//
// The service does NOT independently determine whether a CRT
// exists.
//
// crtEngine.js is the authority.
//
// If buildSignal() returns null:
//
//   No confirmed Rachel T CRT signal.
//
// Therefore nothing is sent to Discord.
//
// MARKET:
//
//   MEXC FUTURES ONLY
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
      )
    ) {
      return;
    }

    // ========================================================
    // CLOSED CANDLES ONLY
    //
    // Never allow the currently-forming MEXC Futures candle
    // to become the CRT confirmation candle.
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
      );

    // ========================================================
    // MINIMUM HISTORY
    //
    // Rachel T fractal + RSI + standard deviation require
    // historical candles.
    //
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
    // NO CONFIRMED RACHEL T CRT
    //
    // This is expected most of the time.
    //
    // ========================================================

    if (
      !signal
    ) {
      return;
    }

    // ========================================================
    // SAFETY
    //
    // The engine must return the actual confirmed CRT candle.
    //
    // ========================================================

    if (
      !isConfirmedSignal(
        signal
      )
    ) {
      return;
    }

    // ========================================================
    // SIGNAL ID
    //
    // Prevent duplicate Discord alerts.
    //
    // ========================================================

    if (
      !signal.id
    ) {
      console.warn(
        `[CRT] Signal rejected because no signal.id was returned: futures:${symbol}:${timeframe}`
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
// SCAN ALL
// ============================================================
//
// Sequential scanning is intentional.
//
// This prevents a large burst of requests to MEXC.
//
// Priority order:
//
//   5m
//   15m
//   30m
//   1h
//   4h
//   1d
//
// IMPORTANT:
//
//   ONLY MEXC FUTURES.
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

    const configuredTimeframes =
      Object.keys(
        TIMEFRAMES
      );

    // ========================================================
    // EXPLICIT TIMEFRAME PRIORITY
    //
    // This prevents object/config ordering from accidentally
    // changing the intended scan order.
    //
    // ========================================================

    const priority = [
      '5m',
      '15m',
      '30m',
      '1h',
      '4h',
      '1d',
    ];

    const timeframes =
      priority.filter(
        (timeframe) =>
          configuredTimeframes.includes(
            timeframe
          )
      );

    // Include any custom configured timeframe after the
    // standard priority timeframes.

    for (
      const timeframe of
      configuredTimeframes
    ) {
      if (
        !timeframes.includes(
          timeframe
        )
      ) {
        timeframes.push(
          timeframe
        );
      }
    }

    // ========================================================
    // SCAN TIMEFRAMES
    // ========================================================

    for (
      const timeframe of
      timeframes
    ) {

      // ======================================================
      // FUTURES ONLY
      // ======================================================

      const market =
        'futures';

      const symbols =
        cachedSymbols.get(
          'futures'
        ) || [];

      // ======================================================
      // SCAN EVERY MEXC FUTURES SYMBOL
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
    `[CRT] Timeframes: ${Object.keys(
      TIMEFRAMES
    ).join(', ')}`
  );

  console.log(
    `[CRT] Scan interval: ${SCAN_INTERVAL}ms; max symbols/market: ${MAX_SYMBOLS}`
  );

  console.log(
    `[CRT] Kline history: ${KLINE_LIMIT} candles`
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

    timeframes:
      Object.keys(
        TIMEFRAMES
      ),

    scanInterval:
      SCAN_INTERVAL,

    klineLimit:
      KLINE_LIMIT,

    maxSymbolsPerMarket:
      MAX_SYMBOLS,

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
  `[CRT] Service loaded • Rachel T Fractal PRIMARY • MEXC FUTURES ONLY • ${Object.keys(
    TIMEFRAMES
  ).join(', ')}`
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

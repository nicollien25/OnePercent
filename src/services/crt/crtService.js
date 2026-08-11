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
// The service DOES NOT calculate another CRT.
// The service DOES NOT calculate another liquidity sweep.
//
// crtEngine.js is responsible for generating:
//
//   • Rachel T fractal
//   • CRT confirmation
//   • Market structure
//   • STD deviation
//   • liquidity sweep
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

const CRT_CONFIG = botConfig.crt || {};

// ============================================================
// TIMEFRAMES
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
// 100 is a safe default.
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
// ============================================================

function formatRSIState(
  state
) {
  const normalized =
    String(
      state || 'Neutral'
    ).trim().toUpperCase();

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
//
// Rachel T fractal is PRIMARY.
//
// Accept:
//
//   fractalType
//   fractal.type
//   type
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
    String(raw)
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
//
// IMPORTANT:
//
// crtEngine.js is responsible for generating liquiditySweep.
//
// The service DOES NOT calculate another sweep.
//
// This prevents the service from overriding the engine's
// Rachel T fractal interpretation.
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
// The signal only reaches this service after buildSignal()
// confirms the Rachel T fractal + CRT condition.
//
// Still support explicit confirmation fields for compatibility.
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
//
// BULLISH = GREEN
// BEARISH = RED
// UNKNOWN = YELLOW
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
// Also handles MEXC Futures symbols such as:
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
//   Rachel T CRT Confirmation
//
// SUPPORTING:
//
//   Market Structure
//   STD Deviation
//   Fractal
//   Liquidity
//   RSI
//
// NO FRACTAL PRICE
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
      '**OnePERCENT CRT SIGNAL**'
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
    // CANDLE TIME
    // ========================================================

    .setTimestamp(
      new Date(
        signal.candleTime
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

  if (!channelId) {
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
    !Array.isArray(symbols)
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

        if (!symbol) {
          return false;
        }

        const normalized =
          String(
            symbol
          ).toUpperCase();

        // ----------------------------------------------------
        // MEXC FUTURES ONLY
        // ----------------------------------------------------

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
    .filter(Boolean);
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
    // Never allow the currently forming MEXC Futures candle
    // to become the CRT confirmation candle.
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

          const close =
            Number(
              candle?.close
            );

          return Number.isFinite(
            close
          );
        }
      );

    // ========================================================
    // MINIMUM HISTORY
    //
    // Rachel T fractal + RSI + standard deviation require
    // historical candles.
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
    // ========================================================

    if (!signal) {
      return;
    }

    // ========================================================
    // SAFETY
    //
    // The engine must return the actual confirmed CRT candle.
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
      ` | Fractal=${getFractalType(signal)}` +
      ` | STD=${getStdDeviation(signal)}` +
      ` | Liquidity=${getLiquiditySweep(signal)}` +
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

    const timeframes =
      Object.keys(
        TIMEFRAMES
      );

    // ========================================================
    // TIMEFRAME PRIORITY
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

  if (!client) {
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
    `[CRT] PRIMARY SIGNAL: Rachel T Fractal + CRT Confirmation`
  );

  console.log(
    `[CRT] Markets: MEXC Futures ONLY`
  );

  console.log(
    `[CRT] Timeframes: ${Object.keys(TIMEFRAMES).join(', ')}`
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


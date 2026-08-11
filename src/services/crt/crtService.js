// ============================================================
// OnePERCENT CRT SERVICE
// ============================================================
//
// PRIMARY PURPOSE:
//
//   OnePERCENT CRT SIGNAL
//
// SUPPORTING DATA:
//
//   • Market Structure
//   • STD Deviation
//   • RSI
//
// LIVE LIQUIDITY:
//
//   • Runs independently from CRT confirmation
//   • Can detect a Rachel T liquidity sweep while the
//     current MEXC candle is still running
//
// IMPORTANT:
//
//   crtEngine.js is the authority for:
//
//   • Rachel T fractals
//   • CRT confirmation
//   • Market structure
//   • STD deviation
//   • liquidity sweep
//   • RSI
//
//   crtService.js is responsible for:
//
//   • MEXC candle retrieval
//   • EXACT candle-close timing
//   • live liquidity monitoring
//   • Discord alerts
//   • duplicate prevention
//
// ============================================================

import { EmbedBuilder } from 'discord.js';

import botConfig from '../../config/bot.js';

import {
  buildSignal,
  buildLiveState,
} from './crtEngine.js';

import {
  getKlines,
  getSpotSymbols,
  getFuturesContracts,
  getConfiguredSymbols,
} from './mexcService.js';

import { isNewSignal } from './signalManager.js';

// ============================================================
// CRT CONFIG
// ============================================================

const CRT_CONFIG =
  botConfig.crt || {};

// ============================================================
// TIMEFRAMES
// ============================================================
//
// IMPORTANT:
//
// These values represent the EXACT candle duration in minutes.
//
// MEXC remains the authority for candle timestamps.
//
// ============================================================

const TIMEFRAMES =
  CRT_CONFIG.timeframes || {
    '5m': 5,
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
// MARKETS
// ============================================================

const MARKET_TYPES =
  String(
    CRT_CONFIG.markets ||
      'spot,futures'
  )
    .split(',')
    .map((value) =>
      value
        .trim()
        .toLowerCase()
    )
    .filter(Boolean);

// ============================================================
// CLOSED-CANDLE SCAN INTERVAL
// ============================================================
//
// IMPORTANT:
//
// This is ONLY the polling interval.
//
// It does NOT define the trading timeframe.
//
// Example:
//
// 15m candle:
//
// 00:00 → 00:15
//
// The bot may check every 5 seconds, but it will NOT process
// the candle until the exact 00:15 close boundary has passed.
//
// ============================================================

const SCAN_INTERVAL =
  Math.max(
    1000,
    Number(
      CRT_CONFIG.scanInterval ||
        5000
    )
  );

// ============================================================
// LIVE LIQUIDITY INTERVAL
// ============================================================
//
// Live liquidity is intentionally independent from CRT.
//
// The currently-running candle may generate a liquidity
// sweep before the candle closes.
//
// ============================================================

const LIVE_LIQUIDITY_INTERVAL =
  Math.max(
    1000,
    Number(
      CRT_CONFIG.liveLiquidityInterval ||
        10000
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
// SERVICE STATE
// ============================================================

let monitorStarted =
  false;

let scanRunning =
  false;

let liveScanRunning =
  false;

// ============================================================
// SYMBOL CACHE
// ============================================================

const cachedSymbols =
  new Map();

let lastSymbolRefresh =
  0;

// ============================================================
// LIVE SWEEP STATE
// ============================================================
//
// Prevents the same live liquidity sweep from being sent
// repeatedly while the same candle remains active.
//
// ============================================================

const liveSweepSeen =
  new Map();

// ============================================================
// CLOSED CANDLE STATE
// ============================================================
//
// Key:
//
// market:symbol:timeframe:candleOpenTime
//
// This guarantees that one exact MEXC candle is processed
// only once.
//
// ============================================================

const lastProcessedCandle =
  new Map();

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
      '1h': '1 HOUR',
      '4h': '4 HOURS',
      '1d': 'DAILY',
    }[timeframe] ||
    String(timeframe)
  );
}

// ============================================================
// TIMEFRAME DURATION
// ============================================================

function getTimeframeMs(
  timeframe
) {
  const minutes =
    Number(
      TIMEFRAMES[
        timeframe
      ]
    );

  if (
    !Number.isFinite(
      minutes
    ) ||
    minutes <= 0
  ) {
    return 0;
  }

  return (
    minutes *
    60 *
    1000
  );
}

// ============================================================
// EXACT CANDLE CLOSE TIME
// ============================================================
//
// MEXC candle open time +
// exact timeframe duration.
//
// Example:
//
// 15m:
//
// open 00:00
// close 00:15
//
// ============================================================

function getExpectedCandleCloseTime(
  candleOpenTime,
  timeframe
) {
  const open =
    Number(
      candleOpenTime
    );

  const duration =
    getTimeframeMs(
      timeframe
    );

  if (
    !Number.isFinite(
      open
    ) ||
    open <= 0 ||
    duration <= 0
  ) {
    return 0;
  }

  return (
    open +
    duration
  );
}

// ============================================================
// IS EXACT MEXC CANDLE CLOSED?
// ============================================================
//
// IMPORTANT:
//
// Do NOT depend on candle.closed.
//
// The service calculates closure itself.
//
// ============================================================

function isCandleActuallyClosed(
  candle,
  timeframe,
  now = Date.now()
) {
  const openTime =
    Number(
      candle?.openTime ??
        candle?.time ??
        candle?.timestamp ??
        0
    );

  if (
    !Number.isFinite(
      openTime
    ) ||
    openTime <= 0
  ) {
    return false;
  }

  const expectedClose =
    getExpectedCandleCloseTime(
      openTime,
      timeframe
    );

  if (
    !expectedClose
  ) {
    return false;
  }

  return (
    now >=
    expectedClose
  );
}

// ============================================================
// GET CANDLE OPEN TIME
// ============================================================

function getCandleOpenTime(
  candle
) {
  const value =
    Number(
      candle?.openTime ??
        candle?.time ??
        candle?.timestamp ??
        0
    );

  if (
    !Number.isFinite(
      value
    ) ||
    value <= 0
  ) {
    return 0;
  }

  return value;
}

// ============================================================
// GET CANDLE CLOSE TIME
// ============================================================
//
// IMPORTANT:
//
// The exact MEXC timeframe calculation remains the authority.
//
// If an explicit closeTime is supplied by the service it may
// be used for display, but closed-candle validation always
// uses:
//
//   openTime + timeframe duration
//
// ============================================================

function getCandleCloseTime(
  candle,
  timeframe
) {
  const explicit =
    Number(
      candle?.closeTime ??
        candle?.endTime ??
        0
    );

  if (
    Number.isFinite(
      explicit
    ) &&
    explicit > 0
  ) {
    return explicit;
  }

  const openTime =
    getCandleOpenTime(
      candle
    );

  return getExpectedCandleCloseTime(
    openTime,
    timeframe
  );
}

// ============================================================
// PRICE FORMATTER
// ============================================================

function fmtPrice(
  value
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

  if (
    Math.abs(number) >=
    1000
  ) {
    return number.toLocaleString(
      'en-US',
      {
        minimumFractionDigits:
          2,
        maximumFractionDigits:
          2,
      }
    );
  }

  if (
    Math.abs(number) >=
    1
  ) {
    return number.toLocaleString(
      'en-US',
      {
        maximumFractionDigits:
          5,
      }
    );
  }

  return number.toLocaleString(
    'en-US',
    {
      maximumSignificantDigits:
        7,
    }
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
//
// Numerical RSI is intentionally NOT displayed.
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

  if (
    normalized ===
    'NEUTRAL'
  ) {
    return 'Neutral';
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
// SIGNAL CONFIRMATION
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
// STRUCTURE EMOJI
// ============================================================
//
// Used ONLY for CRT confirmation.
//
// Live liquidity uses 🚨 instead.
//
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
//
// Used for CRT confirmation.
//
// Live liquidity has its own dedicated yellow color.
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
// LIVE LIQUIDITY COLOR
// ============================================================
//
// IMPORTANT:
//
// Live liquidity is ALWAYS yellow.
//
// It does NOT change color based on market structure.
//
// ============================================================

function liveLiquidityColor() {
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
      /[-*]USDT$/i,
      ''
    )
    .replace(
      /USDT$/i,
      ''
    )
    .replace(
      /[-*]USD$/i,
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
// GET LIVE LIQUIDITY LABEL
// ============================================================
//
// IMPORTANT:
//
// The live liquidity signal intentionally does NOT expose:
//
//   • PREVIOUS RACHEL_T TOP SWEPT
//   • PREVIOUS RACHEL_T BOTTOM SWEPT
//
// Both are replaced by:
//
//   LIQUIDITY SWEPT
//
// ============================================================

function getLiveLiquidityLabel() {
  return '**LIQUIDITY SWEPT**';
}

// ============================================================
// CREATE CRT CONFIRMATION EMBED
// ============================================================
//
// DISPLAY:
//
//   OnePERCENT CRT CONFIRMATION
//   Coin
//   Source
//   Timeframe
//   Market Structure
//   STD Deviation
//   RSI
//
// REMOVED:
//
//   • Fractal
//   • Fractal Price
//   • CONFIRM CRT Candle
//   • Liquidity
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
            '**MEXC Exchange**',
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
          'PDYN • Rachel T CRT • MEXC Exchange',
      });

  // ========================================================
  // CLOSED MEXC CANDLE TIMESTAMP
  // ========================================================

  if (
    signal.candleTime
  ) {
    const candleDate =
      new Date(
        signal.candleTime
      );

    if (
      !Number.isNaN(
        candleDate.getTime()
      )
    ) {
      embed.setTimestamp(
        candleDate
      );
    }
  }

  return embed;
}

// ============================================================
// SEND CONFIRMED CRT SIGNAL
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
      `[CRT] Failed to fetch Discord channel ${channelId}:`,
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
      `[CRT] Invalid Discord channel for ${signal.timeframe}`
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
      `[CRT] Failed to send CRT signal ${signal.symbol}:${signal.timeframe}:`,
      error?.message ||
        error
    );

    return false;
  }
}

// ============================================================
// CREATE LIVE LIQUIDITY EMBED
// ============================================================
//
// DISPLAY:
//
//   PDYN Liquidity Signal
//   Coin
//   Source
//   Timeframe
//   Market Structure
//   Fractal Swept
//
// IMPORTANT:
//
//   • Always yellow
//   • Uses 🚨 siren emoji
//   • Does NOT display TOP/BOTTOM
//   • Displays only LIQUIDITY SWEPT
//
// ============================================================

function createLiveLiquidityEmbed(
  signal
) {
  const structure =
    getMarketStructure(
      signal
    );

  const coin =
    formatCoin(
      signal.symbol
    );

  const swept =
    getLiveLiquidityLabel();

  const embed =
    new EmbedBuilder()
      .setTitle(
        `🚨 ${coin}`
      )
      .setDescription(
        '**OnePERCENT Liquidity Signal**'
      )
      .addFields(
        {
          name:
            'Source',
          value:
            '**MEXC Exchange**',
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
            'Fractal Swept',
          value:
            swept,
          inline:
            true,
        }
      )
      .setColor(
        liveLiquidityColor()
      )
      .setFooter({
        text:
          'PDYN • Rachel T Liquidity • MEXC Exchange',
      });

  // ========================================================
  // CURRENT RUNNING MEXC CANDLE TIMESTAMP
  // ========================================================

  if (
    signal.liveCandleTime
  ) {
    const candleDate =
      new Date(
        signal.liveCandleTime
      );

    if (
      !Number.isNaN(
        candleDate.getTime()
      )
    ) {
      embed.setTimestamp(
        candleDate
      );
    }
  }

  return embed;
}

// ============================================================
// SEND LIVE LIQUIDITY ALERT
// ============================================================

async function sendLiveLiquidityAlert(
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
      `[CRT] No Discord channel configured for live liquidity ${signal.timeframe}`
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
      `[CRT] Failed to fetch liquidity channel ${channelId}:`,
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
      `[CRT] Invalid liquidity Discord channel for ${signal.timeframe}`
    );

    return false;
  }

  const coin =
    formatCoin(
      signal.symbol
    );

  try {
    await channel.send({
      // ======================================================
      // LIVE LIQUIDITY ALWAYS USES SIREN
      // ======================================================

      content:
        `🚨 **${coin}**`,

      embeds: [
        createLiveLiquidityEmbed(
          signal
        ),
      ],
    });

    return true;
  } catch (
    error
  ) {
    console.error(
      `[CRT] Failed to send liquidity signal ${signal.symbol}:${signal.timeframe}:`,
      error?.message ||
        error
    );

    return false;
  }
}

// ============================================================
// FILTER SYMBOLS
// ============================================================

function filterSymbols(
  symbols,
  market
) {
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

        // ====================================================
        // FUTURES
        // ====================================================

        if (
          market ===
          'futures'
        ) {
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

        // ====================================================
        // SPOT
        // ====================================================

        return (
          normalized.endsWith(
            quote
          ) ||
          normalized.endsWith(
            `_${quote}`
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
// REFRESH SYMBOLS
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

  for (
    const market of
    MARKET_TYPES
  ) {
    try {
      if (
        market ===
        'futures'
      ) {
        const contracts =
          await getFuturesContracts();

        cachedSymbols.set(
          market,
          filterSymbols(
            contracts,
            market
          )
        );
      } else if (
        market ===
        'spot'
      ) {
        const symbols =
          await getSpotSymbols();

        cachedSymbols.set(
          market,
          filterSymbols(
            symbols,
            market
          )
        );
      }
    } catch (
      error
    ) {
      console.error(
        `[CRT] Failed to refresh ${market} symbols:`,
        error?.message ||
          error
      );
    }
  }

  lastSymbolRefresh =
    Date.now();
}

// ============================================================
// SCAN LIVE LIQUIDITY — ONE SYMBOL
// ============================================================
//
// IMPORTANT:
//
// The CURRENT running candle is intentionally used here.
//
// This is NOT CRT confirmation.
//
// ============================================================

async function scanLiveLiquiditySymbol(
  client,
  market,
  symbol,
  timeframe
) {
  try {
    const candles =
      await getKlines({
        market,
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
    // BUILD LIVE STATE
    // ========================================================

    const liveState =
      buildLiveState(
        candles,
        {
          symbol,
          market,
          timeframe,
        }
      );

    if (
      !liveState
    ) {
      return;
    }

    const liveSweep =
      liveState.liveLiquiditySweep;

    if (
      !liveSweep?.swept ||
      !liveSweep.fractal
    ) {
      return;
    }

    // ========================================================
    // CURRENT RUNNING CANDLE
    // ========================================================

    const liveCandle =
      candles[
        candles.length - 1
      ];

    const liveCandleTime =
      getCandleOpenTime(
        liveCandle
      );

    if (
      !liveCandleTime
    ) {
      return;
    }

    // ========================================================
    // IMPORTANT:
    //
    // LIVE LIQUIDITY MUST COME FROM THE CURRENTLY RUNNING
    // CANDLE.
    //
    // If the last candle has already closed, do not treat
    // it as a live candle.
    // ========================================================

    const liveCandleClosed =
      isCandleActuallyClosed(
        liveCandle,
        timeframe
      );

    if (
      liveCandleClosed
    ) {
      return;
    }

    // ========================================================
    // FRACTAL PIVOT TIME
    // ========================================================

    const fractalPivotTime =
      Number(
        liveSweep
          .fractal
          ?.pivotTime ??
          0
      );

    // ========================================================
    // UNIQUE LIVE SWEEP ID
    // ========================================================

    const key = [
      market,
      symbol,
      timeframe,
      liveCandleTime,
      liveSweep.type,
      fractalPivotTime,
      liveSweep.level ??
        liveSweep.price ??
        '',
    ].join(':');

    if (
      liveSweepSeen.has(
        key
      )
    ) {
      return;
    }

    // ========================================================
    // MARK BEFORE SEND
    // ========================================================

    liveSweepSeen.set(
      key,
      Date.now()
    );

    // ========================================================
    // MEMORY CLEANUP
    // ========================================================

    if (
      liveSweepSeen.size >
      10000
    ) {
      const first =
        liveSweepSeen
          .keys()
          .next()
          .value;

      if (
        first
      ) {
        liveSweepSeen.delete(
          first
        );
      }
    }

    // ========================================================
    // SEND LIVE SIGNAL
    // ========================================================

    const sent =
      await sendLiveLiquidityAlert(
        client,
        {
          symbol,
          market,
          timeframe,

          marketStructure:
            liveState.marketStructure,

          structure:
            liveState.structure,

          structureType:
            liveState.structureType,

          liveLiquiditySweep:
            liveSweep,

          liveCandleTime,
        }
      );

    if (
      sent
    ) {
      console.log(
        `[CRT] 🚨 LIVE LIQUIDITY SWEPT ${market}:${symbol}:${timeframe}` +
          ` | Structure=${getMarketStructure(liveState)}` +
          ` | Type=${liveSweep.type}` +
          ` | Fractal=${liveSweep.fractal.fractalType}`
      );
    }
  } catch (
    error
  ) {
    console.error(
      `[CRT] Live liquidity scan failed ${market}:${symbol}:${timeframe}:`,
      error?.message ||
        error
    );
  }
}

// ============================================================
// LIVE LIQUIDITY SCAN
// ============================================================

async function scanLiveLiquidity(
  client
) {
  if (
    liveScanRunning
  ) {
    return;
  }

  liveScanRunning =
    true;

  try {
    await refreshSymbols();

    const timeframes =
      Object.keys(
        TIMEFRAMES
      );

    for (
      const timeframe of
      timeframes
    ) {
      for (
        const market of
        MARKET_TYPES
      ) {
        const symbols =
          cachedSymbols.get(
            market
          ) || [];

        for (
          const symbol of
          symbols
        ) {
          await scanLiveLiquiditySymbol(
            client,
            market,
            symbol,
            timeframe
          );
        }
      }
    }
  } catch (
    error
  ) {
    console.error(
      '[CRT] Live liquidity scan failed:',
      error?.message ||
        error
    );
  } finally {
    liveScanRunning =
      false;
  }
}

// ============================================================
// GET CLOSED CANDLES
// ============================================================
//
// THIS IS THE CORE TIMING FIX.
//
// We DO NOT trust:
//
//   candle.closed
//
// Instead:
//
//   candleOpenTime + timeframeDuration
//
// must be <= Date.now()
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
      const openTime =
        getCandleOpenTime(
          candle
        );

      if (
        !openTime
      ) {
        return false;
      }

      const close =
        Number(
          candle?.close
        );

      if (
        !Number.isFinite(
          close
        )
      ) {
        return false;
      }

      // ======================================================
      // EXACT MEXC CLOSE TIME
      // ======================================================

      const expectedClose =
        getExpectedCandleCloseTime(
          openTime,
          timeframe
        );

      if (
        !expectedClose
      ) {
        return false;
      }

      // ======================================================
      // CRITICAL:
      //
      // Current running candle is rejected here.
      // ======================================================

      return (
        now >=
        expectedClose
      );
    }
  );
}

// ============================================================
// SORT CANDLES CHRONOLOGICALLY
// ============================================================

function sortCandlesAscending(
  candles
) {
  return [
    ...candles,
  ].sort(
    (a, b) =>
      getCandleOpenTime(
        a
      ) -
      getCandleOpenTime(
        b
      )
  );
}

// ============================================================
// CLOSED-CANDLE SCAN — ONE SYMBOL
// ============================================================
//
// IMPORTANT:
//
// The currently-running MEXC candle is NEVER passed to
// buildSignal().
//
// ============================================================

async function scanSymbol(
  client,
  market,
  symbol,
  timeframe
) {
  try {
    const candles =
      await getKlines({
        market,
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
    // EXACT CLOSED CANDLES ONLY
    // ========================================================

    const closed =
      sortCandlesAscending(
        getClosedCandles(
          candles,
          timeframe
        )
      );

    if (
      !closed.length
    ) {
      return;
    }

    // ========================================================
    // MOST RECENT EXACTLY CLOSED MEXC CANDLE
    // ========================================================

    const latestClosed =
      closed[
        closed.length - 1
      ];

    const candleOpenTime =
      getCandleOpenTime(
        latestClosed
      );

    if (
      !candleOpenTime
    ) {
      return;
    }

    const candleCloseTime =
      getCandleCloseTime(
        latestClosed,
        timeframe
      );

    // ========================================================
    // EXTRA SAFETY CHECK
    //
    // Even though getClosedCandles() already filtered it,
    // check again before buildSignal().
    // ========================================================

    if (
      Date.now() <
      candleCloseTime
    ) {
      return;
    }

    // ========================================================
    // CANDLE KEY
    // ========================================================

    const candleKey = [
      market,
      symbol,
      timeframe,
      candleOpenTime,
    ].join(':');

    // ========================================================
    // DO NOT PROCESS SAME CANDLE TWICE
    // ========================================================

    if (
      lastProcessedCandle.has(
        candleKey
      )
    ) {
      return;
    }

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
    // ONLY FULLY CLOSED MEXC CANDLES ARE PASSED.
    // ========================================================

    const signal =
      buildSignal(
        closed,
        {
          symbol,
          market,
          timeframe,

          rsi: {
            period:
              RSI_PERIOD,

            oversold:
              OVERSOLD,

            overbought:
              OVERBOUGHT,
          },

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
        }
      );

    // ========================================================
    // NO CRT SIGNAL
    //
    // IMPORTANT:
    //
    // We do NOT mark the candle as processed yet.
    //
    // This allows the engine to be evaluated again if the
    // required data becomes available on a subsequent scan.
    //
    // ========================================================

    if (
      !signal
    ) {
      return;
    }

    // ========================================================
    // SAFETY
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
    // DUPLICATE SIGNAL CHECK
    // ========================================================

    if (
      !isNewSignal(
        signal.id
      )
    ) {
      // ======================================================
      // Mark this exact candle as processed because the signal
      // manager has already seen this signal.
      // ======================================================

      lastProcessedCandle.set(
        candleKey,
        {
          openTime:
            candleOpenTime,

          closeTime:
            candleCloseTime,

          processedAt:
            Date.now(),
        }
      );

      return;
    }

    // ========================================================
    // FORCE CLOSED-CANDLE TIMESTAMP
    //
    // Ensures the embed refers to the actual MEXC candle
    // that just closed.
    // ========================================================

    signal.candleTime =
      candleCloseTime;

    // ========================================================
    // SEND DISCORD
    // ========================================================

    const sent =
      await sendSignal(
        client,
        signal
      );

    // ========================================================
    // ONLY MARK PROCESSED AFTER SUCCESSFUL SEND
    // ========================================================

    if (
      sent
    ) {
      lastProcessedCandle.set(
        candleKey,
        {
          openTime:
            candleOpenTime,

          closeTime:
            candleCloseTime,

          processedAt:
            Date.now(),
        }
      );

      console.log(
        `[CRT] RACHEL T CONFIRMED ${market}:${symbol}:${timeframe}` +
          ` | Candle Open=${new Date(
            candleOpenTime
          ).toISOString()}` +
          ` | Candle Close=${new Date(
            candleCloseTime
          ).toISOString()}` +
          ` | Structure=${getMarketStructure(
            signal
          )}` +
          ` | STD=${getStdDeviation(
            signal
          )}` +
          ` | RSI=${
            signal.rsiState ||
            'Neutral'
          }`
      );
    }
  } catch (
    error
  ) {
    console.error(
      `[CRT] Scan failed ${market}:${symbol}:${timeframe}:`,
      error?.message ||
        error
    );
  }
}

// ============================================================
// CLEAN OLD PROCESSED CANDLES
// ============================================================

function cleanupProcessedCandles() {
  const now =
    Date.now();

  const maxAge =
    7 *
    24 *
    60 *
    60 *
    1000;

  for (
    const [
      key,
      data,
    ] of lastProcessedCandle
  ) {
    const processedAt =
      Number(
        data?.processedAt ||
          0
      );

    if (
      processedAt &&
      now -
        processedAt >
        maxAge
    ) {
      lastProcessedCandle.delete(
        key
      );
    }
  }

  if (
    lastProcessedCandle.size >
    20000
  ) {
    const entries =
      Array.from(
        lastProcessedCandle.entries()
      );

    entries.sort(
      (a, b) =>
        Number(
          a[1]?.processedAt ||
            0
        ) -
        Number(
          b[1]?.processedAt ||
            0
        )
    );

    const removeCount =
      entries.length -
      15000;

    for (
      let i = 0;
      i < removeCount;
      i++
    ) {
      lastProcessedCandle.delete(
        entries[i][0]
      );
    }
  }
}

// ============================================================
// CLEAN LIVE SWEEP STATE
// ============================================================

function cleanupLiveSweepState() {
  const now =
    Date.now();

  const maxAge =
    24 *
    60 *
    60 *
    1000;

  for (
    const [
      key,
      timestamp,
    ] of liveSweepSeen
  ) {
    if (
      now -
        Number(
          timestamp
        ) >
        maxAge
    ) {
      liveSweepSeen.delete(
        key
      );
    }
  }

  if (
    liveSweepSeen.size >
    10000
  ) {
    const entries =
      Array.from(
        liveSweepSeen.entries()
      );

    entries.sort(
      (a, b) =>
        Number(
          a[1]
        ) -
        Number(
          b[1]
        )
    );

    const removeCount =
      entries.length -
      7000;

    for (
      let i = 0;
      i < removeCount;
      i++
    ) {
      liveSweepSeen.delete(
        entries[i][0]
      );
    }
  }
}

// ============================================================
// SCAN ALL CLOSED CANDLES
// ============================================================
//
// Timeframe priority:
//
//   5m
//   15m
//   1h
//   4h
//   1d
//
// The polling interval DOES NOT determine candle timing.
//
// MEXC candle open time + timeframe duration determines
// the exact candle close.
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
    await refreshSymbols();

    const timeframes =
      Object.keys(
        TIMEFRAMES
      );

    for (
      const timeframe of
      timeframes
    ) {
      for (
        const market of
        MARKET_TYPES
      ) {
        const symbols =
          cachedSymbols.get(
            market
          ) || [];

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
    }

    cleanupProcessedCandles();
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
//
// IMPORTANT:
//
// This function must be imported by ready.js:
//
//   import { startCRTMonitor } from '../services/crt/crtService.js';
//
// Then:
//
//   startCRTMonitor(client);
//
// ============================================================

export function startCRTMonitor(
  client
) {
  // ==========================================================
  // PREVENT MULTIPLE MONITORS
  // ==========================================================

  if (
    monitorStarted
  ) {
    console.warn(
      '[CRT] Monitor already started.'
    );

    return;
  }

  // ==========================================================
  // CONFIG CHECK
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

  console.log(
    '[CRT] Monitor started.'
  );

  console.log(
    '[CRT] PRIMARY SIGNAL: Rachel T Fractal + CRT Confirmation'
  );

  console.log(
    `[CRT] Markets: ${MARKET_TYPES.join(
      ', '
    )}`
  );

  console.log(
    `[CRT] Timeframes: ${Object.keys(
      TIMEFRAMES
    ).join(', ')}`
  );

  console.log(
    `[CRT] Poll interval: ${SCAN_INTERVAL}ms`
  );

  console.log(
    `[CRT] Live liquidity interval: ${LIVE_LIQUIDITY_INTERVAL}ms`
  );

  console.log(
    `[CRT] Max symbols/market: ${MAX_SYMBOLS}`
  );

  console.log(
    `[CRT] Kline history: ${KLINE_LIMIT} candles`
  );

  console.log(
    `[CRT] Auto symbols: ${AUTO_SYMBOLS}`
  );

  console.log(
    '[CRT] LIVE LIQUIDITY DISPLAY: 🚨 YELLOW'
  );

  console.log(
    '[CRT] LIVE LIQUIDITY LABEL: LIQUIDITY SWEPT'
  );

  // ==========================================================
  // PRINT EXACT TIMEFRAME DURATIONS
  // ==========================================================

  for (
    const timeframe of
    Object.keys(
      TIMEFRAMES
    )
  ) {
    const duration =
      getTimeframeMs(
        timeframe
      );

    console.log(
      `[CRT] ${timeframe} candle duration: ${
        duration / 60000
      } minutes`
    );
  }

  // ==========================================================
  // INITIAL CLOSED-CANDLE SCAN
  // ==========================================================

  void scanAll(
    client
  );

  // ==========================================================
  // CLOSED-CANDLE MONITOR
  // ==========================================================
  //
  // This timer only polls.
  //
  // It does NOT decide when a candle closes.
  //
  // Exact closure is calculated using:
  //
  //   candleOpenTime + timeframeDuration
  //
  // ==========================================================

  setInterval(
    () =>
      void scanAll(
        client
      ),
    SCAN_INTERVAL
  );

  // ==========================================================
  // LIVE LIQUIDITY MONITOR
  // ==========================================================
  //
  // This intentionally watches the CURRENT running candle.
  //
  // Therefore a liquidity sweep can appear before CRT
  // confirmation.
  //
  // ==========================================================

  setInterval(
    () =>
      void scanLiveLiquidity(
        client
      ),
    LIVE_LIQUIDITY_INTERVAL
  );

  // ==========================================================
  // PERIODIC MEMORY CLEANUP
  // ==========================================================

  setInterval(
    () => {
      cleanupProcessedCandles();
      cleanupLiveSweepState();
    },
    10 *
      60 *
      1000
  );
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

  await scanAll(
    client
  );
}

// ============================================================
// MANUAL LIVE LIQUIDITY SCAN
// ============================================================

export async function scanLiquidityNow(
  client
) {
  if (
    !client
  ) {
    throw new Error(
      'Discord client is required for liquidity scan'
    );
  }

  await scanLiveLiquidity(
    client
  );
}

// ============================================================
// CRT CONFIG
// ============================================================

export function getCRTConfig() {
  return {
    markets:
      MARKET_TYPES,

    timeframes:
      Object.keys(
        TIMEFRAMES
      ),

    timeframeDurations:
      Object.fromEntries(
        Object.keys(
          TIMEFRAMES
        ).map(
          (timeframe) => [
            timeframe,
            getTimeframeMs(
              timeframe
            ),
          ]
        )
      ),

    scanInterval:
      SCAN_INTERVAL,

    liveLiquidityInterval:
      LIVE_LIQUIDITY_INTERVAL,

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
      'RSI',
    ],

    liveSignal:
      'RACHEL_T_LIQUIDITY_SWEEP',

    liveSignalDisplay: {
      emoji:
        '🚨',

      color:
        'YELLOW',

      hex:
        0xfee75c,

      label:
        'LIQUIDITY SWEPT',
    },

    candleTimingAuthority:
      'MEXC',

    exactCloseTiming:
      true,
  };
}

// ============================================================
// SERVICE LOADED
// ============================================================

console.log(
  `[CRT] Service loaded • Rachel T Fractal PRIMARY • ${Object.keys(
    TIMEFRAMES
  ).join(', ')}`
);

console.log(
  '[CRT] Exact MEXC candle-close timing enabled.'
);

console.log(
  '[CRT] Live Liquidity: 🚨 YELLOW • LIQUIDITY SWEPT'
);

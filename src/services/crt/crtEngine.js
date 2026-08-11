// ============================================================
// PDYN CRT ENGINE
// ============================================================
//
// PDYN Rachel T Fractal / CRT Engine
//
// DATA SOURCE:
//   MEXC FUTURES OHLC
//
// PRIMARY LOGIC:
//   Rachel T Filtered Top / Bottom Fractal
//
// IMPORTANT TIMEFRAME RULE:
//
//   EACH TIMEFRAME IS COMPLETELY INDEPENDENT.
//
//   5m  -> 5m candles  -> 5m fractal  -> 5m signal channel
//   15m -> 15m candles -> 15m fractal -> 15m signal channel
//   30m -> 30m candles -> 30m fractal -> 30m signal channel
//   1h  -> 1h candles  -> 1h fractal  -> 1h signal channel
//   4h  -> 4h candles  -> 4h fractal  -> 4h signal channel
//   1d  -> 1d candles  -> 1d fractal  -> 1d signal channel
//
// A confirmed 15m fractal MUST NOT be blocked because
// there is no new 1h / 4h / 1d fractal.
//
// MARKET STRUCTURE:
//   Separate analysis only.
//
// IMPORTANT:
//   Market structure MUST NOT replace the latest confirmed
//   Rachel T fractal used for the signal.
//
// FRACTAL:
//   Pivot = [2]
//
// CONFIRMATION:
//
//   Pivot candle = [2]
//   First candle after pivot = [1]
//   Second candle after pivot = [0]
//
//   Both confirmation candles MUST be CLOSED.
//
// ============================================================

// ============================================================
// RSI
// ============================================================

import {
  calculateRSI,
  getRSIState,
} from './rsi.js';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_RSI_PERIOD = 14;

const DEFAULT_OVERSOLD = 30;

const DEFAULT_OVERBOUGHT = 70;

const DEFAULT_TIMEFRAME = '5m';

// ============================================================
// SUPPORTED PDYN CRT TIMEFRAMES
// ============================================================
//
// IMPORTANT:
//
// These are intentionally locked to the timeframes used by
// the PDYN CRT monitor.
//
// Do NOT add arbitrary timeframes here unless the MEXC
// service and CRT monitor are also configured for them.
//
// ============================================================

const TIMEFRAME_MS = {
  '5m': 5 * 60 * 1000,

  '15m': 15 * 60 * 1000,

  '30m': 30 * 60 * 1000,

  '1h': 60 * 60 * 1000,

  '4h': 4 * 60 * 60 * 1000,

  '1d': 24 * 60 * 60 * 1000,
};

// ============================================================
// SUPPORTED TIMEFRAMES
// ============================================================

const SUPPORTED_TIMEFRAMES = [
  '5m',
  '15m',
  '30m',
  '1h',
  '4h',
  '1d',
];

// ============================================================
// NUMBER
// ============================================================

function number(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

// ============================================================
// TIMESTAMP NORMALIZER
// ============================================================
//
// MEXC timestamps may arrive in seconds.
//
// PDYN internally uses milliseconds.
//
// ============================================================

function normalizeTimestamp(value) {
  if (value instanceof Date) {
    const time = value.getTime();

    return Number.isFinite(time)
      ? time
      : null;
  }

  const n = Number(value);

  if (!Number.isFinite(n)) {
    return null;
  }

  // Unix seconds -> milliseconds.
  if (
    n > 0 &&
    n < 100000000000
  ) {
    return n * 1000;
  }

  return n;
}

// ============================================================
// CANDLE OPEN TIME
// ============================================================

function getCandleTime(candle) {
  if (!candle) {
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

function getCandleCloseTime(candle) {
  if (!candle) {
    return null;
  }

  return normalizeTimestamp(
    candle.closeTime ??
    candle.endTime ??
    candle.closeTimestamp ??
    null
  );
}

// ============================================================
// TIMEFRAME NORMALIZER
// ============================================================

function normalizeTimeframe(timeframe) {
  if (!timeframe) {
    return DEFAULT_TIMEFRAME;
  }

  const value = String(timeframe)
    .trim()
    .toLowerCase();

  const aliases = {

    // --------------------------------------------------------
    // 5M
    // --------------------------------------------------------

    '5': '5m',
    '5m': '5m',
    '5min': '5m',
    '5mins': '5m',
    '5minute': '5m',
    '5minutes': '5m',

    // --------------------------------------------------------
    // 15M
    // --------------------------------------------------------

    '15': '15m',
    '15m': '15m',
    '15min': '15m',
    '15mins': '15m',
    '15minute': '15m',
    '15minutes': '15m',

    // --------------------------------------------------------
    // 30M
    // --------------------------------------------------------

    '30': '30m',
    '30m': '30m',
    '30min': '30m',
    '30mins': '30m',
    '30minute': '30m',
    '30minutes': '30m',

    // --------------------------------------------------------
    // 1H
    // --------------------------------------------------------

    '60': '1h',
    '60m': '1h',
    '1h': '1h',
    '1hr': '1h',
    '1hour': '1h',

    // --------------------------------------------------------
    // 4H
    // --------------------------------------------------------

    '240': '4h',
    '240m': '4h',
    '4h': '4h',
    '4hr': '4h',
    '4hour': '4h',

    // --------------------------------------------------------
    // DAILY
    // --------------------------------------------------------

    '1440': '1d',
    '1440m': '1d',
    '1d': '1d',
    '1day': '1d',
    'daily': '1d',
    'day': '1d',
  };

  return aliases[value] ?? value;
}

// ============================================================
// ASSERT SUPPORTED TIMEFRAME
// ============================================================

function assertSupportedTimeframe(timeframe) {
  const normalized =
    normalizeTimeframe(timeframe);

  if (
    !TIMEFRAME_MS[
      normalized
    ]
  ) {
    throw new Error(
      `Unsupported PDYN CRT timeframe: ${timeframe}`
    );
  }

  return normalized;
}

// ============================================================
// TIMEFRAME MILLISECONDS
// ============================================================

function getTimeframeMs(timeframe) {
  const normalized =
    normalizeTimeframe(timeframe);

  return (
    TIMEFRAME_MS[
      normalized
    ] ?? null
  );
}

// ============================================================
// VALID OHLC
// ============================================================

function hasValidOHLC(candle) {
  if (!candle) {
    return false;
  }

  return (
    number(candle.open) !== null &&
    number(candle.high) !== null &&
    number(candle.low) !== null &&
    number(candle.close) !== null
  );
}

// ============================================================
// IS CANDLE CLOSED
// ============================================================
//
// PRIORITY:
//
// 1. MEXC normalized closed=true
// 2. MEXC normalized closed=false
// 3. Explicit closeTime
// 4. openTime + timeframe duration
//
// IMPORTANT:
//
// No Asia/Manila calculation is performed here.
//
// The MEXC candle timestamp is authoritative.
//
// ============================================================

function isCandleClosed(
  candle,
  timeframe,
  now = Date.now()
) {
  if (!candle) {
    return false;
  }

  // ----------------------------------------------------------
  // MEXC normalized state.
  // ----------------------------------------------------------

  if (candle.closed === true) {
    return true;
  }

  if (candle.closed === false) {
    return false;
  }

  // ----------------------------------------------------------
  // Explicit MEXC close time.
  // ----------------------------------------------------------

  const closeTime =
    getCandleCloseTime(candle);

  if (closeTime !== null) {
    return closeTime <= now;
  }

  // ----------------------------------------------------------
  // Fallback to MEXC candle OPEN timestamp.
  //
  // This is only a fallback.
  // No local timezone is involved.
  // ----------------------------------------------------------

  const openTime =
    getCandleTime(candle);

  const timeframeMs =
    getTimeframeMs(timeframe);

  if (
    openTime === null ||
    timeframeMs === null
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
// CLOSED CANDLES ONLY
// ============================================================

export function getClosedCandles(
  candles,
  timeframe = DEFAULT_TIMEFRAME,
  now = Date.now()
) {
  if (!Array.isArray(candles)) {
    return [];
  }

  const normalizedTimeframe =
    assertSupportedTimeframe(
      timeframe
    );

  const result = [];

  // ----------------------------------------------------------
  // Keep ONLY fully closed candles.
  // ----------------------------------------------------------

  for (const candle of candles) {

    if (
      !hasValidOHLC(candle)
    ) {
      continue;
    }

    if (
      !isCandleClosed(
        candle,
        normalizedTimeframe,
        now
      )
    ) {
      continue;
    }

    result.push(candle);
  }

  // ----------------------------------------------------------
  // Chronological order.
  // ----------------------------------------------------------

  result.sort(
    (a, b) =>
      (getCandleTime(a) ?? 0) -
      (getCandleTime(b) ?? 0)
  );

  // ----------------------------------------------------------
  // Remove duplicate candle OPEN timestamps.
  // ----------------------------------------------------------

  const unique = [];

  const seen = new Set();

  for (const candle of result) {

    const time =
      getCandleTime(candle);

    const key =
      time !== null
        ? String(time)
        : JSON.stringify(candle);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    unique.push(candle);
  }

  return unique;
}

// ============================================================
// CHRONOLOGY VALIDATION
// ============================================================

function validateChronology(candles) {
  if (!Array.isArray(candles)) {
    return false;
  }

  for (
    let i = 1;
    i < candles.length;
    i++
  ) {

    const previous =
      getCandleTime(
        candles[i - 1]
      );

    const current =
      getCandleTime(
        candles[i]
      );

    if (
      previous === null ||
      current === null
    ) {
      return false;
    }

    if (
      current <= previous
    ) {
      return false;
    }
  }

  return true;
}

// ============================================================
// RACHEL T FILTERED TOP
// ============================================================
//
// FIVE CANDLE STRUCTURE:
//
// [4] [3] [2] [1] [0]
//
// Pivot:
//
//             [2]
//              ↑
//           TOP
//
// Confirmation:
//
// [1] = first candle after pivot
// [0] = second candle after pivot
//
// The current array passed to this function MUST contain
// CLOSED candles only.
//
// ============================================================

export function isFilteredTopAt(
  candles,
  index
) {
  if (
    !Array.isArray(candles) ||
    index < 4 ||
    index >= candles.length
  ) {
    return false;
  }

  const h4 =
    number(
      candles[index - 4]?.high
    );

  const h3 =
    number(
      candles[index - 3]?.high
    );

  const h2 =
    number(
      candles[index - 2]?.high
    );

  const h1 =
    number(
      candles[index - 1]?.high
    );

  const h0 =
    number(
      candles[index]?.high
    );

  if (
    h4 === null ||
    h3 === null ||
    h2 === null ||
    h1 === null ||
    h0 === null
  ) {
    return false;
  }

  return (
    h4 < h2 &&
    h3 <= h2 &&
    h2 >= h1 &&
    h2 > h0
  );
}

// ============================================================
// RACHEL T FILTERED BOTTOM
// ============================================================
//
// FIVE CANDLE STRUCTURE:
//
// [4] [3] [2] [1] [0]
//
// Pivot:
//
//             [2]
//              ↓
//          BOTTOM
//
// ============================================================

export function isFilteredBottomAt(
  candles,
  index
) {
  if (
    !Array.isArray(candles) ||
    index < 4 ||
    index >= candles.length
  ) {
    return false;
  }

  const l4 =
    number(
      candles[index - 4]?.low
    );

  const l3 =
    number(
      candles[index - 3]?.low
    );

  const l2 =
    number(
      candles[index - 2]?.low
    );

  const l1 =
    number(
      candles[index - 1]?.low
    );

  const l0 =
    number(
      candles[index]?.low
    );

  if (
    l4 === null ||
    l3 === null ||
    l2 === null ||
    l1 === null ||
    l0 === null
  ) {
    return false;
  }

  return (
    l4 > l2 &&
    l3 >= l2 &&
    l2 <= l1 &&
    l2 < l0
  );
}

// ============================================================
// BUILD FRACTAL
// ============================================================

function buildFractal(
  type,
  candles,
  confirmationIndex
) {
  const pivotIndex =
    confirmationIndex - 2;

  const pivot =
    candles[pivotIndex];

  const confirmationCandle =
    candles[confirmationIndex];

  if (
    !pivot ||
    !confirmationCandle
  ) {
    return null;
  }

  const price =
    type === 'TOP'
      ? number(pivot.high)
      : number(pivot.low);

  if (price === null) {
    return null;
  }

  const pivotTime =
    getCandleTime(pivot);

  const confirmationTime =
    getCandleTime(
      confirmationCandle
    );

  if (
    pivotTime === null ||
    confirmationTime === null
  ) {
    return null;
  }

  if (
    confirmationTime <=
    pivotTime
  ) {
    return null;
  }

  // ----------------------------------------------------------
  // Explicitly ensure both confirmation candles are closed.
  //
  // Pivot [2]
  // First confirmation [1]
  // Second confirmation [0]
  // ----------------------------------------------------------

  const firstConfirmation =
    candles[
      confirmationIndex - 1
    ];

  const secondConfirmation =
    candles[
      confirmationIndex
    ];

  if (
    !firstConfirmation ||
    !secondConfirmation
  ) {
    return null;
  }

  return {
    type,

    fractalType:
      type === 'TOP'
        ? 'FILTERED TOP'
        : 'FILTERED BOTTOM',

    price,

    candle:
      pivot,

    pivotCandle:
      pivot,

    pivotIndex,

    firstConfirmationCandle:
      firstConfirmation,

    secondConfirmationCandle:
      secondConfirmation,

    confirmationCandle:
      secondConfirmation,

    confirmationIndex,

    pivotTime,

    confirmationTime,

    confirmationCandlesRequired: 2,

    confirmationCandlesClosed: 2,

    confirmed: true,
  };
}

// ============================================================
// FIND ALL CONFIRMED RACHEL T FRACTALS
// ============================================================
//
// IMPORTANT:
//
// This function works ONLY with the requested timeframe.
//
// It does not reference any other timeframe.
//
// ============================================================

export function findFractals(
  candles,
  timeframe = DEFAULT_TIMEFRAME,
  now = Date.now()
) {
  const normalizedTimeframe =
    assertSupportedTimeframe(
      timeframe
    );

  const closed =
    getClosedCandles(
      candles,
      normalizedTimeframe,
      now
    );

  if (
    closed.length < 5
  ) {
    return [];
  }

  if (
    !validateChronology(
      closed
    )
  ) {
    return [];
  }

  const fractals = [];

  // ----------------------------------------------------------
  // confirmationIndex represents [0].
  //
  // Pivot = confirmationIndex - 2
  //
  // Therefore:
  //
  // index 4:
  //
  // [4] [3] [2] [1] [0]
  //           PIVOT
  //
  // Both [1] and [0] are closed.
  // ----------------------------------------------------------

  for (
    let confirmationIndex = 4;
    confirmationIndex <
    closed.length;
    confirmationIndex++
  ) {

    // --------------------------------------------------------
    // FILTERED TOP
    // --------------------------------------------------------

    if (
      isFilteredTopAt(
        closed,
        confirmationIndex
      )
    ) {
      const fractal =
        buildFractal(
          'TOP',
          closed,
          confirmationIndex
        );

      if (fractal) {
        fractals.push(fractal);
      }
    }

    // --------------------------------------------------------
    // FILTERED BOTTOM
    // --------------------------------------------------------

    if (
      isFilteredBottomAt(
        closed,
        confirmationIndex
      )
    ) {
      const fractal =
        buildFractal(
          'BOTTOM',
          closed,
          confirmationIndex
        );

      if (fractal) {
        fractals.push(fractal);
      }
    }
  }

  // ----------------------------------------------------------
  // Chronological order.
  // ----------------------------------------------------------

  fractals.sort(
    (a, b) =>
      a.confirmationTime -
      b.confirmationTime
  );

  return fractals;
}

// ============================================================
// POTENTIAL FRACTALS
// ============================================================
//
// Informational only.
//
// NEVER considered a confirmed signal.
//
// ============================================================

export function findPotentialFractals(
  candles,
  timeframe = DEFAULT_TIMEFRAME,
  now = Date.now()
) {
  const normalizedTimeframe =
    assertSupportedTimeframe(
      timeframe
    );

  if (
    !Array.isArray(candles)
  ) {
    return [];
  }

  const closed =
    getClosedCandles(
      candles,
      normalizedTimeframe,
      now
    );

  if (
    closed.length < 4
  ) {
    return [];
  }

  const potential = [];

  const index =
    closed.length - 1;

  // ----------------------------------------------------------
  // TOP POTENTIAL
  // ----------------------------------------------------------

  if (
    index >= 3
  ) {

    const h3 =
      number(
        closed[index - 3]?.high
      );

    const h2 =
      number(
        closed[index - 2]?.high
      );

    const h1 =
      number(
        closed[index - 1]?.high
      );

    if (
      h3 !== null &&
      h2 !== null &&
      h1 !== null &&
      h3 < h2 &&
      h2 >= h1
    ) {
      potential.push({
        type: 'TOP',

        fractalType:
          'FILTERED TOP',

        price: h2,

        candle:
          closed[index - 2],

        pivotTime:
          getCandleTime(
            closed[index - 2]
          ),

        status:
          'POTENTIAL',

        confirmed: false,

        confirmationCandlesRequired: 2,

        confirmationCandlesClosed: 1,

        waitingFor:
          'SECOND CLOSED CONFIRMATION CANDLE',
      });
    }
  }

  // ----------------------------------------------------------
  // BOTTOM POTENTIAL
  // ----------------------------------------------------------

  if (
    index >= 3
  ) {

    const l3 =
      number(
        closed[index - 3]?.low
      );

    const l2 =
      number(
        closed[index - 2]?.low
      );

    const l1 =
      number(
        closed[index - 1]?.low
      );

    if (
      l3 !== null &&
      l2 !== null &&
      l1 !== null &&
      l3 > l2 &&
      l2 <= l1
    ) {
      potential.push({
        type: 'BOTTOM',

        fractalType:
          'FILTERED BOTTOM',

        price: l2,

        candle:
          closed[index - 2],

        pivotTime:
          getCandleTime(
            closed[index - 2]
          ),

        status:
          'POTENTIAL',

        confirmed: false,

        confirmationCandlesRequired: 2,

        confirmationCandlesClosed: 1,

        waitingFor:
          'SECOND CLOSED CONFIRMATION CANDLE',
      });
    }
  }

  return potential;
}

// ============================================================
// LATEST CONFIRMED FRACTAL
// ============================================================

export function getLatestFractal(
  candles,
  timeframe = DEFAULT_TIMEFRAME,
  now = Date.now()
) {
  const fractals =
    findFractals(
      candles,
      timeframe,
      now
    );

  return fractals.length
    ? fractals[
        fractals.length - 1
      ]
    : null;
}

// ============================================================
// SAME TYPE FRACTALS
// ============================================================

function getSameTypeFractals(
  fractals,
  type
) {
  return fractals.filter(
    (fractal) =>
      fractal.type === type
  );
}

// ============================================================
// PREVIOUS SAME TYPE FRACTAL
// ============================================================

function getPreviousSameTypeFractal(
  fractals,
  fractal
) {
  if (!fractal) {
    return null;
  }

  const sameType =
    getSameTypeFractals(
      fractals,
      fractal.type
    );

  const index =
    sameType.findIndex(
      (item) =>
        item.confirmationTime ===
        fractal.confirmationTime
    );

  if (
    index <= 0
  ) {
    return null;
  }

  return sameType[
    index - 1
  ];
}

// ============================================================
// MARKET STRUCTURE
// ============================================================
//
// IMPORTANT:
//
// Structure is ANALYSIS.
//
// It does NOT select the signal fractal.
//
// ============================================================

export function calculateMarketStructure(
  fractals
) {
  if (
    !Array.isArray(fractals) ||
    !fractals.length
  ) {
    return {
      marketStructure: 'NEUTRAL',

      structureType: 'NONE',

      latestTop: null,

      previousTop: null,

      latestBottom: null,

      previousBottom: null,
    };
  }

  const tops =
    getSameTypeFractals(
      fractals,
      'TOP'
    );

  const bottoms =
    getSameTypeFractals(
      fractals,
      'BOTTOM'
    );

  const latestTop =
    tops.length
      ? tops[tops.length - 1]
      : null;

  const previousTop =
    tops.length >= 2
      ? tops[tops.length - 2]
      : null;

  const latestBottom =
    bottoms.length
      ? bottoms[
          bottoms.length - 1
        ]
      : null;

  const previousBottom =
    bottoms.length >= 2
      ? bottoms[
          bottoms.length - 2
        ]
      : null;

  const higherHigh =
    Boolean(
      latestTop &&
      previousTop &&
      latestTop.price >
        previousTop.price
    );

  const lowerHigh =
    Boolean(
      latestTop &&
      previousTop &&
      latestTop.price <
        previousTop.price
    );

  const higherLow =
    Boolean(
      latestBottom &&
      previousBottom &&
      latestBottom.price >
        previousBottom.price
    );

  const lowerLow =
    Boolean(
      latestBottom &&
      previousBottom &&
      latestBottom.price <
        previousBottom.price
    );

  // ----------------------------------------------------------
  // FULL BULLISH
  // ----------------------------------------------------------

  if (
    higherHigh &&
    higherLow
  ) {
    return {
      marketStructure:
        'BULLISH',

      structureType:
        'HIGHER HIGH / HIGHER LOW',

      latestTop,

      previousTop,

      latestBottom,

      previousBottom,
    };
  }

  // ----------------------------------------------------------
  // FULL BEARISH
  // ----------------------------------------------------------

  if (
    lowerHigh &&
    lowerLow
  ) {
    return {
      marketStructure:
        'BEARISH',

      structureType:
        'LOWER HIGH / LOWER LOW',

      latestTop,

      previousTop,

      latestBottom,

      previousBottom,
    };
  }

  // ----------------------------------------------------------
  // PARTIAL BULLISH
  // ----------------------------------------------------------

  if (
    higherHigh ||
    higherLow
  ) {
    return {
      marketStructure:
        'BULLISH',

      structureType:
        higherHigh
          ? 'HIGHER HIGH'
          : 'HIGHER LOW',

      latestTop,

      previousTop,

      latestBottom,

      previousBottom,
    };
  }

  // ----------------------------------------------------------
  // PARTIAL BEARISH
  // ----------------------------------------------------------

  if (
    lowerHigh ||
    lowerLow
  ) {
    return {
      marketStructure:
        'BEARISH',

      structureType:
        lowerHigh
          ? 'LOWER HIGH'
          : 'LOWER LOW',

      latestTop,

      previousTop,

      latestBottom,

      previousBottom,
    };
  }

  return {
    marketStructure:
      'NEUTRAL',

    structureType:
      'NONE',

    latestTop,

    previousTop,

    latestBottom,

    previousBottom,
  };
}

// ============================================================
// STRUCTURE-ALIGNED FRACTAL
// ============================================================
//
// IMPORTANT:
//
// This function remains available for compatibility and
// analysis.
//
// IT IS NO LONGER USED TO CHOOSE THE PRIMARY SIGNAL FRACTAL.
//
// Primary signal fractal:
//
//     latestConfirmedFractal
//
// ============================================================

export function getStructureAlignedFractal(
  fractals,
  marketStructure
) {
  if (
    !Array.isArray(fractals) ||
    !fractals.length
  ) {
    return null;
  }

  const structure =
    String(
      marketStructure || ''
    ).toUpperCase();

  if (
    structure === 'BEARISH'
  ) {
    for (
      let i =
        fractals.length - 1;
      i >= 0;
      i--
    ) {
      if (
        fractals[i].type ===
        'TOP'
      ) {
        return fractals[i];
      }
    }
  }

  if (
    structure === 'BULLISH'
  ) {
    for (
      let i =
        fractals.length - 1;
      i >= 0;
      i--
    ) {
      if (
        fractals[i].type ===
        'BOTTOM'
      ) {
        return fractals[i];
      }
    }
  }

  return fractals[
    fractals.length - 1
  ];
}

// ============================================================
// FRACTAL LIQUIDITY
// ============================================================
//
// Latest confirmed SAME-TYPE fractal
// versus previous confirmed SAME-TYPE fractal.
//
// This is independent of CRT candle liquidity.
//
// ============================================================

export function detectFractalLiquiditySweep(
  fractals,
  latest = null
) {
  if (
    !Array.isArray(fractals) ||
    !fractals.length
  ) {
    return {
      swept: false,

      type: 'NONE',

      label: 'None',

      level: null,

      fractal: null,

      previousFractal: null,
    };
  }

  const latestFractal =
    latest ||
    fractals[
      fractals.length - 1
    ];

  const previousFractal =
    getPreviousSameTypeFractal(
      fractals,
      latestFractal
    );

  if (
    !previousFractal
  ) {
    return {
      swept: false,

      type: 'NONE',

      label: 'None',

      level: null,

      fractal:
        latestFractal,

      previousFractal:
        null,
    };
  }

  // ----------------------------------------------------------
  // TOP
  // ----------------------------------------------------------

  if (
    latestFractal.type ===
    'TOP'
  ) {
    if (
      latestFractal.price >
      previousFractal.price
    ) {
      return {
        swept: true,

        type: 'HIGH',

        label:
          'PREVIOUS FRACTAL HIGH SWEPT',

        level:
          previousFractal.price,

        fractal:
          latestFractal,

        previousFractal,
      };
    }

    return {
      swept: false,

      type: 'NONE',

      label: 'None',

      level:
        previousFractal.price,

      fractal:
        latestFractal,

      previousFractal,
    };
  }

  // ----------------------------------------------------------
  // BOTTOM
  // ----------------------------------------------------------

  if (
    latestFractal.type ===
    'BOTTOM'
  ) {
    if (
      latestFractal.price <
      previousFractal.price
    ) {
      return {
        swept: true,

        type: 'LOW',

        label:
          'PREVIOUS FRACTAL LOW SWEPT',

        level:
          previousFractal.price,

        fractal:
          latestFractal,

        previousFractal,
      };
    }

    return {
      swept: false,

      type: 'NONE',

      label: 'None',

      level:
        previousFractal.price,

      fractal:
        latestFractal,

      previousFractal,
    };
  }

  return {
    swept: false,

    type: 'NONE',

    label: 'None',

    level: null,

    fractal:
      latestFractal,

    previousFractal,
  };
}

// ============================================================
// DIRECTION
// ============================================================
//
// BOTTOM = BUY
// TOP    = SELL
//
// ============================================================

export function getDirection(
  fractal
) {
  if (!fractal) {
    return null;
  }

  if (
    fractal.type ===
    'BOTTOM'
  ) {
    return 'BUY';
  }

  if (
    fractal.type ===
    'TOP'
  ) {
    return 'SELL';
  }

  return null;
}

// ============================================================
// BODY RATIO
// ============================================================

export function getBodyRatio(
  candle
) {
  if (!candle) {
    return 0;
  }

  const open =
    number(candle.open);

  const high =
    number(candle.high);

  const low =
    number(candle.low);

  const close =
    number(candle.close);

  if (
    open === null ||
    high === null ||
    low === null ||
    close === null
  ) {
    return 0;
  }

  const range =
    high - low;

  if (
    range <= 0
  ) {
    return 0;
  }

  return (
    Math.abs(
      close - open
    ) /
    range
  );
}

// ============================================================
// CRT CANDLE CONFIRMATION
// ============================================================
//
// IMPORTANT:
//
// The CRT confirmation is evaluated against the
// ACTUAL LATEST CONFIRMED RACHEL T FRACTAL.
//
// BUY:
//
//   signal LOW < parent LOW
//   signal CLOSE returns inside parent range
//
// SELL:
//
//   signal HIGH > parent HIGH
//   signal CLOSE returns inside parent range
//
// ============================================================

export function confirmCRTCandle(
  fractal,
  candles,
  options = {}
) {
  if (
    !fractal ||
    !Array.isArray(candles)
  ) {
    return {
      confirmed: false,

      reason:
        'Missing fractal or candles.',
    };
  }

  const confirmationIndex =
    Number(
      fractal.confirmationIndex
    );

  if (
    !Number.isInteger(
      confirmationIndex
    ) ||
    confirmationIndex <= 0 ||
    confirmationIndex >=
      candles.length
  ) {
    return {
      confirmed: false,

      reason:
        'Invalid CRT confirmation candle index.',
    };
  }

  const signalCandle =
    candles[
      confirmationIndex
    ];

  const parentCandle =
    candles[
      confirmationIndex - 1
    ];

  if (
    !signalCandle ||
    !parentCandle
  ) {
    return {
      confirmed: false,

      reason:
        'Missing CRT candle or parent candle.',
    };
  }

  const signalOpen =
    number(
      signalCandle.open
    );

  const signalHigh =
    number(
      signalCandle.high
    );

  const signalLow =
    number(
      signalCandle.low
    );

  const signalClose =
    number(
      signalCandle.close
    );

  const parentHigh =
    number(
      parentCandle.high
    );

  const parentLow =
    number(
      parentCandle.low
    );

  if (
    signalOpen === null ||
    signalHigh === null ||
    signalLow === null ||
    signalClose === null ||
    parentHigh === null ||
    parentLow === null
  ) {
    return {
      confirmed: false,

      reason:
        'Invalid CRT candle OHLC.',
    };
  }

  const direction =
    getDirection(fractal);

  const bodyRatio =
    getBodyRatio(
      signalCandle
    );

  const requireCloseInside =
    options.requireCloseInside !==
    false;

  const useCloseDirection =
    options.useCloseDirection ===
    true;

  const minBodyRatio =
    Math.max(
      0,
      Number(
        options.minBodyRatio ?? 0
      )
    );

  // ----------------------------------------------------------
  // BUY
  // ----------------------------------------------------------

  if (
    direction === 'BUY'
  ) {
    const sweptLow =
      signalLow <
      parentLow;

    const closedInside =
      signalClose >=
        parentLow &&
      signalClose <=
        parentHigh;

    const bullishClose =
      signalClose >=
      signalOpen;

    if (!sweptLow) {
      return {
        confirmed: false,

        reason:
          'BUY CRT: LOW not swept.',

        direction,

        signalCandle,

        parentCandle,

        sweptLow: false,

        sweptHigh: false,

        closedInside,

        bodyRatio,
      };
    }

    if (
      requireCloseInside &&
      !closedInside
    ) {
      return {
        confirmed: false,

        reason:
          'BUY CRT: close did not return inside parent range.',

        direction,

        signalCandle,

        parentCandle,

        sweptLow: true,

        sweptHigh: false,

        closedInside: false,

        bodyRatio,
      };
    }

    if (
      useCloseDirection &&
      !bullishClose
    ) {
      return {
        confirmed: false,

        reason:
          'BUY CRT: close direction failed.',

        direction,

        signalCandle,

        parentCandle,

        sweptLow: true,

        sweptHigh: false,

        closedInside,

        bodyRatio,
      };
    }

    if (
      bodyRatio <
      minBodyRatio
    ) {
      return {
        confirmed: false,

        reason:
          'BUY CRT: body ratio below minimum.',

        direction,

        signalCandle,

        parentCandle,

        sweptLow: true,

        sweptHigh: false,

        closedInside,

        bodyRatio,
      };
    }

    return {
      confirmed: true,

      reason:
        'BUY CRT conditions confirmed.',

      direction,

      signalCandle,

      parentCandle,

      sweptLow: true,

      sweptHigh: false,

      closedInside,

      bodyRatio,

      parentHigh,

      parentLow,
    };
  }

  // ----------------------------------------------------------
  // SELL
  // ----------------------------------------------------------

  if (
    direction === 'SELL'
  ) {
    const sweptHigh =
      signalHigh >
      parentHigh;

    const closedInside =
      signalClose <=
        parentHigh &&
      signalClose >=
        parentLow;

    const bearishClose =
      signalClose <=
      signalOpen;

    if (!sweptHigh) {
      return {
        confirmed: false,

        reason:
          'SELL CRT: HIGH not swept.',

        direction,

        signalCandle,

        parentCandle,

        sweptLow: false,

        sweptHigh: false,

        closedInside,

        bodyRatio,
      };
    }

    if (
      requireCloseInside &&
      !closedInside
    ) {
      return {
        confirmed: false,

        reason:
          'SELL CRT: close did not return inside parent range.',

        direction,

        signalCandle,

        parentCandle,

        sweptLow: false,

        sweptHigh: true,

        closedInside: false,

        bodyRatio,
      };
    }

    if (
      useCloseDirection &&
      !bearishClose
    ) {
      return {
        confirmed: false,

        reason:
          'SELL CRT: close direction failed.',

        direction,

        signalCandle,

        parentCandle,

        sweptLow: false,

        sweptHigh: true,

        closedInside,

        bodyRatio,
      };
    }

    if (
      bodyRatio <
      minBodyRatio
    ) {
      return {
        confirmed: false,

        reason:
          'SELL CRT: body ratio below minimum.',

        direction,

        signalCandle,

        parentCandle,

        sweptLow: false,

        sweptHigh: true,

        closedInside,

        bodyRatio,
      };
    }

    return {
      confirmed: true,

      reason:
        'SELL CRT conditions confirmed.',

      direction,

      signalCandle,

      parentCandle,

      sweptLow: false,

      sweptHigh: true,

      closedInside,

      bodyRatio,

      parentHigh,

      parentLow,
    };
  }

  return {
    confirmed: false,

    reason:
      'Unable to determine direction.',
  };
}

// ============================================================
// STANDARD DEVIATION
// ============================================================

export function calculateStdDeviation(
  candles
) {
  if (
    !Array.isArray(candles)
  ) {
    return null;
  }

  const values =
    candles
      .map(
        (candle) =>
          number(
            candle.close
          )
      )
      .filter(
        (value) =>
          value !== null
      );

  if (
    !values.length
  ) {
    return null;
  }

  const mean =
    values.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    values.length;

  const variance =
    values.reduce(
      (sum, value) =>
        sum +
        Math.pow(
          value - mean,
          2
        ),
      0
    ) /
    values.length;

  return Math.sqrt(
    variance
  );
}

// ============================================================
// CONFIRMED FRACTAL CHECK
// ============================================================

function isConfirmedFractal(
  fractal,
  candles
) {
  if (
    !fractal ||
    !Array.isArray(candles)
  ) {
    return false;
  }

  if (
    !Number.isInteger(
      fractal.pivotIndex
    ) ||
    !Number.isInteger(
      fractal.confirmationIndex
    )
  ) {
    return false;
  }

  if (
    fractal.pivotIndex !==
    fractal.confirmationIndex - 2
  ) {
    return false;
  }

  if (
    fractal.confirmationIndex >=
    candles.length
  ) {
    return false;
  }

  if (
    fractal.confirmed !==
    true
  ) {
    return false;
  }

  // ----------------------------------------------------------
  // Verify the two confirmation candles are actually closed.
  // ----------------------------------------------------------

  const first =
    candles[
      fractal.confirmationIndex - 1
    ];

  const second =
    candles[
      fractal.confirmationIndex
    ];

  if (
    !first ||
    !second
  ) {
    return false;
  }

  return (
    first.closed !== false &&
    second.closed !== false
  );
}

// ============================================================
// BUILD SIGNAL
// ============================================================
//
// CRITICAL CHANGE:
//
// The signal is ALWAYS based on:
//
//     latestConfirmedFractal
//
// NOT:
//
//     structureAlignedFractal
//
// Market structure is calculated separately.
//
// ============================================================

export function buildSignal({
  symbol,

  market = 'futures',

  timeframe = DEFAULT_TIMEFRAME,

  candles,

  rsiPeriod =
    DEFAULT_RSI_PERIOD,

  oversold =
    DEFAULT_OVERSOLD,

  overbought =
    DEFAULT_OVERBOUGHT,

  crtOptions = {},
}) {

  // ==========================================================
  // TIMEFRAME
  // ==========================================================

  const normalizedTimeframe =
    assertSupportedTimeframe(
      timeframe
    );

  // ==========================================================
  // CLOSED CANDLES
  // ==========================================================

  const now =
    Date.now();

  const closed =
    getClosedCandles(
      candles,
      normalizedTimeframe,
      now
    );

  // ==========================================================
  // MINIMUM DATA
  // ==========================================================

  const minimumCandles =
    Math.max(
      30,
      Number(rsiPeriod) + 10,
      5
    );

  if (
    closed.length <
    minimumCandles
  ) {
    return null;
  }

  // ==========================================================
  // CHRONOLOGY
  // ==========================================================

  if (
    !validateChronology(
      closed
    )
  ) {
    return null;
  }

  // ==========================================================
  // RACHEL T FRACTALS
  // ==========================================================

  const fractals =
    findFractals(
      closed,
      normalizedTimeframe,
      now
    );

  if (
    !fractals.length
  ) {
    return null;
  }

  // ==========================================================
  // LATEST CONFIRMED FRACTAL
  // ==========================================================
  //
  // THIS IS THE SIGNAL SOURCE.
  //
  // We do NOT replace it with an older fractal based on
  // market structure.
  //
  // ==========================================================

  const latestConfirmedFractal =
    fractals[
      fractals.length - 1
    ];

  if (
    !isConfirmedFractal(
      latestConfirmedFractal,
      closed
    )
  ) {
    return null;
  }

  // ==========================================================
  // MARKET STRUCTURE
  // ==========================================================
  //
  // Context only.
  //
  // Does NOT suppress the latest fractal.
  //
  // ==========================================================

  const structure =
    calculateMarketStructure(
      fractals
    );

  // ==========================================================
  // STRUCTURE-ALIGNED FRACTAL
  // ==========================================================
  //
  // Kept for display/compatibility only.
  //
  // IMPORTANT:
  //
  // displayFractal is NOT the signal source.
  //
  // ==========================================================

  const structureAlignedFractal =
    getStructureAlignedFractal(
      fractals,
      structure.marketStructure
    );

  // ==========================================================
  // PRIMARY SIGNAL FRACTAL
  // ==========================================================

  const signalFractal =
    latestConfirmedFractal;

  // ==========================================================
  // CRT CONFIRMATION
  // ==========================================================
  //
  // Evaluate CRT against the newest confirmed Rachel T
  // fractal on THIS timeframe.
  //
  // ==========================================================

  const crtConfirmation =
    confirmCRTCandle(
      signalFractal,
      closed,
      crtOptions
    );

  // ==========================================================
  // FRACTAL LIQUIDITY
  // ==========================================================

  const liquiditySweep =
    detectFractalLiquiditySweep(
      fractals,
      latestConfirmedFractal
    );

  // ==========================================================
  // RSI
  // ==========================================================

  const closes =
    closed.map(
      (candle) =>
        Number(
          candle.close
        )
    );

  const rsi =
    calculateRSI(
      closes,
      Number(rsiPeriod)
    );

  const rsiState =
    getRSIState(
      rsi,
      Number(oversold),
      Number(overbought)
    );

  // ==========================================================
  // STANDARD DEVIATION
  // ==========================================================

  const stdDeviation =
    calculateStdDeviation(
      closed
    );

  // ==========================================================
  // DIRECTION
  // ==========================================================

  const direction =
    getDirection(
      signalFractal
    );

  // ==========================================================
  // SIGNAL ID
  // ==========================================================
  //
  // VERY IMPORTANT:
  //
  // The ID is based on the actual latest confirmed fractal.
  //
  // Therefore:
  //
  // 08:00 15M fractal -> one ID
  // 08:15 15M fractal -> different ID
  //
  // Meanwhile an unchanged 1H fractal keeps the same ID.
  //
  // ==========================================================

  const id = [
    market,
    symbol,
    normalizedTimeframe,
    signalFractal.type,
    signalFractal.pivotTime,
    signalFractal.confirmationTime,
    signalFractal.price,
  ].join(':');

  // ==========================================================
  // RETURN
  // ==========================================================

  return {

    // --------------------------------------------------------
    // IDENTITY
    // --------------------------------------------------------

    id,

    symbol,

    market,

    timeframe:
      normalizedTimeframe,

    // --------------------------------------------------------
    // MARKET STRUCTURE
    // --------------------------------------------------------

    marketStructure:
      structure.marketStructure,

    structure:
      structure.marketStructure,

    market_structure:
      structure.marketStructure,

    structureType:
      structure.structureType,

    structureData:
      structure,

    // --------------------------------------------------------
    // PRIMARY FRACTAL
    // --------------------------------------------------------
    //
    // ALWAYS newest confirmed Rachel T fractal.
    //
    // --------------------------------------------------------

    latestConfirmedFractal,

    latestFractal:
      latestConfirmedFractal,

    signalFractal,

    fractal:
      signalFractal,

    fractalType:
      signalFractal.fractalType,

    fractalPrice:
      signalFractal.price,

    fractalConfirmed:
      true,

    confirmedFractal:
      true,

    // --------------------------------------------------------
    // STRUCTURE-ALIGNED FRACTAL
    //
    // Compatibility / informational only.
    // --------------------------------------------------------

    structureAlignedFractal,

    displayFractal:
      structureAlignedFractal,

    // --------------------------------------------------------
    // DIRECTION
    // --------------------------------------------------------

    direction,

    // --------------------------------------------------------
    // POTENTIAL / CRT
    // --------------------------------------------------------

    potentialCRT:
      crtConfirmation.confirmed,

    potentialCRTStatus:
      crtConfirmation.confirmed
        ? 'CONFIRMED'
        : 'NOT CONFIRMED',

    potentialCRTConfirmation:
      crtConfirmation,

    confirmed:
      crtConfirmation.confirmed,

    confirmedCRT:
      crtConfirmation.confirmed,

    crtConfirmed:
      crtConfirmation.confirmed,

    crtConfirmation,

    crtCandle:
      crtConfirmation
        .signalCandle ??
      null,

    crtParentCandle:
      crtConfirmation
        .parentCandle ??
      null,

    crtParentHigh:
      crtConfirmation
        .parentHigh ??
      null,

    crtParentLow:
      crtConfirmation
        .parentLow ??
      null,

    crtClosedInside:
      crtConfirmation
        .closedInside ??
      false,

    crtSweptLow:
      crtConfirmation
        .sweptLow ??
      false,

    crtSweptHigh:
      crtConfirmation
        .sweptHigh ??
      false,

    crtBodyRatio:
      crtConfirmation
        .bodyRatio ??
      0,

    // --------------------------------------------------------
    // LIQUIDITY
    // --------------------------------------------------------

    liquiditySweep,

    liquiditySwept:
      liquiditySweep.swept,

    liquidityType:
      liquiditySweep.type,

    liquidityLevel:
      liquiditySweep.level,

    previousConfirmedFractal:
      liquiditySweep
        .previousFractal ??
      null,

    previousFractal:
      liquiditySweep
        .previousFractal ??
      null,

    previousFractalPrice:
      liquiditySweep
        .previousFractal
        ?.price ??
      null,

    // --------------------------------------------------------
    // RSI
    // --------------------------------------------------------

    rsi,

    rsiState,

    // --------------------------------------------------------
    // STANDARD DEVIATION
    // --------------------------------------------------------

    stdDeviation,

    stdDev:
      stdDeviation,

    standardDeviation:
      stdDeviation,

    // --------------------------------------------------------
    // STRENGTH
    // --------------------------------------------------------

    strength:
      (
        direction === 'BUY' &&
        rsiState === 'OVERSOLD'
      ) ||
      (
        direction === 'SELL' &&
        rsiState === 'OVERBOUGHT'
      )
        ? 'STRONG'
        : 'STANDARD',

    // --------------------------------------------------------
    // FRACTAL TIMES
    // --------------------------------------------------------

    candleTime:
      signalFractal.pivotTime,

    pivotTime:
      signalFractal.pivotTime,

    confirmationTime:
      signalFractal.confirmationTime,

    crtCandleTime:
      getCandleTime(
        crtConfirmation
          .signalCandle
      ),

    // --------------------------------------------------------
    // PRICES
    // --------------------------------------------------------

    price:
      signalFractal.price,

    signalHigh:
      signalFractal.type === 'TOP'
        ? signalFractal.price
        : null,

    signalLow:
      signalFractal.type === 'BOTTOM'
        ? signalFractal.price
        : null,

    parentHigh:
      crtConfirmation.parentHigh ??
      null,

    parentLow:
      crtConfirmation.parentLow ??
      null,

    closedInside:
      crtConfirmation.closedInside ??
      false,

    // --------------------------------------------------------
    // COMPLETE FRACTAL HISTORY
    // --------------------------------------------------------

    confirmedFractals:
      fractals,

    // --------------------------------------------------------
    // TIMEFRAME DATA
    // --------------------------------------------------------

    timeframeMs:
      getTimeframeMs(
        normalizedTimeframe
      ),

    // --------------------------------------------------------
    // CLOSED CANDLE COUNT
    // --------------------------------------------------------

    closedCandleCount:
      closed.length,
  };
}

// ============================================================
// DETECT CRT
// ============================================================
//
// Compatibility helper.
//
// IMPORTANT:
//
// Uses latest confirmed Rachel T fractal directly.
//
// ============================================================

export function detectCRT(
  candles,
  options = {}
) {
  const timeframe =
    normalizeTimeframe(
      options.timeframe ??
      DEFAULT_TIMEFRAME
    );

  const closed =
    getClosedCandles(
      candles,
      timeframe,
      Date.now()
    );

  if (
    closed.length < 5
  ) {
    return null;
  }

  const fractals =
    findFractals(
      closed,
      timeframe,
      Date.now()
    );

  if (
    !fractals.length
  ) {
    return null;
  }

  // ----------------------------------------------------------
  // ALWAYS USE LATEST CONFIRMED FRACTAL.
  // ----------------------------------------------------------

  const latest =
    fractals[
      fractals.length - 1
    ];

  if (
    !isConfirmedFractal(
      latest,
      closed
    )
  ) {
    return null;
  }

  const structure =
    calculateMarketStructure(
      fractals
    );

  const structureAlignedFractal =
    getStructureAlignedFractal(
      fractals,
      structure.marketStructure
    );

  const crt =
    confirmCRTCandle(
      latest,
      closed,
      options
    );

  const liquidity =
    detectFractalLiquiditySweep(
      fractals,
      latest
    );

  return {

    // --------------------------------------------------------
    // CRT
    // --------------------------------------------------------

    confirmed:
      crt.confirmed,

    confirmedCRT:
      crt.confirmed,

    crtConfirmed:
      crt.confirmed,

    potentialCRT:
      crt.confirmed,

    // --------------------------------------------------------
    // DIRECTION
    // --------------------------------------------------------

    direction:
      getDirection(
        latest
      ),

    // --------------------------------------------------------
    // FRACTAL
    // --------------------------------------------------------

    fractalType:
      latest.fractalType,

    fractalPrice:
      latest.price,

    fractal:
      latest,

    signalFractal:
      latest,

    latestConfirmedFractal:
      latest,

    // --------------------------------------------------------
    // STRUCTURE ALIGNMENT
    //
    // INFORMATIONAL ONLY.
    // --------------------------------------------------------

    displayFractal:
      structureAlignedFractal,

    structureAlignedFractal,

    // --------------------------------------------------------
    // CANDLES
    // --------------------------------------------------------

    signal:
      crt.signalCandle ??
      null,

    parent:
      crt.parentCandle ??
      null,

    // --------------------------------------------------------
    // TIMES
    // --------------------------------------------------------

    candleTime:
      latest.pivotTime,

    confirmationTime:
      latest.confirmationTime,

    crtCandleTime:
      getCandleTime(
        crt.signalCandle
      ),

    // --------------------------------------------------------
    // CRT
    // --------------------------------------------------------

    crtConfirmation:
      crt,

    // --------------------------------------------------------
    // LIQUIDITY
    // --------------------------------------------------------

    liquiditySweep:
      liquidity,

    liquiditySwept:
      liquidity.swept,

    previousFractal:
      liquidity.previousFractal ??
      null,

    previousFractalPrice:
      liquidity
        .previousFractal
        ?.price ??
      null,

    // --------------------------------------------------------
    // STRUCTURE
    // --------------------------------------------------------

    marketStructure:
      structure.marketStructure,

    structureType:
      structure.structureType,

    // --------------------------------------------------------
    // CRT PRICE LEVELS
    // --------------------------------------------------------

    parentHigh:
      crt.parentHigh ??
      null,

    parentLow:
      crt.parentLow ??
      null,

    signalHigh:
      latest.type === 'TOP'
        ? latest.price
        : null,

    signalLow:
      latest.type === 'BOTTOM'
        ? latest.price
        : null,

    closedInside:
      crt.closedInside ??
      false,

    sweptLow:
      crt.sweptLow ??
      false,

    sweptHigh:
      crt.sweptHigh ??
      false,

    // --------------------------------------------------------
    // TIMEFRAME
    // --------------------------------------------------------

    timeframe,
  };
}

// ============================================================
// TEST RACHEL T FRACTAL
// ============================================================

export function testRachelFractal(
  candles,
  timeframe = DEFAULT_TIMEFRAME
) {
  return getLatestFractal(
    candles,
    timeframe,
    Date.now()
  );
}

// ============================================================
// TEST LIQUIDITY
// ============================================================

export function testLiquidity(
  candles,
  timeframe = DEFAULT_TIMEFRAME
) {
  const closed =
    getClosedCandles(
      candles,
      timeframe,
      Date.now()
    );

  const fractals =
    findFractals(
      closed,
      timeframe,
      Date.now()
    );

  if (
    !fractals.length
  ) {
    return {
      latestConfirmedFractal:
        null,

      previousConfirmedFractal:
        null,

      liquiditySweep: {
        swept: false,

        type: 'NONE',

        label: 'None',

        level: null,
      },

      confirmedFractals: [],
    };
  }

  const latest =
    fractals[
      fractals.length - 1
    ];

  const liquidity =
    detectFractalLiquiditySweep(
      fractals,
      latest
    );

  return {
    latestConfirmedFractal:
      latest,

    previousConfirmedFractal:
      liquidity.previousFractal,

    liquiditySweep:
      liquidity,

    confirmedFractals:
      fractals,
  };
}

// ============================================================
// TEST MARKET ANALYSIS
// ============================================================

export function testMarketAnalysis(
  candles,
  timeframe = DEFAULT_TIMEFRAME
) {
  const normalizedTimeframe =
    assertSupportedTimeframe(
      timeframe
    );

  const closed =
    getClosedCandles(
      candles,
      normalizedTimeframe,
      Date.now()
    );

  if (
    closed.length < 20
  ) {
    return null;
  }

  const fractals =
    findFractals(
      closed,
      normalizedTimeframe,
      Date.now()
    );

  const latest =
    fractals.length
      ? fractals[
          fractals.length - 1
        ]
      : null;

  const structure =
    calculateMarketStructure(
      fractals
    );

  const structureAlignedFractal =
    getStructureAlignedFractal(
      fractals,
      structure.marketStructure
    );

  const liquidity =
    latest
      ? detectFractalLiquiditySweep(
          fractals,
          latest
        )
      : null;

  const crtConfirmation =
    latest
      ? confirmCRTCandle(
          latest,
          closed,
          {}
        )
      : null;

  const closes =
    closed.map(
      (candle) =>
        Number(
          candle.close
        )
    );

  const rsi =
    calculateRSI(
      closes,
      DEFAULT_RSI_PERIOD
    );

  const rsiState =
    getRSIState(
      rsi,
      DEFAULT_OVERSOLD,
      DEFAULT_OVERBOUGHT
    );

  const stdDeviation =
    calculateStdDeviation(
      closed
    );

  return {
    timeframe:
      normalizedTimeframe,

    confirmedFractals:
      fractals,

    latestConfirmedFractal:
      latest,

    // Primary signal fractal.
    signalFractal:
      latest,

    // Informational only.
    structureAlignedFractal,

    previousConfirmedFractal:
      liquidity
        ?.previousFractal ??
      null,

    liquiditySweep:
      liquidity,

    crtConfirmation,

    rsi,

    rsiState,

    standardDeviation:
      stdDeviation,

    stdDeviation,

    marketStructure:
      structure.marketStructure,

    structureType:
      structure.structureType,

    structureData:
      structure,
  };
}

// ============================================================
// TIMEFRAME HELPERS
// ============================================================

export function getTimeframeMilliseconds(
  timeframe
) {
  return getTimeframeMs(
    timeframe
  );
}

// ============================================================
// SUPPORTED TIMEFRAME CHECK
// ============================================================

export function isSupportedTimeframe(
  timeframe
) {
  const normalized =
    normalizeTimeframe(
      timeframe
    );

  return Boolean(
    TIMEFRAME_MS[
      normalized
    ]
  );
}

// ============================================================
// PUBLIC EXPORTS
// ============================================================

export {
  normalizeTimestamp,

  normalizeTimeframe,

  getTimeframeMs,

  getCandleTime,

  getCandleCloseTime,

  isCandleClosed,

  validateChronology,

  getPreviousSameTypeFractal,

  SUPPORTED_TIMEFRAMES,

  TIMEFRAME_MS,
};

// ============================================================
// ENGINE LOADED
// ============================================================

console.log(
  '[CRT ENGINE] Rachel T engine loaded.'
);

console.log(
  '[CRT ENGINE] MEXC Futures OHLC only.'
);

console.log(
  '[CRT ENGINE] Supported timeframes: 5m, 15m, 30m, 1h, 4h, 1d.'
);

console.log(
  '[CRT ENGINE] Pivot = [2].'
);

console.log(
  '[CRT ENGINE] Confirmation = 2 CLOSED candles.'
);

console.log(
  '[CRT ENGINE] Latest confirmed Rachel T fractal = PRIMARY SIGNAL FRACTAL.'
);

console.log(
  '[CRT ENGINE] Market structure = ANALYSIS ONLY.'
);

console.log(
  '[CRT ENGINE] Structure-aligned fractal DOES NOT replace the latest signal fractal.'
);

console.log(
  '[CRT ENGINE] Liquidity = latest confirmed fractal vs previous same-type fractal.'
);

console.log(
  '[CRT ENGINE] Active candles are rejected.'
);

console.log(
  '[CRT ENGINE] Each timeframe is evaluated independently.'
);

console.log(
  '[CRT ENGINE] 15m does not require a new 1h/4h/1d fractal.'
);

console.log(
  '[CRT ENGINE] 1h does not require a new 15m/4h/1d fractal.'
);

console.log(
  '[CRT ENGINE] 4h does not require a new 15m/1h/1d fractal.'
);

console.log(
  '[CRT ENGINE] Daily does not require a new lower-timeframe fractal.'
);

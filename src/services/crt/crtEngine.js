// ============================================================
// PDYN CRT ENGINE
// ============================================================
//
// PDYN Rachel T Fractal / CRT Engine
//
// DATA SOURCE:
//   MEXC FUTURES OHLC
//
// NO TRADINGVIEW API.
//
// PRIMARY LOGIC:
//   Rachel T Filtered Top / Bottom Fractal
//
// FRACTAL:
//   Pivot = [2]
//
// CONFIRMATION:
//   [1] = first candle after pivot
//   [0] = second candle after pivot
//
//   BOTH MUST BE CLOSED.
//
// LIQUIDITY:
//   ONLY CONFIRMED FRACTAL HISTORY.
//
//   Latest TOP
//       vs
//   Previous confirmed TOP
//
//   Latest BOTTOM
//       vs
//   Previous confirmed BOTTOM
//
// MARKET STRUCTURE:
//   Calculated from confirmed fractal history.
//
// STRUCTURE-ALIGNED FRACTAL:
//
//   BEARISH -> latest confirmed TOP
//   BULLISH -> latest confirmed BOTTOM
//   NEUTRAL -> latest confirmed fractal
//
// CRT:
//   Separate from fractal liquidity.
//
//   BUY / BOTTOM:
//      confirmation candle sweeps previous candle LOW
//      and closes back inside previous candle range
//
//   SELL / TOP:
//      confirmation candle sweeps previous candle HIGH
//      and closes back inside previous candle range
//
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

const TIMEFRAME_MS = {
  '1m': 60 * 1000,
  '3m': 3 * 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '2h': 2 * 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '8h': 8 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

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

  // Unix seconds -> milliseconds
  if (n > 0 && n < 100000000000) {
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
    '1': '1m',
    '1m': '1m',

    '3': '3m',
    '3m': '3m',

    '5': '5m',
    '5min': '5m',
    '5mins': '5m',
    '5minute': '5m',
    '5minutes': '5m',

    '15': '15m',
    '15min': '15m',
    '15mins': '15m',
    '15minute': '15m',
    '15minutes': '15m',

    '30': '30m',
    '30min': '30m',
    '30mins': '30m',
    '30minute': '30m',
    '30minutes': '30m',

    '60': '1h',
    '60m': '1h',
    '1h': '1h',
    '1hr': '1h',
    '1hour': '1h',

    '120': '2h',
    '120m': '2h',
    '2h': '2h',

    '240': '4h',
    '240m': '4h',
    '4h': '4h',
    '4hr': '4h',
    '4hour': '4h',

    '6h': '6h',
    '8h': '8h',
    '12h': '12h',

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
// TIMEFRAME MILLISECONDS
// ============================================================

function getTimeframeMs(timeframe) {
  return (
    TIMEFRAME_MS[
      normalizeTimeframe(timeframe)
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
// Priority:
//
// 1. explicit closed=true
// 2. explicit closed=false
// 3. closeTime
// 4. openTime + timeframe duration
//
// This is intentionally strict.
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

  if (candle.closed === true) {
    return true;
  }

  if (candle.closed === false) {
    return false;
  }

  const closeTime =
    getCandleCloseTime(candle);

  if (closeTime !== null) {
    return closeTime <= now;
  }

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

  const result = [];

  for (const candle of candles) {
    if (!hasValidOHLC(candle)) {
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

    result.push(candle);
  }

  // ----------------------------------------------------------
  // CHRONOLOGICAL ORDER
  // ----------------------------------------------------------

  result.sort(
    (a, b) =>
      (getCandleTime(a) ?? 0) -
      (getCandleTime(b) ?? 0)
  );

  // ----------------------------------------------------------
  // REMOVE DUPLICATES
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
// CHRONOLOGY
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
// Pivot = high[2]
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
// Pivot = low[2]
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

  return {
    type,

    fractalType:
      type === 'TOP'
        ? 'FILTERED TOP'
        : 'FILTERED BOTTOM',

    price,

    candle: pivot,

    pivotIndex,

    confirmationCandle,

    confirmationIndex,

    pivotTime,

    confirmationTime,

    confirmationCandlesRequired: 2,

    confirmationCandlesClosed: 2,

    confirmed: true,
  };
}

// ============================================================
// FIND ALL CONFIRMED FRACTALS
// ============================================================

export function findFractals(
  candles,
  timeframe = DEFAULT_TIMEFRAME,
  now = Date.now()
) {
  const closed =
    getClosedCandles(
      candles,
      timeframe,
      now
    );

  if (closed.length < 5) {
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
  // confirmationIndex is the second candle after pivot.
  // ----------------------------------------------------------

  for (
    let confirmationIndex = 4;
    confirmationIndex <
    closed.length;
    confirmationIndex++
  ) {
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
// This does NOT create a confirmed signal.
//
// It is only informational.
//
// ============================================================

export function findPotentialFractals(
  candles,
  timeframe = DEFAULT_TIMEFRAME,
  now = Date.now()
) {
  if (!Array.isArray(candles)) {
    return [];
  }

  const closed =
    getClosedCandles(
      candles,
      timeframe,
      now
    );

  if (closed.length < 4) {
    return [];
  }

  const potential = [];

  // ----------------------------------------------------------
  // A developing fractal can have one closed confirmation
  // candle after the pivot.
  //
  // We intentionally do NOT treat the active candle as a
  // confirmed candle.
  // ----------------------------------------------------------

  const index =
    closed.length - 1;

  // ----------------------------------------------------------
  // TOP potential
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

        confirmed:
          false,

        confirmationCandlesRequired:
          2,

        confirmationCandlesClosed:
          1,

        waitingFor:
          'SECOND CLOSED CONFIRMATION CANDLE',
      });
    }
  }

  // ----------------------------------------------------------
  // BOTTOM potential
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

        confirmed:
          false,

        confirmationCandlesRequired:
          2,

        confirmationCandlesClosed:
          1,

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
// PREVIOUS SAME TYPE
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

  return sameType[index - 1];
}

// ============================================================
// MARKET STRUCTURE
// ============================================================
//
// Structure is calculated from confirmed Rachel T fractals.
//
// TOP:
//   higher than previous TOP = HIGHER HIGH
//   lower than previous TOP  = LOWER HIGH
//
// BOTTOM:
//   higher than previous BOTTOM = HIGHER LOW
//   lower than previous BOTTOM  = LOWER LOW
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
      marketStructure:
        'NEUTRAL',

      structureType:
        'NONE',

      latestTop:
        null,

      previousTop:
        null,

      latestBottom:
        null,

      previousBottom:
        null,
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
  // FULL BULLISH STRUCTURE
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
  // FULL BEARISH STRUCTURE
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
// This is DIFFERENT from latestConfirmedFractal.
//
// BEARISH:
//   display latest TOP
//
// BULLISH:
//   display latest BOTTOM
//
// NEUTRAL:
//   display latest confirmed fractal
//
// This prevents the Discord Fractal field from showing a
// BOTTOM while the market structure is BEARISH.
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
    structure ===
    'BEARISH'
  ) {
    for (
      let i = fractals.length - 1;
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
    structure ===
    'BULLISH'
  ) {
    for (
      let i = fractals.length - 1;
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
// LIQUIDITY
// ============================================================
//
// IMPORTANT:
//
// Liquidity ALWAYS uses:
//
//   latest confirmed fractal
//              vs
//   previous confirmed SAME-TYPE fractal
//
// It does NOT use:
//
//   current candle wick
//   previous candle wick
//   CRT candle wick
//   current price
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
      previousFractal: null,
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
    fractal: latestFractal,
    previousFractal,
  };
}

// ============================================================
// DIRECTION
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

  if (range <= 0) {
    return 0;
  }

  return (
    Math.abs(close - open) /
    range
  );
}

// ============================================================
// CRT CANDLE CONFIRMATION
// ============================================================
//
// BUY / BOTTOM:
//
//   signal LOW < parent LOW
//   signal CLOSE inside parent range
//
// SELL / TOP:
//
//   signal HIGH > parent HIGH
//   signal CLOSE inside parent range
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
    number(signalCandle.open);

  const signalHigh =
    number(signalCandle.high);

  const signalLow =
    number(signalCandle.low);

  const signalClose =
    number(signalCandle.close);

  const parentHigh =
    number(parentCandle.high);

  const parentLow =
    number(parentCandle.low);

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
    direction ===
    'BUY'
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
    direction ===
    'SELL'
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
  if (!Array.isArray(candles)) {
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

  if (!values.length) {
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

  return (
    fractal.confirmed ===
    true
  );
}

// ============================================================
// BUILD SIGNAL
// ============================================================
//
// IMPORTANT:
//
// latestConfirmedFractal:
//   The actual newest Rachel T fractal.
//
// displayFractal:
//   Structure-aligned fractal.
//
// Liquidity:
//   ALWAYS uses latestConfirmedFractal.
//
// Potential CRT:
//   Evaluated against displayFractal.
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
  const normalizedTimeframe =
    normalizeTimeframe(
      timeframe
    );

  const closed =
    getClosedCandles(
      candles,
      normalizedTimeframe,
      Date.now()
    );

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

  if (
    !validateChronology(
      closed
    )
  ) {
    return null;
  }

  // ----------------------------------------------------------
  // ALL CONFIRMED FRACTALS
  // ----------------------------------------------------------

  const fractals =
    findFractals(
      closed,
      normalizedTimeframe,
      Date.now()
    );

  if (!fractals.length) {
    return null;
  }

  // ----------------------------------------------------------
  // LATEST CONFIRMED FRACTAL
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // MARKET STRUCTURE
  // ----------------------------------------------------------

  const structure =
    calculateMarketStructure(
      fractals
    );

  // ----------------------------------------------------------
  // STRUCTURE-ALIGNED FRACTAL
  // ----------------------------------------------------------

  const displayFractal =
    getStructureAlignedFractal(
      fractals,
      structure.marketStructure
    );

  if (!displayFractal) {
    return null;
  }

  // ----------------------------------------------------------
  // CRT FOR STRUCTURE-ALIGNED FRACTAL
  // ----------------------------------------------------------

  const crtConfirmation =
    confirmCRTCandle(
      displayFractal,
      closed,
      crtOptions
    );

  // ----------------------------------------------------------
  // LIQUIDITY
  //
  // IMPORTANT:
  //
  // This intentionally uses the latest confirmed fractal,
  // NOT displayFractal.
  //
  // ----------------------------------------------------------

  const liquiditySweep =
    detectFractalLiquiditySweep(
      fractals,
      latestConfirmedFractal
    );

  // ----------------------------------------------------------
  // RSI
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // STANDARD DEVIATION
  // ----------------------------------------------------------

  const stdDeviation =
    calculateStdDeviation(
      closed
    );

  // ----------------------------------------------------------
  // DIRECTION
  // ----------------------------------------------------------

  const direction =
    getDirection(
      displayFractal
    );

  // ----------------------------------------------------------
  // SIGNAL ID
  //
  // Based on the structure-aligned fractal.
  //
  // This prevents repeated Discord alerts.
  // ----------------------------------------------------------

  const id = [
    market,
    symbol,
    normalizedTimeframe,
    displayFractal.type,
    displayFractal.pivotTime,
    displayFractal.price,
  ].join(':');

  // ----------------------------------------------------------
  // RETURN SIGNAL
  // ----------------------------------------------------------

  return {
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

    // --------------------------------------------------------
    // LATEST ACTUAL CONFIRMED FRACTAL
    // --------------------------------------------------------

    latestConfirmedFractal,

    latestFractal:
      latestConfirmedFractal,

    // --------------------------------------------------------
    // STRUCTURE-ALIGNED FRACTAL
    // --------------------------------------------------------

    displayFractal,

    fractal:
      displayFractal,

    fractalType:
      displayFractal.fractalType,

    fractalPrice:
      displayFractal.price,

    // --------------------------------------------------------
    // DIRECTION
    // --------------------------------------------------------

    direction,

    // --------------------------------------------------------
    // FRACTAL CONFIRMATION
    // --------------------------------------------------------

    fractalConfirmed:
      true,

    confirmedFractal:
      true,

    // --------------------------------------------------------
    // POTENTIAL CRT
    // --------------------------------------------------------
    //
    // The field is called Potential CRT in Discord.
    //
    // Internally it remains explicit whether the actual CRT
    // condition passed.
    //
    // --------------------------------------------------------

    potentialCRT:
      crtConfirmation.confirmed,

    potentialCRTStatus:
      crtConfirmation.confirmed
        ? 'CONFIRMED'
        : 'NOT CONFIRMED',

    potentialCRTConfirmation:
      crtConfirmation,

    // Compatibility
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
    //
    // ALWAYS based on the latest actual confirmed fractal.
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
    // STD DEVIATION
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
        direction ===
          'BUY' &&
        rsiState ===
          'OVERSOLD'
      ) ||
      (
        direction ===
          'SELL' &&
        rsiState ===
          'OVERBOUGHT'
      )
        ? 'STRONG'
        : 'STANDARD',

    // --------------------------------------------------------
    // TIMES
    // --------------------------------------------------------

    candleTime:
      displayFractal.pivotTime,

    confirmationTime:
      displayFractal.confirmationTime,

    crtCandleTime:
      getCandleTime(
        crtConfirmation
          .signalCandle
      ),

    // --------------------------------------------------------
    // PRICE
    // --------------------------------------------------------

    price:
      displayFractal.price,

    signalHigh:
      displayFractal.type ===
      'TOP'
        ? displayFractal.price
        : null,

    signalLow:
      displayFractal.type ===
      'BOTTOM'
        ? displayFractal.price
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
    // STRUCTURE DATA
    // --------------------------------------------------------

    structureData:
      structure,
  };
}

// ============================================================
// DETECT CRT
// ============================================================
//
// Compatibility helper.
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

  if (!fractals.length) {
    return null;
  }

  const structure =
    calculateMarketStructure(
      fractals
    );

  const displayFractal =
    getStructureAlignedFractal(
      fractals,
      structure.marketStructure
    );

  if (!displayFractal) {
    return null;
  }

  const crt =
    confirmCRTCandle(
      displayFractal,
      closed,
      options
    );

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
    confirmed:
      crt.confirmed,

    confirmedCRT:
      crt.confirmed,

    crtConfirmed:
      crt.confirmed,

    potentialCRT:
      crt.confirmed,

    direction:
      getDirection(
        displayFractal
      ),

    fractalType:
      displayFractal.fractalType,

    fractalPrice:
      displayFractal.price,

    fractal:
      displayFractal,

    displayFractal,

    latestConfirmedFractal:
      latest,

    signal:
      crt.signalCandle ??
      null,

    parent:
      crt.parentCandle ??
      null,

    candleTime:
      displayFractal.pivotTime,

    confirmationTime:
      displayFractal.confirmationTime,

    crtCandleTime:
      getCandleTime(
        crt.signalCandle
      ),

    crtConfirmation:
      crt,

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

    marketStructure:
      structure.marketStructure,

    structureType:
      structure.structureType,

    parentHigh:
      crt.parentHigh ??
      null,

    parentLow:
      crt.parentLow ??
      null,

    signalHigh:
      displayFractal.type ===
      'TOP'
        ? displayFractal.price
        : null,

    signalLow:
      displayFractal.type ===
      'BOTTOM'
        ? displayFractal.price
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
  };
}

// ============================================================
// TEST RACHEL T
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

  if (!fractals.length) {
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
  const closed =
    getClosedCandles(
      candles,
      timeframe,
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
      timeframe,
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

  const displayFractal =
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
    displayFractal
      ? confirmCRTCandle(
          displayFractal,
          closed,
          {}
        )
      : null;

  const closes =
    closed.map(
      (candle) =>
        Number(candle.close)
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
    confirmedFractals:
      fractals,

    latestConfirmedFractal:
      latest,

    structureAlignedFractal:
      displayFractal,

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
  };
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
  '[CRT ENGINE] No TradingView API.'
);

console.log(
  '[CRT ENGINE] Pivot = [2].'
);

console.log(
  '[CRT ENGINE] Confirmation = 2 closed candles.'
);

console.log(
  '[CRT ENGINE] Liquidity = confirmed fractal vs previous same-type fractal.'
);

console.log(
  '[CRT ENGINE] Bearish display fractal = latest confirmed TOP.'
);

console.log(
  '[CRT ENGINE] Bullish display fractal = latest confirmed BOTTOM.'
);

console.log(
  '[CRT ENGINE] Potential CRT is separate from fractal liquidity.'
);

console.log(
  '[CRT ENGINE] Active candles are rejected.'
);

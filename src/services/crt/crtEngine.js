// ============================================================
// PDYN CRT ENGINE
// ============================================================
//
// PRIMARY SIGNAL:
//
//   Rachel T Filtered Top / Bottom Fractal
//
// DATA SOURCE:
//
//   MEXC FUTURES
//
// IMPORTANT:
//
//   This engine does NOT use TradingView API.
//   Rachel T fractals are calculated locally from OHLC candles.
//
// ============================================================
//
// RACHEL T FILTERED FRACTAL
//
// FILTERED TOP:
//
//   high[4] < high[2]
//   high[3] <= high[2]
//   high[2] >= high[1]
//   high[2] > high[0]
//
// FILTERED BOTTOM:
//
//   low[4] > low[2]
//   low[3] >= low[2]
//   low[2] <= low[1]
//   low[2] < low[0]
//
// FRACTAL PIVOT:
//
//   [2]
//
// CONFIRMATION:
//
//   [1] = first candle after pivot
//   [0] = second candle after pivot
//
//   BOTH candles must be CLOSED.
//
// ============================================================
//
// IMPORTANT SIGNAL FLOW:
//
//   MEXC FUTURES
//        ↓
//   CLOSED CANDLES ONLY
//        ↓
//   RACHEL T FRACTAL
//        ↓
//   2 CLOSED CANDLES
//        ↓
//   CONFIRMED FRACTAL
//        ↓
//   CRT CANDLE CONFIRMATION
//        ↓
//   SIGNAL
//
// ============================================================
//
// POTENTIAL FRACTAL:
//
//   A separate helper can identify a developing fractal,
//   but potential fractals NEVER produce confirmed signals.
//
// ============================================================
//
// LIQUIDITY:
//
//   ONLY confirmed Rachel T fractals.
//
//   Latest TOP
//       vs
//   previous confirmed TOP
//
//   Latest BOTTOM
//       vs
//   previous confirmed BOTTOM
//
//   TOP:
//
//      latest TOP > previous TOP
//         => previous fractal high swept
//
//   BOTTOM:
//
//      latest BOTTOM < previous BOTTOM
//         => previous fractal low swept
//
//   No current wick.
//   No previous candle wick.
//   No CRT wick.
//   No arbitrary liquidity level.
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

const STRUCTURE_FRACTALS = 3;

const DEFAULT_TIMEFRAME = '5m';

// ============================================================
// TIMEFRAME DURATIONS
// ============================================================
//
// MEXC candle timestamps are normally UTC-based.
// No timezone conversion is required.
//
// ============================================================

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
// NUMBER HELPER
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
// Supports:
//   milliseconds
//   seconds
//   Date
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

  // Unix seconds
  if (n > 0 && n < 100000000000) {
    return n * 1000;
  }

  return n;
}

// ============================================================
// CANDLE TIME
// ============================================================

function getCandleTime(candle) {
  if (!candle) {
    return null;
  }

  const raw =
    candle.openTime ??
    candle.time ??
    candle.timestamp ??
    candle.ts ??
    null;

  return normalizeTimestamp(raw);
}

// ============================================================
// CANDLE CLOSE TIME
// ============================================================

function getCandleCloseTime(candle) {
  if (!candle) {
    return null;
  }

  const raw =
    candle.closeTime ??
    candle.endTime ??
    candle.closeTimestamp ??
    null;

  return normalizeTimestamp(raw);
}

// ============================================================
// TIMEFRAME NORMALIZER
// ============================================================

function normalizeTimeframe(timeframe) {
  if (!timeframe) {
    return DEFAULT_TIMEFRAME;
  }

  const value =
    String(timeframe)
      .trim()
      .toLowerCase();

  const aliases = {
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
    '1hr': '1h',
    '1hour': '1h',

    '240': '4h',
    '240m': '4h',
    '4hr': '4h',
    '4hour': '4h',

    '1440': '1d',
    '1440m': '1d',
    '1day': '1d',
    'daily': '1d',
    'day': '1d',
  };

  return aliases[value] ?? value;
}

// ============================================================
// GET TIMEFRAME MILLISECONDS
// ============================================================

function getTimeframeMs(timeframe) {
  const normalized =
    normalizeTimeframe(
      timeframe
    );

  return (
    TIMEFRAME_MS[
      normalized
    ] ?? null
  );
}

// ============================================================
// IS MEXC CANDLE CLOSED
// ============================================================
//
// Priority:
//
// 1. Explicit closed === true
// 2. Explicit closed === false
// 3. Explicit closeTime
// 4. openTime + timeframe duration
//
// This prevents an active MEXC candle from being treated as
// confirmed merely because the candle object does not contain
// closed: false.
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

  if (
    candle.closed === true
  ) {
    return true;
  }

  if (
    candle.closed === false
  ) {
    return false;
  }

  const closeTime =
    getCandleCloseTime(
      candle
    );

  if (
    closeTime !== null
  ) {
    return closeTime <= now;
  }

  const openTime =
    getCandleTime(
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
    // IMPORTANT:
    //
    // If we cannot prove that the candle is closed,
    // reject it.
    //
    return false;
  }

  return (
    openTime +
      timeframeMs <=
    now
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
// CLOSED CANDLES ONLY
// ============================================================
//
// This is intentionally strict.
//
// The old implementation only rejected:
//
//   closed === false
//
// That was unsafe because an active candle may not have the
// property at all.
//
// Now a candle must be PROVABLY CLOSED.
//
// ============================================================

function getClosedCandles(
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

  // ==========================================================
  // CHRONOLOGICAL ORDER
  // ==========================================================

  result.sort(
    (a, b) => {
      const ta =
        getCandleTime(a) ?? 0;

      const tb =
        getCandleTime(b) ?? 0;

      return ta - tb;
    }
  );

  // ==========================================================
  // REMOVE DUPLICATE CANDLE TIMES
  // ==========================================================

  const unique = [];

  const seen = new Set();

  for (const candle of result) {
    const time =
      getCandleTime(
        candle
      );

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
// VALID CHRONOLOGICAL CANDLES
// ============================================================

function validateChronology(candles) {
  if (!Array.isArray(candles)) {
    return false;
  }

  if (candles.length < 2) {
    return true;
  }

  for (
    let i = 1;
    i < candles.length;
    i++
  ) {
    const previousTime =
      getCandleTime(
        candles[i - 1]
      );

    const currentTime =
      getCandleTime(
        candles[i]
      );

    if (
      previousTime === null ||
      currentTime === null
    ) {
      return false;
    }

    if (
      currentTime <=
      previousTime
    ) {
      return false;
    }
  }

  return true;
}

// ============================================================
// RACHEL T FILTERED TOP
// ============================================================

function isFilteredTopAt(
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
      candles[
        index - 4
      ]?.high
    );

  const h3 =
    number(
      candles[
        index - 3
      ]?.high
    );

  const h2 =
    number(
      candles[
        index - 2
      ]?.high
    );

  const h1 =
    number(
      candles[
        index - 1
      ]?.high
    );

  const h0 =
    number(
      candles[
        index
      ]?.high
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

function isFilteredBottomAt(
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
      candles[
        index - 4
      ]?.low
    );

  const l3 =
    number(
      candles[
        index - 3
      ]?.low
    );

  const l2 =
    number(
      candles[
        index - 2
      ]?.low
    );

  const l1 =
    number(
      candles[
        index - 1
      ]?.low
    );

  const l0 =
    number(
      candles[
        index
      ]?.low
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
// BUILD FRACTAL OBJECT
// ============================================================

function buildFractal(
  type,
  closed,
  confirmationIndex
) {
  const pivotIndex =
    confirmationIndex - 2;

  const pivot =
    closed[
      pivotIndex
    ];

  const confirmationCandle =
    closed[
      confirmationIndex
    ];

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

  if (
    price === null
  ) {
    return null;
  }

  const pivotTime =
    getCandleTime(
      pivot
    );

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

  // ==========================================================
  // THE CONFIRMATION CANDLE MUST ACTUALLY BE AFTER THE PIVOT
  // ==========================================================

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

    candle:
      pivot,

    pivotIndex,

    confirmationCandle,

    confirmationIndex,

    pivotTime,

    confirmationTime,

    // Explicit confirmation metadata.
    confirmationCandlesRequired:
      2,

    confirmationCandlesClosed:
      2,

    confirmed:
      true,
  };
}

// ============================================================
// FIND ALL CONFIRMED RACHEL T FRACTALS
// ============================================================
//
// Every returned fractal:
//
//   • uses closed candles only
//   • has a pivot at [2]
//   • has 2 closed candles after pivot
//
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

  for (
    let confirmationIndex = 4;
    confirmationIndex <
    closed.length;
    confirmationIndex++
  ) {
    // ========================================================
    // FILTERED TOP
    // ========================================================

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
        fractals.push(
          fractal
        );
      }
    }

    // ========================================================
    // FILTERED BOTTOM
    // ========================================================

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
        fractals.push(
          fractal
        );
      }
    }
  }

  // ==========================================================
  // CHRONOLOGICAL ORDER
  // ==========================================================

  fractals.sort(
    (a, b) =>
      Number(
        a.confirmationIndex
      ) -
      Number(
        b.confirmationIndex
      )
  );

  return fractals;
}

// ============================================================
// POTENTIAL FRACTALS
// ============================================================
//
// This function is ONLY for monitoring.
//
// It can identify a developing Rachel T pattern before the
// second confirmation candle has closed.
//
// IMPORTANT:
//
// It NEVER gets used by buildSignal().
//
// Therefore:
//
//   POTENTIAL != CONFIRMED
//
// ============================================================

export function findPotentialFractals(
  candles,
  timeframe = DEFAULT_TIMEFRAME,
  now = Date.now()
) {
  if (
    !Array.isArray(candles)
  ) {
    return [];
  }

  // ----------------------------------------------------------
  // Separate closed and active candles.
  // ----------------------------------------------------------

  const closed =
    getClosedCandles(
      candles,
      timeframe,
      now
    );

  const active =
    candles
      .filter(
        (candle) =>
          hasValidOHLC(candle) &&
          !isCandleClosed(
            candle,
            timeframe,
            now
          )
      )
      .sort(
        (a, b) =>
          (getCandleTime(a) ?? 0) -
          (getCandleTime(b) ?? 0)
      );

  if (
    closed.length < 4
  ) {
    return [];
  }

  const potential = [];

  // ==========================================================
  // CASE 1
  //
  // Four closed candles exist.
  //
  // Pivot is closed[1].
  //
  // We know:
  //
  //   [4] older information may exist
  //   [3] older
  //   [2] pivot
  //   [1] first confirmation
  //
  // But the second confirmation candle has NOT closed.
  //
  // If an active candle exists, inspect it as [0].
  // ==========================================================

  if (
    active.length > 0
  ) {
    const activeCandle =
      active[
        active.length - 1
      ];

    const working =
      [
        ...closed,
        activeCandle,
      ];

    if (
      working.length >= 5
    ) {
      const index =
        working.length - 1;

      if (
        isFilteredTopAt(
          working,
          index
        )
      ) {
        const pivot =
          working[
            index - 2
          ];

        potential.push({
          type:
            'TOP',

          fractalType:
            'FILTERED TOP',

          price:
            number(
              pivot.high
            ),

          candle:
            pivot,

          pivotTime:
            getCandleTime(
              pivot
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

          activeCandle:
            activeCandle,
        });
      }

      if (
        isFilteredBottomAt(
          working,
          index
        )
      ) {
        const pivot =
          working[
            index - 2
          ];

        potential.push({
          type:
            'BOTTOM',

          fractalType:
            'FILTERED BOTTOM',

          price:
            number(
              pivot.low
            ),

          candle:
            pivot,

          pivotTime:
            getCandleTime(
              pivot
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

          activeCandle:
            activeCandle,
        });
      }
    }
  }

  return potential;
}

// ============================================================
// GET LATEST CONFIRMED FRACTAL
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
// GET PREVIOUS SAME-TYPE FRACTALS
// ============================================================
//
// TOP only compares with TOP.
//
// BOTTOM only compares with BOTTOM.
//
// ============================================================

function getPreviousSameType(
  fractals,
  latest,
  count = STRUCTURE_FRACTALS
) {
  if (
    !latest ||
    !Array.isArray(fractals)
  ) {
    return [];
  }

  return fractals
    .filter(
      (fractal) =>
        fractal.type ===
          latest.type &&
        fractal.confirmationIndex <
          latest.confirmationIndex
    )
    .slice(-count);
}

// ============================================================
// MARKET STRUCTURE
// ============================================================

function calculateMarketStructure(
  fractals,
  latest
) {
  if (!latest) {
    return {
      marketStructure:
        'NEUTRAL',

      structureType:
        'NONE',

      structurePrice:
        null,
    };
  }

  const previous =
    getPreviousSameType(
      fractals,
      latest,
      STRUCTURE_FRACTALS
    );

  if (
    !previous.length
  ) {
    return {
      marketStructure:
        'NEUTRAL',

      structureType:
        'NONE',

      structurePrice:
        latest.price,
    };
  }

  const previousFractal =
    previous[
      previous.length - 1
    ];

  // ==========================================================
  // TOP
  // ==========================================================

  if (
    latest.type ===
    'TOP'
  ) {
    if (
      latest.price >
      previousFractal.price
    ) {
      return {
        marketStructure:
          'BULLISH',

        structureType:
          'HIGHER HIGH',

        structurePrice:
          latest.price,
      };
    }

    if (
      latest.price <
      previousFractal.price
    ) {
      return {
        marketStructure:
          'BEARISH',

        structureType:
          'LOWER HIGH',

        structurePrice:
          latest.price,
      };
    }
  }

  // ==========================================================
  // BOTTOM
  // ==========================================================

  if (
    latest.type ===
    'BOTTOM'
  ) {
    if (
      latest.price >
      previousFractal.price
    ) {
      return {
        marketStructure:
          'BULLISH',

        structureType:
          'HIGHER LOW',

        structurePrice:
          latest.price,
      };
    }

    if (
      latest.price <
      previousFractal.price
    ) {
      return {
        marketStructure:
          'BEARISH',

        structureType:
          'LOWER LOW',

        structurePrice:
          latest.price,
      };
    }
  }

  return {
    marketStructure:
      'NEUTRAL',

    structureType:
      'NONE',

    structurePrice:
      latest.price,
  };
}

// ============================================================
// COMBINED MARKET STRUCTURE
// ============================================================

function calculateCombinedStructure(
  fractals
) {
  const tops =
    fractals.filter(
      (fractal) =>
        fractal.type ===
        'TOP'
    );

  const bottoms =
    fractals.filter(
      (fractal) =>
        fractal.type ===
        'BOTTOM'
    );

  let higherHigh =
    false;

  let lowerHigh =
    false;

  let higherLow =
    false;

  let lowerLow =
    false;

  // ==========================================================
  // TOPS
  // ==========================================================

  if (
    tops.length >= 2
  ) {
    const latestTop =
      tops[
        tops.length - 1
      ];

    const previousTop =
      tops[
        tops.length - 2
      ];

    higherHigh =
      latestTop.price >
      previousTop.price;

    lowerHigh =
      latestTop.price <
      previousTop.price;
  }

  // ==========================================================
  // BOTTOMS
  // ==========================================================

  if (
    bottoms.length >= 2
  ) {
    const latestBottom =
      bottoms[
        bottoms.length - 1
      ];

    const previousBottom =
      bottoms[
        bottoms.length - 2
      ];

    higherLow =
      latestBottom.price >
      previousBottom.price;

    lowerLow =
      latestBottom.price <
      previousBottom.price;
  }

  // ==========================================================
  // HIGHER HIGH + HIGHER LOW
  // ==========================================================

  if (
    higherHigh &&
    higherLow
  ) {
    return {
      marketStructure:
        'BULLISH',

      structureType:
        'HIGHER HIGH / HIGHER LOW',
    };
  }

  // ==========================================================
  // LOWER HIGH + LOWER LOW
  // ==========================================================

  if (
    lowerHigh &&
    lowerLow
  ) {
    return {
      marketStructure:
        'BEARISH',

      structureType:
        'LOWER HIGH / LOWER LOW',
    };
  }

  // ==========================================================
  // SINGLE BULLISH STRUCTURE
  // ==========================================================

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
    };
  }

  // ==========================================================
  // SINGLE BEARISH STRUCTURE
  // ==========================================================

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
    };
  }

  return {
    marketStructure:
      'NEUTRAL',

    structureType:
      'NONE',
  };
}

// ============================================================
// STANDARD DEVIATION
// ============================================================

function calculateStdDeviation(
  candles
) {
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
// LIQUIDITY — CONFIRMED FRACTAL HISTORY ONLY
// ============================================================
//
// IMPORTANT:
//
// This function DOES NOT inspect candle wicks.
//
// It DOES NOT inspect the CRT candle.
//
// It DOES NOT inspect the previous candle.
//
// It ONLY compares:
//
//   latest confirmed TOP
//          vs
//   previous confirmed TOP
//
// OR:
//
//   latest confirmed BOTTOM
//          vs
//   previous confirmed BOTTOM
//
// ============================================================

function detectFractalLiquiditySweep(
  candles,
  fractals,
  latest
) {
  if (
    !latest ||
    !Array.isArray(fractals) ||
    !fractals.length
  ) {
    return {
      swept:
        false,

      type:
        'NONE',

      label:
        'None',

      level:
        null,

      fractal:
        null,

      previousFractal:
        null,
    };
  }

  // ==========================================================
  // ALL CONFIRMED FRACTALS BEFORE LATEST
  // ==========================================================

  const previousConfirmedFractals =
    fractals.filter(
      (fractal) =>
        fractal.confirmationIndex <
        latest.confirmationIndex
    );

  if (
    !previousConfirmedFractals.length
  ) {
    return {
      swept:
        false,

      type:
        'NONE',

      label:
        'None',

      level:
        null,

      fractal:
        null,

      previousFractal:
        null,
    };
  }

  // ==========================================================
  // SAME TYPE ONLY
  // ==========================================================

  const previousSameType =
    previousConfirmedFractals.filter(
      (fractal) =>
        fractal.type ===
        latest.type
    );

  if (
    !previousSameType.length
  ) {
    return {
      swept:
        false,

      type:
        'NONE',

      label:
        'None',

      level:
        null,

      fractal:
        null,

      previousFractal:
        null,
    };
  }

  // ==========================================================
  // IMMEDIATELY PREVIOUS CONFIRMED SAME-TYPE FRACTAL
  // ==========================================================

  const previousFractal =
    previousSameType[
      previousSameType.length - 1
    ];

  // ==========================================================
  // TOP
  // ==========================================================

  if (
    latest.type ===
    'TOP'
  ) {
    if (
      latest.price >
      previousFractal.price
    ) {
      return {
        swept:
          true,

        type:
          'HIGH',

        label:
          'PREVIOUS FRACTAL HIGH SWEPT',

        level:
          previousFractal.price,

        fractal:
          latest,

        previousFractal,
      };
    }

    return {
      swept:
        false,

      type:
        'NONE',

      label:
        'None',

      level:
        previousFractal.price,

      fractal:
        latest,

      previousFractal,
    };
  }

  // ==========================================================
  // BOTTOM
  // ==========================================================

  if (
    latest.type ===
    'BOTTOM'
  ) {
    if (
      latest.price <
      previousFractal.price
    ) {
      return {
        swept:
          true,

        type:
          'LOW',

        label:
          'PREVIOUS FRACTAL LOW SWEPT',

        level:
          previousFractal.price,

        fractal:
          latest,

        previousFractal,
      };
    }

    return {
      swept:
        false,

      type:
        'NONE',

      label:
        'None',

      level:
        previousFractal.price,

      fractal:
        latest,

      previousFractal,
    };
  }

  return {
    swept:
      false,

    type:
      'NONE',

    label:
      'None',

    level:
      null,

    fractal:
      null,

    previousFractal:
      previousFractal,
  };
}

// ============================================================
// CRT DIRECTION
// ============================================================
//
// BOTTOM = BUY
// TOP    = SELL
//
// ============================================================

function getDirection(
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
// FRACTAL CONFIRMATION
// ============================================================
//
// A valid confirmed fractal must:
//
//   • have confirmationIndex
//   • have pivotIndex = confirmationIndex - 2
//   • have two candles after pivot
//   • have valid chronological timestamps
//
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
    fractal.pivotIndex < 0 ||
    fractal.confirmationIndex >=
      candles.length
  ) {
    return false;
  }

  const pivot =
    candles[
      fractal.pivotIndex
    ];

  const firstConfirmation =
    candles[
      fractal.pivotIndex + 1
    ];

  const secondConfirmation =
    candles[
      fractal.pivotIndex + 2
    ];

  if (
    !pivot ||
    !firstConfirmation ||
    !secondConfirmation
  ) {
    return false;
  }

  const pivotTime =
    getCandleTime(
      pivot
    );

  const firstTime =
    getCandleTime(
      firstConfirmation
    );

  const secondTime =
    getCandleTime(
      secondConfirmation
    );

  if (
    pivotTime === null ||
    firstTime === null ||
    secondTime === null
  ) {
    return false;
  }

  if (
    firstTime <=
    pivotTime
  ) {
    return false;
  }

  if (
    secondTime <=
    firstTime
  ) {
    return false;
  }

  return true;
}

// ============================================================
// CRT BODY RATIO
// ============================================================

function getBodyRatio(
  candle
) {
  if (!candle) {
    return 0;
  }

  const open =
    number(
      candle.open
    );

  const high =
    number(
      candle.high
    );

  const low =
    number(
      candle.low
    );

  const close =
    number(
      candle.close
    );

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

  const body =
    Math.abs(
      close - open
    );

  return (
    body / range
  );
}

// ============================================================
// ACTUAL CRT CANDLE CONFIRMATION
// ============================================================
//
// IMPORTANT:
//
// The CRT confirmation candle is the SECOND candle after the
// fractal pivot.
//
// Therefore:
//
//   pivot             = [2]
//   first confirmation = [1]
//   CRT confirmation   = [0]
//
// This means CRT cannot be confirmed before the fractal itself
// is confirmed.
//
// ============================================================

function confirmCRTCandle(
  fractal,
  candles,
  options = {}
) {
  if (
    !fractal ||
    !Array.isArray(candles)
  ) {
    return {
      confirmed:
        false,

      reason:
        'Missing fractal or candle history.',
    };
  }

  const confirmationIndex =
    Number(
      fractal.confirmationIndex
    );

  if (
    !Number.isInteger(
      confirmationIndex
    )
  ) {
    return {
      confirmed:
        false,

      reason:
        'Invalid fractal confirmation index.',
    };
  }

  // ==========================================================
  // The fractal confirmation candle is the CRT candle.
  // ==========================================================

  if (
    confirmationIndex <= 0 ||
    confirmationIndex >=
      candles.length
  ) {
    return {
      confirmed:
        false,

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
      confirmed:
        false,

      reason:
        'Missing CRT confirmation or parent candle.',
    };
  }

  // ==========================================================
  // SAFETY:
  //
  // The CRT candle must be CLOSED.
  //
  // The engine has already filtered closed candles, but we
  // verify the explicit property here as well when available.
  // ==========================================================

  if (
    signalCandle.closed === false
  ) {
    return {
      confirmed:
        false,

      reason:
        'CRT candle is not closed.',
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
      confirmed:
        false,

      reason:
        'Invalid CRT candle OHLC values.',
    };
  }

  const direction =
    getDirection(
      fractal
    );

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
        options.minBodyRatio ??
        0
      )
    );

  // ==========================================================
  // BUY CRT
  // ==========================================================

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

    if (
      !sweptLow
    ) {
      return {
        confirmed:
          false,

        reason:
          'BUY CRT failed: confirmation candle did not sweep previous candle LOW.',

        direction,

        signalCandle,

        parentCandle,

        sweptLow:
          false,

        sweptHigh:
          false,

        closedInside,

        bodyRatio,
      };
    }

    if (
      requireCloseInside &&
      !closedInside
    ) {
      return {
        confirmed:
          false,

        reason:
          'BUY CRT failed: confirmation candle did not close back inside previous candle range.',

        direction,

        signalCandle,

        parentCandle,

        sweptLow:
          true,

        sweptHigh:
          false,

        closedInside:
          false,

        bodyRatio,
      };
    }

    if (
      useCloseDirection &&
      !bullishClose
    ) {
      return {
        confirmed:
          false,

        reason:
          'BUY CRT failed: confirmation candle is not bullish.',

        direction,

        signalCandle,

        parentCandle,

        sweptLow:
          true,

        sweptHigh:
          false,

        closedInside,

        bodyRatio,
      };
    }

    if (
      bodyRatio <
      minBodyRatio
    ) {
      return {
        confirmed:
          false,

        reason:
          `BUY CRT failed: body ratio ${bodyRatio.toFixed(
            4
          )} is below minimum ${minBodyRatio.toFixed(
            4
          )}.`,

        direction,

        signalCandle,

        parentCandle,

        sweptLow:
          true,

        sweptHigh:
          false,

        closedInside,

        bodyRatio,
      };
    }

    return {
      confirmed:
        true,

      reason:
        'BUY CRT confirmed.',

      direction,

      signalCandle,

      parentCandle,

      sweptLow:
        true,

      sweptHigh:
        false,

      closedInside,

      bodyRatio,

      parentHigh,

      parentLow,
    };
  }

  // ==========================================================
  // SELL CRT
  // ==========================================================

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

    if (
      !sweptHigh
    ) {
      return {
        confirmed:
          false,

        reason:
          'SELL CRT failed: confirmation candle did not sweep previous candle HIGH.',

        direction,

        signalCandle,

        parentCandle,

        sweptLow:
          false,

        sweptHigh:
          false,

        closedInside,

        bodyRatio,
      };
    }

    if (
      requireCloseInside &&
      !closedInside
    ) {
      return {
        confirmed:
          false,

        reason:
          'SELL CRT failed: confirmation candle did not close back inside previous candle range.',

        direction,

        signalCandle,

        parentCandle,

        sweptLow:
          false,

        sweptHigh:
          true,

        closedInside:
          false,

        bodyRatio,
      };
    }

    if (
      useCloseDirection &&
      !bearishClose
    ) {
      return {
        confirmed:
          false,

        reason:
          'SELL CRT failed: confirmation candle is not bearish.',

        direction,

        signalCandle,

        parentCandle,

        sweptLow:
          false,

        sweptHigh:
          true,

        closedInside,

        bodyRatio,
      };
    }

    if (
      bodyRatio <
      minBodyRatio
    ) {
      return {
        confirmed:
          false,

        reason:
          `SELL CRT failed: body ratio ${bodyRatio.toFixed(
            4
          )} is below minimum ${minBodyRatio.toFixed(
            4
          )}.`,

        direction,

        signalCandle,

        parentCandle,

        sweptLow:
          false,

        sweptHigh:
          true,

        closedInside,

        bodyRatio,
      };
    }

    return {
      confirmed:
        true,

      reason:
        'SELL CRT confirmed.',

      direction,

      signalCandle,

      parentCandle,

      sweptLow:
        false,

      sweptHigh:
        true,

      closedInside,

      bodyRatio,

      parentHigh,

      parentLow,
    };
  }

  return {
    confirmed:
      false,

    reason:
      'Unable to determine CRT direction.',
  };
}

// ============================================================
// SIGNAL ID
// ============================================================

function buildSignalId(
  symbol,
  market,
  timeframe,
  fractal
) {
  return [
    market ??
      'FUTURES',

    symbol,

    timeframe,

    fractal.type,

    fractal.pivotTime,

    fractal.price,
  ].join(':');
}

// ============================================================
// BUILD SIGNAL
// ============================================================
//
// IMPORTANT:
//
// Only confirmed fractals are allowed here.
//
// Potential fractals are NEVER used.
//
// ============================================================

export function buildSignal({
  symbol,

  market = 'FUTURES',

  source = 'MEXC',

  timeframe,

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

  const now =
    Date.now();

  // ==========================================================
  // CLOSED CANDLES
  // ==========================================================

  const closedCandles =
    getClosedCandles(
      candles,
      normalizedTimeframe,
      now
    );

  // ==========================================================
  // MINIMUM HISTORY
  // ==========================================================

  const minimumCandles =
    Math.max(
      5,
      Number(
        rsiPeriod
      ) + 2
    );

  if (
    closedCandles.length <
    minimumCandles
  ) {
    return null;
  }

  // ==========================================================
  // CHRONOLOGY
  // ==========================================================

  if (
    !validateChronology(
      closedCandles
    )
  ) {
    return null;
  }

  // ==========================================================
  // FIND ALL CONFIRMED FRACTALS
  // ==========================================================

  const fractals =
    findFractals(
      closedCandles,
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

  const latest =
    fractals[
      fractals.length - 1
    ];

  if (!latest) {
    return null;
  }

  // ==========================================================
  // VERIFY FRACTAL CONFIRMATION
  // ==========================================================

  if (
    !isConfirmedFractal(
      latest,
      closedCandles
    )
  ) {
    return null;
  }

  // ==========================================================
  // DIRECTION
  // ==========================================================

  const direction =
    getDirection(
      latest
    );

  if (!direction) {
    return null;
  }

  // ==========================================================
  // ACTUAL CRT CANDLE CONFIRMATION
  // ==========================================================

  const crtConfirmation =
    confirmCRTCandle(
      latest,
      closedCandles,
      crtOptions
    );

  if (
    !crtConfirmation.confirmed
  ) {
    return null;
  }

  // ==========================================================
  // RSI
  // ==========================================================

  const closes =
    closedCandles.map(
      (candle) =>
        Number(
          candle.close
        )
    );

  const rsi =
    calculateRSI(
      closes,
      Number(
        rsiPeriod
      )
    );

  const rsiState =
    getRSIState(
      rsi,
      Number(
        oversold
      ),
      Number(
        overbought
      )
    );

  // ==========================================================
  // STANDARD DEVIATION
  // ==========================================================

  const stdDeviation =
    calculateStdDeviation(
      closedCandles
    );

  // ==========================================================
  // INDIVIDUAL MARKET STRUCTURE
  // ==========================================================

  const individualStructure =
    calculateMarketStructure(
      fractals,
      latest
    );

  // ==========================================================
  // COMBINED MARKET STRUCTURE
  // ==========================================================

  const combinedStructure =
    calculateCombinedStructure(
      fractals
    );

  const marketStructure =
    combinedStructure.marketStructure !==
    'NEUTRAL'
      ? combinedStructure.marketStructure
      : individualStructure.marketStructure;

  const structureType =
    combinedStructure.structureType !==
    'NONE'
      ? combinedStructure.structureType
      : individualStructure.structureType;

  // ==========================================================
  // LIQUIDITY
  // ==========================================================
  //
  // ONLY confirmed fractal history.
  //
  // ==========================================================

  const liquiditySweep =
    detectFractalLiquiditySweep(
      closedCandles,
      fractals,
      latest
    );

  // ==========================================================
  // STRENGTH
  // ==========================================================

  const strength =
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
      : 'STANDARD';

  // ==========================================================
  // SIGNAL ID
  // ==========================================================

  const id =
    buildSignalId(
      symbol,
      market,
      normalizedTimeframe,
      latest
    );

  // ==========================================================
  // FINAL SIGNAL
  // ==========================================================

  return {
    // ========================================================
    // IDENTITY
    // ========================================================

    id,

    symbol,

    source,

    market,

    exchange:
      source,

    timeframe:
      normalizedTimeframe,

    // ========================================================
    // PRIMARY SIGNAL
    // ========================================================

    direction,

    fractalType:
      latest.fractalType,

    fractalPrice:
      latest.price,

    fractal: {
      type:
        latest.type,

      label:
        latest.fractalType,

      price:
        latest.price,

      pivotTime:
        latest.pivotTime,

      confirmationTime:
        latest.confirmationTime,

      pivotCandle:
        latest.candle,

      confirmationCandle:
        latest.confirmationCandle,

      confirmationCandlesRequired:
        2,

      confirmationCandlesClosed:
        2,
    },

    // ========================================================
    // FRACTAL CONFIRMATION
    // ========================================================

    fractalConfirmed:
      true,

    // ========================================================
    // CRT CONFIRMATION
    // ========================================================

    confirmed:
      true,

    confirmedCRT:
      true,

    crtConfirmed:
      true,

    // ========================================================
    // CRT CONFIRMATION DETAILS
    // ========================================================

    crtConfirmation: {
      confirmed:
        true,

      reason:
        crtConfirmation.reason,

      direction:
        crtConfirmation.direction,

      signalCandle:
        crtConfirmation.signalCandle,

      parentCandle:
        crtConfirmation.parentCandle,

      sweptLow:
        crtConfirmation.sweptLow ??
        false,

      sweptHigh:
        crtConfirmation.sweptHigh ??
        false,

      closedInside:
        crtConfirmation.closedInside ??
        false,

      bodyRatio:
        crtConfirmation.bodyRatio ??
        0,

      parentHigh:
        crtConfirmation.parentHigh ??
        null,

      parentLow:
        crtConfirmation.parentLow ??
        null,
    },

    // ========================================================
    // CRT CANDLE COMPATIBILITY
    // ========================================================

    crtCandle:
      crtConfirmation.signalCandle ??
      null,

    crtParentCandle:
      crtConfirmation.parentCandle ??
      null,

    crtParentHigh:
      crtConfirmation.parentHigh ??
      null,

    crtParentLow:
      crtConfirmation.parentLow ??
      null,

    crtClosedInside:
      crtConfirmation.closedInside ??
      false,

    crtSweptLow:
      crtConfirmation.sweptLow ??
      false,

    crtSweptHigh:
      crtConfirmation.sweptHigh ??
      false,

    crtBodyRatio:
      crtConfirmation.bodyRatio ??
      0,

    // ========================================================
    // MARKET STRUCTURE
    // ========================================================

    marketStructure,

    structure:
      marketStructure,

    market_structure:
      marketStructure,

    structureType,

    // ========================================================
    // STANDARD DEVIATION
    // ========================================================

    stdDeviation,

    stdDev:
      stdDeviation,

    standardDeviation:
      stdDeviation,

    // ========================================================
    // LIQUIDITY
    // ========================================================

    liquiditySweep,

    liquiditySwept:
      liquiditySweep.swept,

    liquidityType:
      liquiditySweep.type,

    liquidityLevel:
      liquiditySweep.level,

    previousFractal:
      liquiditySweep.previousFractal,

    previousFractalPrice:
      liquiditySweep
        .previousFractal
        ?.price ??
      null,

    // ========================================================
    // RSI
    // ========================================================

    rsi,

    rsiState,

    // ========================================================
    // STRENGTH
    // ========================================================

    strength,

    // ========================================================
    // FRACTAL PIVOT TIME
    // ========================================================

    candleTime:
      latest.pivotTime,

    // ========================================================
    // FRACTAL CONFIRMATION TIME
    // ========================================================

    confirmationTime:
      latest.confirmationTime,

    // ========================================================
    // CRT CANDLE TIME
    // ========================================================

    crtCandleTime:
      getCandleTime(
        crtConfirmation.signalCandle
      ),

    // ========================================================
    // PRICE
    // ========================================================

    price:
      latest.price,

    // ========================================================
    // FRACTAL HIGH / LOW
    // ========================================================

    signalHigh:
      latest.type ===
      'TOP'
        ? latest.price
        : null,

    signalLow:
      latest.type ===
      'BOTTOM'
        ? latest.price
        : null,

    // ========================================================
    // CRT RANGE
    // ========================================================

    parentHigh:
      crtConfirmation.parentHigh ??
      null,

    parentLow:
      crtConfirmation.parentLow ??
      null,

    closedInside:
      crtConfirmation.closedInside ??
      false,

    // ========================================================
    // CONFIRMED FRACTAL HISTORY
    // ========================================================

    confirmedFractals:
      fractals,

    // ========================================================
    // LATEST FRACTAL
    // ========================================================

    latestConfirmedFractal:
      latest,

    // ========================================================
    // PREVIOUS SAME-TYPE FRACTAL
    // ========================================================

    previousConfirmedFractal:
      liquiditySweep.previousFractal ??
      null,
  };
}

// ============================================================
// DETECT CRT
// ============================================================
//
// Compatibility wrapper.
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

  const latest =
    fractals[
      fractals.length - 1
    ];

  if (!latest) {
    return null;
  }

  if (
    !isConfirmedFractal(
      latest,
      closed
    )
  ) {
    return null;
  }

  const direction =
    getDirection(
      latest
    );

  if (!direction) {
    return null;
  }

  const crt =
    confirmCRTCandle(
      latest,
      closed,
      options
    );

  if (
    !crt.confirmed
  ) {
    return null;
  }

  const liquidity =
    detectFractalLiquiditySweep(
      closed,
      fractals,
      latest
    );

  return {
    confirmed:
      true,

    confirmedCRT:
      true,

    crtConfirmed:
      true,

    direction,

    fractalType:
      latest.fractalType,

    fractalPrice:
      latest.price,

    fractal:
      latest,

    signal:
      crt.signalCandle,

    parent:
      crt.parentCandle,

    candleTime:
      latest.pivotTime,

    confirmationTime:
      latest.confirmationTime,

    crtCandleTime:
      getCandleTime(
        crt.signalCandle
      ),

    // ========================================================
    // CRT CONFIRMATION
    // ========================================================

    crtConfirmation:
      crt,

    // ========================================================
    // LIQUIDITY
    // ========================================================

    liquiditySweep:
      liquidity,

    liquiditySwept:
      liquidity.swept,

    previousFractal:
      liquidity.previousFractal,

    previousFractalPrice:
      liquidity
        .previousFractal
        ?.price ??
      null,

    // ========================================================
    // COMPATIBILITY
    // ========================================================

    parentHigh:
      crt.parentHigh ??
      null,

    parentLow:
      crt.parentLow ??
      null,

    signalHigh:
      latest.type ===
      'TOP'
        ? latest.price
        : null,

    signalLow:
      latest.type ===
      'BOTTOM'
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
// TEST POTENTIAL RACHEL T FRACTAL
// ============================================================
//
// This does NOT create a signal.
//
// It is only for observing a developing pattern.
//
// ============================================================

export function testPotentialRachelFractal(
  candles,
  timeframe = DEFAULT_TIMEFRAME
) {
  return findPotentialFractals(
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
    return {
      liquiditySweep: {
        swept:
          false,

        type:
          'NONE',

        label:
          'None',
      },

      confirmedFractals:
        [],
    };
  }

  const latest =
    fractals[
      fractals.length - 1
    ];

  const liquidity =
    detectFractalLiquiditySweep(
      closed,
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

  const individualStructure =
    latest
      ? calculateMarketStructure(
          fractals,
          latest
        )
      : {
          marketStructure:
            'NEUTRAL',

          structureType:
            'NONE',

          structurePrice:
            null,
        };

  const combinedStructure =
    calculateCombinedStructure(
      fractals
    );

  const marketStructure =
    combinedStructure.marketStructure !==
    'NEUTRAL'
      ? combinedStructure
      : individualStructure;

  const liquidity =
    latest
      ? detectFractalLiquiditySweep(
          closed,
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

  return {
    confirmedFractals:
      fractals,

    latestConfirmedFractal:
      latest,

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
      marketStructure.marketStructure,

    structureType:
      marketStructure.structureType,
  };
}

// ============================================================
// PUBLIC STRUCTURE EXPORT
// ============================================================

export {
  isFilteredTopAt,

  isFilteredBottomAt,

  calculateStdDeviation,

  calculateMarketStructure,

  calculateCombinedStructure,

  detectFractalLiquiditySweep,

  confirmCRTCandle,

  getClosedCandles,

  getBodyRatio,

  getDirection,

  isCandleClosed,

  getCandleTime,

  getCandleCloseTime,

  getTimeframeMs,

  normalizeTimeframe,

  validateChronology,

  isConfirmedFractal,
};

// ============================================================
// ENGINE LOADED
// ============================================================

console.log(
  '[CRT ENGINE] Rachel T Filtered Top/Bottom Fractal engine loaded.'
);

console.log(
  '[CRT ENGINE] Data calculation is local — no TradingView API.'
);

console.log(
  '[CRT ENGINE] Intended source: MEXC FUTURES.'
);

console.log(
  '[CRT ENGINE] filterBW=false.'
);

console.log(
  '[CRT ENGINE] Fractal pivot = high[2] / low[2].'
);

console.log(
  '[CRT ENGINE] Fractal confirmation = 2 CLOSED candles after pivot.'
);

console.log(
  '[CRT ENGINE] Potential fractals are monitoring-only and cannot create signals.'
);

console.log(
  '[CRT ENGINE] Active/unprovably-closed candles are rejected.'
);

console.log(
  '[CRT ENGINE] Candle timestamps are validated chronologically.'
);

console.log(
  '[CRT ENGINE] Liquidity = latest confirmed fractal vs previous confirmed same-type fractal.'
);

console.log(
  '[CRT ENGINE] TOP liquidity = latest TOP > previous TOP.'
);

console.log(
  '[CRT ENGINE] BOTTOM liquidity = latest BOTTOM < previous BOTTOM.'
);

console.log(
  '[CRT ENGINE] Liquidity does NOT use candle wicks.'
);

console.log(
  '[CRT ENGINE] Liquidity does NOT use CRT confirmation candle.'
);

console.log(
  '[CRT ENGINE] CRT confirmation occurs only after fractal confirmation.'
);

console.log(
  '[CRT ENGINE] Current candle cannot produce a confirmed signal.'
);

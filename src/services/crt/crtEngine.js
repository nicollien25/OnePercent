// ============================================================
// PDYN CRT ENGINE
// ============================================================
//
// PRIMARY SIGNAL:
// Rachel_T Fractal Indicator
//
// IMPORTANT:
// This engine is based ONLY on the Filtered Top / Filtered
// Bottom Fractal logic supplied by the user.
//
// filterBW = false
//
// Therefore:
//
// FILTERED TOP:
//
// high[4] < high[2]
// && high[3] <= high[2]
// && high[2] >= high[1]
// && high[2] > high[0]
//
// FILTERED BOTTOM:
//
// low[4] > low[2]
// && low[3] >= low[2]
// && low[2] <= low[1]
// && low[2] < low[0]
//
// The actual fractal price is:
//
// TOP    = high[2]
// BOTTOM = low[2]
//
// The fractal is confirmed two candles AFTER the pivot.
//
// Example:
//
// candles:
// [0] oldest
// ...
// [-5]
// [-4]
// [-3]  <- ACTUAL FRACTAL PIVOT
// [-2]
// [-1]  <- confirmation candle
//
// This matches Pine's:
//
// plotshape(... offset=-2)
//
// ============================================================

import { calculateRSI, getRSIState } from './rsi.js';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_RSI_PERIOD = 14;
const DEFAULT_OVERSOLD = 30;
const DEFAULT_OVERBOUGHT = 70;

// Number of historical fractals used for market structure.
const STRUCTURE_FRACTALS = 3;

// ============================================================
// NUMBER HELPERS
// ============================================================

function number(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

// ============================================================
// CANDLE TIME
// ============================================================

function getCandleTime(candle) {
  if (!candle) {
    return null;
  }

  return (
    candle.openTime ??
    candle.time ??
    candle.timestamp ??
    candle.ts ??
    null
  );
}

// ============================================================
// CLOSED CANDLE FILTER
// ============================================================
//
// The engine expects the caller to provide MEXC candles.
//
// We still protect against a still-forming candle here.
//
// ============================================================

function getClosedCandles(candles) {
  if (!Array.isArray(candles)) {
    return [];
  }

  return candles.filter((candle) => {
    if (!candle) {
      return false;
    }

    if (candle.closed === false) {
      return false;
    }

    return (
      number(candle.open) !== null &&
      number(candle.high) !== null &&
      number(candle.low) !== null &&
      number(candle.close) !== null
    );
  });
}

// ============================================================
// RACHEL_T FILTERED TOP FRACTAL
// ============================================================
//
// EXACT LOGIC FROM PROVIDED PINE:
//
// isBWFractal(1) =>
//
// high[4] < high[2]
// high[3] <= high[2]
// high[2] >= high[1]
// high[2] > high[0]
//
// The pivot is candle index -3 when evaluating the latest
// closed candle.
//
// ============================================================

function isFilteredTopAt(candles, index) {
  if (
    !Array.isArray(candles) ||
    index < 4 ||
    index >= candles.length
  ) {
    return false;
  }

  const h4 = number(candles[index - 4]?.high);
  const h3 = number(candles[index - 3]?.high);
  const h2 = number(candles[index - 2]?.high);
  const h1 = number(candles[index - 1]?.high);
  const h0 = number(candles[index]?.high);

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
// RACHEL_T FILTERED BOTTOM FRACTAL
// ============================================================
//
// EXACT LOGIC FROM PROVIDED PINE:
//
// isBWFractal(-1) =>
//
// low[4] > low[2]
// low[3] >= low[2]
// low[2] <= low[1]
// low[2] < low[0]
//
// ============================================================

function isFilteredBottomAt(candles, index) {
  if (
    !Array.isArray(candles) ||
    index < 4 ||
    index >= candles.length
  ) {
    return false;
  }

  const l4 = number(candles[index - 4]?.low);
  const l3 = number(candles[index - 3]?.low);
  const l2 = number(candles[index - 2]?.low);
  const l1 = number(candles[index - 1]?.low);
  const l0 = number(candles[index]?.low);

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
// FIND CONFIRMED FRACTALS
// ============================================================
//
// Every evaluation candle represents the current Pine bar.
//
// The actual fractal is TWO candles behind.
//
// This function scans historical closed candles and produces
// only confirmed Rachel_T filtered fractals.
//
// ============================================================

export function findFractals(candles) {
  const closed = getClosedCandles(candles);

  if (closed.length < 5) {
    return [];
  }

  const fractals = [];

  for (
    let confirmationIndex = 4;
    confirmationIndex < closed.length;
    confirmationIndex++
  ) {
    const pivotIndex = confirmationIndex - 2;

    // ========================================================
    // FILTERED TOP
    // ========================================================

    if (
      isFilteredTopAt(
        closed,
        confirmationIndex
      )
    ) {
      const pivot = closed[pivotIndex];

      const price = number(pivot.high);

      if (price !== null) {
        fractals.push({
          type: 'TOP',
          fractalType: 'FILTERED TOP',
          price,

          // Actual pivot candle.
          candle: pivot,

          // Exact pivot index.
          pivotIndex,

          // Candle where the fractal became confirmed.
          confirmationCandle:
            closed[confirmationIndex],

          confirmationIndex,

          pivotTime:
            getCandleTime(pivot),

          confirmationTime:
            getCandleTime(
              closed[confirmationIndex]
            ),
        });
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
      const pivot = closed[pivotIndex];

      const price = number(pivot.low);

      if (price !== null) {
        fractals.push({
          type: 'BOTTOM',
          fractalType: 'FILTERED BOTTOM',
          price,

          // Actual pivot candle.
          candle: pivot,

          // Exact pivot index.
          pivotIndex,

          // Candle where the fractal became confirmed.
          confirmationCandle:
            closed[confirmationIndex],

          confirmationIndex,

          pivotTime:
            getCandleTime(pivot),

          confirmationTime:
            getCandleTime(
              closed[confirmationIndex]
            ),
        });
      }
    }
  }

  // ==========================================================
  // SORT CHRONOLOGICALLY
  // ==========================================================

  fractals.sort(
    (a, b) =>
      Number(a.confirmationIndex) -
      Number(b.confirmationIndex)
  );

  return fractals;
}

// ============================================================
// GET LATEST CONFIRMED FRACTAL
// ============================================================

export function getLatestFractal(candles) {
  const fractals = findFractals(candles);

  if (!fractals.length) {
    return null;
  }

  return fractals[fractals.length - 1];
}

// ============================================================
// GET PREVIOUS FRACTALS
// ============================================================

function getPreviousSameType(
  fractals,
  latest,
  count = 3
) {
  if (!latest) {
    return [];
  }

  return fractals
    .filter(
      (fractal) =>
        fractal.type === latest.type &&
        fractal.confirmationIndex <
          latest.confirmationIndex
    )
    .slice(-count);
}

// ============================================================
// MARKET STRUCTURE
// ============================================================
//
// This follows the intent of the supplied Rachel_T script:
//
// TOPS:
//
// Latest TOP > previous TOP
// => HIGHER HIGH
//
// Latest TOP < previous TOP
// => LOWER HIGH
//
// BOTTOMS:
//
// Latest BOTTOM > previous BOTTOM
// => HIGHER LOW
//
// Latest BOTTOM < previous BOTTOM
// => LOWER LOW
//
// Primary structure:
//
// BULLISH:
// - Higher Low
// - Higher High
//
// BEARISH:
// - Lower High
// - Lower Low
//
// If there is insufficient fractal history:
// NEUTRAL
//
// ============================================================

function calculateMarketStructure(
  fractals,
  latest
) {
  if (!latest) {
    return {
      marketStructure: 'NEUTRAL',
      structureType: 'NONE',
      structurePrice: null,
    };
  }

  const previous = getPreviousSameType(
    fractals,
    latest,
    STRUCTURE_FRACTALS
  );

  if (!previous.length) {
    return {
      marketStructure: 'NEUTRAL',
      structureType: 'NONE',
      structurePrice: latest.price,
    };
  }

  const previousFractal =
    previous[previous.length - 1];

  if (latest.type === 'TOP') {
    if (
      latest.price >
      previousFractal.price
    ) {
      return {
        marketStructure: 'BULLISH',
        structureType: 'HIGHER HIGH',
        structurePrice: latest.price,
      };
    }

    if (
      latest.price <
      previousFractal.price
    ) {
      return {
        marketStructure: 'BEARISH',
        structureType: 'LOWER HIGH',
        structurePrice: latest.price,
      };
    }
  }

  if (latest.type === 'BOTTOM') {
    if (
      latest.price >
      previousFractal.price
    ) {
      return {
        marketStructure: 'BULLISH',
        structureType: 'HIGHER LOW',
        structurePrice: latest.price,
      };
    }

    if (
      latest.price <
      previousFractal.price
    ) {
      return {
        marketStructure: 'BEARISH',
        structureType: 'LOWER LOW',
        structurePrice: latest.price,
      };
    }
  }

  return {
    marketStructure: 'NEUTRAL',
    structureType: 'NONE',
    structurePrice: latest.price,
  };
}

// ============================================================
// STRONGER MARKET STRUCTURE
// ============================================================
//
// When enough confirmed fractals exist, use the latest TOP

// ============================================================
// and latest BOTTOM and determine the latest directional
// relationship.
//
// This keeps the market structure tied to the SAME designated
// timeframe supplied to buildSignal().
//
// There is NO Daily -> lower timeframe inheritance.
// ============================================================

function calculateDirectionalStructure(
  fractals
) {
  const tops = fractals.filter(
    (fractal) =>
      fractal.type === 'TOP'
  );

  const bottoms = fractals.filter(
    (fractal) =>
      fractal.type === 'BOTTOM'
  );

  if (
    tops.length < 2 ||
    bottoms.length < 2
  ) {
    return {
      marketStructure: 'NEUTRAL',
      structureType: 'NONE',
      higherHigh: null,
      higherLow: null,
      lowerHigh: null,
      lowerLow: null,
    };
  }

  const latestTop =
    tops[tops.length - 1];

  const previousTop =
    tops[tops.length - 2];

  const latestBottom =
    bottoms[bottoms.length - 1];

  const previousBottom =
    bottoms[bottoms.length - 2];

  const higherHigh =
    latestTop.price >
    previousTop.price;

  const lowerHigh =
    latestTop.price <
    previousTop.price;

  const higherLow =
    latestBottom.price >
    previousBottom.price;

  const lowerLow =
    latestBottom.price <
    previousBottom.price;

  // ==========================================================
  // BULLISH
  // ==========================================================

  if (
    higherHigh &&
    higherLow
  ) {
    return {
      marketStructure: 'BULLISH',
      structureType:
        'HIGHER HIGH / HIGHER LOW',

      higherHigh:
        latestTop,

      higherLow:
        latestBottom,

      lowerHigh: null,
      lowerLow: null,
    };
  }

  // ==========================================================
  // BEARISH
  // ==========================================================

  if (
    lowerHigh &&
    lowerLow
  ) {
    return {
      marketStructure: 'BEARISH',
      structureType:
        'LOWER HIGH / LOWER LOW',

      higherHigh: null,
      higherLow: null,

      lowerHigh:
        latestTop,

      lowerLow:
        latestBottom,
    };
  }

  // ==========================================================
  // IF ONLY THE LATEST STRUCTURAL EVENT IS DIRECTIONAL,
  // KEEP THAT DIRECTION.
  //
  // This prevents the structure from unnecessarily becoming
  // neutral when the latest confirmed fractal has established
  // a clear HH/HL or LH/LL component.
  // ==========================================================

  const latestFractal =
    fractals[fractals.length - 1];

  if (
    latestFractal?.type === 'TOP'
  ) {
    if (higherHigh) {
      return {
        marketStructure: 'BULLISH',
        structureType:
          'HIGHER HIGH',

        higherHigh:
          latestTop,

        higherLow:
          higherLow
            ? latestBottom
            : null,

        lowerHigh: null,
        lowerLow: null,
      };
    }

    if (lowerHigh) {
      return {
        marketStructure: 'BEARISH',
        structureType:
          'LOWER HIGH',

        higherHigh: null,
        higherLow: null,

        lowerHigh:
          latestTop,

        lowerLow:
          lowerLow
            ? latestBottom
            : null,
      };
    }
  }

  if (
    latestFractal?.type === 'BOTTOM'
  ) {
    if (higherLow) {
      return {
        marketStructure: 'BULLISH',
        structureType:
          'HIGHER LOW',

        higherHigh:
          higherHigh
            ? latestTop
            : null,

        higherLow:
          latestBottom,

        lowerHigh: null,
        lowerLow: null,
      };
    }

    if (lowerLow) {
      return {
        marketStructure: 'BEARISH',
        structureType:
          'LOWER LOW',

        higherHigh: null,
        higherLow: null,

        lowerHigh:
          lowerHigh
            ? latestTop
            : null,

        lowerLow:
          latestBottom,
      };
    }
  }

  return {
    marketStructure: 'NEUTRAL',
    structureType: 'NONE',

    higherHigh:
      higherHigh
        ? latestTop
        : null,

    higherLow:
      higherLow
        ? latestBottom
        : null,

    lowerHigh:
      lowerHigh
        ? latestTop
        : null,

    lowerLow:
      lowerLow
        ? latestBottom
        : null,
  };
}

// ============================================================
// FIND FRACTAL LIQUIDITY
// ============================================================
//
// CLOSED-CANDLE / SIGNAL VERSION.
//
// This checks whether the latest CLOSED candle has swept a
// previously confirmed Rachel_T fractal.
//
// IMPORTANT:
//
// We do NOT limit this to the immediately previous fractal.
//
// A fractal from many candles ago can remain a liquidity level
// until it is swept.
//
// ============================================================

function findLiquiditySweep(
  candles,
  fractals
) {
  const closed =
    getClosedCandles(candles);

  if (
    !closed.length ||
    !fractals.length
  ) {
    return {
      swept: false,
      type: null,
      label: 'None',
      price: null,
      fractal: null,
      sweptByCandle: null,
      sweptByCandleTime: null,
    };
  }

  const current =
    closed[closed.length - 1];

  const currentHigh =
    number(current.high);

  const currentLow =
    number(current.low);

  if (
    currentHigh === null ||
    currentLow === null
  ) {
    return {
      swept: false,
      type: null,
      label: 'None',
      price: null,
      fractal: null,
      sweptByCandle: current,
      sweptByCandleTime:
        getCandleTime(current),
    };
  }

  // ==========================================================
  // Only fractals confirmed BEFORE the current candle can be
  // used as liquidity.
  // ==========================================================

  const eligible =
    fractals.filter(
      (fractal) =>
        Number(
          fractal.confirmationIndex
        ) <
        closed.length - 1
    );

  if (!eligible.length) {
    return {
      swept: false,
      type: null,
      label: 'None',
      price: null,
      fractal: null,
      sweptByCandle: current,
      sweptByCandleTime:
        getCandleTime(current),
    };
  }

  // ==========================================================
  // TOP LIQUIDITY
  //
  // Current candle high reaches or exceeds the confirmed
  // Rachel_T TOP.
  // ==========================================================

  const topSweeps =
    eligible
      .filter(
        (fractal) =>
          fractal.type === 'TOP' &&
          currentHigh >=
            fractal.price
      )
      .sort(
        (a, b) =>
          Number(
            b.confirmationIndex
          ) -
          Number(
            a.confirmationIndex
          )
      );

  // ==========================================================
  // BOTTOM LIQUIDITY
  //
  // Current candle low reaches or falls below the confirmed
  // Rachel_T BOTTOM.
  // ==========================================================

  const bottomSweeps =
    eligible
      .filter(
        (fractal) =>
          fractal.type === 'BOTTOM' &&
          currentLow <=
            fractal.price
      )
      .sort(
        (a, b) =>
          Number(
            b.confirmationIndex
          ) -
          Number(
            a.confirmationIndex
          )
      );

  // ==========================================================
  // IF BOTH SIDES WERE TOUCHED BY THE SAME CANDLE
  //
  // Return the most recently confirmed swept fractal.
  // ==========================================================

  const candidates = [
    ...topSweeps.map(
      (fractal) => ({
        fractal,
        side: 'TOP',
      })
    ),

    ...bottomSweeps.map(
      (fractal) => ({
        fractal,
        side: 'BOTTOM',
      })
    ),
  ];

  if (!candidates.length) {
    return {
      swept: false,
      type: null,
      label: 'None',
      price: null,
      fractal: null,
      sweptByCandle: current,
      sweptByCandleTime:
        getCandleTime(current),
    };
  }

  candidates.sort(
    (a, b) =>
      Number(
        b.fractal.confirmationIndex
      ) -
      Number(
        a.fractal.confirmationIndex
      )
  );

  const selected =
    candidates[0];

  const fractal =
    selected.fractal;

  return {
    swept: true,

    type:
      selected.side === 'TOP'
        ? 'HIGH'
        : 'LOW',

    fractalType:
      fractal.type,

    label:
      selected.side === 'TOP'
        ? '**PREVIOUS RACHEL_T TOP SWEPT**'
        : '**PREVIOUS RACHEL_T BOTTOM SWEPT**',

    price:
      fractal.price,

    fractal,

    sweptByCandle:
      current,

    sweptByCandleTime:
      getCandleTime(current),

    sweepPrice:
      selected.side === 'TOP'
        ? currentHigh
        : currentLow,
  };
}

// ============================================================
// LIVE LIQUIDITY SWEEP
// ============================================================
//
// THIS IS DIFFERENT FROM THE CLOSED-CANDLE SIGNAL.
//
// The current MEXC candle may still be running.
//
// We inspect:
//
// current HIGH >= TOP fractal
//
// OR
//
// current LOW <= BOTTOM fractal
//
// Therefore a liquidity sweep can be detected BEFORE the
// current candle closes.
//
// ============================================================

export function findLiveLiquiditySweep(
  candles,
  fractals
) {
  if (
    !Array.isArray(candles) ||
    !candles.length ||
    !Array.isArray(fractals) ||
    !fractals.length
  ) {
    return {
      swept: false,
      currentlySwept: false,
      type: null,
      label: 'None',
      price: null,
      fractal: null,
      currentCandle: null,
      currentCandleTime: null,
      sweepPrice: null,
    };
  }

  // ==========================================================
  // IMPORTANT:
  //
  // The last candle is intentionally NOT filtered out.
  //
  // This is the currently running MEXC candle.
  // ==========================================================

  const current =
    candles[candles.length - 1];

  const currentHigh =
    number(current?.high);

  const currentLow =
    number(current?.low);

  if (
    currentHigh === null ||
    currentLow === null
  ) {
    return {
      swept: false,
      currentlySwept: false,
      type: null,
      label: 'None',
      price: null,
      fractal: null,
      currentCandle: current,
      currentCandleTime:
        getCandleTime(current),
      sweepPrice: null,
    };
  }

  // ==========================================================
  // Only use fractals that were confirmed BEFORE the current
  // running candle.
  //
  // We identify this by confirmation time rather than simply
  // assuming the last array element.
  // ==========================================================

  const currentTime =
    Number(
      getCandleTime(current)
    );

  const eligible =
    fractals.filter(
      (fractal) => {
        const confirmationTime =
          Number(
            fractal.confirmationTime
          );

        if (
          Number.isFinite(
            currentTime
          ) &&
          Number.isFinite(
            confirmationTime
          )
        ) {
          return (
            confirmationTime <
            currentTime
          );
        }

        return true;
      }
    );

  if (!eligible.length) {
    return {
      swept: false,
      currentlySwept: false,
      type: null,
      label: 'None',
      price: null,
      fractal: null,
      currentCandle: current,
      currentCandleTime:
        getCandleTime(current),
      sweepPrice: null,
    };
  }

  // ==========================================================
  // TOP FRACTAL SWEEP
  // ==========================================================

  const topSweeps =
    eligible
      .filter(
        (fractal) =>
          fractal.type === 'TOP' &&
          currentHigh >=
            fractal.price
      )
      .sort(
        (a, b) =>
          Number(
            b.confirmationTime
          ) -
          Number(
            a.confirmationTime
          )
      );

  // ==========================================================
  // BOTTOM FRACTAL SWEEP
  // ==========================================================

  const bottomSweeps =
    eligible
      .filter(
        (fractal) =>
          fractal.type === 'BOTTOM' &&
          currentLow <=
            fractal.price
      )
      .sort(
        (a, b) =>
          Number(
            b.confirmationTime
          ) -
          Number(
            a.confirmationTime
          )
      );

  const candidates = [
    ...topSweeps.map(
      (fractal) => ({
        fractal,
        side: 'TOP',
      })
    ),

    ...bottomSweeps.map(
      (fractal) => ({
        fractal,
        side: 'BOTTOM',
      })
    ),
  ];

  if (!candidates.length) {
    return {
      swept: false,
      currentlySwept: false,
      type: null,
      label: 'None',
      price: null,
      fractal: null,
      currentCandle: current,
      currentCandleTime:
        getCandleTime(current),
      sweepPrice: null,
    };
  }

  // ==========================================================
  // MOST RECENT CONFIRMED FRACTAL WINS IF MULTIPLE LEVELS
  // WERE TOUCHED.
  // ==========================================================

  candidates.sort(
    (a, b) =>
      Number(
        b.fractal.confirmationTime
      ) -
      Number(
        a.fractal.confirmationTime
      )
  );

  const selected =
    candidates[0];

  const fractal =
    selected.fractal;

  const isTop =
    selected.side === 'TOP';

  return {
    swept: true,

    currentlySwept: true,

    type:
      isTop
        ? 'HIGH'
        : 'LOW',

    fractalType:
      fractal.type,

    label:
      isTop
        ? '**CURRENTLY SWEPT — RACHEL_T TOP**'
        : '**CURRENTLY SWEPT — RACHEL_T BOTTOM**',

    price:
      fractal.price,

    fractal,

    currentCandle:
      current,

    currentCandleTime:
      getCandleTime(current),

    sweepPrice:
      isTop
        ? currentHigh
        : currentLow,
  };
}

// ============================================================
// FRACTAL SIGNAL
// ============================================================
//
// A new Rachel_T fractal is a signal whenever it becomes
// confirmed.
//
// THERE IS NO SIGNAL LIMIT.
//
// There is NO:
// - one-per-timeframe limit
// - cooldown
// - same-direction suppression
// - RSI requirement
// - liquidity requirement
// - STD requirement
//
// If the Pine fractal confirms, buildSignal() returns it.
//
// ============================================================

function buildFractalSignal(
  fractal
) {
  if (!fractal) {
    return null;
  }

  return {
    fractalType:
      fractal.fractalType,

    fractalTypeShort:
      fractal.type,

    fractalPrice:
      fractal.price,

    fractalCandle:
      fractal.candle,

    pivotCandle:
      fractal.candle,

    pivotTime:
      fractal.pivotTime,

    confirmationCandle:
      fractal.confirmationCandle,

    confirmationTime:
      fractal.confirmationTime,
  };
}

// ============================================================
// RSI
// ============================================================

function calculateRSIState(
  candles,
  options = {}
) {
  const period =
    Number(
      options.period ??
        DEFAULT_RSI_PERIOD
    );

  const oversold =
    Number(
      options.oversold ??
        DEFAULT_OVERSOLD
    );

  const overbought =
    Number(
      options.overbought ??
        DEFAULT_OVERBOUGHT
    );

  const closes =
    candles
      .map(
        (candle) =>
          number(candle.close)
      )
      .filter(
        (value) =>
          value !== null
      );

  if (
    closes.length <= period
  ) {
    return {
      value: null,
      state: 'Neutral',
    };
  }

  let value = null;

  try {
    value =
      calculateRSI(
        closes,
        period
      );
  } catch {
    value = null;
  }

  if (
    Array.isArray(value)
  ) {
    value =
      value[value.length - 1];
  }

  const numeric =
    number(value);

  if (numeric === null) {
    return {
      value: null,
      state: 'Neutral',
    };
  }

  let state = 'Neutral';

  if (
    numeric >=
    overbought
  ) {
    state = 'Overbought';
  } else if (
    numeric <=
    oversold
  ) {
    state = 'Oversold';
  } else {
    try {
      state =
        getRSIState(
          numeric,
          oversold,
          overbought
        );
    } catch {
      state = 'Neutral';
    }
  }

  return {
    value: numeric,
    state,
  };
}

// ============================================================
// STANDARD DEVIATION
// ============================================================

function calculateStandardDeviation(
  candles
) {
  const closes =
    candles
      .map(
        (candle) =>
          number(candle.close)
      )
      .filter(
        (value) =>
          value !== null
      );

  if (
    closes.length < 2
  ) {
    return null;
  }

  const mean =
    closes.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    closes.length;

  const variance =
    closes.reduce(
      (sum, value) =>
        sum +
        Math.pow(
          value - mean,
          2
        ),
      0
    ) /
    closes.length;

  return Math.sqrt(
    variance
  );
}

// ============================================================
// CRT CONFIRMATION
// ============================================================
//
// Rachel_T fractal confirmation is the PRIMARY event.
//
// This function intentionally does not suppress a signal just
// because another signal was recently generated.
//
// The caller / signalManager may deduplicate the SAME candle
// and SAME fractal ID, but legitimate new confirmed fractals
// are always allowed through.
//
// ============================================================

function confirmCRT(
  fractal,
  candles
) {
  if (!fractal) {
    return false;
  }

  if (
    !Array.isArray(candles) ||
    !candles.length
  ) {
    return false;
  }

  // ==========================================================
  // The existence of a confirmed Rachel_T fractal is enough
  // for the primary fractal signal.
  //
  // Do not add an artificial second confirmation gate.
  // ==========================================================

  return true;
}

// ============================================================
// SIGNAL ID
// ============================================================
//
// The ID uniquely identifies a particular confirmed fractal.
//
// This is NOT a frequency limiter.
//
// A new fractal gets a new ID and must be sent.
//
// ============================================================

function createSignalId({
  symbol,
  market,
  timeframe,
  fractal,
}) {
  return [
    symbol || 'UNKNOWN',
    market || 'UNKNOWN',
    timeframe || 'UNKNOWN',
    fractal?.type || 'UNKNOWN',
    fractal?.pivotTime ??
      fractal?.confirmationTime ??
      'UNKNOWN',
  ].join(':');
}

// ============================================================
// BUILD SIGNAL
// ============================================================
//
// This is the main closed-candle signal builder.
//
// IMPORTANT:
//
// Market structure is calculated ONLY from the candles supplied
// for this designated timeframe.
//
// Example:
//
// buildSignal(15m candles)
//
// => 15M structure.
//
// buildSignal(1h candles)
//
// => 1H structure.
//
// buildSignal(1d candles)
//
// => Daily structure.
//
// There is NO cross-timeframe structure inheritance.
//
// ============================================================

export function buildSignal(
  candles,
  options = {}
) {
  const closed =
    getClosedCandles(candles);

  if (
    closed.length < 5
  ) {
    return null;
  }

  const fractals =
    findFractals(
      closed
    );

  if (!fractals.length) {
    return null;
  }

  // ==========================================================
  // The newest confirmed Rachel_T fractal.
  // ==========================================================

  const latestFractal =
    fractals[
      fractals.length - 1
    ];

  if (!latestFractal) {
    return null;
  }

  // ==========================================================
  // Determine whether this fractal has just become confirmed
  // on the latest closed candle.
  // ==========================================================

  const latestClosedIndex =
    closed.length - 1;

  if (
    Number(
      latestFractal.confirmationIndex
    ) !==
    latestClosedIndex
  ) {
    return null;
  }

  // ==========================================================
  // PRIMARY CONFIRMATION
  // ==========================================================

  const confirmed =
    confirmCRT(
      latestFractal,
      closed
    );

  if (!confirmed) {
    return null;
  }

  // ==========================================================
  // MARKET STRUCTURE
  //
  // SAME TIMEFRAME ONLY.
  // ==========================================================

  const structure =
    calculateDirectionalStructure(
      fractals
    );

  // ==========================================================
  // CLOSED-CANDLE LIQUIDITY
  // ==========================================================

  const liquiditySweep =
    findLiquiditySweep(
      closed,
      fractals
    );

  // ==========================================================
  // RSI
  // ==========================================================

  const rsi =
    calculateRSIState(
      closed,
      options.rsi || {}
    );

  // ==========================================================
  // STD
  // ==========================================================

  const stdDeviation =
    calculateStandardDeviation(
      closed
    );

  // ==========================================================
  // FRACTAL DATA
  // ==========================================================

  const fractalSignal =
    buildFractalSignal(
      latestFractal
    );

  // ==========================================================
  // SYMBOL / MARKET / TIMEFRAME
  // ==========================================================

  const symbol =
    options.symbol ??
    options.coin ??
    null;

  const market =
    options.market ??
    options.marketType ??
    null;

  const timeframe =
    options.timeframe ??
    null;

  // ==========================================================
  // SIGNAL ID
  // ==========================================================

  const signalId =
    createSignalId({
      symbol,
      market,
      timeframe,
      fractal:
        latestFractal,
    });

  // ==========================================================
  // RETURN
  // ==========================================================

  return {
    signalId,

    id:
      signalId,

    confirmed: true,

    confirmedCRT: true,

    crtConfirmed: true,

    symbol,

    market,

    marketType:
      market,

    timeframe,

    candleTime:
      getCandleTime(
        closed[
          closed.length - 1
        ]
      ),

    candle:
      closed[
        closed.length - 1
      ],

    // ========================================================
    // RACHEL_T
    // ========================================================

    fractal:
      latestFractal,

    fractalType:
      fractalSignal
        ?.fractalTypeShort ??
      latestFractal.type,

    fractalLabel:
      fractalSignal
        ?.fractalType ??
      latestFractal.fractalType,

    fractalPrice:
      fractalSignal
        ?.fractalPrice ??
      latestFractal.price,

    pivotCandle:
      fractalSignal
        ?.pivotCandle ??
      latestFractal.candle,

    pivotTime:
      fractalSignal
        ?.pivotTime ??
      latestFractal.pivotTime,

    confirmationCandle:
      fractalSignal
        ?.confirmationCandle ??
      latestFractal.confirmationCandle,

    confirmationTime:
      fractalSignal
        ?.confirmationTime ??
      latestFractal.confirmationTime,

    // ========================================================
    // MARKET STRUCTURE
    // ========================================================

    marketStructure:
      structure.marketStructure,

    structure:
      structure.marketStructure,

    market_structure:
      structure.marketStructure,

    structureType:
      structure.structureType,

    structurePrice:
      structure.structurePrice,

    higherHigh:
      structure.higherHigh,

    higherLow:
      structure.higherLow,

    lowerHigh:
      structure.lowerHigh,

    lowerLow:
      structure.lowerLow,

    // ========================================================
    // LIQUIDITY
    // ========================================================

    liquiditySweep,

    // ========================================================
    // RSI
    // ========================================================

    rsi:
      rsi.value,

    rsiValue:
      rsi.value,

    rsiState:
      rsi.state,

    // ========================================================
    // STD
    // ========================================================

    stdDeviation,

    stdDev:
      stdDeviation,

    standardDeviation:
      stdDeviation,

    // ========================================================
    // HISTORICAL FRACTALS
    // ========================================================

    fractals,
  };
}

// ============================================================
// BUILD LIVE STATE
// ============================================================
//
// This function is intentionally separate from buildSignal().
//
// buildSignal()
//   = completed MEXC candle + confirmed Rachel_T signal
//
// buildLiveState()
//   = currently running MEXC candle + live liquidity sweep
//
// This allows the service to monitor a candle before it closes.
//
// ============================================================

export function buildLiveState(
  candles,
  options = {}
) {
  if (
    !Array.isArray(candles) ||
    !candles.length
  ) {
    return null;
  }

  const fractals =
    findFractals(
      candles
    );

  if (!fractals.length) {
    return {
      symbol:
        options.symbol ??
        null,

      market:
        options.market ??
        null,

      marketType:
        options.marketType ??
        options.market ??
        null,

      timeframe:
        options.timeframe ??
        null,

      candle:
        candles[
          candles.length - 1
        ],

      candleTime:
        getCandleTime(
          candles[
            candles.length - 1
          ]
        ),

      liveLiquiditySweep: {
        swept: false,
        currentlySwept: false,
        type: null,
        label: 'None',
        price: null,
        fractal: null,
        currentCandle:
          candles[
            candles.length - 1
          ],
        currentCandleTime:
          getCandleTime(
            candles[
              candles.length - 1
            ]
          ),
        sweepPrice: null,
      },

      fractals,
    };
  }

  const liveLiquiditySweep =
    findLiveLiquiditySweep(
      candles,
      fractals
    );

  // ==========================================================
  // Structure is still calculated from the designated
  // timeframe's fractals.
  // ==========================================================

  const structure =
    calculateDirectionalStructure(
      fractals
    );

  return {
    symbol:
      options.symbol ??
      null,

    market:
      options.market ??
      null,

    marketType:
      options.marketType ??
      options.market ??
      null,

    timeframe:
      options.timeframe ??
      null,

    candle:
      candles[
        candles.length - 1
      ],

    candleTime:
      getCandleTime(
        candles[
          candles.length - 1
        ]
      ),

    marketStructure:
      structure.marketStructure,

    structure:
      structure.marketStructure,

    structureType:
      structure.structureType,

    liveLiquiditySweep,

    fractals,
  };
}

// ============================================================
// GET CONFIRMED FRACTALS
// ============================================================
//
// Public helper for the service.
//
// ============================================================

export function getConfirmedFractals(
  candles
) {
  return findFractals(
    getClosedCandles(
      candles
    )
  );
}

// ============================================================
// GET MARKET STRUCTURE
// ============================================================
//
// Public helper.
//
// ============================================================

export function getMarketStructure(
  candles
) {
  const closed =
    getClosedCandles(
      candles
    );

  const fractals =
    findFractals(
      closed
    );

  return calculateDirectionalStructure(
    fractals
  );
}

// ============================================================
// GET LIQUIDITY
// ============================================================
//
// Public helper for closed candle state.
//
// ============================================================

export function getLiquiditySweep(
  candles
) {
  const closed =
    getClosedCandles(
      candles
    );

  const fractals =
    findFractals(
      closed
    );

  return findLiquiditySweep(
    closed,
    fractals
  );
}

// ============================================================
// GET LIVE LIQUIDITY
// ============================================================
//
// Public helper for currently running candle.
//
// ============================================================

export function getLiveLiquiditySweep(
  candles
) {
  const fractals =
    findFractals(
      candles
    );

  return findLiveLiquiditySweep(
    candles,
    fractals
  );
}

// ============================================================
// DEFAULT EXPORT
// ============================================================

export default {
  buildSignal,
  buildLiveState,

  findFractals,
  getConfirmedFractals,

  getMarketStructure,

  getLiquiditySweep,
  getLiveLiquiditySweep,
};
// ============================================================
// END OF crtEngine.js
// ============================================================
//
// PUBLIC API:
//
// buildSignal()
// buildLiveState()
//
// findFractals()
// getConfirmedFractals()
//
// getMarketStructure()
//
// getLiquiditySweep()
// getLiveLiquiditySweep()
//
// ============================================================

// Nothing else is required below this point.

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
// and latest BOTTOM together.
//
// This avoids incorrectly calling every TOP bullish or every
// BOTTOM bearish.
//
// ============================================================

function calculateCombinedStructure(
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

  let higherHigh = false;
  let lowerHigh = false;
  let higherLow = false;
  let lowerLow = false;

  if (tops.length >= 2) {
    const latestTop =
      tops[tops.length - 1];

    const previousTop =
      tops[tops.length - 2];

    higherHigh =
      latestTop.price >
      previousTop.price;

    lowerHigh =
      latestTop.price <
      previousTop.price;
  }

  if (bottoms.length >= 2) {
    const latestBottom =
      bottoms[bottoms.length - 1];

    const previousBottom =
      bottoms[bottoms.length - 2];

    higherLow =
      latestBottom.price >
      previousBottom.price;

    lowerLow =
      latestBottom.price <
      previousBottom.price;
  }

  if (
    higherHigh &&
    higherLow
  ) {
    return {
      marketStructure: 'BULLISH',
      structureType:
        'HIGHER HIGH / HIGHER LOW',
    };
  }

  if (
    lowerHigh &&
    lowerLow
  ) {
    return {
      marketStructure: 'BEARISH',
      structureType:
        'LOWER HIGH / LOWER LOW',
    };
  }

  // If only one side confirms a structure,
  // preserve that directional information.

  if (
    higherHigh ||
    higherLow
  ) {
    return {
      marketStructure: 'BULLISH',
      structureType:
        higherHigh
          ? 'HIGHER HIGH'
          : 'HIGHER LOW',
    };
  }

  if (
    lowerHigh ||
    lowerLow
  ) {
    return {
      marketStructure: 'BEARISH',
      structureType:
        lowerHigh
          ? 'LOWER HIGH'
          : 'LOWER LOW',
    };
  }

  return {
    marketStructure: 'NEUTRAL',
    structureType: 'NONE',
  };
}

// ============================================================
// STANDARD DEVIATION
// ============================================================
//
// Supplementary information only.
//
// Calculated from closed candle closing prices.
//
// Population standard deviation is used here because the
// display is describing the current observed candle set.
//
// ============================================================

function calculateStdDeviation(
  candles
) {
  const values = candles
    .map((candle) =>
      number(candle.close)
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
    ) / values.length;

  const variance =
    values.reduce(
      (sum, value) =>
        sum +
        Math.pow(
          value - mean,
          2
        ),
      0
    ) / values.length;

  return Math.sqrt(variance);
}

// ============================================================
// FRACTAL LIQUIDITY SWEEP
// ============================================================
//
// IMPORTANT:
//
// Liquidity is NOT based on simply:
//
// previous candle high
// previous candle low
//
// It is based on PREVIOUS CONFIRMED RACHEL_T FRACTALS.
//
// TOP FRACTAL:
//
// Current price sweeps previous TOP fractal price.
//
// BOTTOM FRACTAL:
//
// Current price sweeps previous BOTTOM fractal price.
//
// This allows the CRT confirmation to reference the actual
// previous fractal liquidity.
//
// ============================================================

function detectFractalLiquiditySweep(
  candles,
  fractals,
  latest
) {
  if (
    !latest ||
    !Array.isArray(fractals)
  ) {
    return {
      swept: false,
      type: 'NONE',
      label: 'None',
      level: null,
      fractal: null,
    };
  }

  const previousFractals =
    fractals.filter(
      (fractal) =>
        fractal.confirmationIndex <
        latest.confirmationIndex
    );

  if (!previousFractals.length) {
    return {
      swept: false,
      type: 'NONE',
      label: 'None',
      level: null,
      fractal: null,
    };
  }

  // ==========================================================
  // PREVIOUS TOP LIQUIDITY
  // ==========================================================

  const previousTops =
    previousFractals.filter(
      (fractal) =>
        fractal.type === 'TOP'
    );

  // ==========================================================
  // PREVIOUS BOTTOM LIQUIDITY
  // ==========================================================

  const previousBottoms =
    previousFractals.filter(
      (fractal) =>
        fractal.type === 'BOTTOM'
    );

  // ==========================================================
  // CURRENT CONFIRMED FRACTAL IS TOP
  //
  // Look for previous TOP liquidity.
  // The latest pivot itself is excluded.
  // ==========================================================

  if (
    latest.type === 'TOP' &&
    previousTops.length
  ) {
    const previousTop =
      previousTops[
        previousTops.length - 1
      ];

    if (
      latest.price >
      previousTop.price
    ) {
      return {
        swept: true,
        type: 'HIGH',
        label:
          '**PREVIOUS FRACTAL HIGH SWEPT**',
        level:
          previousTop.price,
        fractal:
          previousTop,
      };
    }
  }

  // ==========================================================
  // CURRENT CONFIRMED FRACTAL IS BOTTOM
  //
  // Look for previous BOTTOM liquidity.
  // ==========================================================

  if (
    latest.type === 'BOTTOM' &&
    previousBottoms.length
  ) {
    const previousBottom =
      previousBottoms[
        previousBottoms.length - 1
      ];

    if (
      latest.price <
      previousBottom.price
    ) {
      return {
        swept: true,
        type: 'LOW',
        label:
          '**PREVIOUS FRACTAL LOW SWEPT**',
        level:
          previousBottom.price,
        fractal:
          previousBottom,
      };
    }
  }

  // ==========================================================
  // NONE
  // ==========================================================

  return {
    swept: false,
    type: 'NONE',
    label: 'None',
    level: null,
    fractal: null,
  };
}

// ============================================================
// CRT DIRECTION
// ============================================================
//
// The Rachel_T fractal is the signal.
//
// FILTERED BOTTOM:
// BUY-side CRT confirmation.
//
// FILTERED TOP:
// SELL-side CRT confirmation.
//
// Direction is derived from the fractal type, not from RSI,
// market structure, or candle color.
//
// ============================================================

function getDirection(
  fractal
) {
  if (!fractal) {
    return null;
  }

  if (
    fractal.type === 'BOTTOM'
  ) {
    return 'BUY';
  }

  if (
    fractal.type === 'TOP'
  ) {
    return 'SELL';
  }

  return null;
}

// ============================================================
// FRACTAL CONFIRMATION
// ============================================================
//
// A fractal is confirmed when the two candles to its right
// have closed.
//
// This corresponds directly to the Pine [2] relationship.
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

  return (
    fractal.confirmationIndex <
    candles.length
  );
}

// ============================================================
// SIGNAL ID
// ============================================================
//
// IMPORTANT:
//
// Use the CONFIRMATION CANDLE TIME.
//
// This prevents duplicate alerts for the same confirmed
// fractal after Railway restart / repeated polling.
//
// ============================================================

function buildSignalId(
  symbol,
  market,
  timeframe,
  fractal
) {
  return [
    market,
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
// This is the main public engine function.
//
// Rachel_T Fractal:
// PRIMARY
//
// RSI:
// SUPPLEMENTARY
//
// STD Deviation:
// SUPPLEMENTARY
//
// Market Structure:
// SUPPLEMENTARY
//
// Liquidity Sweep:
// SUPPLEMENTARY
//
// ============================================================

export function buildSignal({
  symbol,
  market,
  timeframe,
  candles,
  rsiPeriod =
    DEFAULT_RSI_PERIOD,
  oversold =
    DEFAULT_OVERSOLD,
  overbought =
    DEFAULT_OVERBOUGHT,
}) {
  const closedCandles =
    getClosedCandles(
      candles
    );

  // ==========================================================
  // Minimum candle requirement
  //
  // 5 candles are required for the exact [4]...[0] fractal
  // calculation.
  //
  // RSI requires additional history.
  // ==========================================================

  const minimumCandles =
    Math.max(
      5,
      Number(rsiPeriod) + 2
    );

  if (
    closedCandles.length <
    minimumCandles
  ) {
    return null;
  }

  // ==========================================================
  // FIND ALL CONFIRMED RACHEL_T FRACTALS
  // ==========================================================

  const fractals =
    findFractals(
      closedCandles
    );

  if (!fractals.length) {
    return null;
  }

  // ==========================================================
  // LATEST CONFIRMED FRACTAL
  // ==========================================================

  const latest =
    fractals[
      fractals.length - 1
    ];

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
  // RSI
  //
  // SUPPLEMENTARY ONLY.
  //
  // RSI DOES NOT CREATE THE SIGNAL.
  // ==========================================================

  const closes =
    closedCandles.map(
      (candle) =>
        Number(candle.close)
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
      closedCandles
    );

  // ==========================================================
  // MARKET STRUCTURE
  // ==========================================================

  const individualStructure =
    calculateMarketStructure(
      fractals,
      latest
    );

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
  // FRACTAL LIQUIDITY
  // ==========================================================

  const liquiditySweep =
    detectFractalLiquiditySweep(
      closedCandles,
      fractals,
      latest
    );

  // ==========================================================
  // STRENGTH
  //
  // This does NOT affect whether the fractal is confirmed.
  //
  // It is only descriptive.
  // ==========================================================

  const strength =
    (
      direction === 'BUY' &&
      rsiState === 'OVERSOLD'
    ) ||
    (
      direction === 'SELL' &&
      rsiState === 'OVERBOUGHT'
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
      timeframe,
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
    market,
    timeframe,

    // ========================================================
    // PRIMARY RACHEL_T SIGNAL
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
    },

    // ========================================================
    // CONFIRMATION
    // ========================================================

    confirmed: true,

    confirmedCRT: true,

    crtConfirmed: true,

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
    // LIQUIDITY SWEEP
    // ========================================================

    liquiditySweep,

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
    // EXACT FRACTAL CANDLE TIME
    //
    // candleTime is the actual pivot candle, NOT the
    // confirmation candle.
    //
    // This is important because the displayed Fractal Price
    // belongs to the pivot candle.
    // ========================================================

    candleTime:
      latest.pivotTime,

    confirmationTime:
      latest.confirmationTime,

    // ========================================================
    // PRICE
    //
    // Kept for compatibility with existing crtService.js.
    //
    // This is NOT used as the Fractal Price.
    // ========================================================

    price:
      latest.price,

    // ========================================================
    // FRACTAL HIGH / LOW COMPATIBILITY
    // ========================================================

    signalHigh:
      latest.type === 'TOP'
        ? latest.price
        : null,

    signalLow:
      latest.type === 'BOTTOM'
        ? latest.price
        : null,

    // ========================================================
    // CRT COMPATIBILITY
    //
    // These fields exist so the current service does not
    // crash if it references them.
    //
    // They are NOT used to determine the Rachel_T fractal.
    // ========================================================

    parentHigh: null,

    parentLow: null,

    closedInside: true,
  };
}

// ============================================================
// DETECT CRT
// ============================================================
//
// Compatibility wrapper.
//
// IMPORTANT:
// This is NO LONGER the old two-candle CRT detector.
//
// The primary confirmation is the Rachel_T filtered fractal.
//
// ============================================================

export function detectCRT(
  candles,
  options = {}
) {
  const closed =
    getClosedCandles(
      candles
    );

  if (closed.length < 5) {
    return null;
  }

  const fractal =
    getLatestFractal(
      closed
    );

  if (!fractal) {
    return null;
  }

  const direction =
    getDirection(
      fractal
    );

  if (!direction) {
    return null;
  }

  return {
    direction,

    fractalType:
      fractal.fractalType,

    fractalPrice:
      fractal.price,

    fractal,

    signal:
      fractal.confirmationCandle,

    parent:
      fractal.candle,

    candleTime:
      fractal.pivotTime,

    confirmationTime:
      fractal.confirmationTime,

    // Compatibility fields.
    parentHigh: null,
    parentLow: null,

    signalHigh:
      fractal.type === 'TOP'
        ? fractal.price
        : null,

    signalLow:
      fractal.type === 'BOTTOM'
        ? fractal.price
        : null,

    closedInside: true,

    sweptLow:
      fractal.type === 'BOTTOM',

    sweptHigh:
      fractal.type === 'TOP',
  };
}

// ============================================================
// EXPORT FRACTAL CALCULATORS
// ============================================================
//
// Exported for debugging/testing.
//
// This allows crtService.js or another module to verify that
// the exact Rachel_T fractal is being detected.
//
// ============================================================

export {
  isFilteredTopAt,
  isFilteredBottomAt,
  calculateStdDeviation,
  calculateMarketStructure,
  calculateCombinedStructure,
  detectFractalLiquiditySweep,
};

// ============================================================
// ENGINE LOADED
// ============================================================

console.log(
  '[CRT ENGINE] Rachel_T Filtered Top/Bottom Fractal engine loaded.'
);

console.log(
  '[CRT ENGINE] filterBW=false • Bill Williams filtered fractal logic active.'
);

console.log(
  '[CRT ENGINE] Fractal price = high[2] / low[2].'
);

console.log(
  '[CRT ENGINE] Fractal confirmation = 2 candles after pivot.'
);

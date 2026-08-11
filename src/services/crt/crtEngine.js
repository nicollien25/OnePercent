// ============================================================
// PDYN CRT ENGINE
// ============================================================
//
// PRIMARY SIGNAL:
//
//   Rachel T Filtered Top / Bottom Fractal
//
// FRACTAL LOGIC:
//
//   FILTERED TOP:
//
//     high[4] < high[2]
//     high[3] <= high[2]
//     high[2] >= high[1]
//     high[2] > high[0]
//
//   FILTERED BOTTOM:
//
//     low[4] > low[2]
//     low[3] >= low[2]
//     low[2] <= low[1]
//     low[2] < low[0]
//
// FRACTAL CONFIRMATION:
//
//   The fractal pivot is [2].
//   Two candles must close after the pivot.
//
// LIQUIDITY:
//
//   IMPORTANT:
//
//   Liquidity is based ONLY on confirmed Rachel T fractals.
//
//   It does NOT use:
//
//     • Current candle wick
//     • Previous candle wick
//     • CRT confirmation candle
//     • Previous candle high/low
//
//   It scans ALL confirmed fractals and compares:
//
//     Latest TOP
//       vs
//     Previous confirmed TOP
//
//     Latest BOTTOM
//       vs
//     Previous confirmed BOTTOM
//
//   TOP:
//
//     latest TOP > previous TOP
//       => PREVIOUS FRACTAL HIGH SWEPT
//
//   BOTTOM:
//
//     latest BOTTOM < previous BOTTOM
//       => PREVIOUS FRACTAL LOW SWEPT
//
// CRT CONFIRMATION:
//
//   CRT confirmation is separate from liquidity.
//
//   BUY / BOTTOM:
//
//     • confirmation candle sweeps previous candle LOW
//     • closes back inside previous candle range
//
//   SELL / TOP:
//
//     • confirmation candle sweeps previous candle HIGH
//     • closes back inside previous candle range
//
//   This CRT candle check does NOT determine the Liquidity field.
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
// CLOSED CANDLES ONLY
// ============================================================
//
// The engine never intentionally uses a candle where:
//   candle.closed === false
//
// The service already removes the active candle, but the engine
// protects itself as well.
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
// FIND ALL CONFIRMED RACHEL T FRACTALS
// ============================================================
//
// Every confirmed fractal is stored.
//
// IMPORTANT:
//
// We do NOT only keep the latest fractal.
//
// The complete confirmed-fractal history is required for the
// Liquidity calculation.
//
// ============================================================

export function findFractals(candles) {
  const closed =
    getClosedCandles(
      candles
    );

  if (
    closed.length < 5
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
    const pivotIndex =
      confirmationIndex - 2;

    // ========================================================
    // FILTERED TOP
    // ========================================================

    if (
      isFilteredTopAt(
        closed,
        confirmationIndex
      )
    ) {
      const pivot =
        closed[pivotIndex];

      const price =
        number(
          pivot.high
        );

      if (
        price !== null
      ) {
        fractals.push({
          type:
            'TOP',

          fractalType:
            'FILTERED TOP',

          price,

          candle:
            pivot,

          pivotIndex,

          confirmationCandle:
            closed[
              confirmationIndex
            ],

          confirmationIndex,

          pivotTime:
            getCandleTime(
              pivot
            ),

          confirmationTime:
            getCandleTime(
              closed[
                confirmationIndex
              ]
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
      const pivot =
        closed[pivotIndex];

      const price =
        number(
          pivot.low
        );

      if (
        price !== null
      ) {
        fractals.push({
          type:
            'BOTTOM',

          fractalType:
            'FILTERED BOTTOM',

          price,

          candle:
            pivot,

          pivotIndex,

          confirmationCandle:
            closed[
              confirmationIndex
            ],

          confirmationIndex,

          pivotTime:
            getCandleTime(
              pivot
            ),

          confirmationTime:
            getCandleTime(
              closed[
                confirmationIndex
              ]
            ),
        });
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
// GET LATEST CONFIRMED FRACTAL
// ============================================================

export function getLatestFractal(
  candles
) {
  const fractals =
    findFractals(
      candles
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
// IMPORTANT:
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
    !Array.isArray(
      fractals
    )
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
// THIS IS THE IMPORTANT CHANGE.
//
// We scan ALL confirmed Rachel T fractals.
//
// Then:
//
//   latest TOP
//       ↓
//   previous confirmed TOP
//       ↓
//   latest.price > previous.price
//       ↓
//   PREVIOUS FRACTAL HIGH SWEPT
//
// OR:
//
//   latest BOTTOM
//       ↓
//   previous confirmed BOTTOM
//       ↓
//   latest.price < previous.price
//       ↓
//   PREVIOUS FRACTAL LOW SWEPT
//
// There is NO candle wick logic here.
//
// There is NO CRT candle logic here.
//
// There is NO previous-candle logic here.
//
// ============================================================

function detectFractalLiquiditySweep(
  candles,
  fractals,
  latest
) {
  // ==========================================================
  // SAFETY
  // ==========================================================

  if (
    !latest ||
    !Array.isArray(
      fractals
    ) ||
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
  // STEP 1
  //
  // ALL CONFIRMED FRACTALS BEFORE THE LATEST FRACTAL
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
  // STEP 2
  //
  // KEEP ONLY THE SAME FRACTAL TYPE
  //
  // TOP -> TOP
  // BOTTOM -> BOTTOM
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
  // STEP 3
  //
  // IMMEDIATELY PREVIOUS CONFIRMED SAME-TYPE FRACTAL
  // ==========================================================

  const previousFractal =
    previousSameType[
      previousSameType.length - 1
    ];

  if (
    !previousFractal
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
  // STEP 4
  //
  // LATEST TOP VS PREVIOUS TOP
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
          '**PREVIOUS FRACTAL HIGH SWEPT**',

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
  // STEP 5
  //
  // LATEST BOTTOM VS PREVIOUS BOTTOM
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
          '**PREVIOUS FRACTAL LOW SWEPT**',

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
  // UNKNOWN TYPE
  // ==========================================================

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

function isConfirmedFractal(
  fractal,
  candles
) {
  if (
    !fractal ||
    !Array.isArray(
      candles
    )
  ) {
    return false;
  }

  return (
    Number.isInteger(
      fractal.confirmationIndex
    ) &&
    fractal.confirmationIndex >= 0 &&
    fractal.confirmationIndex <
      candles.length
  );
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
// This is NOT Liquidity.
//
// This is only the CRT confirmation candle.
//
// BUY / BOTTOM:
//
//   signal LOW < parent LOW
//   AND
//   signal CLOSE is inside parent range
//
// SELL / TOP:
//
//   signal HIGH > parent HIGH
//   AND
//   signal CLOSE is inside parent range
//
// ============================================================

function confirmCRTCandle(
  fractal,
  candles,
  options = {}
) {
  if (
    !fractal ||
    !Array.isArray(
      candles
    )
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
    ) ||
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

  crtOptions = {},
}) {
  // ==========================================================
  // CLOSED CANDLES
  // ==========================================================

  const closedCandles =
    getClosedCandles(
      candles
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
  // FIND ALL CONFIRMED FRACTALS
  // ==========================================================

  const fractals =
    findFractals(
      closedCandles
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
  //
  // Liquidity is NOT used here.
  //
  // CRT confirmation is independent.
  //
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
  // THIS IS NOW EXCLUSIVELY:
  //
  //   latest confirmed fractal
  //            vs
  //   previous confirmed same-type fractal
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
    //
    // ONLY CONFIRMED FRACTAL HISTORY.
    // ========================================================

    liquiditySweep,

    // Explicit compatibility fields.
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
        crtConfirmation
          .signalCandle
      ),

    // ========================================================
    // PRICE COMPATIBILITY
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
    // CRT RANGE COMPATIBILITY
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
    //
    // Kept in the signal so debugging can show exactly which
    // fractals were scanned for liquidity.
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
// This function performs the same actual CRT confirmation
// used by buildSignal().
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

  if (
    closed.length < 5
  ) {
    return null;
  }

  const fractals =
    findFractals(
      closed
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

  if (
    !latest
  ) {
    return null;
  }

  const direction =
    getDirection(
      latest
    );

  if (
    !direction
  ) {
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
    //
    // CONFIRMED FRACTAL HISTORY ONLY.
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
  candles
) {
  return getLatestFractal(
    candles
  );
}

// ============================================================
// TEST LIQUIDITY
// ============================================================
//
// This helper allows you to inspect exactly how Liquidity is
// being determined.
//
// ============================================================

export function testLiquidity(
  candles
) {
  const closed =
    getClosedCandles(
      candles
    );

  if (
    closed.length < 5
  ) {
    return null;
  }

  const fractals =
    findFractals(
      closed
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
  candles
) {
  const closed =
    getClosedCandles(
      candles
    );

  if (
    closed.length < 20
  ) {
    return null;
  }

  const fractals =
    findFractals(
      closed
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
};

// ============================================================
// ENGINE LOADED
// ============================================================

console.log(
  '[CRT ENGINE] Rachel T Filtered Top/Bottom Fractal engine loaded.'
);

console.log(
  '[CRT ENGINE] filterBW=false.'
);

console.log(
  '[CRT ENGINE] Fractal pivot = high[2] / low[2].'
);

console.log(
  '[CRT ENGINE] Fractal confirmation = 2 closed candles after pivot.'
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
  '[CRT ENGINE] Actual CRT candle confirmation remains separate.'
);

console.log(
  '[CRT ENGINE] Currently-forming candles are rejected.'
);

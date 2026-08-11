/**
 * RSI(14) using Wilder's smoothing.
 * Returns null until enough closes are available.
 */
export function calculateRSI(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  if (!Number.isInteger(period) || period < 2) throw new Error('RSI period must be an integer >= 2');

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i += 1) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gain += change;
    else loss -= change;
  }

  gain /= period;
  loss /= period;

  for (let i = period + 1; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    const currentGain = Math.max(change, 0);
    const currentLoss = Math.max(-change, 0);
    gain = ((gain * (period - 1)) + currentGain) / period;
    loss = ((loss * (period - 1)) + currentLoss) / period;
  }

  if (loss === 0) return 100;
  if (gain === 0) return 0;

  const rs = gain / loss;
  return 100 - (100 / (1 + rs));
}

export function getRSIState(rsi, oversold = 30, overbought = 70) {
  if (rsi == null) return 'UNAVAILABLE';
  if (rsi <= oversold) return 'OVERSOLD';
  if (rsi >= overbought) return 'OVERBOUGHT';
  return 'NEUTRAL';
}

import assert from 'node:assert/strict';
import { detectCRT } from '../src/services/crt/crtEngine.js';

const candles = [
  { openTime: 1, open: 100, high: 110, low: 90, close: 105, closed: true },
  { openTime: 2, open: 100, high: 106, low: 88, close: 103, closed: true },
];

const result = detectCRT(candles);
assert.equal(result.direction, 'BUY');
assert.equal(result.closedInside, true);

const bearish = [
  { openTime: 1, open: 100, high: 110, low: 90, close: 95, closed: true },
  { openTime: 2, open: 100, high: 112, low: 94, close: 104, closed: true },
];

const result2 = detectCRT(bearish);
assert.equal(result2.direction, 'SELL');

console.log('CRT engine tests passed.');

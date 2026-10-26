import { test } from 'node:test';
import assert from 'node:assert/strict';
import { median, pairedStats, holm } from './stats.mjs';

test('paired results should keep zero effects and zero baselines explicit', () => {
  assert.equal(median([3, 1, 2, 4]), 2.5);
  const result = pairedStats(Array.from({ length: 8 }, () => [0, 0]), 500);
  assert.deepEqual(result.deltaCI95, [0, 0]);
  assert.equal(result.percentChange, null);
  assert.equal(result.signFlipP, 1);
});
test('a constant paired effect should have an exact sign-flip probability', () => {
  const result = pairedStats(Array.from({ length: 8 }, () => [2, 1]), 500);
  assert.equal(result.pairedMedianDelta, -1);
  assert.deepEqual(result.deltaCI95, [-1, -1]);
  assert.equal(result.signFlipP, 2 / 256);
});
test('Holm adjustment should preserve original ordering and enforce monotonic adjusted probabilities', () => {
  assert.deepEqual(holm([.04, .001, .03]), [.06, .003, .06]);
  assert.throws(() => pairedStats([]));
  assert.throws(() => pairedStats([[1, 2, 3]]));
});

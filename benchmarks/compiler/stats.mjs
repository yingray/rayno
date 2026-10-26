export function median(values) {
  if (!values.length) throw new Error('No samples.');
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
function random(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
const quantile = (values, fraction) => values[Math.floor((values.length - 1) * fraction)];

// Resample complete adjacent pairs. Repeated interactions within a page are not independent units.
export function pairedStats(pairs, iterations = 20000) {
  if (!pairs.length || pairs.length > 20 || pairs.some(pair => pair.length !== 2 || !pair.every(Number.isFinite))) throw new Error('Invalid pairs.');
  const deltas = pairs.map(([off, on]) => on - off), rng = random(26319), boot = [];
  for (let index = 0; index < iterations; index++) {
    boot.push(median(Array.from({ length: pairs.length }, () => deltas[Math.floor(rng() * deltas.length)])));
  }
  boot.sort((a, b) => a - b);
  const observed = Math.abs(mean(deltas));
  let extreme = 0;
  // Exact two-sided sign-flip test for the paired mean difference.
  for (let mask = 0; mask < 2 ** pairs.length; mask++) {
    const value = Math.abs(mean(deltas.map((delta, index) => mask & 2 ** index ? delta : -delta)));
    if (value >= observed - 1e-12) extreme++;
  }
  const off = median(pairs.map(pair => pair[0])), on = median(pairs.map(pair => pair[1]));
  return { pairs: pairs.length, offMedian: off, onMedian: on, pairedMedianDelta: median(deltas),
    deltaCI95: [quantile(boot, .025), quantile(boot, .975)],
    percentChange: off > 0 ? (on / off - 1) * 100 : null,
    signFlipP: extreme / 2 ** pairs.length, offValues: pairs.map(pair => pair[0]), onValues: pairs.map(pair => pair[1]) };
}

// Adjust a family of exploratory comparisons before any significance claim.
export function holm(pValues) {
  const sorted = pValues.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = [];
  let previous = 0;
  for (let rank = 0; rank < sorted.length; rank++) {
    previous = Math.min(1, Math.max(previous, sorted[rank].value * (sorted.length - rank)));
    result[sorted[rank].index] = previous;
  }
  return result;
}

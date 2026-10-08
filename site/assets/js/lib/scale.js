// Small scale helpers for the SVG charts.

/** Linear scale. A zero-width domain maps everything to the middle of the range (no divide-by-zero). */
export function linear([d0, d1], [r0, r1]) {
  const span = d1 - d0;
  if (!Number.isFinite(span) || span === 0) return () => (r0 + r1) / 2;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

const round12 = (n) => Number(n.toPrecision(12)); // strips 0.30000000000000004-style noise

/**
 * "Nice" axis for [min, max]: returns an extended domain and tick values at 1/2/5 x 10^k steps.
 * Handles min === max (pads), min > max (swaps) and non-finite input (empty result).
 */
export function niceScale(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 1, ticks: [0, 1] };
  if (min > max) [min, max] = [max, min];
  if (min === max) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
    min -= pad;
    max += pad;
  }
  const rawStep = (max - min) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const niceMin = round12(Math.floor(min / step + 1e-9) * step);
  const niceMax = round12(Math.ceil(max / step - 1e-9) * step);
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step * 1e-9; v += step) ticks.push(round12(v));
  return { min: niceMin, max: niceMax, step: round12(step), ticks };
}

/** Integer year ticks starting AT min (so the baseline year is always labelled). */
export function yearTicks(min, max, maxCount = 7) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return [];
  if (min === max) return [min];
  const span = max - min;
  const steps = [1, 2, 5, 10, 20, 50];
  const step = steps.find((s) => span / s + 1 <= maxCount) ?? 100;
  const ticks = [];
  for (let y = min; y <= max; y += step) ticks.push(y);
  if (ticks[ticks.length - 1] !== max && max - ticks[ticks.length - 1] >= step / 2) ticks.push(max);
  return ticks;
}

// Pure logic for the map dashboard: filtering, aggregation, binning, colour lookup. No DOM here (unit-tested).

export const STATUS_ORDER = ['Operating', 'Development', 'Proposed', 'Unknown'];
export const CAPACITY_ORDER = ['Mega campus (1,000+ MW)', 'Hyperscale (100–999 MW)', 'Large (51–99 MW)', 'Medium (11–50 MW)', 'Small (0–10 MW)', 'Unknown'];
export const TYPE_ORDER = ['Colocation', 'Hyperscale', 'Carrier-Neutral', 'Carrier', 'Mobile', 'Fintech', 'Content', 'Real Estate', 'Enterprise', 'MSP', 'Unknown'];
export const SOURCE_ORDER = ['dcm', 'baxtel', 'dckb', 'dhi_hyperscale', 'dhi_western', 'dccom'];
export const SOURCE_LABEL = {
  dcm: 'Commercial directory', baxtel: 'baxtel crawl', dckb: 'DCKB sample',
  dhi_hyperscale: 'UVA hyperscale set', dhi_western: 'UVA western set', dccom: 'Second commercial directory (reviewed)',
};
export const TECH_ORDER = ['Coal', 'Hydro', 'Wind', 'Solar', 'Nuclear', 'Bioenergy'];

/** Categorical colours: fixed slots from the site palette (light / dark). Status colours double as filter swatches. */
export const STATUS_COLOR = {
  Operating: { light: '#1baf7a', dark: '#199e70' },
  Development: { light: '#2a78d6', dark: '#3987e5' },
  Proposed: { light: '#eda100', dark: '#c98500' },
  Unknown: { light: '#898781', dark: '#898781' },
};
export const TECH_COLOR = {
  Coal: { light: '#6b6a65', dark: '#a5a49b' },
  Hydro: { light: '#2a78d6', dark: '#3987e5' },
  Wind: { light: '#1baf7a', dark: '#199e70' },
  Solar: { light: '#eda100', dark: '#c98500' },
  Nuclear: { light: '#6250d6', dark: '#9085e9' },
  Bioenergy: { light: '#008300', dark: '#008300' },
};
/** Sequential blue ramp (5 steps) for choropleths; index 0 = lowest. Dark mode uses the lighter end of the ramp. */
export const SEQ_RAMP = {
  light: ['#cde2fb', '#9ec5f4', '#5598e7', '#256abf', '#104281'],
  dark: ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#b7d3f6'],
};
/**
 * Transmission-line overlay, lowest to highest voltage class (the last N steps are used for N classes). Oranges at
 * mid lightness so a line stays visible over both ends of the blue choropleth; darker (light theme) or brighter (dark
 * theme) for higher voltage, and line width encodes the class as well, so identity is never colour-alone.
 */
export const LINE_RAMP = {
  light: ['#f09a6e', '#e8743f', '#d95926', '#c04516', '#9c3a15'],
  dark: ['#a8431a', '#c2501f', '#d95926', '#e8743f', '#f2915c'],
};
/** Second sequential hue (orange) for the water-pressure measure, where "more" means more stress. */
export const SEQ_RAMP_WARM = {
  light: ['#fbe3d6', '#f4b899', '#ec8c5b', '#d9582a', '#9c3a15'],
  dark: ['#8a3512', '#b8471c', '#d95926', '#ec8c5b', '#f4b899'],
};

export function colorOf(table, key, theme) {
  const c = table[key] ?? table.Unknown ?? { light: '#898781', dark: '#898781' };
  return c[theme === 'dark' ? 'dark' : 'light'];
}

/** Bin a value against ascending thresholds. thresholds [a,b,c,d] -> 5 bins: <a, a–b, b–c, c–d, ≥d. null -> -1. */
export function binIndex(value, thresholds) {
  if (value === null || value === undefined || !Number.isFinite(value)) return -1;
  let i = 0;
  while (i < thresholds.length && value >= thresholds[i]) i += 1;
  return i;
}

/**
 * Human labels for the bins produced by binIndex. With `integer`, ranges are closed ("1–4", "5–14") so a count
 * never appears in two bins. The first label is "Under a" unless the lowest threshold is 1 (then bin 0 is "0").
 */
export function binLabels(thresholds, { unit = '', digits = 0, integer = false } = {}) {
  const f = (v) => v.toLocaleString('en-US', { maximumFractionDigits: digits });
  const labels = [];
  for (let i = 0; i <= thresholds.length; i += 1) {
    if (i === 0) labels.push(thresholds[0] === 1 && integer ? `0${unit}` : `Under ${f(thresholds[0])}${unit}`);
    else if (i === thresholds.length) labels.push(`${f(thresholds[i - 1])}${unit} or more`);
    else labels.push(`${f(thresholds[i - 1])}–${f(integer ? thresholds[i] - 1 : thresholds[i])}${unit}`);
  }
  return labels;
}

/** Parse the free-text search into lower-case tokens; every token must match name/operator/province. */
export function matchesSearch(f, provinceName, q) {
  if (!q) return true;
  const hay = `${f.name ?? ''} ${f.operator ?? ''} ${provinceName ?? ''}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
}

/**
 * Apply the sidebar filters.
 * @param {Array} facilities
 * @param {{search:string, province:string, status:Set, type:Set, capacity:Set, source:Set}} filters
 * @param {Map<string,{name:string}>} provinceById
 */
export function filterFacilities(facilities, filters, provinceById) {
  return facilities.filter((f) =>
    (!filters.province || f.province === filters.province)
    && filters.status.has(f.status)
    && filters.type.has(f.facilityType)
    && filters.capacity.has(f.capacity)
    && f.sources.some((s) => filters.source.has(s))
    && matchesSearch(f, provinceById.get(f.province)?.name, filters.search));
}

/** Counts per category for a key function, in a fixed order (missing categories count 0). */
export function countBy(rows, key, order) {
  const counts = new Map(order.map((k) => [k, 0]));
  for (const r of rows) {
    const k = key(r);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/** Per-province rollup of the filtered facilities. */
export function summarizeByProvince(filtered) {
  const out = new Map();
  for (const f of filtered) {
    let s = out.get(f.province);
    if (!s) {
      s = { count: 0, mw: 0, mwKnown: 0, status: new Map(STATUS_ORDER.map((k) => [k, 0])) };
      out.set(f.province, s);
    }
    s.count += 1;
    if (Number.isFinite(f.mw)) { s.mw += f.mw; s.mwKnown += 1; }
    s.status.set(f.status, (s.status.get(f.status) ?? 0) + 1);
  }
  return out;
}

export function summarizeSelection(filtered, total, provinceById) {
  const mwValues = filtered.map((f) => f.mw).filter(Number.isFinite);
  const operating = filtered.filter((f) => f.status === 'Operating').length;
  const inHub = filtered.filter((f) => provinceById.get(f.province)?.hub).length;
  return {
    count: filtered.length,
    share: total ? filtered.length / total : 0,
    mwTotal: mwValues.reduce((a, b) => a + b, 0),
    mwKnown: mwValues.length,
    operatingShare: filtered.length ? operating / filtered.length : null,
    hubShare: filtered.length ? inHub / filtered.length : null,
  };
}

/** Square-root scaling so bubble AREA is proportional to the value. Returns radius in view-box units. */
export function bubbleRadius(value, maxValue, { min = 3, max = 26 } = {}) {
  if (!value || !maxValue) return 0;
  return min + (max - min) * Math.sqrt(value / maxValue);
}

/**
 * Push overlapping province bubbles apart so every wheel stays readable. items: [{x, y, r, ...}] in view-box units
 * (x, y = the province anchor). Returns copies with the new x, y plus ax, ay = the anchor, for a leader line.
 * The smaller bubble of a pair moves more, so big provinces keep their wheel on their anchor; a weak pull back to
 * the anchor keeps the layout geographic; a final pass without the pull removes any overlap the pull reintroduced.
 * `bounds` [x0, y0, x1, y1] keeps bubbles inside the map. Deterministic: same input, same layout.
 */
export function separateBubbles(items, { gap = 1.5, iterations = 160, pull = 0.03, bounds = null } = {}) {
  const b = items.map((it) => ({ ...it, ax: it.x, ay: it.y }));
  const clamp = (p) => {
    if (!bounds) return;
    p.x = Math.min(bounds[2] - p.r, Math.max(bounds[0] + p.r, p.x));
    p.y = Math.min(bounds[3] - p.r, Math.max(bounds[1] + p.r, p.y));
  };
  const relax = (k) => {
    let moved = false;
    for (let i = 0; i < b.length; i += 1) {
      for (let j = i + 1; j < b.length; j += 1) {
        const p = b[i];
        const q = b[j];
        let dx = q.x - p.x;
        let dy = q.y - p.y;
        let d = Math.hypot(dx, dy);
        const min = p.r + q.r + gap;
        if (d >= min) continue;
        if (d < 1e-6) { dx = 1; dy = 0; d = 1; } // coincident anchors: separate sideways, deterministically
        const push = (min - d) / d;
        const wp = q.r / (p.r + q.r);
        const wq = p.r / (p.r + q.r);
        p.x -= dx * push * wp; p.y -= dy * push * wp;
        q.x += dx * push * wq; q.y += dy * push * wq;
        clamp(p); clamp(q);
        moved = true;
      }
    }
    if (k > 0) for (const p of b) { p.x += (p.ax - p.x) * k; p.y += (p.ay - p.y) * k; }
    return moved;
  };
  for (let it = 0; it < iterations; it += 1) relax(pull);
  for (let it = 0; it < iterations && relax(0); it += 1);
  return b;
}

/** Arc path for a pie slice (used for the per-province status wheel). Angles in radians from 12 o'clock. */
export function arcPath(cx, cy, r, a0, a1) {
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    return `M${cx},${cy - r}A${r},${r} 0 1 1 ${cx},${cy + r}A${r},${r} 0 1 1 ${cx},${cy - r}Z`;
  }
  const fmt = (v) => (Math.abs(v) < 0.005 ? '0.00' : v.toFixed(2)); // never emit "-0.00"
  const p = (a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${cx},${cy}L${fmt(x0)},${fmt(y0)}A${r},${r} 0 ${large} 1 ${fmt(x1)},${fmt(y1)}Z`;
}

/** Thresholds that split the given values into roughly equal-count bins (quantiles), rounded to "nice" numbers. */
export function quantileThresholds(values, n = 5) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < n) return v.length ? [v[Math.floor(v.length / 2)]] : [];
  const out = [];
  for (let i = 1; i < n; i += 1) {
    const q = v[Math.min(v.length - 1, Math.floor((v.length * i) / n))];
    out.push(niceRound(q));
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

export function niceRound(x) {
  if (!Number.isFinite(x) || x === 0) return x;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const mag = 10 ** Math.floor(Math.log10(ax));
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10];
  const m = ax / mag;
  let best = steps[0];
  for (const s of steps) if (Math.abs(s - m) < Math.abs(best - m)) best = s;
  return sign * best * mag;
}

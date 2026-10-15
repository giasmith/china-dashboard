// Formatting helpers. Every function is total: bad input yields the placeholder, never "NaN" or "null".

export const EM_DASH = '—';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** Format a number with up to `digits` decimals (trailing zeros trimmed). null/undefined/NaN -> em dash. */
export function formatNumber(value, { digits = 2 } = {}) {
  if (!isNum(value)) return EM_DASH;
  const rounded = Number(value.toFixed(digits)); // trims trailing zeros; also normalises -0
  return (Object.is(rounded, -0) ? 0 : rounded).toLocaleString('en-US', { maximumFractionDigits: digits });
}

/** Format a value with its unit. Percent-like units attach without a space. */
export function formatValue(value, unit, opts) {
  const n = formatNumber(value, opts);
  if (n === EM_DASH || !unit) return n;
  return unit.startsWith('%') ? `${n}${unit}` : `${n} ${unit}`; // '%' and '% per year' attach directly
}

const QUALIFIER_PREFIX = { floor: '≥ ', ceiling: '≤ ', approx: '≈ ' };

/** Prefix for a bounded figure: 'floor' -> "≥ ", 'ceiling' -> "≤ ", 'approx' -> "≈ ", anything else -> "". */
export function qualifierPrefix(qualifier) {
  return QUALIFIER_PREFIX[qualifier] ?? '';
}

/**
 * Format a reported point ({value, qualifier}) with its unit, honouring the qualifier so a figure published as
 * "超过95%" reads "≥ 95%" rather than an exact 95%. Accepts a bare number too (no prefix).
 */
export function formatActual(point, unit, opts) {
  if (point === null || point === undefined) return EM_DASH;
  if (typeof point === 'number') return formatValue(point, unit, opts);
  const text = formatValue(point.value, unit, opts);
  return text === EM_DASH ? text : `${qualifierPrefix(point.qualifier)}${text}`;
}

/** Fraction -> percent string. 0.456 -> "46%". Values outside 0..1 are shown as-is (e.g. -12%, 130%). */
export function formatPercent(fraction, { digits = 0 } = {}) {
  if (!isNum(fraction)) return EM_DASH;
  return `${formatNumber(fraction * 100, { digits })}%`;
}

/** Integer -> English ordinal: 1 -> "1st", 2 -> "2nd", 11 -> "11th", 23 -> "23rd". Non-integers -> em dash. */
export function ordinal(n) {
  if (!Number.isInteger(n)) return EM_DASH;
  const suffix = ['th', 'st', 'nd', 'rd'];
  const v = Math.abs(n) % 100;
  return `${n}${suffix[(v - 20) % 10] || suffix[v] || suffix[0]}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format an ISO date (YYYY-MM-DD) WITHOUT going through Date, so the result never shifts a day
 * with the viewer's time zone (new Date('2021-03-11') is UTC midnight = Mar 10 in New York).
 * precision: 'day' | 'month' | 'year'
 */
export function formatIsoDate(iso, precision = 'day') {
  if (typeof iso !== 'string') return EM_DASH;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return EM_DASH;
  const [, y, mo, d] = m;
  const monthIdx = Number(mo) - 1;
  if (monthIdx < 0 || monthIdx > 11) return EM_DASH;
  if (precision === 'year') return y;
  if (precision === 'month') return `${MONTHS[monthIdx]} ${y}`;
  return `${Number(d)} ${MONTHS[monthIdx]} ${y}`;
}

/** "2022-02" -> "Feb 2022". */
export function formatYearMonth(ym) {
  if (typeof ym !== 'string' || !/^\d{4}-\d{2}$/.test(ym)) return EM_DASH;
  return formatIsoDate(`${ym}-01`, 'month');
}

/** Return the URL only if it is an absolute http(s) URL; otherwise null. Blocks javascript:, data:, etc. */
export function safeUrl(u) {
  if (typeof u !== 'string') return null;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** "in_force" -> "In force". */
export function humanize(token) {
  if (typeof token !== 'string' || token === '') return EM_DASH;
  const s = token.replace(/[_-]+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Case-insensitive, accent-insensitive substring test over several fields. Empty query matches everything. */
export function textMatches(query, ...fields) {
  const q = normalize(query);
  if (q === '') return true;
  return fields.some((f) => typeof f === 'string' && normalize(f).includes(q));
}

function normalize(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

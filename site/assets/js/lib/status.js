// Target-vs-actual status engine. Pure functions: no DOM, no fetch, fully unit-tested.
//
// Three target kinds (see schemas/plan_targets.schema.json):
//   level     reach a value relative to a baseline by a year
//               progress = (latest - baseline) / (target - baseline)   (direction-agnostic)
//               expected = share of the baseline->target time window that has elapsed
//   threshold stay at/above (increase) or at/below (decrease) a value
//   rate      average annual rate over a period must be >= (increase) or <= (decrease) the target
//
// Statuses:
//   achieved    target met (level: progress >= 100%; threshold/rate: window complete and met)
//   on_track    not finished, but at/above the expected pace (within `tolerance`)
//   behind      not finished and below the expected pace
//   missed      a full-year figure for the target year (or later) is reported and the target was not met
//   unresolved  the target year has passed (relative to `asOfYear`) but no full-year figure for it is reported,
//               so the outcome cannot be scored either way
//   no_data     no usable actuals
//   invalid     the target definition cannot be evaluated (reason explains why)
//
// Two details that matter for honest scoring:
//   * Actuals carry an optional `as_of` date. A value whose as_of is not 31 December is a PARTIAL-YEAR figure
//     (e.g. "as of June 2025"). It can show progress and can confirm early achievement, but it can never settle a
//     deadline verdict, because the year-end figure is still unknown.
//   * Values reported AFTER the target year never count towards meeting a dated target (a target "by 2025" is not
//     achieved by a 2026 figure). They are still plotted for context.

export const STATUS = Object.freeze({
  ACHIEVED: 'achieved',
  ON_TRACK: 'on_track',
  BEHIND: 'behind',
  MISSED: 'missed',
  UNRESOLVED: 'unresolved',
  NO_DATA: 'no_data',
  INVALID: 'invalid',
});

// Display / sort order: most concerning first.
export const STATUS_ORDER = Object.freeze([
  STATUS.MISSED,
  STATUS.BEHIND,
  STATUS.UNRESOLVED,
  STATUS.NO_DATA,
  STATUS.ON_TRACK,
  STATUS.ACHIEVED,
  STATUS.INVALID,
]);

export const STATUS_META = Object.freeze({
  achieved: { label: 'Achieved', icon: '✓' }, // check
  on_track: { label: 'On track', icon: '→' }, // arrow
  behind: { label: 'Behind pace', icon: '!' },
  missed: { label: 'Missed', icon: '✕' }, // x
  unresolved: { label: 'Unresolved', icon: '…' }, // deadline passed, final figure not yet reported
  no_data: { label: 'No data', icon: '–' }, // dash
  invalid: { label: 'Invalid target', icon: '?' },
});

/** Progress shortfall allowed before a target is flagged "behind" (fraction of the full distance). */
export const DEFAULT_TOLERANCE = 0.1;

const EPS = 1e-9;

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

const AS_OF_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A reported value is a full-year figure unless its `as_of` date says otherwise.
 * `as_of` must be a YYYY-MM-DD string; anything else is ignored (treated as full-year) rather than guessed at.
 */
export function isPartialYear(asOf) {
  if (typeof asOf !== 'string') return false;
  const m = AS_OF_RE.exec(asOf);
  if (!m) return false;
  return !(m[2] === '12' && m[3] === '31');
}

const DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Fraction of the year that had elapsed at `asOf` (1 for a full-year figure or an unparseable date).
 * Used so a June figure is compared with half a year of expected progress, not a whole one.
 */
export function yearFraction(asOf) {
  if (!isPartialYear(asOf)) return 1;
  const [, y, mo, d] = AS_OF_RE.exec(asOf).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return 1;
  const leap = isLeap(y);
  const day = DAYS_BEFORE_MONTH[mo - 1] + (leap && mo > 2 ? 1 : 0) + d;
  return clamp(day / (leap ? 366 : 365), 0, 1);
}

const QUALIFIERS = new Set(['floor', 'ceiling', 'approx']);

/**
 * Keep only usable actuals for one target: matching id, finite integer year, finite value.
 * Duplicate years are resolved deliberately, not by file order alone:
 *   1. a full-year figure beats a partial-year one (a June value must never shadow the December value);
 *   2. between two partial-year figures the later `as_of` wins;
 *   3. otherwise the LAST one in input order wins (a corrected record appended later overrides).
 * Returns an array sorted by year ascending. Each point carries `partial` (see isPartialYear), `as_of` and
 * `qualifier` ('floor' | 'ceiling' | 'approx' | null — how the printed figure bounds the true value).
 */
export function cleanActuals(actuals, targetId) {
  if (!Array.isArray(actuals)) return [];
  const byYear = new Map();
  for (const a of actuals) {
    if (!a || a.target_id !== targetId) continue;
    if (!Number.isInteger(a.year) || !isNum(a.value)) continue;
    const asOf = typeof a.as_of === 'string' ? a.as_of : null;
    const point = {
      year: a.year,
      value: a.value,
      source: a.source ?? null,
      placeholder: a.placeholder === true,
      as_of: asOf,
      partial: isPartialYear(asOf),
      fraction: yearFraction(asOf), // share of the year elapsed at as_of (1 = year-end)
      qualifier: QUALIFIERS.has(a.qualifier) ? a.qualifier : null,
    };
    const prev = byYear.get(a.year);
    if (prev && !prev.partial && point.partial) continue; // rule 1: keep the full-year figure
    if (prev && prev.partial && point.partial && prev.as_of > point.as_of) continue; // rule 2: keep the later partial
    byYear.set(a.year, point);
  }
  return [...byYear.values()].sort((x, y) => x.year - y.year);
}

/**
 * The points that actually take part in evaluating `target` (the chart plots exactly these, so a badge and its
 * chart can never disagree about which values exist):
 *   level      actuals on/after the baseline year
 *   rate       actuals inside the plan period
 *   threshold  all actuals
 * Points after the target year are included here (they are plotted) but are excluded from the deadline verdict.
 */
export function usablePoints(target, actuals) {
  if (!target) return [];
  const series = cleanActuals(actuals, target.id);
  if (target.kind === 'level' && isNum(target.baseline?.year)) return series.filter((p) => p.year >= target.baseline.year);
  if (target.kind === 'rate' && isNum(target.period?.start) && isNum(target.period?.end)) {
    return series.filter((p) => p.year >= target.period.start && p.year <= target.period.end);
  }
  return series;
}

function result(status, extra = {}) {
  return {
    status,
    progress: null, // fraction (1 = 100%); level targets only. May be <0 or >1.
    expected: null, // fraction of the time window elapsed at the latest actual; level targets only
    latest: null, // {year, value, partial, as_of, ...}
    average: null, // rate targets only
    coverage: null, // rate targets only: {have, of}
    met: null, // threshold / rate: whether the target is currently met
    reason: '',
    ...extra,
  };
}

const deadlinePassed = (asOfYear, year) => isNum(asOfYear) && asOfYear > year;

const POST_DEADLINE_REASON = (year) => `Only values reported after the target year (${year}) are available, so the outcome cannot be scored.`;
const UNRESOLVED_REASON = (year, latest) =>
  `The target year (${year}) has passed, but the latest reported figure is ${latest.partial ? `a partial-year value (as of ${latest.as_of})` : `for ${latest.year}`}; no full-year figure for ${year} is recorded yet.`;

function evaluateLevel(target, series, tolerance, asOfYear) {
  const b = target.baseline;
  const t = target.target;
  if (!b || !isNum(b.year) || !isNum(b.value) || !t || !isNum(t.year) || !isNum(t.value)) {
    return result(STATUS.INVALID, { reason: 'Baseline or target is missing or not numeric.' });
  }
  if (t.year <= b.year) {
    return result(STATUS.INVALID, { reason: 'Target year must be after the baseline year.' });
  }
  if (Math.abs(t.value - b.value) < EPS) {
    return result(STATUS.INVALID, { reason: 'Target equals baseline, so progress is undefined. Model it as a threshold.' });
  }

  // Years before the baseline year cannot describe progress from the baseline.
  const usable = series.filter((p) => p.year >= b.year); // keep in sync with usablePoints()
  if (usable.length === 0) return result(STATUS.NO_DATA, { reason: 'No actuals on or after the baseline year.' });

  const progressOf = (p) => (p.value - b.value) / (t.value - b.value);
  // Elapsed time is measured from the END of the baseline year; a partial-year point only counts the part of its
  // year that had passed by its as_of date.
  const expectedOf = (p) => clamp((p.year - b.year - (1 - p.fraction)) / (t.year - b.year), 0, 1);

  // Values after the target year cannot meet a dated target; they are context only.
  const candidates = usable.filter((p) => p.year <= t.year);
  if (candidates.length === 0) {
    const latest = usable[usable.length - 1];
    return result(STATUS.UNRESOLVED, { progress: progressOf(latest), expected: expectedOf(latest), latest, reason: POST_DEADLINE_REASON(t.year) });
  }

  const latest = candidates[candidates.length - 1];
  const progress = progressOf(latest);
  const expected = expectedOf(latest);

  let status;
  let reason = '';
  if (progress >= 1 - EPS) status = STATUS.ACHIEVED;
  else if (latest.year >= t.year && !latest.partial) status = STATUS.MISSED;
  else if (deadlinePassed(asOfYear, t.year)) {
    status = STATUS.UNRESOLVED;
    reason = UNRESOLVED_REASON(t.year, latest);
  } else if (progress >= expected - tolerance - EPS) status = STATUS.ON_TRACK;
  else status = STATUS.BEHIND;

  return result(status, { progress, expected, latest, reason });
}

function evaluateThreshold(target, series, asOfYear) {
  const t = target.target;
  if (!t || !isNum(t.year) || !isNum(t.value) || !['increase', 'decrease'].includes(target.direction)) {
    return result(STATUS.INVALID, { reason: 'Threshold needs a numeric target and a direction.' });
  }
  if (series.length === 0) return result(STATUS.NO_DATA, { reason: 'No actuals.' });

  const meets = (p) => (target.direction === 'increase' ? p.value >= t.value - EPS : p.value <= t.value + EPS);

  const candidates = series.filter((p) => p.year <= t.year);
  if (candidates.length === 0) {
    const latest = series[series.length - 1];
    return result(STATUS.UNRESOLVED, { latest, met: meets(latest), reason: POST_DEADLINE_REASON(t.year) });
  }

  const latest = candidates[candidates.length - 1];
  const met = meets(latest);
  const finalFigure = latest.year >= t.year && !latest.partial;

  let status;
  let reason = '';
  if (finalFigure) status = met ? STATUS.ACHIEVED : STATUS.MISSED;
  else if (deadlinePassed(asOfYear, t.year)) {
    status = STATUS.UNRESOLVED;
    reason = UNRESOLVED_REASON(t.year, latest);
  } else status = met ? STATUS.ON_TRACK : STATUS.BEHIND;

  return result(status, { latest, met, reason });
}

function evaluateRate(target, series, asOfYear) {
  const t = target.target;
  const p = target.period;
  if (!t || !isNum(t.value) || !p || !isNum(p.start) || !isNum(p.end) || p.end < p.start) {
    return result(STATUS.INVALID, { reason: 'Rate target needs a numeric target and a valid period.' });
  }
  if (!['increase', 'decrease'].includes(target.direction)) {
    return result(STATUS.INVALID, { reason: 'Rate target needs a direction.' });
  }
  const inWindow = series.filter((a) => a.year >= p.start && a.year <= p.end); // keep in sync with usablePoints()
  if (inWindow.length === 0) return result(STATUS.NO_DATA, { reason: 'No actuals inside the plan period.' });

  const average = inWindow.reduce((sum, a) => sum + a.value, 0) / inWindow.length;
  const latest = inWindow[inWindow.length - 1];
  const met = target.direction === 'increase' ? average >= t.value - EPS : average <= t.value + EPS;
  const have = inWindow.length;
  const of = p.end - p.start + 1;
  const finalFigure = latest.year >= p.end && !latest.partial;

  let status;
  let reason = have < of ? `Average of ${have} of ${of} years reported.` : '';
  if (finalFigure) status = met ? STATUS.ACHIEVED : STATUS.MISSED;
  else if (deadlinePassed(asOfYear, p.end)) {
    status = STATUS.UNRESOLVED;
    reason = `${UNRESOLVED_REASON(p.end, latest)} ${reason}`.trim();
  } else status = met ? STATUS.ON_TRACK : STATUS.BEHIND;

  return result(status, { latest, average, met, coverage: { have, of }, reason });
}

/**
 * Evaluate one target against all actuals.
 * @param {object} target  a record from plan_targets.json
 * @param {Array}  actuals the full actuals array (filtered internally by target.id)
 * @param {{tolerance?: number, asOfYear?: number}} [opts]
 *        asOfYear: the year the dataset was compiled (meta.as_of). When it is later than a target's year and no
 *        full-year figure for that year exists, the target is reported as `unresolved` instead of on_track/behind.
 *        Omit it to keep the pace-based statuses (useful in tests and for undated data).
 */
export function computeStatus(target, actuals, opts = {}) {
  const tolerance = isNum(opts.tolerance) && opts.tolerance >= 0 ? opts.tolerance : DEFAULT_TOLERANCE;
  const asOfYear = Number.isInteger(opts.asOfYear) ? opts.asOfYear : null;
  if (!target || typeof target !== 'object') {
    return result(STATUS.INVALID, { reason: 'Target record is missing.' });
  }
  const series = cleanActuals(actuals, target.id);
  switch (target.kind) {
    case 'level':
      return evaluateLevel(target, series, tolerance, asOfYear);
    case 'threshold':
      return evaluateThreshold(target, series, asOfYear);
    case 'rate':
      return evaluateRate(target, series, asOfYear);
    default:
      return result(STATUS.INVALID, { reason: `Unknown target kind: ${String(target.kind)}.` });
  }
}

/** Count rows per status. Every status key is always present (zero when absent). */
export function summarizeStatuses(rows) {
  const counts = Object.fromEntries(Object.values(STATUS).map((s) => [s, 0]));
  for (const r of rows ?? []) {
    const s = r?.result?.status;
    if (s in counts) counts[s] += 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  // Targets that could actually be scored: exclude "no data", "unresolved" and "invalid".
  const assessable = total - counts.no_data - counts.unresolved - counts.invalid;
  const healthy = counts.achieved + counts.on_track;
  return {
    counts,
    total,
    assessable,
    healthy,
    // null (not 0) when nothing is assessable, so the UI can show "-" instead of a misleading 0%.
    healthyShare: assessable > 0 ? healthy / assessable : null,
  };
}

/** Year component of an ISO date string (meta.as_of), or null when it is not a YYYY-MM-DD string. */
export function yearOf(isoDate) {
  if (typeof isoDate !== 'string') return null;
  const m = AS_OF_RE.exec(isoDate);
  return m ? Number(m[1]) : null;
}

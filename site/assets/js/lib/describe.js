// Plain-language explanation of a target's status. Pure; unit-tested.

import { formatValue, formatActual, formatPercent, formatIsoDate, EM_DASH } from './format.js';
import { STATUS } from './status.js';

/** "Latest (2025): 1,680 EB." — with the as-of date when the figure is a partial-year value. */
export function latestText(res, unit) {
  if (!res?.latest) return '';
  const when = res.latest.partial ? `${res.latest.year}, as of ${formatIsoDate(res.latest.as_of)}` : String(res.latest.year);
  return `Latest (${when}): ${formatActual(res.latest, unit)}.`;
}

export function describeResult(target, res) {
  if (!target || !res) return '';
  const unit = target.unit;
  const val = (v) => formatValue(v, unit);

  switch (res.status) {
    case STATUS.INVALID:
      return res.reason || 'This target cannot be evaluated.';
    case STATUS.NO_DATA:
      return res.reason && res.reason !== 'No actuals.' ? res.reason : 'No reported values yet.';
    case STATUS.UNRESOLVED:
      return `${latestText(res, unit)} ${res.reason}`.trim();
    default:
      break;
  }

  const latest = latestText(res, unit);

  if (target.kind === 'level') {
    const b = target.baseline;
    const t = target.target;
    if (res.progress < 0) {
      return `${latest} Moving away from the target: ${formatPercent(res.progress)} progress from the ${b.year} baseline of ${val(b.value)}.`;
    }
    return `${latest} ${formatPercent(res.progress)} of the way from ${val(b.value)} (${b.year}) to ${val(t.value)} (${t.year}); ${formatPercent(res.expected)} of that period had elapsed.`;
  }

  if (target.kind === 'threshold') {
    const word = target.direction === 'increase' ? 'minimum' : 'maximum';
    return `${latest} ${res.met ? 'Meets' : 'Does not meet'} the ${word} of ${val(target.target.value)} (deadline ${target.target.year}).`;
  }

  if (target.kind === 'rate') {
    const word = target.direction === 'increase' ? 'at least' : 'at most';
    const avg = res.average === null ? EM_DASH : val(res.average);
    return `Average of reported years: ${avg}; target is ${word} ${val(target.target.value)}. ${res.reason}`.trim();
  }
  return '';
}

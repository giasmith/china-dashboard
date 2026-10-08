import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStatus, cleanActuals, usablePoints, summarizeStatuses, isPartialYear, yearFraction, yearOf, STATUS, STATUS_ORDER, STATUS_META, DEFAULT_TOLERANCE } from '../../site/assets/js/lib/status.js';

const level = (over = {}) => ({
  id: 't', kind: 'level', direction: 'increase',
  baseline: { year: 2020, value: 60 }, target: { year: 2025, value: 65 }, ...over,
});
const act = (year, value, target_id = 't') => ({ target_id, year, value });

// ---- level targets ---------------------------------------------------------------------------------------------

test('level: on track when progress is at the expected pace', () => {
  // 2024: expected 80%, progress (64.2-60)/5 = 84%
  const r = computeStatus(level(), [act(2024, 64.2)]);
  assert.equal(r.status, STATUS.ON_TRACK);
  assert.ok(Math.abs(r.progress - 0.84) < 1e-9);
  assert.ok(Math.abs(r.expected - 0.8) < 1e-9);
});

test('level: behind when progress trails expected by more than the tolerance', () => {
  // 2024: expected 80%, progress 20%
  assert.equal(computeStatus(level(), [act(2024, 61)]).status, STATUS.BEHIND);
});

test('level: tolerance boundary is inclusive (expected 80%, tolerance 10% -> 70% is still on track)', () => {
  // progress exactly 0.70 -> value 63.5
  assert.equal(computeStatus(level(), [act(2024, 63.5)]).status, STATUS.ON_TRACK);
  assert.equal(computeStatus(level(), [act(2024, 63.49)]).status, STATUS.BEHIND);
});

test('level: achieved as soon as progress reaches 100%, even before the target year', () => {
  assert.equal(computeStatus(level(), [act(2023, 65)]).status, STATUS.ACHIEVED);
  assert.equal(computeStatus(level(), [act(2023, 70)]).status, STATUS.ACHIEVED); // overshoot
});

test('level: floating-point noise at exactly 100% still counts as achieved', () => {
  // (0.1+0.2) style error: baseline 0, target 0.3, actual 0.1+0.2 = 0.30000000000000004
  const t = level({ baseline: { year: 2020, value: 0 }, target: { year: 2025, value: 0.3 } });
  assert.equal(computeStatus(t, [act(2025, 0.1 + 0.2)]).status, STATUS.ACHIEVED);
  // and the opposite rounding: 0.29999999999999993 must also pass
  assert.equal(computeStatus(t, [act(2025, 0.3 - 5e-17)]).status, STATUS.ACHIEVED);
});

test('level: missed when a full-year figure for the target year falls short', () => {
  assert.equal(computeStatus(level(), [act(2025, 64.9)]).status, STATUS.MISSED);
  // a later value cannot rescue a dated target that was missed in its own year
  assert.equal(computeStatus(level(), [act(2025, 64.9), act(2027, 66)]).status, STATUS.MISSED);
});

test('level: values reported only after the target year cannot settle it -> unresolved, never achieved or missed', () => {
  const low = computeStatus(level(), [act(2027, 64.9)]);
  assert.equal(low.status, STATUS.UNRESOLVED);
  assert.match(low.reason, /after the target year/);
  assert.equal(low.latest.year, 2027); // still reported for context
  assert.equal(computeStatus(level(), [act(2027, 70)]).status, STATUS.UNRESOLVED); // even when above the target
});

test('level: a decrease target uses the same formula (direction-agnostic)', () => {
  const t = level({ direction: 'decrease', baseline: { year: 2020, value: 100 }, target: { year: 2025, value: 86.5 } });
  const r = computeStatus(t, [act(2023, 93.1)]);
  assert.equal(r.status, STATUS.ON_TRACK);
  assert.ok(Math.abs(r.progress - (6.9 / 13.5)) < 1e-9);
  assert.equal(computeStatus(t, [act(2023, 100.5)]).status, STATUS.BEHIND); // moving the wrong way
  assert.ok(computeStatus(t, [act(2023, 100.5)]).progress < 0);
});

test('level: uses the latest year, not the latest array position (unsorted input)', () => {
  const r = computeStatus(level(), [act(2024, 64.2), act(2021, 61), act(2022, 62)]);
  assert.equal(r.latest.year, 2024);
});

test('level: duplicate year -> the later record wins', () => {
  const r = computeStatus(level(), [act(2024, 10), act(2024, 64.2)]);
  assert.equal(r.latest.value, 64.2);
});

test('level: actuals before the baseline year are ignored', () => {
  const r = computeStatus(level(), [act(2018, 1), act(2019, 2)]);
  assert.equal(r.status, STATUS.NO_DATA);
});

test('level: an actual in the baseline year itself yields 0% progress and is on track', () => {
  const r = computeStatus(level(), [act(2020, 60)]);
  assert.equal(r.status, STATUS.ON_TRACK);
  assert.equal(r.progress, 0);
  assert.equal(r.expected, 0);
});

test('level: an actual after the target year does not push expected above 100%', () => {
  const r = computeStatus(level(), [act(2030, 62)]);
  assert.equal(r.expected, 1);
  assert.equal(r.status, STATUS.UNRESOLVED);
});

// ---- deadline passed / partial-year figures --------------------------------------------------------------------

const partial = (year, value, as_of, target_id = 't') => ({ target_id, year, value, as_of });

test('isPartialYear: only a 31 December as_of is a full-year figure; malformed input is not guessed at', () => {
  assert.equal(isPartialYear('2025-06-30'), true);
  assert.equal(isPartialYear('2025-12-31'), false);
  assert.equal(isPartialYear('2025-12-30'), true);
  assert.equal(isPartialYear(undefined), false);
  assert.equal(isPartialYear('June 2025'), false);
  assert.equal(isPartialYear(20250630), false);
});

test('level: the target year has passed (asOfYear) but only an earlier year is reported -> unresolved, not on track', () => {
  const noDate = computeStatus(level(), [act(2024, 64.2)]); // without asOfYear: pace-based as before
  assert.equal(noDate.status, STATUS.ON_TRACK);
  const sameYear = computeStatus(level(), [act(2024, 64.2)], { asOfYear: 2025 }); // deadline year not over yet
  assert.equal(sameYear.status, STATUS.ON_TRACK);
  const later = computeStatus(level(), [act(2024, 64.2)], { asOfYear: 2026 });
  assert.equal(later.status, STATUS.UNRESOLVED);
  assert.match(later.reason, /2025/);
  assert.ok(Math.abs(later.progress - 0.84) < 1e-9); // progress is still reported for the meter
});

test('level: a partial-year figure in the target year cannot settle a miss, but can confirm an achievement', () => {
  const short = [partial(2025, 64.8, '2025-06-30')];
  assert.equal(computeStatus(level(), short).status, STATUS.ON_TRACK); // no asOfYear: judged on pace (96% vs 100%, within tolerance)
  assert.equal(computeStatus(level(), short, { asOfYear: 2025 }).status, STATUS.ON_TRACK);
  const r = computeStatus(level(), short, { asOfYear: 2026 });
  assert.equal(r.status, STATUS.UNRESOLVED);
  assert.match(r.reason, /partial-year value \(as of 2025-06-30\)/);
  assert.equal(r.latest.partial, true);
  assert.equal(computeStatus(level(), [partial(2025, 65.2, '2025-06-30')], { asOfYear: 2026 }).status, STATUS.ACHIEVED);
  // a 31 December as_of is a full-year figure and settles the verdict
  assert.equal(computeStatus(level(), [partial(2025, 64.8, '2025-12-31')], { asOfYear: 2026 }).status, STATUS.MISSED);
});

test('threshold: deadline handling mirrors level targets', () => {
  assert.equal(computeStatus(floor(), [act(2024, 690)], { asOfYear: 2026 }).status, STATUS.UNRESOLVED);
  assert.equal(computeStatus(floor(), [act(2024, 690)], { asOfYear: 2025 }).status, STATUS.ON_TRACK);
  const met = computeStatus(floor(), [partial(2025, 690, '2025-06-30')], { asOfYear: 2026 });
  assert.equal(met.status, STATUS.UNRESOLVED);
  assert.equal(met.met, true); // "met so far" is still reported
  assert.equal(computeStatus(floor(), [act(2025, 690)], { asOfYear: 2026 }).status, STATUS.ACHIEVED);
  assert.equal(computeStatus(floor(), [act(2025, 640)], { asOfYear: 2026 }).status, STATUS.MISSED);
  assert.equal(computeStatus(floor(), [act(2026, 700)], { asOfYear: 2027 }).status, STATUS.UNRESOLVED); // post-deadline only
  assert.equal(computeStatus(floor(), [act(2025, 640), act(2026, 700)]).status, STATUS.MISSED); // late success does not rescue
});

test('rate: an incomplete period whose end has passed is unresolved; a complete period is final regardless of asOfYear', () => {
  const three = [act(2021, 6), act(2022, 6), act(2023, 6)];
  assert.equal(computeStatus(rate(), three).status, STATUS.ON_TRACK);
  const r = computeStatus(rate(), three, { asOfYear: 2026 });
  assert.equal(r.status, STATUS.UNRESOLVED);
  assert.deepEqual(r.coverage, { have: 3, of: 5 });
  assert.match(r.reason, /3 of 5/);
  const five = [2021, 2022, 2023, 2024, 2025].map((y) => act(y, 5.2));
  assert.equal(computeStatus(rate(), five, { asOfYear: 2030 }).status, STATUS.ACHIEVED);
  const lastPartial = [...five.slice(0, 4), partial(2025, 5.2, '2025-06-30')];
  assert.equal(computeStatus(rate(), lastPartial, { asOfYear: 2026 }).status, STATUS.UNRESOLVED);
  assert.equal(computeStatus(rate(), lastPartial, { asOfYear: 2025 }).status, STATUS.ON_TRACK);
});

test('asOfYear must be an integer year; anything else is ignored', () => {
  for (const bad of ['2026', 2026.5, NaN, null, {}]) {
    assert.equal(computeStatus(level(), [act(2024, 64.2)], { asOfYear: bad }).status, STATUS.ON_TRACK, String(bad));
  }
});

test('yearOf reads the year from an ISO date and rejects anything else', () => {
  assert.equal(yearOf('2026-10-02'), 2026);
  assert.equal(yearOf('2026-10'), null);
  assert.equal(yearOf(null), null);
  assert.equal(yearOf(2026), null);
});

test('every status has display metadata and a place in the sort order', () => {
  for (const s of Object.values(STATUS)) {
    assert.ok(STATUS_META[s]?.label, s);
    assert.ok(STATUS_ORDER.includes(s), s);
  }
  assert.equal(new Set(STATUS_ORDER).size, Object.values(STATUS).length);
});

test('level: no actuals -> no_data (not behind, not 0%)', () => {
  const r = computeStatus(level(), []);
  assert.equal(r.status, STATUS.NO_DATA);
  assert.equal(r.progress, null);
});

test('level: actuals that belong to other targets are ignored', () => {
  assert.equal(computeStatus(level(), [act(2024, 64.2, 'other')]).status, STATUS.NO_DATA);
});

test('level: invalid definitions are reported, never divided by zero', () => {
  assert.equal(computeStatus(level({ target: { year: 2025, value: 60 } }), [act(2024, 61)]).status, STATUS.INVALID); // target == baseline
  assert.equal(computeStatus(level({ target: { year: 2020, value: 65 } }), [act(2024, 61)]).status, STATUS.INVALID); // same year
  assert.equal(computeStatus(level({ target: { year: 2019, value: 65 } }), [act(2024, 61)]).status, STATUS.INVALID); // target before baseline
  assert.equal(computeStatus(level({ baseline: null }), [act(2024, 61)]).status, STATUS.INVALID);
  assert.equal(computeStatus(level({ baseline: { year: 2020, value: NaN } }), [act(2024, 61)]).status, STATUS.INVALID);
});

test('level: non-finite or non-integer actuals are dropped, not propagated as NaN', () => {
  const r = computeStatus(level(), [act(2023, NaN), act(2022, Infinity), act(2021.5, 61), act('2024', 64), act(2024, null), act(2024, '64.2')]);
  assert.equal(r.status, STATUS.NO_DATA);
  assert.equal(Number.isNaN(r.progress), false);
});

test('level: custom tolerance is respected; bad tolerance falls back to the default', () => {
  assert.equal(computeStatus(level(), [act(2024, 62.5)], { tolerance: 0.5 }).status, STATUS.ON_TRACK);
  assert.equal(computeStatus(level(), [act(2024, 62.5)], { tolerance: 0 }).status, STATUS.BEHIND);
  assert.equal(computeStatus(level(), [act(2024, 63.49)], { tolerance: -1 }).status, STATUS.BEHIND); // -> default 0.1
  assert.equal(computeStatus(level(), [act(2024, 63.5)], { tolerance: 'x' }).status, STATUS.ON_TRACK);
  assert.equal(DEFAULT_TOLERANCE, 0.1);
});

// ---- threshold targets -----------------------------------------------------------------------------------------

const floor = (over = {}) => ({ id: 't', kind: 'threshold', direction: 'increase', target: { year: 2025, value: 650 }, ...over });

test('threshold (floor): met before the deadline -> on track; met at the deadline -> achieved', () => {
  assert.equal(computeStatus(floor(), [act(2024, 690)]).status, STATUS.ON_TRACK);
  assert.equal(computeStatus(floor(), [act(2025, 690)]).status, STATUS.ACHIEVED);
});

test('threshold (floor): exactly at the floor counts as met', () => {
  assert.equal(computeStatus(floor(), [act(2024, 650)]).status, STATUS.ON_TRACK);
});

test('threshold (floor): below before the deadline -> behind; below at the deadline -> missed', () => {
  assert.equal(computeStatus(floor(), [act(2024, 640)]).status, STATUS.BEHIND);
  assert.equal(computeStatus(floor(), [act(2025, 640)]).status, STATUS.MISSED);
});

test('threshold (ceiling): decrease direction flips the comparison', () => {
  const t = floor({ direction: 'decrease', target: { year: 2025, value: 1.25 } });
  assert.equal(computeStatus(t, [act(2024, 1.2)]).status, STATUS.ON_TRACK);
  assert.equal(computeStatus(t, [act(2024, 1.3)]).status, STATUS.BEHIND);
  assert.equal(computeStatus(t, [act(2025, 1.3)]).status, STATUS.MISSED);
});

test('threshold: the already-met-floor trap does not produce a negative-progress "behind"', () => {
  // This is the case that breaks a level model: baseline 669 > floor 650. As a threshold it is simply met.
  const r = computeStatus(floor(), [act(2021, 683)]);
  assert.equal(r.status, STATUS.ON_TRACK);
  assert.equal(r.progress, null);
});

test('threshold: missing direction is invalid', () => {
  assert.equal(computeStatus(floor({ direction: undefined }), [act(2024, 690)]).status, STATUS.INVALID);
});

// ---- rate targets ----------------------------------------------------------------------------------------------

const rate = (over = {}) => ({
  id: 't', kind: 'rate', direction: 'increase', period: { start: 2021, end: 2025 }, target: { year: 2025, value: 5 }, ...over,
});

test('rate: average of reported years vs target; incomplete period is on track / behind', () => {
  assert.equal(computeStatus(rate(), [act(2021, 6), act(2022, 5)]).status, STATUS.ON_TRACK);
  const r = computeStatus(rate(), [act(2021, 7), act(2022, 3.5), act(2023, 4.8), act(2024, 4.6)]);
  assert.equal(r.status, STATUS.BEHIND); // average 4.975 < 5
  assert.ok(Math.abs(r.average - 4.975) < 1e-9);
  assert.deepEqual(r.coverage, { have: 4, of: 5 });
  assert.match(r.reason, /4 of 5/);
});

test('rate: a complete period is achieved or missed', () => {
  const years = [2021, 2022, 2023, 2024, 2025];
  assert.equal(computeStatus(rate(), years.map((y) => act(y, 5.2))).status, STATUS.ACHIEVED);
  assert.equal(computeStatus(rate(), years.map((y) => act(y, 4.9))).status, STATUS.MISSED);
});

test('rate: only years inside the period are averaged', () => {
  const r = computeStatus(rate(), [act(2019, 100), act(2021, 5), act(2030, 100)]);
  assert.equal(r.average, 5);
});

test('rate: no in-period data -> no_data; bad period -> invalid', () => {
  assert.equal(computeStatus(rate(), [act(2019, 5)]).status, STATUS.NO_DATA);
  assert.equal(computeStatus(rate({ period: { start: 2025, end: 2021 } }), [act(2021, 5)]).status, STATUS.INVALID);
  assert.equal(computeStatus(rate({ period: null }), [act(2021, 5)]).status, STATUS.INVALID);
});

test('rate: decrease direction (e.g. a ceiling on inflation)', () => {
  const t = rate({ direction: 'decrease', target: { year: 2025, value: 3 } });
  assert.equal(computeStatus(t, [act(2021, 2), act(2022, 3)]).status, STATUS.ON_TRACK); // avg 2.5 <= 3
  assert.equal(computeStatus(t, [act(2021, 4), act(2022, 3)]).status, STATUS.BEHIND);
});

// ---- generic ---------------------------------------------------------------------------------------------------

test('unknown kind, missing target, and garbage input never throw', () => {
  assert.equal(computeStatus({ id: 't', kind: 'weird' }, []).status, STATUS.INVALID);
  assert.equal(computeStatus(null, []).status, STATUS.INVALID);
  assert.equal(computeStatus(undefined, undefined).status, STATUS.INVALID);
  assert.equal(computeStatus(level(), null).status, STATUS.NO_DATA);
  assert.equal(computeStatus(level(), [null, undefined, 5, 'x']).status, STATUS.NO_DATA);
});

test('cleanActuals sorts, dedupes and filters', () => {
  const out = cleanActuals([act(2023, 3), act(2021, 1), act(2023, 4), act(2022, 'x'), act(2020, 9, 'zzz')], 't');
  assert.deepEqual(out.map(({ year, value }) => ({ year, value })), [{ year: 2021, value: 1 }, { year: 2023, value: 4 }]);
  assert.deepEqual(cleanActuals(undefined, 't'), []);
});

test('summarizeStatuses: counts, assessable denominator and null share when nothing is assessable', () => {
  const rows = ['achieved', 'on_track', 'behind', 'missed', 'no_data', 'no_data', 'invalid', 'unresolved'].map((status) => ({ result: { status } }));
  const s = summarizeStatuses(rows);
  assert.equal(s.total, 8);
  assert.equal(s.assessable, 4); // unresolved, no_data and invalid cannot be scored
  assert.equal(s.counts.unresolved, 1);
  assert.equal(s.healthy, 2);
  assert.equal(s.healthyShare, 0.5);
  assert.equal(s.counts.no_data, 2);

  const empty = summarizeStatuses([]);
  assert.equal(empty.total, 0);
  assert.equal(empty.healthyShare, null); // not NaN, not 0

  const onlyNoData = summarizeStatuses([{ result: { status: 'no_data' } }]);
  assert.equal(onlyNoData.healthyShare, null);

  assert.equal(summarizeStatuses(undefined).total, 0);
  assert.equal(summarizeStatuses([{}, null, { result: { status: 'bogus' } }]).total, 0); // unknown statuses are ignored
  for (const k of Object.values(STATUS)) assert.ok(k in empty.counts); // every key always present
});

test('usablePoints agrees with computeStatus: the chart plots exactly what the badge was computed from', () => {
  const cases = [
    [level(), [act(2018, 1), act(2020, 60), act(2022, 62), act(2025, 64)]],
    [rate(), [act(2019, 9), act(2021, 5), act(2022, 6), act(2031, 9)]],
    [floor(), [act(2021, 683), act(2022, 690)]],
  ];
  for (const [target, actuals] of cases) {
    const pts = usablePoints(target, actuals);
    const res = computeStatus(target, actuals);
    assert.equal(res.latest?.year, pts[pts.length - 1]?.year, target.kind);
    assert.equal(res.latest?.value, pts[pts.length - 1]?.value, target.kind);
  }
  // Post-deadline points are plotted (context) but the verdict uses the last point on or before the target year.
  const late = [act(2022, 62), act(2030, 64)];
  assert.deepEqual(usablePoints(level(), late).map((p) => p.year), [2022, 2030]);
  assert.equal(computeStatus(level(), late).latest.year, 2022);
  assert.equal(usablePoints(level(), late)[1].partial, false);
  assert.equal(usablePoints(level(), [partial(2024, 63, '2024-06-30')])[0].partial, true);
  assert.deepEqual(usablePoints(null, []), []);
  assert.deepEqual(usablePoints(level({ baseline: null }), [act(2021, 1)]).map((p) => p.year), [2021]); // no crash on bad baseline
});

test('yearFraction: expected pace for a partial-year point counts only the elapsed part of that year', () => {
  assert.equal(yearFraction('2025-12-31'), 1);
  assert.equal(yearFraction(null), 1);
  assert.ok(Math.abs(yearFraction('2025-06-30') - 181 / 365) < 1e-9);
  assert.ok(Math.abs(yearFraction('2024-06-30') - 182 / 366) < 1e-9); // leap year
  assert.ok(Math.abs(yearFraction('2025-01-01') - 1 / 365) < 1e-9);
  // baseline 2020 -> target 2025; a 30 June 2023 point has 2.496 of 5 years elapsed, not 3
  const r = computeStatus(level(), [partial(2023, 62.5, '2023-06-30')]);
  assert.ok(Math.abs(r.expected - (3 - 184 / 365) / 5) < 1e-9);
  assert.equal(r.status, STATUS.ON_TRACK); // 50% progress vs ~50% expected
  const full = computeStatus(level(), [act(2023, 62.5)]);
  assert.ok(Math.abs(full.expected - 0.6) < 1e-9);
  assert.equal(full.status, STATUS.ON_TRACK); // 50% vs 60%: within the 10% tolerance
  assert.equal(computeStatus(level(), [act(2023, 62.4)]).status, STATUS.BEHIND);
  assert.equal(computeStatus(level(), [partial(2023, 62.4, '2023-06-30')]).status, STATUS.ON_TRACK);
});

// ---- duplicate-year resolution and qualifiers ------------------------------------------------------------------

test('cleanActuals: a full-year figure beats a partial-year one regardless of file order', () => {
  const partialFirst = [{ ...act(2025, 788), as_of: '2025-06-30' }, act(2025, 1590)];
  const fullFirst = [act(2025, 1590), { ...act(2025, 788), as_of: '2025-06-30' }];
  assert.equal(cleanActuals(partialFirst, 't')[0].value, 1590);
  assert.equal(cleanActuals(fullFirst, 't')[0].value, 1590);
  assert.equal(cleanActuals(fullFirst, 't')[0].partial, false);
});

test('cleanActuals: between two partial-year figures the later as_of wins', () => {
  const pts = cleanActuals([{ ...act(2025, 9), as_of: '2025-09-30' }, { ...act(2025, 6), as_of: '2025-06-30' }], 't');
  assert.equal(pts.length, 1);
  assert.equal(pts[0].value, 9);
});

test('cleanActuals: two full-year figures for one year -> the later record in the file wins (a correction appended later)', () => {
  assert.equal(cleanActuals([act(2024, 1), act(2024, 2)], 't')[0].value, 2);
});

test('cleanActuals: qualifier passes through only when it is a known token', () => {
  const pts = cleanActuals([{ ...act(2024, 95), qualifier: 'floor' }, { ...act(2025, 96), qualifier: 'roughly' }], 't');
  assert.equal(pts[0].qualifier, 'floor');
  assert.equal(pts[1].qualifier, null);
});

test('level: a floor value is scored at its printed value (≥95 against a target of 95 is achieved)', () => {
  const t = level({ baseline: { year: 2020, value: 91 }, target: { year: 2025, value: 95 } });
  const r = computeStatus(t, [{ ...act(2025, 95), qualifier: 'floor' }]);
  assert.equal(r.status, STATUS.ACHIEVED);
  assert.equal(r.latest.qualifier, 'floor');
});

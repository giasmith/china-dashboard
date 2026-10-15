import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatNumber, formatValue, formatActual, qualifierPrefix, formatPercent, formatIsoDate, formatYearMonth, safeUrl, humanize, textMatches, ordinal, EM_DASH } from '../../site/assets/js/lib/format.js';
import { toCsv, csvCell } from '../../site/assets/js/lib/csv.js';
import { parseHash, serializeState, inSet, defaultState } from '../../site/assets/js/lib/state.js';
import { niceScale, yearTicks, linear } from '../../site/assets/js/lib/scale.js';

// ---- format ----------------------------------------------------------------------------------------------------

test('formatNumber: null/undefined/NaN/strings give an em dash, never 0 or "NaN"', () => {
  for (const bad of [null, undefined, NaN, Infinity, -Infinity, '', '12', {}, []]) assert.equal(formatNumber(bad), EM_DASH);
  assert.equal(formatNumber(0), '0');
});

test('ordinal: English suffixes including the 11-13 and 111-113 exceptions; bad input gives an em dash', () => {
  const cases = { 0: '0th', 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 10: '10th', 11: '11th', 12: '12th', 13: '13th', 21: '21st', 22: '22nd', 23: '23rd', 31: '31st', 101: '101st', 111: '111th', 112: '112th', 113: '113th' };
  for (const [n, want] of Object.entries(cases)) assert.equal(ordinal(Number(n)), want);
  for (const bad of [null, undefined, NaN, 2.5, '3', Infinity]) assert.equal(ordinal(bad), EM_DASH);
});

test('formatNumber: trims trailing zeros, groups thousands, normalises negative zero', () => {
  assert.equal(formatNumber(2.5), '2.5');
  assert.equal(formatNumber(2.0), '2');
  assert.equal(formatNumber(1234567.891, { digits: 1 }), '1,234,567.9');
  assert.equal(formatNumber(-0.0001, { digits: 2 }), '0'); // would otherwise print "-0"
});

test('formatValue / formatPercent', () => {
  assert.equal(formatValue(65, '%'), '65%');
  assert.equal(formatValue(650, 'Mt'), '650 Mt');
  assert.equal(formatValue(4.6, '% per year'), '4.6% per year');
  assert.equal(formatValue(null, 'Mt'), EM_DASH);
  assert.equal(formatPercent(0.456), '46%');
  assert.equal(formatPercent(-0.12), '-12%');
  assert.equal(formatPercent(1.3), '130%');
  assert.equal(formatPercent(null), EM_DASH);
});

test('formatIsoDate: never shifts the day with the time zone', () => {
  const tz = process.env.TZ;
  for (const zone of ['America/New_York', 'Pacific/Kiritimati', 'Asia/Shanghai', 'UTC']) {
    process.env.TZ = zone;
    assert.equal(formatIsoDate('2021-03-11'), '11 Mar 2021', zone);
  }
  process.env.TZ = tz;
});

test('formatIsoDate: precision and invalid input', () => {
  assert.equal(formatIsoDate('2022-02-01', 'month'), 'Feb 2022');
  assert.equal(formatIsoDate('2022-02-01', 'year'), '2022');
  assert.equal(formatIsoDate('2022-13-01'), EM_DASH);
  assert.equal(formatIsoDate('2022-2-1'), EM_DASH);
  assert.equal(formatIsoDate(null), EM_DASH);
  assert.equal(formatYearMonth('2022-02'), 'Feb 2022');
  assert.equal(formatYearMonth('2022'), EM_DASH);
});

test('safeUrl: only absolute http(s) URLs survive', () => {
  assert.equal(safeUrl('https://www.npc.gov.cn/x?y=1'), 'https://www.npc.gov.cn/x?y=1');
  assert.equal(safeUrl('http://example.org'), 'http://example.org/');
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'vbscript:x', '//evil.com', '/relative', 'ftp://x.org', '', null, undefined, 5]) {
    assert.equal(safeUrl(bad), null, String(bad));
  }
});

test('humanize', () => {
  assert.equal(humanize('in_force'), 'In force');
  assert.equal(humanize('policy_notice'), 'Policy notice');
  assert.equal(humanize(''), EM_DASH);
  assert.equal(humanize(null), EM_DASH);
});

test('textMatches: case/accent-insensitive; empty query matches all; non-string fields ignored', () => {
  assert.equal(textMatches('', 'anything'), true);
  assert.equal(textMatches('   ', null), true);
  assert.equal(textMatches('cyber', 'Cybersecurity Law'), true);
  assert.equal(textMatches('CAFE', 'Café'), true);
  assert.equal(textMatches('数据', null, '数据安全法'), true);
  assert.equal(textMatches('zzz', 'abc', null, undefined, 5), false);
});

// ---- csv -------------------------------------------------------------------------------------------------------

test('csvCell: quoting rules', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line1\nline2'), '"line1\nline2"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(NaN), '');
  assert.equal(csvCell(0), '0');
  assert.equal(csvCell(true), 'true');
  assert.equal(csvCell(['a', 'b']), 'a; b');
  assert.equal(csvCell('数据安全法'), '数据安全法');
});

test('csvCell: spreadsheet formula injection is neutralised, real negative numbers are not mangled', () => {
  assert.equal(csvCell('=HYPERLINK("http://evil","x")'), `"'=HYPERLINK(""http://evil"",""x"")"`);
  assert.equal(csvCell('+1+1'), "'+1+1");
  assert.equal(csvCell('-2+3'), "'-2+3");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('\tcmd'), "'\tcmd");
  assert.equal(csvCell(-5.5), '-5.5'); // a number, not text
});

test('toCsv: header, CRLF endings, getters, empty input', () => {
  const rows = [{ a: 1, b: 'x,y' }, { a: null, b: '=1+1' }];
  const csv = toCsv(rows, [{ key: 'a', label: 'A' }, { label: 'B', get: (r) => r.b }]);
  assert.equal(csv, `A,B\r\n1,"x,y"\r\n,'=1+1\r\n`);
  assert.equal(toCsv([], [{ key: 'a', label: 'A' }]), 'A\r\n'); // header only, no crash
  assert.equal(toCsv(undefined, [{ key: 'a', label: 'A' }]), 'A\r\n');
});

// ---- state -----------------------------------------------------------------------------------------------------

const SPEC = {
  q: { type: 'text', max: 10 },
  status: { type: 'set', allowed: ['a', 'b', 'c'] },
  plan: { type: 'choice', allowed: ['14fyp', '15fyp'] },
  from: { type: 'int', min: 1949, max: 2100 },
};

test('parseHash: round trip', () => {
  const s = parseHash('#q=hello%20world&status=c,a&plan=14fyp&from=2021', SPEC);
  assert.equal(s.q, 'hello worl'); // capped at max 10
  assert.deepEqual([...s.status], ['a', 'c']); // allowed order
  assert.equal(s.plan, '14fyp');
  assert.equal(s.from, 2021);
  assert.equal(serializeState(s, SPEC), 'q=hello%20worl&status=a,c&plan=14fyp&from=2021');
});

test('parseHash: untrusted input cannot break it', () => {
  assert.doesNotThrow(() => parseHash('#q=%E0%A4%A&status=%', SPEC)); // malformed percent-encoding
  assert.equal(parseHash('#q=%E0%A4%A', SPEC).q, '');
  assert.deepEqual([...parseHash('#status=zzz,a,<script>', SPEC).status], ['a']); // unknown values dropped
  assert.equal(parseHash('#plan=99fyp', SPEC).plan, '');
  assert.equal(parseHash('#unknown=1&__proto__=x&constructor=y', SPEC).unknown, undefined);
  assert.equal(Object.keys(parseHash('#__proto__=x', SPEC)).includes('__proto__'), false);
  assert.deepEqual(parseHash('', SPEC), defaultState(SPEC));
  assert.deepEqual(parseHash(undefined, SPEC), defaultState(SPEC));
  assert.deepEqual(parseHash('#&&=&=x&novalue', SPEC), defaultState(SPEC));
});

test('parseHash: strict integers (empty string must not become 0)', () => {
  for (const bad of ['', ' ', 'abc', '2021abc', '1e3', '20.5', '1900', '3000', '-1']) {
    assert.equal(parseHash(`#from=${encodeURIComponent(bad)}`, SPEC).from, null, JSON.stringify(bad));
  }
  assert.equal(parseHash('#from=2021', SPEC).from, 2021);
});

test('parseHash: duplicate keys -> last wins; "+" decodes to a space', () => {
  assert.equal(parseHash('#plan=14fyp&plan=15fyp', SPEC).plan, '15fyp');
  assert.equal(parseHash('#q=a+b', SPEC).q, 'a b');
});

test('serializeState: defaults are omitted', () => {
  assert.equal(serializeState(defaultState(SPEC), SPEC), '');
});

test('inSet: empty set means no restriction', () => {
  assert.equal(inSet(new Set(), 'x'), true);
  assert.equal(inSet(undefined, 'x'), true);
  assert.equal(inSet(new Set(['a']), 'a'), true);
  assert.equal(inSet(new Set(['a']), 'b'), false);
});

// ---- scale -----------------------------------------------------------------------------------------------------

test('niceScale: sensible ticks and floating-point cleanliness', () => {
  const s = niceScale(0, 10, 5);
  assert.deepEqual(s.ticks, [0, 2, 4, 6, 8, 10]);
  const f = niceScale(0.1, 0.7, 6);
  for (const t of f.ticks) assert.equal(String(t).length < 8, true, `ugly tick ${t}`);
  assert.ok(f.min <= 0.1 && f.max >= 0.7);
});

test('niceScale: equal, reversed, negative and non-finite input', () => {
  const eq = niceScale(5, 5);
  assert.ok(eq.min < 5 && eq.max > 5);
  const zero = niceScale(0, 0);
  assert.ok(zero.min < 0 && zero.max > 0);
  assert.equal(niceScale(10, 0).min, 0);
  const neg = niceScale(-3, 3);
  assert.ok(neg.ticks.includes(0));
  assert.deepEqual(niceScale(NaN, 1).ticks, [0, 1]);
  assert.ok(niceScale(1e-6, 3e-6).ticks.length >= 2);
  assert.ok(niceScale(1e9, 3e9).ticks.length >= 2);
});

test('yearTicks: starts at the baseline year, bounded count', () => {
  assert.deepEqual(yearTicks(2020, 2025), [2020, 2021, 2022, 2023, 2024, 2025]);
  assert.deepEqual(yearTicks(2020, 2020), [2020]);
  assert.deepEqual(yearTicks(2025, 2020), []);
  const long = yearTicks(2000, 2030);
  assert.equal(long[0], 2000);
  assert.ok(long.length <= 8);
});

test('linear: zero-width domain does not divide by zero', () => {
  assert.equal(linear([5, 5], [0, 100])(5), 50);
  assert.equal(linear([0, 10], [0, 100])(5), 50);
  assert.equal(linear([0, 10], [100, 0])(2.5), 75); // inverted range (SVG y axis)
});

// ---- describe ----------------------------------------------------------------------------------------------------

import { describeResult, latestText } from '../../site/assets/js/lib/describe.js';
import { computeStatus } from '../../site/assets/js/lib/status.js';

test('describeResult: unresolved and partial-year figures are explained in words, with the as-of date', () => {
  const t = { id: 't', kind: 'level', direction: 'increase', unit: 'EB', baseline: { year: 2023, value: 1200 }, target: { year: 2025, value: 1800 } };
  const res = computeStatus(t, [{ target_id: 't', year: 2025, value: 1680, as_of: '2025-06-30' }], { asOfYear: 2026 });
  const text = describeResult(t, res);
  assert.match(text, /Latest \(2025, as of 30 Jun 2025\): 1,680 EB\./);
  assert.match(text, /no full-year figure for 2025/);
  assert.equal(latestText({ latest: null }, 'EB'), '');
  assert.equal(latestText({ latest: { year: 2024, value: 1500, partial: false } }, 'EB'), 'Latest (2024): 1,500 EB.');
  // ordinary statuses are unchanged
  const ok = computeStatus(t, [{ target_id: 't', year: 2024, value: 1500 }], { asOfYear: 2024 });
  assert.match(describeResult(t, ok), /^Latest \(2024\): 1,500 EB\. 50% of the way/);
});

// ---- qualifiers --------------------------------------------------------------------------------------------------

test('formatActual: floors, ceilings and approximations carry their sign; exact values do not', () => {
  assert.equal(formatActual({ value: 95, qualifier: 'floor' }, '%'), '≥ 95%');
  assert.equal(formatActual({ value: 1.5, qualifier: 'ceiling' }, 'PUE'), '≤ 1.5 PUE');
  assert.equal(formatActual({ value: 1200, qualifier: 'approx' }, 'EB'), '≈ 1,200 EB');
  assert.equal(formatActual({ value: 67.89, qualifier: null }, '%'), '67.89%');
  assert.equal(formatActual({ value: 67.89 }, '%'), '67.89%');
});

test('formatActual: bare numbers, missing points and non-finite values never produce a stray sign', () => {
  assert.equal(formatActual(42, 'EB'), '42 EB');
  assert.equal(formatActual(null, '%'), EM_DASH);
  assert.equal(formatActual(undefined, '%'), EM_DASH);
  assert.equal(formatActual({ value: NaN, qualifier: 'floor' }, '%'), EM_DASH);
  assert.equal(qualifierPrefix('nonsense'), '');
  assert.equal(qualifierPrefix(undefined), '');
});

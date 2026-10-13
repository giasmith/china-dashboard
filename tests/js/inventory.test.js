import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS_ORDER, CAPACITY_ORDER, TYPE_ORDER, SOURCE_ORDER, binIndex, binLabels, matchesSearch, filterFacilities, countBy,
  summarizeByProvince, summarizeSelection, bubbleRadius, arcPath, quantileThresholds, niceRound, colorOf, STATUS_COLOR,
} from '../../site/assets/js/lib/inventory.js';

const provinces = new Map([
  ['beijing', { id: 'beijing', name: 'Beijing', hub: 'jingjinji' }],
  ['hunan', { id: 'hunan', name: 'Hunan', hub: null }],
]);
const fac = (over) => ({ id: 'x', name: 'Alpha DC', operator: 'Op', province: 'beijing', status: 'Operating', facilityType: 'Colocation', mw: null, capacity: 'Unknown', pue: null, onlineYear: null, sources: ['dcm'], ...over });
const allFilters = () => ({ search: '', province: '', status: new Set(STATUS_ORDER), type: new Set(TYPE_ORDER), capacity: new Set(CAPACITY_ORDER), source: new Set(SOURCE_ORDER) });

// ---- bins --------------------------------------------------------------------------------------------------------

test('binIndex: thresholds are lower bounds; null/NaN give -1', () => {
  const t = [1, 5, 15, 50];
  assert.equal(binIndex(0, t), 0);
  assert.equal(binIndex(1, t), 1);
  assert.equal(binIndex(4.99, t), 1);
  assert.equal(binIndex(5, t), 2);
  assert.equal(binIndex(50, t), 4);
  assert.equal(binIndex(1e9, t), 4);
  for (const bad of [null, undefined, NaN, Infinity, '3']) assert.equal(binIndex(bad, t), -1);
  assert.equal(binIndex(3, []), 0); // no thresholds: everything is bin 0
});

test('binLabels: integer ranges are closed so a count never sits in two bins; decimal ranges are half-open', () => {
  assert.deepEqual(binLabels([1, 5, 15, 50], { unit: ' facilities', integer: true }),
    ['0 facilities', '1–4 facilities', '5–14 facilities', '15–49 facilities', '50 facilities or more']);
  assert.deepEqual(binLabels([0.5, 0.6], { unit: ' 元/kWh', digits: 2 }), ['Under 0.5 元/kWh', '0.5–0.6 元/kWh', '0.6 元/kWh or more']);
});

test('quantileThresholds: nice, ascending, de-duplicated; tiny inputs do not crash', () => {
  const t = quantileThresholds([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 100, 1000]);
  assert.ok(t.length >= 1 && t.length <= 4);
  assert.deepEqual([...t].sort((a, b) => a - b), t);
  assert.deepEqual(quantileThresholds([]), []);
  assert.deepEqual(quantileThresholds([7]), [7]);
  assert.deepEqual(quantileThresholds([NaN, null, 7]), [7]);
});

test('niceRound: snaps to 1/1.5/2/2.5/3/4/5/6/7.5/8/10 × a power of ten', () => {
  assert.equal(niceRound(2370), 2500);
  assert.equal(niceRound(0.0712), 0.075);
  assert.equal(niceRound(0), 0);
  assert.equal(niceRound(-0.44), -0.4);
});

// ---- filtering -----------------------------------------------------------------------------------------------------

test('matchesSearch: every token must match somewhere in name, operator or province; empty query matches', () => {
  const f = fac({ name: 'Alibaba Zhangbei', operator: 'Alibaba Cloud' });
  assert.ok(matchesSearch(f, 'Hebei', ''));
  assert.ok(matchesSearch(f, 'Hebei', 'alibaba hebei'));
  assert.ok(!matchesSearch(f, 'Hebei', 'alibaba guizhou'));
  assert.ok(matchesSearch(fac({ name: 'X', operator: null }), undefined, 'x'));
});

test('filterFacilities: all groups intersect; a cleared group hides everything; sources use ANY semantics', () => {
  const rows = [fac({ id: 'a' }), fac({ id: 'b', status: 'Proposed', province: 'hunan', sources: ['baxtel', 'dcm'] })];
  assert.equal(filterFacilities(rows, allFilters(), provinces).length, 2);
  const f1 = allFilters(); f1.status = new Set(['Operating']);
  assert.deepEqual(filterFacilities(rows, f1, provinces).map((r) => r.id), ['a']);
  const f2 = allFilters(); f2.status = new Set();
  assert.equal(filterFacilities(rows, f2, provinces).length, 0);
  const f3 = allFilters(); f3.source = new Set(['baxtel']);
  assert.deepEqual(filterFacilities(rows, f3, provinces).map((r) => r.id), ['b']);
  const f4 = allFilters(); f4.province = 'hunan';
  assert.deepEqual(filterFacilities(rows, f4, provinces).map((r) => r.id), ['b']);
});

test('countBy keeps the fixed order and reports zeros', () => {
  const c = countBy([fac(), fac({ status: 'Unknown' })], (f) => f.status, STATUS_ORDER);
  assert.deepEqual([...c.entries()], [['Operating', 1], ['Development', 0], ['Proposed', 0], ['Unknown', 1]]);
});

// ---- summaries -----------------------------------------------------------------------------------------------------

test('summarizeByProvince: unknown MW never counts as zero', () => {
  const s = summarizeByProvince([fac({ mw: 10 }), fac({ mw: null }), fac({ province: 'hunan', mw: 2.5, status: 'Proposed' })]);
  assert.equal(s.get('beijing').count, 2);
  assert.equal(s.get('beijing').mw, 10);
  assert.equal(s.get('beijing').mwKnown, 1);
  assert.equal(s.get('hunan').status.get('Proposed'), 1);
  assert.equal(s.get('hunan').status.get('Operating'), 0);
});

test('summarizeSelection: shares are null for an empty selection, hub share uses the province table', () => {
  const empty = summarizeSelection([], 10, provinces);
  assert.equal(empty.operatingShare, null);
  assert.equal(empty.hubShare, null);
  assert.equal(empty.share, 0);
  const s = summarizeSelection([fac({ mw: 4 }), fac({ province: 'hunan', status: 'Proposed' })], 4, provinces);
  assert.equal(s.share, 0.5);
  assert.equal(s.mwTotal, 4);
  assert.equal(s.mwKnown, 1);
  assert.equal(s.operatingShare, 0.5);
  assert.equal(s.hubShare, 0.5);
});

// ---- drawing helpers -----------------------------------------------------------------------------------------------

test('bubbleRadius: area-proportional, zero for nothing, capped at max', () => {
  assert.equal(bubbleRadius(0, 100), 0);
  assert.equal(bubbleRadius(5, 0), 0);
  assert.equal(bubbleRadius(100, 100, { min: 3, max: 26 }), 26);
  const quarter = bubbleRadius(25, 100, { min: 0, max: 20 });
  assert.ok(Math.abs(quarter - 10) < 1e-9); // sqrt(0.25) = 0.5 of the range
});

test('arcPath: full circle uses two arcs; a slice starts at the centre', () => {
  assert.match(arcPath(10, 10, 5, 0, Math.PI * 2), /^M10,5A5,5 0 1 1 10,15A5,5 0 1 1 10,5Z$/);
  const slice = arcPath(0, 0, 10, 0, Math.PI / 2);
  assert.ok(slice.startsWith('M0,0L0.00,-10.00A10,10 0 0 1 10.00,0.00Z'), slice);
  const big = arcPath(0, 0, 10, 0, Math.PI * 1.5);
  assert.ok(big.includes(' 0 1 1 '), 'large-arc flag set for > 180°');
});

test('colorOf: unknown keys fall back to the neutral swatch in both themes', () => {
  assert.equal(colorOf(STATUS_COLOR, 'Operating', 'dark'), STATUS_COLOR.Operating.dark);
  assert.equal(colorOf(STATUS_COLOR, 'Mystery', 'light'), STATUS_COLOR.Unknown.light);
  assert.equal(colorOf({}, 'x', 'light'), '#898781');
});

// Map dashboard (index.html): province map with layer tabs, sidebar filters, KPI tiles, profile chart and a detail
// panel. Mirrors the layout of the U.S. Data Center Ecosystem Tracker, adapted to province-level data.
//
// Privacy rule: facilities.json carries no coordinates, so every facility is drawn at its province anchor. The
// page never receives, derives or displays a site location.

import { h, svg, byId, put, add, clear } from '../lib/dom.js';
import { CONFIG, DATA_FILES } from '../config.js';
import { loadJson, DataError } from '../lib/data.js';
import { renderShell, showError, announce, debounce } from '../lib/ui.js';
import { formatNumber, formatPercent, ordinal, EM_DASH } from '../lib/format.js';
import {
  STATUS_ORDER, CAPACITY_ORDER, TYPE_ORDER, SOURCE_ORDER, TECH_ORDER,
  STATUS_COLOR, TECH_COLOR, SEQ_RAMP, SEQ_RAMP_WARM, LINE_RAMP, colorOf, binIndex, binLabels,
  filterFacilities, countBy, summarizeByProvince, summarizeSelection, bubbleRadius, arcPath, quantileThresholds, separateBubbles,
} from '../lib/inventory.js';

const app = byId('app');
const VIEW_W = 1000;
const VIEW_H = 620;

// ---------------------------------------------------------------------------------------------------------------
// View definitions. `fill(province, ctx)` returns the value that colours the province; `bins` are thresholds.
// ---------------------------------------------------------------------------------------------------------------
const VIEWS = {
  status: {
    label: 'Status', title: 'Operating status by province',
    sourceKey: 'inventory', ramp: 'blue', unit: ' facilities', digits: 0,
    legendNote: 'Province shade: facility count. Wheel: status mix.',
    fill: (p, ctx) => ctx.byProvince.get(p.id)?.count ?? 0,
    bins: () => [1, 5, 15, 50], zeroLabel: 'None',
  },
  capacity: {
    label: 'Capacity', title: 'Reported IT / built-out capacity',
    sourceKey: 'inventory', ramp: 'blue', unit: ' MW', digits: 0,
    legendNote: 'Province shade: known MW in the selection. Bubble: known MW.',
    fill: (p, ctx) => ctx.byProvince.get(p.id)?.mw ?? 0,
    bins: () => [1, 50, 150, 400], zeroLabel: 'No reported MW',
  },
  power: {
    label: 'Power', title: 'Installed generating capacity (GEM units)',
    sourceKey: 'plants', ramp: 'blue', unit: ' MW', digits: 0,
    legendNote: 'Province shade: installed MW of the chosen technology.',
    fill: (p, ctx) => (ctx.powerTech ? p.indicators.installed_mw?.[ctx.powerTech] ?? 0 : p.indicators.installed_mw_total ?? 0),
    bins: (ctx) => quantileThresholds(ctx.provinces.map((p) => VIEWS.power.fill(p, ctx)).filter((v) => v > 0)),
    zeroLabel: 'None',
  },
  generation: {
    label: 'Generation', title: '2024 electricity generation and plant locations',
    sourceKey: 'generation', ramp: 'blue', unit: ' 亿kWh', digits: 0,
    legendNote: 'Province shade: 2024 generation (亿 kWh). Points: GEM plant units.',
    fill: (p) => p.indicators.generation_2024 ?? null,
    bins: () => [1000, 2500, 4000, 6000],
  },
  cost: {
    label: 'Electricity cost', title: 'Industrial & commercial electricity price (1–10 kV)',
    sourceKey: 'tariff', ramp: 'blue', unit: ' 元/kWh', digits: 2,
    legendNote: 'Province shade: 元 per kWh, May 2025. Grey: not in the source.',
    fill: (p, ctx) => (ctx.costMeasure === 'two' ? p.indicators.tariff_two_part_1_10kv : p.indicators.tariff_single_1_10kv) ?? null,
    bins: (ctx) => (ctx.costMeasure === 'two' ? [0.45, 0.55, 0.62, 0.68] : [0.5, 0.6, 0.7, 0.78]),
  },
  water: {
    label: 'Water scarcity', title: 'Water resources and use, 2024',
    sourceKey: 'water_resources', digits: (ctx) => (ctx.waterMeasure === 'stress' ? 2 : 0),
    // Abundance measures use the blue ramp (darker = more water); pressure measures use the warm ramp (darker = more stress).
    ramp: (ctx) => (ctx.waterMeasure === 'stress' || ctx.waterMeasure === 'industrial' ? 'warm' : 'blue'),
    unit: (ctx) => ({ stress: '', industrial: ' 亿m³', total: ' 亿m³', percap: ' m³/person' }[ctx.waterMeasure] ?? ''),
    legendNote: 'Province shade: the chosen water measure (blue = resources, orange = pressure).',
    fill: (p, ctx) => {
      const i = p.indicators;
      if (ctx.waterMeasure === 'stress') return i.water_stress_ratio_2024 ?? null;
      if (ctx.waterMeasure === 'industrial') return i.water_use_industrial_2024 ?? null;
      if (ctx.waterMeasure === 'total') return i.water_total_2024 ?? null;
      return i.water_per_capita_2024 ?? null;
    },
    bins: (ctx) => (ctx.waterMeasure === 'stress' ? [0.1, 0.25, 0.5, 1]
      : ctx.waterMeasure === 'industrial' ? [10, 20, 40, 70]
        : ctx.waterMeasure === 'total' ? [100, 500, 1000, 2000] : [500, 1000, 2000, 4000]),
  },
  policy: {
    label: 'Policy', title: 'East Data West Computing hub designation',
    sourceKey: null, ramp: 'blue', unit: '', digits: 0, categorical: true,
    legendNote: 'Hub provinces per the 2022 NDRC / MIIT / NEA / CAC approvals.',
    fill: (p) => (p.hub ? 1 : 0), bins: () => [],
  },
};
const VIEW_KEYS = Object.keys(VIEWS);

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
// No inventory-source filter on the page (removed at Gia's request, 15 Oct 2026); every source stays selected.
const defaultFilters = () => ({ search: '', status: new Set(STATUS_ORDER), type: new Set(TYPE_ORDER), capacity: new Set(CAPACITY_ORDER), source: new Set(SOURCE_ORDER) });
const state = {
  view: 'status',
  filters: defaultFilters(),
  // Province picked on the map ('' = all of China). It replaces the old Province dropdown: it scopes the KPI tiles,
  // the sidebar counts, the profile card and the plant layer, while every province stays drawn and clickable.
  focus: '',
  powerTech: '', generationTech: '', costMeasure: 'single', waterMeasure: 'percap',
  showLines: true, // transmission-line overlay on the energy tabs (Power, Generation)
  selected: null, // {kind:'province'|'facility'|'plant', id}
  transform: { k: 1, x: 0, y: 0 },
};
let data = null; // { provinces, facilities, plants, legislation, lines }
let els = {};
let filtered = []; // facilities passing the sidebar filters AND the province focus (KPIs, counts, donut)
let byProvince = new Map(); // per-province rollup of the sidebar filters only (map shading, bubbles, tooltips)
let provinceById = new Map();

function theme() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark' || t === 'light') return t;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// ---------------------------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------------------------
async function main() {
  let meta = null;
  try {
    const [m, provinces, facilities] = await Promise.all([
      loadJson(DATA_FILES.meta), loadJson(DATA_FILES.provinces), loadJson(DATA_FILES.facilities),
    ]);
    meta = m;
    if (!Array.isArray(provinces?.provinces)) throw new DataError(`${DATA_FILES.provinces} is missing the "provinces" array.`);
    if (!Array.isArray(facilities?.facilities)) throw new DataError(`${DATA_FILES.facilities} is missing the "facilities" array.`);
    data = { provinces, facilities, plants: null, legislation: null };
  } catch (err) {
    renderShell('index.html', meta);
    showError(app, err);
    return;
  }
  renderShell('index.html', meta);
  provinceById = new Map(data.provinces.provinces.map((p) => [p.id, p]));
  buildLayout();
  applyFilters();
  setView(viewFromHash() ?? 'status');
  window.addEventListener('hashchange', readHash);
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener?.('change', repaint);
  new MutationObserver(repaint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

function viewFromHash() {
  const m = /view=([a-z]+)/.exec(location.hash);
  return m && VIEWS[m[1]] ? m[1] : null;
}
function readHash() {
  const v = viewFromHash();
  if (v && v !== state.view) setView(v);
}

// ---------------------------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------------------------
function buildLayout() {
  const sidebar = h('aside', { class: 'db-filters card', 'aria-label': 'Dashboard filters' },
    h('div', { class: 'db-panel-head' },
      h('div', null, h('span', { class: 'eyebrow' }, 'Explore'), h('h2', null, 'Filter facilities')),
      h('button', { class: 'link-btn', type: 'button', id: 'db-reset' }, 'Reset')),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Search'),
      h('input', { id: 'db-search', class: 'input', type: 'search', placeholder: 'Name, operator, province', autocomplete: 'off' })),
    h('p', { class: 'hint' }, 'All categories begin selected. Clear a group, then check the types you want to compare.'),
    filterGroup('status', 'Project status', STATUS_ORDER, (k) => colorOf(STATUS_COLOR, k, theme()), true),
    filterGroup('type', 'Facility type', TYPE_ORDER, null, false),
    filterGroup('capacity', 'Reported capacity', CAPACITY_ORDER, null, true),
    h('div', { class: 'db-selection' },
      h('span', { class: 'field-label' }, 'Current selection'),
      h('strong', { id: 'db-selection-count' }, EM_DASH),
      h('div', { class: 'db-scope', id: 'db-scope' })),
    flagNote('These measures support screening and comparison. Province totals, mapped transmission lines and inventory listings do not prove grid service, causation, or project-level effects. Facilities are shown at province level only and are not downloadable.'));

  const kpis = h('div', { class: 'kpis', 'aria-live': 'polite' },
    kpiTile('db-k-count', 'Facilities', 'of inventory'),
    kpiTile('db-k-mw', 'Reported capacity', 'Known MW, selected records'),
    kpiTile('db-k-op', 'Operating', 'Share of selection'),
    kpiTile('db-k-hub', 'In an EDWC hub province', 'Share of selection'));

  const tabs = h('div', { class: 'db-tabs', role: 'tablist', 'aria-label': 'Map layer' },
    VIEW_KEYS.map((k) => h('button', { class: 'db-tab', type: 'button', role: 'tab', dataset: { view: k }, 'aria-selected': 'false', onclick: () => setView(k) }, VIEWS[k].label)));

  const subcontrols = h('div', { class: 'db-subcontrols' },
    h('label', { class: 'db-sub', dataset: { for: 'power' }, hidden: true }, 'Technology ',
      h('select', { id: 'db-power-tech', class: 'select small' }, h('option', { value: '' }, 'All technologies'), TECH_ORDER.map((t) => h('option', { value: t }, t)))),
    h('label', { class: 'db-sub', dataset: { for: 'generation' }, hidden: true }, 'Plant technology ',
      h('select', { id: 'db-gen-tech', class: 'select small' }, h('option', { value: '' }, 'All technologies'), TECH_ORDER.map((t) => h('option', { value: t }, t)))),
    h('label', { class: 'db-sub', dataset: { for: 'cost' }, hidden: true }, 'Tariff ',
      h('select', { id: 'db-cost-measure', class: 'select small' },
        h('option', { value: 'single' }, 'Single-part (单一制) rate'),
        h('option', { value: 'two' }, 'Two-part (两部制) energy rate'))),
    h('label', { class: 'db-sub', dataset: { for: 'water' }, hidden: true }, 'Measure ',
      h('select', { id: 'db-water-measure', class: 'select small' },
        h('option', { value: 'percap' }, 'Per-capita water resources (m³/person)'),
        h('option', { value: 'stress' }, 'Use ÷ resources (pressure ratio)'),
        h('option', { value: 'total' }, 'Total water resources (亿 m³)'),
        h('option', { value: 'industrial' }, 'Industrial water use (亿 m³)'))),
    h('label', { class: 'db-sub db-sub-check', dataset: { for: 'power generation' }, hidden: true },
      h('input', { type: 'checkbox', id: 'db-lines-toggle', checked: true }),
      h('span', { id: 'db-lines-label' }, 'Transmission lines ≥250 kV')),
    h('div', { class: 'db-map-actions' },
      h('button', { class: 'btn', type: 'button', id: 'db-zoom-out', 'aria-label': 'Zoom out' }, '−'),
      h('button', { class: 'btn', type: 'button', id: 'db-zoom-reset' }, 'Reset view'),
      h('button', { class: 'btn', type: 'button', id: 'db-zoom-in', 'aria-label': 'Zoom in' }, '+')));

  const map = svg('svg', { id: 'db-map', viewBox: `0 0 ${VIEW_W} ${VIEW_H}`, role: 'img', 'aria-label': 'Map of China by province', preserveAspectRatio: 'xMidYMid meet' },
    svg('g', { id: 'db-viewport' },
      svg('g', { id: 'db-provinces' }), svg('g', { id: 'db-lines', 'aria-hidden': 'true' }), svg('g', { id: 'db-plants' }), svg('g', { id: 'db-bubbles' }), svg('g', { id: 'db-labels' })));
  const mapCard = h('div', { class: 'db-map-card card' },
    h('div', { class: 'db-toolbar' }, tabs, subcontrols),
    h('div', { class: 'db-map-shell', id: 'db-map-shell' }, map,
      h('div', { class: 'db-caption' }, h('span', { id: 'db-view-title' }), h('span', null, 'Scroll to zoom · drag to pan · select a province to focus on it'))),
    h('div', { class: 'db-legend', id: 'db-legend', 'aria-label': 'Map legend' }));

  const analysis = h('div', { class: 'db-analysis' },
    h('section', { class: 'card', 'aria-labelledby': 'db-profile-title' },
      h('div', { class: 'db-panel-head' },
        h('div', null, h('span', { class: 'eyebrow', id: 'db-profile-eyebrow' }, 'Selection profile'), h('h2', { id: 'db-profile-title' }, 'Status distribution')),
        h('span', { class: 'muted', id: 'db-chart-total' })),
      h('div', { id: 'db-chart', class: 'db-bars' })));

  const detail = h('aside', { class: 'db-detail card', id: 'db-detail', 'aria-label': 'Selected province details' });

  put(app,
    // No visible title block (Gia, 15 Oct 2026); the h1 stays for screen readers and document outline.
    h('h1', { class: 'sr-only' }, 'China Data-Center Ecosystem Tracker'),
    h('div', { class: 'db-workspace' }, sidebar, h('div', { class: 'db-main' }, kpis, mapCard, analysis), detail));

  els = {
    search: byId('db-search'), reset: byId('db-reset'), scope: byId('db-scope'),
    selectionCount: byId('db-selection-count'), map: byId('db-map'), viewport: byId('db-viewport'), provinces: byId('db-provinces'),
    plants: byId('db-plants'), bubbles: byId('db-bubbles'), labels: byId('db-labels'), legend: byId('db-legend'), viewTitle: byId('db-view-title'),
    chart: byId('db-chart'), chartTotal: byId('db-chart-total'), profileEyebrow: byId('db-profile-eyebrow'), profileTitle: byId('db-profile-title'),
    detail: byId('db-detail'), powerTech: byId('db-power-tech'), genTech: byId('db-gen-tech'), costMeasure: byId('db-cost-measure'), waterMeasure: byId('db-water-measure'),
    mapShell: byId('db-map-shell'), lines: byId('db-lines'), linesToggle: byId('db-lines-toggle'), linesLabel: byId('db-lines-label'),
  };
  els.tooltip = h('div', { class: 'tooltip', id: 'db-tooltip', role: 'tooltip' });
  document.body.append(els.tooltip); // note: add() returns the parent, which is why this is not add(document.body, …)

  const onSearch = debounce(() => { state.filters.search = els.search.value.trim(); applyFilters(); }, 120);
  els.search.addEventListener('input', onSearch);
  els.reset.addEventListener('click', resetFilters);
  els.powerTech.addEventListener('change', () => { state.powerTech = els.powerTech.value; repaint(); });
  els.genTech.addEventListener('change', () => { state.generationTech = els.genTech.value; repaint(); });
  els.costMeasure.addEventListener('change', () => { state.costMeasure = els.costMeasure.value; repaint(); });
  els.waterMeasure.addEventListener('change', () => { state.waterMeasure = els.waterMeasure.value; repaint(); });
  els.linesToggle.addEventListener('change', () => { state.showLines = els.linesToggle.checked; repaint(); });
  byId('db-zoom-in').addEventListener('click', () => zoom(1.35));
  byId('db-zoom-out').addEventListener('click', () => zoom(1 / 1.35));
  byId('db-zoom-reset').addEventListener('click', resetView);
  installPanZoom();
  renderProvinces();
  renderDetail();
}

/** Caveat line with an info icon (as on the U.S. tracker). */
function flagNote(text) {
  const icon = svg('svg', { viewBox: '0 0 16 16', class: 'db-flag-icon', 'aria-hidden': 'true', focusable: 'false' },
    svg('circle', { cx: 8, cy: 8, r: 7, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3 }),
    svg('rect', { x: 7.3, y: 6.8, width: 1.4, height: 5, rx: 0.7, fill: 'currentColor' }),
    svg('circle', { cx: 8, cy: 4.7, r: 0.9, fill: 'currentColor' }));
  return h('p', { class: 'db-flag', role: 'note' }, icon, h('span', null, text));
}

function kpiTile(id, label, note) {
  return h('div', { class: 'kpi' }, h('div', { class: 'label' }, label), h('div', { class: 'value', id: id }, EM_DASH), h('div', { class: 'note', id: `${id}-note` }, note));
}

function filterGroup(key, label, order, swatch, open, labelOf = (k) => k) {
  const body = h('div', { class: 'group', role: 'group', 'aria-label': label, id: `db-group-${key}` },
    order.map((k) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', value: k, checked: true, onchange: (e) => { toggle(key, k, e.target.checked); } }),
      swatch ? h('span', { class: 'swatch', style: { background: swatch(k) }, 'aria-hidden': 'true' }) : null,
      h('span', null, labelOf(k)), h('span', { class: 'count', dataset: { count: k } }))));
  return h('details', { class: 'db-group', open: open || null },
    h('summary', null, h('span', null, label), h('strong', { id: `db-sel-${key}` })),
    h('div', { class: 'db-group-actions' },
      h('button', { type: 'button', class: 'link-btn small', onclick: () => setAll(key, order, true) }, 'Select all'),
      h('button', { type: 'button', class: 'link-btn small', onclick: () => setAll(key, order, false) }, 'Clear')),
    body);
}

function toggle(key, value, on) {
  if (on) state.filters[key].add(value); else state.filters[key].delete(value);
  applyFilters();
}
function setAll(key, order, on) {
  state.filters[key] = new Set(on ? order : []);
  byId(`db-group-${key}`).querySelectorAll('input').forEach((i) => { i.checked = on; });
  applyFilters();
}
function resetFilters() {
  state.filters = defaultFilters();
  state.focus = ''; // Reset also returns the dashboard to all of China
  state.selected = null;
  els.search.value = '';
  app.querySelectorAll('.db-group input').forEach((i) => { i.checked = true; });
  applyFilters();
}

/** Sidebar line naming the focused province (set by clicking the map), with a way back to all of China. */
function renderScope(focusP) {
  if (focusP) {
    put(els.scope, h('span', { class: 'db-chip' }, `${focusP.name} ${focusP.nameZh}`),
      h('button', { class: 'link-btn small', type: 'button', onclick: () => select(null) }, 'Show all of China'));
  } else {
    put(els.scope, h('span', { class: 'muted' }, 'All of China. Select a province on the map to focus on it.'));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Filtering and summary
// ---------------------------------------------------------------------------------------------------------------
function applyFilters() {
  const all = data.facilities.facilities;
  const passing = filterFacilities(all, state.filters, provinceById);
  byProvince = summarizeByProvince(passing); // the map keeps every province so another one can be clicked
  filtered = state.focus ? passing.filter((f) => f.province === state.focus) : passing;
  const focusP = provinceById.get(state.focus);
  const sum = summarizeSelection(filtered, all.length, provinceById);
  els.selectionCount.textContent = `${formatNumber(sum.count)} ${sum.count === 1 ? 'facility' : 'facilities'}`;
  renderScope(focusP);
  byId('db-k-count').textContent = formatNumber(sum.count);
  byId('db-k-count-note').textContent = `${(sum.share * 100).toFixed(1)}% of inventory${focusP ? ` · ${focusP.name}` : ''}`;
  byId('db-k-mw').textContent = sum.mwKnown ? `${formatNumber(sum.mwTotal, { digits: 1 })} MW` : EM_DASH;
  byId('db-k-mw-note').textContent = `Known MW, ${formatNumber(sum.mwKnown)} of ${formatNumber(sum.count)} records`;
  byId('db-k-op').textContent = sum.operatingShare === null ? EM_DASH : `${(sum.operatingShare * 100).toFixed(1)}%`;
  byId('db-k-hub').textContent = sum.hubShare === null ? EM_DASH : `${(sum.hubShare * 100).toFixed(1)}%`;
  // Per-category counts and "n of m" summaries.
  const groups = { status: [STATUS_ORDER, (f) => f.status], type: [TYPE_ORDER, (f) => f.facilityType], capacity: [CAPACITY_ORDER, (f) => f.capacity] };
  for (const [key, [order, fn]] of Object.entries(groups)) {
    const counts = countBy(filtered, fn, order);
    const group = byId(`db-group-${key}`);
    group.querySelectorAll('[data-count]').forEach((el) => { el.textContent = formatNumber(counts.get(el.dataset.count) ?? 0); });
    byId(`db-sel-${key}`).textContent = `${state.filters[key].size} of ${order.length}`;
  }
  announce(`${sum.count} ${sum.count === 1 ? 'facility matches' : 'facilities match'} the filters${focusP ? ` in ${focusP.name}` : ''}`);
  repaint();
  renderDetail();
}

function unitOf(view) {
  return typeof view.unit === 'function' ? view.unit(ctx()) : view.unit;
}
function digitsOf(view) {
  return typeof view.digits === 'function' ? view.digits(ctx()) : view.digits;
}

function ctx() {
  return { byProvince, provinces: data.provinces.provinces, powerTech: state.powerTech, costMeasure: state.costMeasure, waterMeasure: state.waterMeasure };
}

// ---------------------------------------------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------------------------------------------
function renderProvinces() {
  clear(els.provinces);
  clear(els.labels);
  for (const p of data.provinces.provinces) {
    const path = svg('path', { d: p.path, class: 'db-province', dataset: { id: p.id }, tabindex: 0, role: 'button', 'aria-label': `${p.name} ${p.nameZh}` });
    path.addEventListener('pointerenter', (e) => showProvinceTooltip(e, p));
    path.addEventListener('pointermove', positionTooltip);
    path.addEventListener('pointerleave', hideTooltip);
    path.addEventListener('click', (e) => { e.stopPropagation(); select({ kind: 'province', id: p.id }); });
    path.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select({ kind: 'province', id: p.id }); } });
    els.provinces.append(path);
  }
}

function repaint() {
  const view = VIEWS[state.view];
  const c = ctx();
  const t = theme();
  const rampKey = typeof view.ramp === 'function' ? view.ramp(c) : view.ramp;
  const ramp = (rampKey === 'warm' ? SEQ_RAMP_WARM : SEQ_RAMP)[t];
  const thresholds = view.bins(c);
  const fills = new Map();
  for (const p of data.provinces.provinces) {
    const v = view.fill(p, c);
    let fill = 'var(--map-nodata)';
    if (view.categorical) fill = v ? ramp[3] : 'var(--map-land)';
    else if (v !== null && v !== undefined) {
      const i = binIndex(v, thresholds);
      fill = (v === 0 && view.zeroLabel) ? 'var(--map-land)' : ramp[Math.max(0, Math.min(ramp.length - 1, i))];
    }
    fills.set(p.id, fill);
  }
  for (const path of els.provinces.children) {
    const id = path.dataset.id;
    path.style.fill = fills.get(id);
    path.classList.toggle('is-selected', state.selected?.kind === 'province' && state.selected.id === id);
    path.classList.toggle('is-dim', Boolean(state.focus) && state.focus !== id);
  }
  els.provinces.classList.toggle('soft', state.view === 'generation'); // let the plant points read over the fill
  renderBubbles(t);
  renderLines(t);
  renderPlants(t);
  renderLegend(view, thresholds, ramp, t);
  renderChart(view, t);
}

function renderBubbles(t) {
  clear(els.bubbles);
  const byMw = state.view === 'capacity';
  const max = Math.max(0, ...[...byProvince.values()].map((s) => (byMw ? s.mw : s.count)));
  const pale = !['status', 'capacity'].includes(state.view);
  const items = [];
  for (const p of data.provinces.provinces) {
    const s = byProvince.get(p.id);
    if (!s) continue;
    const value = byMw ? s.mw : s.count;
    const r = bubbleRadius(value, max, pale ? { min: 2.5, max: 16 } : { min: 3.5, max: 26 });
    if (r) items.push({ x: p.cx, y: p.cy, r, p, s });
  }
  // Wheels of neighbouring provinces (Beijing / Tianjin / Hebei, Shanghai / Jiangsu / Zhejiang, Guangdong / Hong Kong /
  // Macau) used to overlap. Push them apart, tie a wheel that left its province to it with a leader line, and draw
  // the largest first so a small wheel is never hidden under a big one.
  const placed = separateBubbles(items, { gap: 1.5, bounds: [0, 0, VIEW_W, VIEW_H] }).sort((a, b) => b.r - a.r);
  const leaders = svg('g', { class: 'db-leaders', 'aria-hidden': 'true' });
  for (const b of placed) {
    const { p, s, r, x: cx, y: cy } = b;
    const dim = Boolean(state.focus) && state.focus !== p.id;
    const off = Math.hypot(cx - b.ax, cy - b.ay);
    if (off > r) { // the wheel no longer covers its anchor: draw a line from the province to the wheel's edge
      const k = (off - r) / off;
      leaders.append(svg('line', { x1: b.ax, y1: b.ay, x2: b.ax + (cx - b.ax) * k, y2: b.ay + (cy - b.ay) * k, class: dim ? 'db-leader is-dim' : 'db-leader' }));
      leaders.append(svg('circle', { cx: b.ax, cy: b.ay, r: 1.4, class: dim ? 'db-anchor is-dim' : 'db-anchor' }));
    }
    const g = svg('g', { class: `db-bubble${pale ? ' pale' : ''}${dim ? ' is-dim' : ''}`, dataset: { id: p.id } });
    if (state.view === 'status' && s.count) {
      let a = 0;
      for (const k of STATUS_ORDER) {
        const n = s.status.get(k) ?? 0;
        if (!n) continue;
        const a1 = a + (n / s.count) * Math.PI * 2;
        g.append(svg('path', { d: arcPath(cx, cy, r, a, a1), fill: colorOf(STATUS_COLOR, k, t), class: 'db-slice' }));
        a = a1;
      }
    } else {
      g.append(svg('circle', { cx, cy, r, class: 'db-dot' }));
    }
    g.append(svg('circle', { cx, cy, r, class: 'db-bubble-ring' }));
    g.addEventListener('pointerenter', (e) => showProvinceTooltip(e, p));
    g.addEventListener('pointermove', positionTooltip);
    g.addEventListener('pointerleave', hideTooltip);
    g.addEventListener('click', (e) => { e.stopPropagation(); select({ kind: 'province', id: p.id }); });
    els.bubbles.append(g);
  }
  if (leaders.childNodes.length) els.bubbles.prepend(leaders); // under every wheel; absent when nothing moved
}

// ---------------------------------------------------------------------------------------------------------------
// Transmission lines (OpenStreetMap, at or above the build threshold, 250 kV by default): an overlay on the energy
// tabs. The paths never take pointer events, so clicks and hovers still reach the province underneath.
// ---------------------------------------------------------------------------------------------------------------
const LINE_VIEWS = new Set(['power', 'generation']);
const LINE_WIDTH = { 220: 0.6, 330: 0.8, 500: 1.1, 750: 1.6, uhv: 2.4 }; // px, non-scaling; width encodes voltage too
let linesPromise = null;

/** Load power_lines.json once, then repaint: the legend, the profile card and the detail panel use it as well. */
function ensureLines() {
  if (!linesPromise) {
    linesPromise = loadJson(DATA_FILES.lines)
      .then((d) => {
        if (!Array.isArray(d?.classes) || !d.paths || !d.km_by_province) throw new DataError(`${DATA_FILES.lines} is missing "classes", "paths" or "km_by_province".`);
        data.lines = d;
        els.linesLabel.textContent = `Transmission lines ≥${formatNumber(d.min_kv)} kV`;
      })
      .catch((err) => { data.linesError = err.message; })
      .finally(() => { repaint(); renderDetail(); });
  }
  return linesPromise;
}

function linesShown() { return state.showLines && LINE_VIEWS.has(state.view); }

/** Colour of class i of n (lowest voltage first): the last n steps of LINE_RAMP. */
function lineColor(i, n, t) {
  const ramp = LINE_RAMP[t];
  return ramp[Math.min(ramp.length - 1, Math.max(0, ramp.length - n + i))];
}

function renderLines(t) {
  clear(els.lines);
  if (!linesShown()) return;
  if (!data.lines) { if (!data.linesError) ensureLines(); return; }
  const { classes, paths } = data.lines;
  const frag = document.createDocumentFragment();
  classes.forEach((c, i) => { // lowest voltage first, so the heavier lines draw on top
    const stroke = lineColor(i, classes.length, t);
    for (const [pid, byClass] of Object.entries(paths)) {
      if (!byClass[c.key]) continue;
      frag.append(svg('path', { d: byClass[c.key], class: state.focus && state.focus !== pid ? 'db-line is-dim' : 'db-line', stroke, 'stroke-width': LINE_WIDTH[c.key] ?? 1, dataset: { cls: c.key, province: pid } }));
    }
  });
  els.lines.append(frag);
}

/** Mapped km per class for a province ({} if none); null before the data has loaded. */
function lineKm(pid) {
  return data.lines ? data.lines.km_by_province[pid] ?? {} : null;
}
const sumKm = (byClass) => Object.values(byClass ?? {}).reduce((a, b) => a + b, 0);

/** Profile-card block: mapped km per voltage class for one province, or for all of China when pid is empty. */
function lineBars(pid, t) {
  if (!data.lines) { if (!data.linesError) ensureLines(); return null; }
  const { classes } = data.lines;
  const km = pid ? lineKm(pid) : Object.fromEntries(classes.map((c) => [c.key, c.km]));
  const total = sumKm(km);
  const max = Math.max(...classes.map((c) => km[c.key] ?? 0), 1);
  return h('div', { class: 'db-line-bars' },
    h('h3', { class: 'db-chart-sub' }, `Transmission lines ≥${formatNumber(data.lines.min_kv)} kV · ${formatNumber(total, { digits: 0 })} km mapped`),
    total
      ? classes.map((c, i) => barRow(c.label, km[c.key] ?? 0, max, lineColor(i, classes.length, t), `${formatNumber(km[c.key] ?? 0, { digits: 0 })} km`))
      : h('p', { class: 'muted' }, 'No line at this voltage is mapped in OpenStreetMap here.'),
    h('p', { class: 'hint db-chart-note' }, 'Route length of voltage-tagged OpenStreetMap ways, not official circuit length; untagged lines are left out, so read it as a lower bound.'));
}

/** Detail-panel value: total km and a chip per class. */
function transmissionFact(pid, t) {
  if (data.linesError) return 'Unavailable';
  if (!data.lines) { ensureLines(); return 'Loading…'; }
  const km = lineKm(pid);
  const total = sumKm(km);
  if (!total) return 'None mapped';
  const { classes } = data.lines;
  return [h('span', { class: 'db-chip' }, `${formatNumber(total, { digits: 0 })} km mapped`),
    classes.filter((c) => km[c.key]).map((c) => h('span', { class: 'db-chip' },
      h('span', { class: 'db-swatch line', style: { background: lineColor(classes.indexOf(c), classes.length, t) } }),
      `${c.label} ${formatNumber(km[c.key], { digits: 0 })} km`))];
}

async function renderPlants(t) {
  clear(els.plants);
  if (state.view !== 'generation') return;
  if (!data.plants) {
    try {
      data.plants = await loadJson(DATA_FILES.plants);
    } catch (err) {
      put(els.legend, h('div', { class: 'db-legend-note' }, `Power-plant layer unavailable: ${err.message}`));
      return;
    }
    if (state.view !== 'generation') return;
  }
  const frag = document.createDocumentFragment();
  const [TI, MI, XI, YI, PI] = [0, 1, 2, 3, 4];
  const prov = state.focus;
  const tech = state.generationTech;
  let maxMw = 0;
  for (const row of data.plants.plants) if (row[MI] > maxMw) maxMw = row[MI];
  for (let i = 0; i < data.plants.plants.length; i += 1) {
    const row = data.plants.plants[i];
    if (tech && row[TI] !== tech) continue;
    if (prov && row[PI] !== prov) continue;
    const r = 0.8 + 3.2 * Math.sqrt(row[MI] / (maxMw || 1));
    frag.append(svg('circle', { cx: row[XI], cy: row[YI], r: r.toFixed(2), class: 'db-plant', fill: colorOf(TECH_COLOR, row[TI], t), dataset: { i } }));
  }
  els.plants.append(frag);
  renderChart(VIEWS.generation, t);
}

// Plant hover/click uses event delegation (there can be 16k circles).
function plantFromEvent(e) {
  const el = e.target.closest?.('.db-plant');
  if (!el || !data.plants) return null;
  const row = data.plants.plants[Number(el.dataset.i)];
  return row ? { tech: row[0], mw: row[1], province: row[4] } : null;
}

function installPanZoom() {
  // Pointer capture starts only once the pointer has really moved. Capturing on pointerdown retargets the click that
  // follows to the <svg> itself (Chromium), so a plain click on a province never reached it and was read as a click
  // on empty map instead.
  let drag = null;
  let suppressClick = false;
  els.map.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = els.map.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * VIEW_W;
    const py = ((e.clientY - rect.top) / rect.height) * VIEW_H;
    zoom(e.deltaY < 0 ? 1.18 : 1 / 1.18, px, py);
  }, { passive: false });
  els.map.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    suppressClick = false;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, tx: state.transform.x, ty: state.transform.y, moved: false };
  });
  els.map.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const rect = els.map.getBoundingClientRect();
    const dx = ((e.clientX - drag.x) / rect.width) * VIEW_W;
    const dy = ((e.clientY - drag.y) / rect.height) * VIEW_H;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 2) {
      drag.moved = true;
      els.map.setPointerCapture(e.pointerId);
      els.map.classList.add('dragging');
    }
    if (drag.moved) {
      state.transform.x = drag.tx + dx;
      state.transform.y = drag.ty + dy;
      updateTransform();
    }
  });
  els.map.addEventListener('pointerup', () => {
    if (drag?.moved) { els.map.classList.remove('dragging'); suppressClick = true; }
    drag = null;
  });
  els.map.addEventListener('pointercancel', () => { els.map.classList.remove('dragging'); drag = null; });
  // The click that ends a drag is swallowed here (capture phase, before any province or bubble handler), so panning
  // never selects a province or clears the focus.
  els.map.addEventListener('click', (e) => {
    if (suppressClick) { suppressClick = false; e.stopImmediatePropagation(); }
  }, true);
  els.map.addEventListener('click', (e) => {
    const plant = plantFromEvent(e);
    if (plant) { e.stopPropagation(); select({ kind: 'plant', plant }); return; }
    if (e.target === els.map) select(null);
  });
  els.plants.addEventListener('pointerover', (e) => { const p = plantFromEvent(e); if (p) showPlantTooltip(e, p); });
  els.plants.addEventListener('pointermove', positionTooltip);
  els.plants.addEventListener('pointerout', hideTooltip);
}

function zoom(factor, px = VIEW_W / 2, py = VIEW_H / 2) {
  const tr = state.transform;
  const k = Math.min(12, Math.max(1, tr.k * factor));
  const f = k / tr.k;
  tr.x = px - (px - tr.x) * f;
  tr.y = py - (py - tr.y) * f;
  tr.k = k;
  if (k === 1) { tr.x = 0; tr.y = 0; }
  updateTransform();
}
function resetView() { state.transform = { k: 1, x: 0, y: 0 }; updateTransform(); }
function updateTransform() {
  const { k, x, y } = state.transform;
  els.viewport.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${k.toFixed(3)})`);
  els.viewport.style.setProperty('--k', String(k));
}

// ---------------------------------------------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------------------------------------------
function showProvinceTooltip(e, p) {
  const s = byProvince.get(p.id);
  const view = VIEWS[state.view];
  const v = view.fill(p, ctx());
  const rows = [
    h('div', { class: 't-value' }, `${p.name} · ${p.nameZh}`),
    h('div', { class: 't-label' }, `${formatNumber(s?.count ?? 0)} facilities in selection${s?.mwKnown ? ` · ${formatNumber(s.mw, { digits: 0 })} MW known` : ''}`),
  ];
  if (!view.categorical && state.view !== 'status' && state.view !== 'capacity') {
    rows.push(h('div', { class: 't-label' }, `${view.title}: ${v === null || v === undefined ? 'no data' : formatNumber(v, { digits: digitsOf(view) }) + unitOf(view)}`));
  }
  if (linesShown() && data.lines) rows.push(h('div', { class: 't-label' }, `Transmission ≥${formatNumber(data.lines.min_kv)} kV: ${formatNumber(sumKm(lineKm(p.id)), { digits: 0 })} km mapped`));
  if (p.hub) rows.push(h('div', { class: 't-label' }, `EDWC: ${data.provinces.hubs[p.hub]?.name_en}`));
  put(els.tooltip, rows);
  els.tooltip.classList.add('on');
  positionTooltip(e);
}
function showPlantTooltip(e, plant) {
  put(els.tooltip, h('div', { class: 't-value' }, `${plant.tech} unit · ${formatNumber(plant.mw, { digits: 1 })} MW`),
    h('div', { class: 't-label' }, provinceById.get(plant.province)?.name ?? 'Outside province outlines'));
  els.tooltip.classList.add('on');
  positionTooltip(e);
}
function positionTooltip(e) {
  const pad = 14;
  const w = els.tooltip.offsetWidth;
  const hgt = els.tooltip.offsetHeight;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
  if (y + hgt > window.innerHeight - 8) y = e.clientY - hgt - pad;
  els.tooltip.style.left = `${x}px`;
  els.tooltip.style.top = `${y}px`;
}
function hideTooltip() { els.tooltip.classList.remove('on'); }

// ---------------------------------------------------------------------------------------------------------------
// Legend, chart
// ---------------------------------------------------------------------------------------------------------------
function setView(key) {
  state.view = key;
  app.querySelectorAll('.db-tab').forEach((b) => { b.setAttribute('aria-selected', b.dataset.view === key ? 'true' : 'false'); b.classList.toggle('active', b.dataset.view === key); });
  app.querySelectorAll('.db-sub').forEach((el) => { el.hidden = !el.dataset.for.split(' ').includes(key); });
  if (location.hash !== `#view=${key}`) history.replaceState(null, '', `#view=${key}`);
  repaint();
}

function legendItem(color, label, { ring = false } = {}) {
  return h('div', { class: 'db-legend-item' }, h('span', { class: ring ? 'db-swatch ring' : 'db-swatch', style: { background: color } }), h('span', null, label));
}

function renderLegend(view, thresholds, ramp, t) {
  els.viewTitle.textContent = view.title;
  const items = [];
  if (view.categorical) {
    items.push(legendItem(ramp[3], 'EDWC national hub province'), legendItem('var(--map-land)', 'Other province'));
  } else {
    const labels = binLabels(thresholds, { unit: unitOf(view), digits: digitsOf(view), integer: digitsOf(view) === 0 });
    labels.forEach((label, i) => {
      if (i === 0 && view.zeroLabel) items.push(legendItem('var(--map-land)', view.zeroLabel));
      else items.push(legendItem(ramp[Math.min(i, ramp.length - 1)], label));
    });
    if (state.view === 'cost' || state.view === 'water' || state.view === 'generation') items.push(legendItem('var(--map-nodata)', 'No data'));
  }
  if (state.view === 'status') STATUS_ORDER.forEach((k) => items.push(legendItem(colorOf(STATUS_COLOR, k, t), k, { ring: true })));
  if (state.view === 'generation') TECH_ORDER.forEach((k) => items.push(legendItem(colorOf(TECH_COLOR, k, t), `${k} unit`, { ring: true })));
  const lines = linesShown() ? data.lines : null;
  if (lines) {
    lines.classes.forEach((c, i) => items.push(h('div', { class: 'db-legend-item' },
      h('span', { class: 'db-swatch line', style: { background: lineColor(i, lines.classes.length, t), height: `${Math.max(2, Math.round((LINE_WIDTH[c.key] ?? 1) * 1.6))}px` } }),
      h('span', null, `${c.label} line`))));
  }
  const src = view.sourceKey ? data.provinces.sources[view.sourceKey] : null;
  put(els.legend, items, h('div', { class: 'db-legend-note' }, view.legendNote, ' ',
    src ? ['Source: ', src.url ? h('a', { href: src.url, rel: 'noopener', target: '_blank' }, src.title) : src.title, ` (${src.publisher}; tier ${src.tier}).`] : null,
    lines ? [` Transmission lines: OpenStreetMap ways tagged ≥${formatNumber(lines.min_kv)} kV, `, h('a', { href: lines.source.url, rel: 'noopener', target: '_blank' }, lines.source.publisher),
      `, ODbL (tier ${lines.source.tier}; lines without a voltage tag are omitted).`] : null,
    linesShown() && data.linesError ? ` Transmission layer unavailable: ${data.linesError}` : null));
}

function barRow(label, value, max, color, valueText, { focus = false } = {}) {
  return h('div', { class: focus ? 'db-bar-row is-focus' : 'db-bar-row' },
    h('span', { class: 'db-bar-label', title: label }, label),
    h('div', { class: 'db-bar-track' }, h('div', { class: 'db-bar-fill', style: { width: `${max ? (value / max) * 100 : 0}%`, background: color } })),
    h('strong', { class: 'num' }, valueText ?? formatNumber(value)));
}

/** Provinces with a non-zero value for the current view, highest first: [[province, value], …]. */
function rankProvinces(view, c) {
  return data.provinces.provinces.map((p) => [p, view.fill(p, c)])
    .filter(([, v]) => Number.isFinite(v) && v !== 0)
    .sort((a, b) => b[1] - a[1]);
}

/** Plain-language name of the measure behind the current comparison view, used in the rank sentence. */
function measurePhrase() {
  if (state.view === 'cost') return state.costMeasure === 'two' ? 'the two-part 1–10 kV energy rate' : 'the single-part 1–10 kV rate';
  if (state.view === 'water') return { percap: 'per-capita water resources', stress: 'the use ÷ resources ratio', total: 'total water resources', industrial: 'industrial water use' }[state.waterMeasure] ?? 'the chosen measure';
  return `${state.powerTech || 'total'} installed capacity`;
}

function rankNote(p, ranked) {
  const i = ranked.findIndex(([q]) => q.id === p.id);
  return i < 0 ? `No value for ${measurePhrase()} in ${p.name}.` : `${p.name} ranks ${ordinal(i + 1)} highest of ${ranked.length} provinces for ${measurePhrase()}.`;
}

// The profile card follows the province focus: the Generation and Power tabs show that province's power
// infrastructure, the comparison tabs highlight it, and the donut tabs count only its facilities.
async function renderChart(view, t) {
  const c = ctx();
  const provs = data.provinces.provinces;
  const focusP = provinceById.get(state.focus) ?? null;
  els.chart.classList.remove('has-focus');
  if (state.view === 'generation') {
    els.profileEyebrow.textContent = 'Power infrastructure profile';
    els.profileTitle.textContent = focusP ? `${focusP.name} · GEM units by technology` : 'GEM units by technology · all of China';
    if (!data.plants) { els.chartTotal.textContent = ''; put(els.chart, h('p', { class: 'muted' }, 'Loading…')); return; }
    const all = data.plants.plants;
    const rows = focusP ? all.filter((r) => r[4] === focusP.id) : all;
    els.chartTotal.textContent = `${formatNumber(rows.length)} units`;
    if (!rows.length) { put(els.chart, h('p', { class: 'muted' }, `No operating GEM units are recorded in ${focusP?.name ?? 'the data'}.`)); return; }
    const mwBy = new Map(TECH_ORDER.map((k) => [k, 0]));
    const nBy = new Map(TECH_ORDER.map((k) => [k, 0]));
    let mw = 0;
    for (const r of rows) { mwBy.set(r[0], (mwBy.get(r[0]) ?? 0) + r[1]); nBy.set(r[0], (nBy.get(r[0]) ?? 0) + 1); mw += r[1]; }
    const max = Math.max(...mwBy.values(), 1);
    const nationalMw = all.reduce((a, r) => a + r[1], 0);
    if (state.generationTech) els.chart.classList.add('has-focus');
    put(els.chart,
      TECH_ORDER.map((k) => barRow(k, mwBy.get(k), max, colorOf(TECH_COLOR, k, t), `${formatNumber(mwBy.get(k) / 1000, { digits: 1 })} GW · ${formatNumber(nBy.get(k))}`, { focus: k === state.generationTech })),
      h('p', { class: 'hint db-chart-note' }, focusP
        ? `${formatNumber(mw / 1000, { digits: 1 })} GW across ${formatNumber(rows.length)} units, ${formatPercent(nationalMw ? mw / nationalMw : null, { digits: 1 })} of China's GEM total. Bars show GW · unit count.`
        : 'Bars show GW · unit count. Select a province on the map to see its own mix.'),
      lineBars(focusP?.id ?? '', t));
    return;
  }
  if (state.view === 'power' && focusP) {
    const inst = focusP.indicators.installed_mw ?? {};
    const total = focusP.indicators.installed_mw_total ?? 0;
    els.profileEyebrow.textContent = 'Power infrastructure profile';
    els.profileTitle.textContent = `${focusP.name} · installed capacity by technology`;
    els.chartTotal.textContent = total ? `${formatNumber(total / 1000, { digits: 1 })} GW installed` : '';
    if (!total) { put(els.chart, h('p', { class: 'muted' }, `No GEM generating units are recorded in ${focusP.name}.`)); return; }
    const max = Math.max(...TECH_ORDER.map((k) => inst[k] ?? 0), 1);
    if (state.powerTech) els.chart.classList.add('has-focus');
    put(els.chart,
      TECH_ORDER.map((k) => barRow(k, inst[k] ?? 0, max, colorOf(TECH_COLOR, k, t), `${formatNumber((inst[k] ?? 0) / 1000, { digits: 1 })} GW`, { focus: k === state.powerTech })),
      h('p', { class: 'hint db-chart-note' }, rankNote(focusP, rankProvinces(view, c))),
      lineBars(focusP.id, t));
    return;
  }
  if (state.view === 'policy') {
    els.profileEyebrow.textContent = 'National legislation profile';
    els.profileTitle.textContent = 'Most common topics in the library';
    if (!data.legislation) {
      put(els.chart, h('p', { class: 'muted' }, 'Loading…'));
      try { data.legislation = await loadJson(DATA_FILES.legislation); } catch (err) { put(els.chart, h('p', { class: 'muted' }, `Legislation library unavailable: ${err.message}`)); return; }
      if (state.view !== 'policy') return;
    }
    const docs = data.legislation.documents;
    const counts = new Map();
    for (const d of docs) for (const tpc of d.topics ?? []) counts.set(tpc, (counts.get(tpc) ?? 0) + 1);
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const max = rows[0]?.[1] ?? 1;
    const hub = focusP?.hub ? data.provinces.hubs[focusP.hub] : null;
    els.chartTotal.textContent = `${formatNumber(docs.length)} documents`;
    put(els.chart,
      focusP ? h('p', { class: 'hint db-chart-note' }, hub
        ? `${focusP.name} is part of the ${hub.name_en} (${hub.cluster}). The topic counts below cover the national library, not this province.`
        : `${focusP.name} is not an EDWC hub province. The topic counts below cover the national library, not this province.`) : null,
      rows.map(([k, n]) => barRow(k.replace(/_/g, ' '), n, max, 'var(--series-1)')),
      h('p', { class: 'hint', style: { marginTop: '8px' } }, h('a', { href: 'legislation.html' }, 'Open the legislation library')));
    return;
  }
  if (['cost', 'water', 'power'].includes(state.view)) {
    const ranked = rankProvinces(view, c);
    const fmt = (v) => `${formatNumber(v, { digits: digitsOf(view) })}${unitOf(view)}`;
    const max = ranked[0]?.[1] ?? 1;
    const fi = focusP ? ranked.findIndex(([p]) => p.id === focusP.id) : -1;
    els.profileEyebrow.textContent = 'Province comparison';
    els.profileTitle.textContent = state.view === 'cost' ? 'Highest 1–10 kV rates' : state.view === 'water' ? 'Highest values for the chosen measure' : `Largest installed ${state.powerTech || 'total'} capacity`;
    els.chartTotal.textContent = `${provs.filter((p) => Number.isFinite(view.fill(p, c))).length} provinces`;
    const rows = ranked.slice(0, 8).map(([p, v]) => barRow(p.name, v, max, 'var(--series-1)', fmt(v), { focus: p.id === state.focus }));
    // A focused province outside the top eight is appended after a gap, so it is always on the chart.
    if (fi >= 8) rows.push(h('div', { class: 'db-bar-gap', 'aria-hidden': 'true' }, '⋯'), barRow(focusP.name, ranked[fi][1], max, 'var(--series-1)', fmt(ranked[fi][1]), { focus: true }));
    if (fi >= 0) els.chart.classList.add('has-focus');
    put(els.chart, rows, focusP ? h('p', { class: 'hint db-chart-note' }, rankNote(focusP, ranked)) : null);
    return;
  }
  // status / capacity: a donut of the selection, headline count in the middle
  els.profileEyebrow.textContent = focusP ? `Selection profile · ${focusP.name}` : 'Selection profile';
  els.chartTotal.textContent = `${formatNumber(filtered.length)} records`;
  if (!filtered.length) {
    els.profileTitle.textContent = 'Status distribution';
    put(els.chart, h('p', { class: 'muted' }, focusP ? `No facilities in ${focusP.name} match these filters.` : 'No facilities match these filters.'));
    return;
  }
  if (state.view === 'capacity') {
    els.profileTitle.textContent = 'Capacity classes';
    const cc = countBy(filtered, (f) => f.capacity, CAPACITY_ORDER);
    const known = filtered.filter((f) => Number.isFinite(f.mw)).length;
    const seq = SEQ_RAMP[t];
    const capColor = (k) => (k === 'Unknown' ? 'var(--grid)' : seq[Math.max(0, 4 - CAPACITY_ORDER.indexOf(k))]);
    put(els.chart, donut(CAPACITY_ORDER.map((k) => [k, cc.get(k), capColor(k)]), { value: formatNumber(known), label: `with reported MW`, sub: `${((known / filtered.length) * 100).toFixed(0)}% of selection` }));
  } else {
    els.profileTitle.textContent = 'Status distribution';
    const counts = countBy(filtered, (f) => f.status, STATUS_ORDER);
    const op = counts.get('Operating') ?? 0;
    put(els.chart, donut(STATUS_ORDER.map((k) => [k, counts.get(k), colorOf(STATUS_COLOR, k, t)]), { value: `${((op / filtered.length) * 100).toFixed(0)}%`, label: 'operating', sub: `${formatNumber(op)} of ${formatNumber(filtered.length)}` }));
  }
}

/**
 * Donut with a hero figure in the hole and a legend that carries count and share for every slice (so identity is
 * never colour-alone). Slices thinner than 1.5° are drawn with a 1.5° minimum so tiny categories stay visible.
 * rows: [[label, count, color], …]
 */
function donut(rows, hero) {
  const total = rows.reduce((a, [, n]) => a + (n || 0), 0) || 1;
  const R = 54; const r0 = 36; const cx = 60; const cy = 60;
  const gap = 0.022; // radians of surface between slices
  const minA = (1.5 * Math.PI) / 180;
  let a = -Math.PI / 2;
  const slices = [];
  for (const [label, n, color] of rows) {
    if (!n) continue;
    let span = (n / total) * Math.PI * 2;
    if (span < minA) span = minA;
    const a0 = a + gap / 2; const a1 = a + span - gap / 2;
    a += span;
    if (a1 <= a0) continue;
    const P = (ang, rad) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
    const [x0, y0] = P(a0, R); const [x1, y1] = P(a1, R); const [x2, y2] = P(a1, r0); const [x3, y3] = P(a0, r0);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const d = `M${x0.toFixed(2)},${y0.toFixed(2)}A${R},${R} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}L${x2.toFixed(2)},${y2.toFixed(2)}A${r0},${r0} 0 ${large} 0 ${x3.toFixed(2)},${y3.toFixed(2)}Z`;
    const path = svg('path', { d, fill: color, class: 'db-donut-slice', 'aria-label': `${label}: ${formatNumber(n)} (${((n / total) * 100).toFixed(1)}%)` });
    path.append(svg('title', null, `${label}: ${formatNumber(n)} · ${((n / total) * 100).toFixed(1)}%`));
    slices.push(path);
  }
  const chart = svg('svg', { viewBox: '0 0 120 120', class: 'db-donut', role: 'img', 'aria-label': 'Distribution of the selected facilities' },
    svg('circle', { cx, cy, r: (R + r0) / 2, fill: 'none', stroke: 'var(--grid)', 'stroke-width': R - r0 }),
    slices,
    svg('text', { x: cx, y: cy - 2, class: 'db-donut-hero', 'text-anchor': 'middle' }, hero.value),
    svg('text', { x: cx, y: cy + 12, class: 'db-donut-label', 'text-anchor': 'middle' }, hero.label),
    svg('text', { x: cx, y: cy + 23, class: 'db-donut-sub', 'text-anchor': 'middle' }, hero.sub));
  const legend = h('ul', { class: 'db-donut-legend' }, rows.map(([label, n, color]) =>
    h('li', { class: n ? '' : 'is-zero' },
      h('span', { class: 'db-swatch ring', style: { background: color } }),
      h('span', { class: 'db-donut-name' }, label),
      h('strong', { class: 'num' }, formatNumber(n || 0)),
      h('span', { class: 'num muted' }, `${(((n || 0) / total) * 100).toFixed(1)}%`))));
  return h('div', { class: 'db-donut-wrap' }, chart, legend);
}

// ---------------------------------------------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------------------------------------------
/**
 * Open a province, facility or plant in the detail panel. Selecting a province also focuses the dashboard on it (the
 * job the Province dropdown used to do). Selecting the open province again, clicking empty map, Close or Reset returns
 * to all of China. Facilities and plants opened while a province is focused keep that focus.
 */
function select(sel) {
  const again = sel?.kind === 'province' && state.selected?.kind === 'province' && state.selected.id === sel.id;
  const next = again ? null : sel;
  const focus = !next ? '' : next.kind === 'province' ? next.id : state.focus;
  state.selected = next;
  if (focus !== state.focus) {
    state.focus = focus;
    applyFilters(); // re-scopes the tiles and counts, then repaints the map, chart and detail panel
    const p = provinceById.get(focus);
    announce(p ? `Focused on ${p.name}: ${formatNumber(filtered.length)} ${filtered.length === 1 ? 'facility' : 'facilities'}. Select it again or press Close to show all of China.` : 'Showing all of China');
  } else {
    repaint();
    renderDetail();
  }
  if (window.matchMedia('(max-width: 1100px)').matches && next) els.detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function fact(label, value) {
  return [h('dt', null, label), h('dd', null, value === null || value === undefined || value === '' ? EM_DASH : value)];
}

function renderDetail() {
  const sel = state.selected;
  if (!sel) {
    put(els.detail, h('div', { class: 'db-detail-empty' }, h('span', { class: 'db-marker' }), h('h2', null, 'Select a province'), h('p', null, 'Choose a province on the map to review its facilities and context layers. Selecting a province also focuses the tiles and the profile chart on it; select it again to return to all of China. Facilities are listed without locations.')));
    return;
  }
  const close = h('button', { class: 'link-btn small', type: 'button', onclick: () => select(null) }, 'Close');
  if (sel.kind === 'plant') {
    const p = sel.plant;
    put(els.detail, h('div', { class: 'db-panel-head' }, h('div', null, h('span', { class: 'eyebrow' }, 'Power plant unit'), h('h2', null, `${p.tech} unit`)), close),
      h('dl', { class: 'facts' }, fact('Capacity', `${formatNumber(p.mw, { digits: 1 })} MW`), fact('Province', provinceById.get(p.province)?.name ?? 'Outside province outlines'), fact('Source', 'Global Energy Monitor trackers (operating units)')),
      h('p', { class: 'hint' }, 'GEM publishes plant names and operators; this build keeps only technology, capacity and location to keep the file small.'),
      state.focus ? h('p', null, h('button', { class: 'link-btn small', type: 'button', onclick: () => select({ kind: 'province', id: state.focus }) }, `Back to ${provinceById.get(state.focus)?.name ?? 'province'}`)) : null);
    return;
  }
  if (sel.kind === 'facility') {
    const f = data.facilities.facilities.find((x) => x.id === sel.id);
    if (!f) { select(null); return; }
    const p = provinceById.get(f.province);
    put(els.detail, h('div', { class: 'db-panel-head' }, h('div', null, h('span', { class: 'eyebrow' }, 'Facility'), h('h2', null, f.name)), close),
      h('dl', { class: 'facts' },
        fact('Operator', f.operator), fact('Province', p ? `${p.name} ${p.nameZh}` : f.province), fact('Status', f.status), fact('Facility type', f.facilityType),
        fact('Reported capacity', Number.isFinite(f.mw) ? `${formatNumber(f.mw, { digits: 1 })} MW (${f.capacity})` : f.capacity),
        fact('PUE (reported)', Number.isFinite(f.pue) ? formatNumber(f.pue, { digits: 2 }) : null), fact('Online year', f.onlineYear),
        fact('EDWC hub', p?.hub ? data.provinces.hubs[p.hub].name_en : 'Not a hub province')),
      h('p', { class: 'hint' }, 'Location is published at province level only.'),
      h('p', null, h('button', { class: 'link-btn small', type: 'button', onclick: () => select({ kind: 'province', id: f.province }) }, `Back to ${p?.name ?? 'province'}`)));
    return;
  }
  const p = provinceById.get(sel.id);
  if (!p) { select(null); return; }
  const s = byProvince.get(p.id);
  const i = p.indicators;
  const facs = filtered.filter((f) => f.province === p.id).sort((a, b) => (b.mw ?? -1) - (a.mw ?? -1) || a.name.localeCompare(b.name));
  const inst = i.installed_mw ?? {};
  const t = theme();
  const hub = p.hub ? data.provinces.hubs[p.hub] : null;
  put(els.detail,
    h('div', { class: 'db-panel-head' }, h('div', null, h('span', { class: 'eyebrow' }, `${p.region} China · ${p.nameZh}`), h('h2', null, p.name)), close),
    hub ? h('p', { class: 'tag' }, `EDWC: ${hub.name_en} (${hub.cluster})`) : null,
    h('section', { class: 'db-detail-section' }, h('h3', null, 'Facilities in selection'),
      h('dl', { class: 'facts' },
        fact('Facilities', formatNumber(s?.count ?? 0)),
        fact('Status mix', s ? STATUS_ORDER.filter((k) => s.status.get(k)).map((k) => h('span', { class: 'db-chip' }, h('span', { class: 'db-swatch ring', style: { background: colorOf(STATUS_COLOR, k, t) } }), `${k} ${s.status.get(k)}`)) : EM_DASH),
        fact('Known MW', s?.mwKnown ? `${formatNumber(s.mw, { digits: 1 })} MW across ${s.mwKnown} records` : 'None reported'))),
    h('section', { class: 'db-detail-section' }, h('h3', null, 'Power'),
      h('dl', { class: 'facts' },
        fact('Generation 2024', i.generation_2024 != null ? `${formatNumber(i.generation_2024, { digits: 0 })} 亿kWh` : null),
        fact('Consumption 2024', i.consumption_2024 != null ? `${formatNumber(i.consumption_2024, { digits: 0 })} 亿kWh` : null),
        fact('Balance (computed)', i.generation_balance_2024 != null ? `${i.generation_balance_2024 > 0 ? '+' : ''}${formatNumber(i.generation_balance_2024, { digits: 0 })} 亿kWh` : null),
        fact('Installed (GEM units)', i.installed_mw_total ? `${formatNumber(i.installed_mw_total / 1000, { digits: 1 })} GW` : null),
        fact('By technology', Object.keys(inst).length ? TECH_ORDER.filter((k) => inst[k]).map((k) => h('span', { class: 'db-chip' }, h('span', { class: 'db-swatch ring', style: { background: colorOf(TECH_COLOR, k, t) } }), `${k} ${formatNumber(inst[k] / 1000, { digits: 1 })} GW`)) : null),
        fact(`Transmission ≥${data.lines ? formatNumber(data.lines.min_kv) : 250} kV`, transmissionFact(p.id, t)),
        fact('1–10 kV rate (May 2025)', i.tariff_single_1_10kv != null ? `${formatNumber(i.tariff_single_1_10kv, { digits: 3 })} 元/kWh single-part${i.tariff_two_part_1_10kv != null ? ` · ${formatNumber(i.tariff_two_part_1_10kv, { digits: 3 })} two-part` : ''}` : 'Not in source'),
        i.tariff_note ? fact('Tariff note', i.tariff_note) : null)),
    h('section', { class: 'db-detail-section' }, h('h3', null, 'Water (2024)'),
      h('dl', { class: 'facts' },
        fact('Total resources', i.water_total_2024 != null ? `${formatNumber(i.water_total_2024, { digits: 1 })} 亿m³` : null),
        fact('Per capita', i.water_per_capita_2024 != null ? `${formatNumber(i.water_per_capita_2024, { digits: 0 })} m³/person` : null),
        fact('Total use', i.water_use_total_2024 != null ? `${formatNumber(i.water_use_total_2024, { digits: 1 })} 亿m³ (industrial ${formatNumber(i.water_use_industrial_2024, { digits: 1 })})` : null),
        fact('Use ÷ resources (computed)', i.water_stress_ratio_2024 != null ? formatNumber(i.water_stress_ratio_2024, { digits: 2 }) : null))),
    h('section', { class: 'db-detail-section' }, h('h3', null, `Facility list (${facs.length})`),
      facs.length ? h('ul', { class: 'db-facility-list' }, facs.slice(0, 200).map((f) => h('li', null,
        h('button', { class: 'link-btn', type: 'button', onclick: () => select({ kind: 'facility', id: f.id }) }, f.name),
        h('span', { class: 'cell-sub' }, [f.operator, f.status, f.facilityType, Number.isFinite(f.mw) ? `${formatNumber(f.mw, { digits: 0 })} MW` : null].filter(Boolean).join(' · ')))))
        : h('p', { class: 'muted' }, 'No facilities match the current filters.'),
      facs.length > 200 ? h('p', { class: 'hint' }, `Showing the 200 largest of ${facs.length}.`) : null));
}

main();

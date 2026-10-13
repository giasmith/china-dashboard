// Map dashboard (index.html): province map with layer tabs, sidebar filters, KPI tiles, profile chart and a detail
// panel. Mirrors the layout of the U.S. Data Center Ecosystem Tracker, adapted to province-level data.
//
// Privacy rule: facilities.json carries no coordinates, so every facility is drawn at its province anchor. The
// page never receives, derives or displays a site location.

import { h, svg, byId, put, add, clear } from '../lib/dom.js';
import { CONFIG, DATA_FILES } from '../config.js';
import { loadJson, DataError } from '../lib/data.js';
import { renderShell, showError, announce, debounce } from '../lib/ui.js';
import { formatNumber, EM_DASH } from '../lib/format.js';
import {
  STATUS_ORDER, CAPACITY_ORDER, TYPE_ORDER, SOURCE_ORDER, SOURCE_LABEL, TECH_ORDER,
  STATUS_COLOR, TECH_COLOR, SEQ_RAMP, SEQ_RAMP_WARM, colorOf, binIndex, binLabels,
  filterFacilities, countBy, summarizeByProvince, summarizeSelection, bubbleRadius, arcPath, quantileThresholds,
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
  hazard: {
    label: 'Hazard', title: 'Natural-hazard screening (not yet loaded)',
    sourceKey: null, ramp: 'blue', unit: '', digits: 0, noData: true,
    legendNote: 'No hazard measure loaded yet.',
    fill: () => null, bins: () => [],
  },
  policy: {
    label: 'Policy', title: 'East Data West Computing hub designation',
    sourceKey: null, ramp: 'blue', unit: '', digits: 0, categorical: true,
    legendNote: 'Hub provinces per the 2022 NDRC / MIIT / NEA / CAC approvals.',
    fill: (p) => (p.hub ? 1 : 0), bins: () => [],
  },
  opposition: {
    label: 'Opposition', title: 'Local opposition (no tracker available)',
    sourceKey: null, ramp: 'blue', unit: '', digits: 0, noData: true,
    legendNote: 'No opposition record loaded.',
    fill: () => null, bins: () => [],
  },
};
const VIEW_KEYS = Object.keys(VIEWS);

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
const state = {
  view: 'status',
  filters: { search: '', province: '', status: new Set(STATUS_ORDER), type: new Set(TYPE_ORDER), capacity: new Set(CAPACITY_ORDER), source: new Set(SOURCE_ORDER) },
  powerTech: '', generationTech: '', costMeasure: 'single', waterMeasure: 'percap',
  selected: null, // {kind:'province'|'facility'|'plant', id}
  transform: { k: 1, x: 0, y: 0 },
};
let data = null; // { provinces, facilities, plants, legislation }
let els = {};
let filtered = [];
let byProvince = new Map();
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
  const provinces = [...data.provinces.provinces].sort((a, b) => a.name.localeCompare(b.name));
  const sidebar = h('aside', { class: 'db-filters card', 'aria-label': 'Dashboard filters' },
    h('div', { class: 'db-panel-head' },
      h('div', null, h('span', { class: 'eyebrow' }, 'Explore'), h('h2', null, 'Filter facilities')),
      h('button', { class: 'link-btn', type: 'button', id: 'db-reset' }, 'Reset')),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Search'),
      h('input', { id: 'db-search', class: 'input', type: 'search', placeholder: 'Name, operator, province', autocomplete: 'off' })),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Province'),
      h('select', { id: 'db-province', class: 'select' },
        h('option', { value: '' }, 'All provinces'),
        provinces.map((p) => h('option', { value: p.id }, `${p.name} ${p.nameZh}`)))),
    h('p', { class: 'hint' }, 'All categories begin selected. Clear a group, then check the types you want to compare.'),
    filterGroup('status', 'Project status', STATUS_ORDER, (k) => colorOf(STATUS_COLOR, k, theme()), true),
    filterGroup('type', 'Facility type', TYPE_ORDER, null, false),
    filterGroup('capacity', 'Reported capacity', CAPACITY_ORDER, null, true),
    filterGroup('source', 'Inventory source', SOURCE_ORDER, null, false, (k) => SOURCE_LABEL[k]),
    h('div', { class: 'db-selection' },
      h('span', { class: 'field-label' }, 'Current selection'),
      h('strong', { id: 'db-selection-count' }, EM_DASH)),
    h('div', { class: 'note-box' }, 'Facilities are shown at province level only and are not downloadable. The published data holds no coordinates, addresses or city names, so proximity and counts describe provinces, not sites.'));

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
    h('div', { class: 'db-map-actions' },
      h('button', { class: 'btn', type: 'button', id: 'db-zoom-out', 'aria-label': 'Zoom out' }, '−'),
      h('button', { class: 'btn', type: 'button', id: 'db-zoom-reset' }, 'Reset view'),
      h('button', { class: 'btn', type: 'button', id: 'db-zoom-in', 'aria-label': 'Zoom in' }, '+')));

  const map = svg('svg', { id: 'db-map', viewBox: `0 0 ${VIEW_W} ${VIEW_H}`, role: 'img', 'aria-label': 'Map of China by province', preserveAspectRatio: 'xMidYMid meet' },
    svg('g', { id: 'db-viewport' },
      svg('g', { id: 'db-provinces' }), svg('g', { id: 'db-plants' }), svg('g', { id: 'db-bubbles' }), svg('g', { id: 'db-labels' })));
  const mapCard = h('div', { class: 'db-map-card card' },
    h('div', { class: 'db-toolbar' }, tabs, subcontrols),
    h('div', { class: 'db-map-shell', id: 'db-map-shell' }, map,
      h('div', { class: 'db-caption' }, h('span', { id: 'db-view-title' }), h('span', null, 'Scroll to zoom · drag to pan · select a province for details'))),
    h('div', { class: 'db-legend', id: 'db-legend', 'aria-label': 'Map legend' }));

  const analysis = h('div', { class: 'db-analysis' },
    h('section', { class: 'card', 'aria-labelledby': 'db-profile-title' },
      h('div', { class: 'db-panel-head' },
        h('div', null, h('span', { class: 'eyebrow', id: 'db-profile-eyebrow' }, 'Selection profile'), h('h2', { id: 'db-profile-title' }, 'Status distribution')),
        h('span', { class: 'muted', id: 'db-chart-total' })),
      h('div', { id: 'db-chart', class: 'db-bars' })));

  const detail = h('aside', { class: 'db-detail card', id: 'db-detail', 'aria-label': 'Selected province details' });

  put(app,
    h('div', { class: 'db-head' },
      h('h1', null, 'China data-center ecosystem tracker'),
      h('p', null, 'Province view · facilities, generation, electricity cost and water context. ', h('a', { href: 'plan.html' }, 'Five-year plan tracker'), ' · ', h('a', { href: 'legislation.html' }, 'Legislation library'))),
    h('div', { class: 'db-workspace' }, sidebar, h('div', { class: 'db-main' }, kpis, mapCard, analysis), detail));

  els = {
    search: byId('db-search'), province: byId('db-province'), reset: byId('db-reset'),
    selectionCount: byId('db-selection-count'), map: byId('db-map'), viewport: byId('db-viewport'), provinces: byId('db-provinces'),
    plants: byId('db-plants'), bubbles: byId('db-bubbles'), labels: byId('db-labels'), legend: byId('db-legend'), viewTitle: byId('db-view-title'),
    chart: byId('db-chart'), chartTotal: byId('db-chart-total'), profileEyebrow: byId('db-profile-eyebrow'), profileTitle: byId('db-profile-title'),
    detail: byId('db-detail'), powerTech: byId('db-power-tech'), genTech: byId('db-gen-tech'), costMeasure: byId('db-cost-measure'), waterMeasure: byId('db-water-measure'),
    mapShell: byId('db-map-shell'),
  };
  els.tooltip = h('div', { class: 'tooltip', id: 'db-tooltip', role: 'tooltip' });
  document.body.append(els.tooltip); // note: add() returns the parent, which is why this is not add(document.body, …)

  const onSearch = debounce(() => { state.filters.search = els.search.value.trim(); applyFilters(); }, 120);
  els.search.addEventListener('input', onSearch);
  els.province.addEventListener('change', () => { state.filters.province = els.province.value; applyFilters(); });
  els.reset.addEventListener('click', resetFilters);
  els.powerTech.addEventListener('change', () => { state.powerTech = els.powerTech.value; repaint(); });
  els.genTech.addEventListener('change', () => { state.generationTech = els.genTech.value; repaint(); });
  els.costMeasure.addEventListener('change', () => { state.costMeasure = els.costMeasure.value; repaint(); });
  els.waterMeasure.addEventListener('change', () => { state.waterMeasure = els.waterMeasure.value; repaint(); });
  byId('db-zoom-in').addEventListener('click', () => zoom(1.35));
  byId('db-zoom-out').addEventListener('click', () => zoom(1 / 1.35));
  byId('db-zoom-reset').addEventListener('click', resetView);
  installPanZoom();
  renderProvinces();
  renderDetail();
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
  state.filters = { search: '', province: '', status: new Set(STATUS_ORDER), type: new Set(TYPE_ORDER), capacity: new Set(CAPACITY_ORDER), source: new Set(SOURCE_ORDER) };
  els.search.value = '';
  els.province.value = '';
  app.querySelectorAll('.db-group input').forEach((i) => { i.checked = true; });
  applyFilters();
}

// ---------------------------------------------------------------------------------------------------------------
// Filtering and summary
// ---------------------------------------------------------------------------------------------------------------
function applyFilters() {
  const all = data.facilities.facilities;
  filtered = filterFacilities(all, state.filters, provinceById);
  byProvince = summarizeByProvince(filtered);
  const sum = summarizeSelection(filtered, all.length, provinceById);
  els.selectionCount.textContent = `${formatNumber(sum.count)} ${sum.count === 1 ? 'facility' : 'facilities'}`;
  byId('db-k-count').textContent = formatNumber(sum.count);
  byId('db-k-count-note').textContent = `${(sum.share * 100).toFixed(1)}% of inventory`;
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
  const srcCounts = new Map(SOURCE_ORDER.map((s) => [s, filtered.filter((f) => f.sources.includes(s)).length]));
  byId('db-group-source').querySelectorAll('[data-count]').forEach((el) => { el.textContent = formatNumber(srcCounts.get(el.dataset.count) ?? 0); });
  byId('db-sel-source').textContent = `${state.filters.source.size} of ${SOURCE_ORDER.length}`;
  announce(`${sum.count} facilities match the filters`);
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
    else if (view.noData) fill = 'var(--map-land)';
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
    path.classList.toggle('is-dim', Boolean(state.filters.province) && state.filters.province !== id);
  }
  els.provinces.classList.toggle('soft', state.view === 'generation'); // let the plant points read over the fill
  renderBubbles(t);
  renderPlants(t);
  renderLegend(view, thresholds, ramp, t);
  renderChart(view, t);
}

function renderBubbles(t) {
  clear(els.bubbles);
  const byMw = state.view === 'capacity';
  const max = Math.max(0, ...[...byProvince.values()].map((s) => (byMw ? s.mw : s.count)));
  const pale = !['status', 'capacity'].includes(state.view);
  for (const p of data.provinces.provinces) {
    const s = byProvince.get(p.id);
    if (!s) continue;
    const value = byMw ? s.mw : s.count;
    const r = bubbleRadius(value, max, pale ? { min: 2.5, max: 16 } : { min: 3.5, max: 26 });
    if (!r) continue;
    const g = svg('g', { class: `db-bubble${pale ? ' pale' : ''}`, dataset: { id: p.id } });
    if (state.view === 'status' && s.count) {
      let a = 0;
      for (const k of STATUS_ORDER) {
        const n = s.status.get(k) ?? 0;
        if (!n) continue;
        const a1 = a + (n / s.count) * Math.PI * 2;
        g.append(svg('path', { d: arcPath(p.cx, p.cy, r, a, a1), fill: colorOf(STATUS_COLOR, k, t), class: 'db-slice' }));
        a = a1;
      }
    } else {
      g.append(svg('circle', { cx: p.cx, cy: p.cy, r, class: 'db-dot' }));
    }
    g.append(svg('circle', { cx: p.cx, cy: p.cy, r, class: 'db-bubble-ring' }));
    g.addEventListener('pointerenter', (e) => showProvinceTooltip(e, p));
    g.addEventListener('pointermove', positionTooltip);
    g.addEventListener('pointerleave', hideTooltip);
    g.addEventListener('click', (e) => { e.stopPropagation(); select({ kind: 'province', id: p.id }); });
    els.bubbles.append(g);
  }
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
  const prov = state.filters.province;
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
  let drag = null;
  els.map.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = els.map.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * VIEW_W;
    const py = ((e.clientY - rect.top) / rect.height) * VIEW_H;
    zoom(e.deltaY < 0 ? 1.18 : 1 / 1.18, px, py);
  }, { passive: false });
  els.map.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, tx: state.transform.x, ty: state.transform.y, moved: false };
    els.map.setPointerCapture(e.pointerId);
  });
  els.map.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const rect = els.map.getBoundingClientRect();
    const dx = ((e.clientX - drag.x) / rect.width) * VIEW_W;
    const dy = ((e.clientY - drag.y) / rect.height) * VIEW_H;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    if (drag.moved) {
      state.transform.x = drag.tx + dx;
      state.transform.y = drag.ty + dy;
      els.map.classList.add('dragging');
      updateTransform();
    }
  });
  const end = () => { if (drag?.moved) els.map.classList.remove('dragging'); drag = null; };
  els.map.addEventListener('pointerup', end);
  els.map.addEventListener('pointercancel', end);
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
  if (!view.noData && !view.categorical && state.view !== 'status' && state.view !== 'capacity') {
    rows.push(h('div', { class: 't-label' }, `${view.title}: ${v === null || v === undefined ? 'no data' : formatNumber(v, { digits: digitsOf(view) }) + unitOf(view)}`));
  }
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
  app.querySelectorAll('.db-sub').forEach((el) => { el.hidden = el.dataset.for !== key; });
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
  } else if (view.noData) {
    items.push(legendItem('var(--map-land)', 'No measure loaded'));
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
  const src = view.sourceKey ? data.provinces.sources[view.sourceKey] : null;
  put(els.legend, items, h('div', { class: 'db-legend-note' }, view.legendNote, ' ',
    src ? ['Source: ', src.url ? h('a', { href: src.url, rel: 'noopener', target: '_blank' }, src.title) : src.title, ` (${src.publisher}; tier ${src.tier}).`] : null));
}

function barRow(label, value, max, color, valueText) {
  return h('div', { class: 'db-bar-row' },
    h('span', { class: 'db-bar-label', title: label }, label),
    h('div', { class: 'db-bar-track' }, h('div', { class: 'db-bar-fill', style: { width: `${max ? (value / max) * 100 : 0}%`, background: color } })),
    h('strong', { class: 'num' }, valueText ?? formatNumber(value)));
}

async function renderChart(view, t) {
  const c = ctx();
  const provs = data.provinces.provinces;
  if (state.view === 'generation') {
    els.profileEyebrow.textContent = 'Power infrastructure profile';
    els.profileTitle.textContent = 'GEM units by technology';
    if (!data.plants) { put(els.chart, h('p', { class: 'muted' }, 'Loading…')); return; }
    const rows = data.plants.plants.filter((r) => !state.filters.province || r[4] === state.filters.province);
    const mwBy = new Map(TECH_ORDER.map((k) => [k, 0]));
    const nBy = new Map(TECH_ORDER.map((k) => [k, 0]));
    for (const r of rows) { mwBy.set(r[0], (mwBy.get(r[0]) ?? 0) + r[1]); nBy.set(r[0], (nBy.get(r[0]) ?? 0) + 1); }
    const max = Math.max(...mwBy.values(), 1);
    els.chartTotal.textContent = `${formatNumber(rows.length)} units`;
    put(els.chart, TECH_ORDER.map((k) => barRow(k, mwBy.get(k), max, colorOf(TECH_COLOR, k, t), `${formatNumber(mwBy.get(k) / 1000, { digits: 1 })} GW · ${formatNumber(nBy.get(k))}`)));
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
    els.chartTotal.textContent = `${formatNumber(docs.length)} documents`;
    put(els.chart, rows.map(([k, n]) => barRow(k.replace(/_/g, ' '), n, max, 'var(--series-1)')),
      h('p', { class: 'hint', style: { marginTop: '8px' } }, h('a', { href: 'legislation.html' }, 'Open the legislation library')));
    return;
  }
  if (['cost', 'water', 'power'].includes(state.view)) {
    const rows = provs.map((p) => [p, view.fill(p, c)]).filter(([, v]) => Number.isFinite(v) && v !== 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const max = rows[0]?.[1] ?? 1;
    els.profileEyebrow.textContent = 'Province comparison';
    els.profileTitle.textContent = state.view === 'cost' ? 'Highest 1–10 kV rates' : state.view === 'water' ? 'Highest values for the chosen measure' : `Largest installed ${state.powerTech || 'total'} capacity`;
    els.chartTotal.textContent = `${provs.filter((p) => Number.isFinite(view.fill(p, c))).length} provinces`;
    put(els.chart, rows.map(([p, v]) => barRow(p.name, v, max, 'var(--series-1)', `${formatNumber(v, { digits: digitsOf(view) })}${unitOf(view)}`)));
    return;
  }
  // status / capacity / hazard / opposition: a donut of the selection, headline count in the middle
  els.profileEyebrow.textContent = 'Selection profile';
  els.chartTotal.textContent = `${formatNumber(filtered.length)} records`;
  if (!filtered.length) {
    els.profileTitle.textContent = 'Status distribution';
    put(els.chart, h('p', { class: 'muted' }, 'No facilities match these filters.'));
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
function select(sel) {
  state.selected = sel;
  repaint();
  renderDetail();
  if (window.matchMedia('(max-width: 1100px)').matches && sel) els.detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function fact(label, value) {
  return [h('dt', null, label), h('dd', null, value === null || value === undefined || value === '' ? EM_DASH : value)];
}

function renderDetail() {
  const sel = state.selected;
  if (!sel) {
    put(els.detail, h('div', { class: 'db-detail-empty' }, h('span', { class: 'db-marker' }), h('h2', null, 'Select a province'), h('p', null, 'Choose a province on the map to review its facilities and the context layers. Facilities are listed without locations.')));
    return;
  }
  const close = h('button', { class: 'link-btn small', type: 'button', onclick: () => select(null) }, 'Close');
  if (sel.kind === 'plant') {
    const p = sel.plant;
    put(els.detail, h('div', { class: 'db-panel-head' }, h('div', null, h('span', { class: 'eyebrow' }, 'Power plant unit'), h('h2', null, `${p.tech} unit`)), close),
      h('dl', { class: 'facts' }, fact('Capacity', `${formatNumber(p.mw, { digits: 1 })} MW`), fact('Province', provinceById.get(p.province)?.name ?? 'Outside province outlines'), fact('Source', 'Global Energy Monitor trackers (operating units)')),
      h('p', { class: 'hint' }, 'GEM publishes plant names and operators; this build keeps only technology, capacity and location to keep the file small.'));
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
        fact('Sources', f.sources.map((s) => SOURCE_LABEL[s] ?? s).join(', ')), fact('EDWC hub', p?.hub ? data.provinces.hubs[p.hub].name_en : 'Not a hub province')),
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

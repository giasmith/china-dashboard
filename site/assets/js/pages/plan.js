import { h, byId, clear, put, add } from '../lib/dom.js';
import { CONFIG } from '../config.js';
import { loadDatasets } from '../lib/data.js';
import { computeStatus, summarizeStatuses, yearOf, STATUS, STATUS_ORDER, STATUS_META } from '../lib/status.js';
import { describeResult } from '../lib/describe.js';
import { formatValue, formatActual, formatNumber, formatPercent, formatIsoDate, humanize, textMatches, safeUrl, EM_DASH } from '../lib/format.js';
import { inSet } from '../lib/state.js';
import { createStore, toggled } from '../lib/store.js';
import { toCsv, downloadCsv } from '../lib/csv.js';
import { renderShell, kpi, statusBadge, tag, emptyState, showError, announce, initFilterDisclosure, revealProfile } from '../lib/ui.js';
import { searchField, selectField, checkGroup, resetButton } from '../lib/filters.js';
import { statusBar, meter, mountTrajectory } from '../lib/charts.js';

const CATEGORY_LABEL = {
  economy: 'Economy', innovation: 'Innovation', digital: 'Digital', infrastructure: 'Infrastructure',
  energy: 'Energy', environment: 'Environment', society: 'Society', agriculture: 'Agriculture',
};
const BINDING_LABEL = { binding: 'Binding (约束性)', anticipated: 'Anticipated (预期性)', unspecified: 'Not classified' };
const BINDING_SHORT = { binding: 'Binding', anticipated: 'Anticipated', unspecified: 'Not classified' };
const SORTS = [
  { value: '', label: 'Status (worst first)' },
  { value: 'name', label: 'Indicator name' },
  { value: 'progress', label: 'Progress (lowest first)' },
];

const app = byId('app');

async function main() {
  let data;
  try {
    data = await loadDatasets(['meta', 'targets', 'actuals', 'legislation']);
  } catch (err) {
    renderShell('plan.html', null);
    showError(app, err);
    return;
  }
  renderShell('plan.html', data.meta);
  start(data);
}

function start({ meta, targets: tDoc, actuals: aDoc, legislation: lDoc }) {
  const plans = tDoc.plans;
  const themes = tDoc.themes;
  const themeById = new Map(themes.map((th) => [th.id, th]));
  const docs = lDoc.documents;
  // Legislation that belongs to a theme: documents tied to one of the theme's plans, or tagged with one of its topics.
  const docsForTheme = (th) => {
    const planIds = new Set(tDoc.targets.filter((t) => t.theme === th.id).map((t) => t.plan_id));
    return docs.filter((d) => d.related_plan_ids.some((id) => planIds.has(id)) || d.topics.some((tp) => th.legislation_topics.includes(tp)));
  };
  const themeDocs = new Map(themes.map((th) => [th.id, docsForTheme(th)]));
  const planById = new Map(plans.map((p) => [p.id, p]));
  const planName = (id) => planById.get(id)?.name_en ?? id; // tolerate a dangling plan_id instead of crashing

  // Statuses are judged as of the dataset date: a target whose year has passed without a full-year figure is
  // "unresolved" rather than silently "on track".
  const asOfYear = yearOf(meta.as_of);
  const rows = tDoc.targets.map((t) => ({
    t,
    planName: planName(t.plan_id),
    result: computeStatus(t, aDoc.actuals, { tolerance: CONFIG.statusTolerance, asOfYear }),
  }));

  const themeIds = themes.map((th) => th.id);
  const spec = {
    q: { type: 'text', max: 80 },
    plan: { type: 'choice', allowed: plans.map((p) => p.id) },
    theme: { type: 'set', allowed: themeIds },
    binding: { type: 'set', allowed: Object.keys(BINDING_LABEL) },
    status: { type: 'set', allowed: [...STATUS_ORDER] },
    sort: { type: 'choice', allowed: ['name', 'progress'] },
    sel: { type: 'choice', allowed: rows.map((r) => r.t.id) },
  };

  const countBy = (fn) => {
    const m = new Map();
    for (const r of rows) m.set(fn(r), (m.get(fn(r)) ?? 0) + 1);
    return m;
  };
  const byTheme = countBy((r) => r.t.theme);
  const byBinding = countBy((r) => r.t.binding);
  const byStatus = countBy((r) => r.result.status);

  // ---------------- controls
  const store = createStore(spec, (state) => {
    sync(state);
    render();
  });

  const c = {
    q: searchField({ id: 'f-q', label: 'Search', placeholder: 'Indicator, plan or id', onInput: (v) => store.set({ q: v.replace(/\s+/g, ' ').trim().slice(0, 80) }) }),
    plan: selectField({
      id: 'f-plan', label: 'Plan',
      options: [{ value: '', label: 'All plans' }, ...plans.map((p) => ({ value: p.id, label: `${p.name_en} (${p.period.start}–${p.period.end})` }))],
      onChange: (v) => store.set({ plan: v }),
    }),
    theme: checkGroup({ legend: 'Theme', name: 'theme', options: themes.map((th) => ({ value: th.id, label: th.name_en, count: byTheme.get(th.id) ?? 0 })), onChange: (s) => store.set({ theme: s }) }),
    binding: checkGroup({ legend: 'Target type', name: 'binding', options: Object.keys(BINDING_LABEL).filter((v) => (byBinding.get(v) ?? 0) > 0).map((v) => ({ value: v, label: BINDING_LABEL[v], count: byBinding.get(v) ?? 0 })), onChange: (s) => store.set({ binding: s }) }),
    status: checkGroup({ legend: 'Status', name: 'status', options: STATUS_ORDER.filter((s) => (byStatus.get(s) ?? 0) > 0).map((v) => ({ value: v, label: STATUS_META[v].label, count: byStatus.get(v) ?? 0 })), onChange: (s) => store.set({ status: s }) }),
    sort: selectField({ id: 'f-sort', label: 'Sort by', options: SORTS, onChange: (v) => store.set({ sort: v }) }),
  };

  const details = h('details', { class: 'card filters' },
    h('summary', null, h('span', null, 'Filters')),
    h('div', { class: 'body' },
      h('div', { class: 'field-stack' }, c.q.el, c.plan.el, c.sort.el), c.theme.el, c.binding.el, c.status.el,
      h('div', { class: 'filters-foot' }, resetButton(() => store.reset(['sel'])), h('span', { class: 'hint' }, 'Leaving a group empty means no restriction.'))));
  initFilterDisclosure(details);

  const kpis = h('div', { class: 'kpis' });
  const statusCard = h('section', { class: 'card', 'aria-labelledby': 'status-h' }, h('h2', { id: 'status-h' }, 'Status of targets'), h('div', { id: 'status-body' }));
  const tableHost = h('div');
  const profile = h('aside', { class: 'card profile', 'aria-label': 'Selected target' });

  put(app, 
    h('div', { class: 'page-head' },
      h('h1', null, 'Policy targets behind the data-center build-out'),
      h('p', null, 'The five-year plans and computing-power action plans set the numbers; the legislation library holds the documents that carry them; the map shows what has been built. This page groups every plan target by its role in that chain — compute to be delivered, the energy and PUE limits it must respect, the digital demand driving it, and the AI programmes seeding it — and compares each with the latest official figure. Progress is measured against the straight-line pace from baseline to target year, so a target can be on track while far from complete.')),
    h('div', { class: 'layout with-profile' }, details, h('div', { class: 'stack' }, kpis, statusCard, tableHost), profile));

  // ---------------- filtering / sorting
  const matches = (r, st, { ignoreStatus = false } = {}) =>
    textMatches(st.q, r.t.indicator_en, r.t.indicator_zh, r.t.id, r.planName) &&
    (!st.plan || r.t.plan_id === st.plan) &&
    inSet(st.theme, r.t.theme) &&
    inSet(st.binding, r.t.binding) &&
    (ignoreStatus || inSet(st.status, r.result.status));

  const cmpName = (a, b) => a.t.indicator_en.localeCompare(b.t.indicator_en);
  const severity = (r) => STATUS_ORDER.indexOf(r.result.status);
  const comparators = {
    '': (a, b) => severity(a) - severity(b) || cmpName(a, b),
    name: cmpName,
    // null progress (threshold / rate / no data) sorts last, never first
    progress: (a, b) => (a.result.progress ?? Infinity) - (b.result.progress ?? Infinity) || cmpName(a, b),
  };

  let chartHandle = null;

  function sync(st) {
    c.q.set(st.q);
    c.plan.set(st.plan);
    c.theme.set(st.theme);
    c.binding.set(st.binding);
    c.status.set(st.status);
    c.sort.set(st.sort);
  }

  function render() {
    const st = store.state;
    const shown = rows.filter((r) => matches(r, st)).sort(comparators[st.sort] ?? comparators['']);
    const facetRows = rows.filter((r) => matches(r, st, { ignoreStatus: true }));
    const sum = summarizeStatuses(shown);

    // KPIs describe what is currently shown
    const bindingOff = shown.filter((r) => r.t.binding === 'binding' && [STATUS.BEHIND, STATUS.MISSED].includes(r.result.status)).length;
    const bindingTotal = shown.filter((r) => r.t.binding === 'binding').length;
    put(kpis, 
      kpi('Targets shown', String(shown.length), `of ${rows.length} total`),
      kpi('On track or achieved', formatPercent(sum.healthyShare), sum.assessable ? `${sum.healthy} of ${sum.assessable} scored targets` : 'No scored targets in view'),
      kpi('Binding targets off pace', bindingTotal ? String(bindingOff) : EM_DASH, bindingTotal ? `of ${bindingTotal} binding targets shown` : 'No binding targets in view'),
    );

    // Status bar is a facet: it ignores the status filter itself so you can switch between statuses.
    put(byId('status-body'), statusBar(summarizeStatuses(facetRows), { active: st.status, onToggle: (s) => store.set({ status: toggled(st.status, s) }) }));

    renderTable(shown);
    renderProfile();
    announce(`${shown.length} of ${rows.length} targets shown`);
  }

  function rangeText(t) {
    if (t.kind === 'level') return `${formatValue(t.baseline.value, t.unit)} (${t.baseline.year}) → ${formatValue(t.target.value, t.unit)} (${t.target.year})`;
    const cmp = t.direction === 'increase' ? '≥' : '≤';
    if (t.kind === 'rate') return `Average ${cmp} ${formatValue(t.target.value, t.unit)} (${t.period.start}–${t.period.end})`;
    return `${cmp} ${formatValue(t.target.value, t.unit)} by ${t.target.year}`;
  }

  function progressCell(r) {
    const { t, result: res } = r;
    if (res.status === STATUS.NO_DATA || res.status === STATUS.INVALID) return h('span', { class: 'muted' }, EM_DASH);
    if (res.status === STATUS.UNRESOLVED && t.kind !== 'level') return h('span', { class: 'muted' }, res.met ? 'Met so far' : 'Not met so far');
    if (t.kind === 'level') return meter(res);
    if (t.kind === 'threshold') return h('span', null, res.met ? 'Meets threshold' : 'Below threshold');
    return h('span', { class: 'num' }, `Avg ${formatNumber(res.average)}`);
  }

  function themeHeader(th, themeRows) {
    const sum = summarizeStatuses(themeRows);
    const related = themeDocs.get(th.id) ?? [];
    const topicHash = th.legislation_topics.length ? `legislation.html#topic=${th.legislation_topics.map(encodeURIComponent).join(',')}` : 'legislation.html';
    return h('div', { class: 'theme-head' },
      h('div', { class: 'theme-title' },
        h('h2', { id: `theme-${th.id}` }, th.name_en, th.name_zh ? h('span', { class: 'zh', style: { marginLeft: '8px' } }, th.name_zh) : null),
        h('p', null, th.description)),
      h('div', { class: 'theme-side' },
        h('div', { class: 'theme-count' }, h('strong', null, String(themeRows.length)), ` target${themeRows.length === 1 ? '' : 's'}`,
          sum.assessable ? ` · ${sum.healthy} of ${sum.assessable} scored on track or achieved` : ''),
        h('div', { class: 'row', style: { gap: '12px' } },
          th.map_view ? h('a', { href: `index.html#view=${th.map_view}` }, 'See on the map') : null,
          related.length ? h('a', { href: topicHash }, `${related.length} related document${related.length === 1 ? '' : 's'}`) : h('span', { class: 'muted' }, 'No related documents yet'))));
  }

  function targetsTable(shown) {
    const st = store.state;
    return h('div', { class: 'table-wrap' },
      h('table', null,
        h('caption', { class: 'sr-only' }, 'Plan targets with latest reported value, progress and status'),
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'Indicator'), h('th', { scope: 'col' }, 'Baseline → target'), h('th', { scope: 'col', class: 'num' }, 'Latest'),
          h('th', { scope: 'col' }, 'Progress'), h('th', { scope: 'col' }, 'Status'))),
        h('tbody', null, shown.map((r) => {
          const { t, result: res } = r;
          return h('tr', { 'aria-current': st.sel === t.id ? 'true' : null },
            h('td', null,
              h('button', { type: 'button', class: 'link-btn', onclick: () => { store.set({ sel: t.id }); revealProfile(profile); } }, t.indicator_en),
              h('span', { class: 'cell-sub' }, `${r.planName} · ${CATEGORY_LABEL[t.category] ?? humanize(t.category)} · ${BINDING_SHORT[t.binding] ?? humanize(t.binding)}`),
              null),
            h('td', null, rangeText(t)),
            h('td', { class: 'num' }, res.latest ? formatActual(res.latest, t.unit) : EM_DASH,
              res.latest ? h('span', { class: 'cell-sub nowrap' }, res.latest.partial ? `${res.latest.year} · as of ${formatIsoDate(res.latest.as_of, 'month')}` : String(res.latest.year)) : null),
            h('td', null, progressCell(r)),
            h('td', null, statusBadge(res.status)));
        }))));
  }

  function renderTable(shown) {
    clear(tableHost);
    const head = h('div', { class: 'row between', style: { 'margin-bottom': '8px' } },
      h('span', { class: 'muted', 'aria-hidden': 'true' }, `${shown.length} target${shown.length === 1 ? '' : 's'}`),
      h('button', {
        type: 'button', class: 'btn', disabled: shown.length === 0,
        onclick: () => downloadCsv(`china-plan-targets-${meta.as_of}.csv`, toCsv(shown, csvColumns)),
      }, 'Export filtered CSV'));
    if (shown.length === 0) {
      add(tableHost, head, h('div', { class: 'card' }, emptyState('No targets match', 'Try clearing a filter or searching for a different word.')));
      return;
    }
    add(tableHost, head);
    // One section per theme, in the order the data file lists them. The last theme (macro/social context) is
    // collapsed by default so the page opens on the data-center story.
    for (const th of themes) {
      const themeRows = shown.filter((r) => r.t.theme === th.id);
      if (!themeRows.length) continue;
      const section = h('section', { class: 'theme', 'aria-labelledby': `theme-${th.id}` }, themeHeader(th, themeRows), targetsTable(themeRows));
      if (th.map_view === null && themes.length > 1) {
        add(tableHost, h('details', { class: 'theme-collapsed', open: store.state.sel && themeRows.some((r) => r.t.id === store.state.sel) ? true : null },
          h('summary', null, `${th.name_en} (${themeRows.length} target${themeRows.length === 1 ? '' : 's'})`), section));
      } else {
        add(tableHost, section);
      }
    }
  }

  function renderProfile() {
    chartHandle?.destroy();
    chartHandle = null;
    const id = store.state.sel;
    const r = rows.find((x) => x.t.id === id);
    clear(profile);
    if (!r) {
      add(profile, h('div', { class: 'profile-empty' }, h('strong', null, 'Selection profile'), h('p', null, 'Choose an indicator to see its trajectory, source and how its status was calculated.')));
      return;
    }
    const { t, result: res } = r;
    const src = safeUrl(t.source?.url);
    const chartHost = h('div');
    add(profile, 
      h('h2', null, t.indicator_en),
      t.indicator_zh ? h('div', { class: 'zh' }, t.indicator_zh) : null,
      h('div', { class: 'row', style: { margin: '8px 0 12px' } }, statusBadge(res.status), t.placeholder ? tag('Placeholder data', { warn: true }) : null),
      h('p', null, describeResult(t, res)),
      t.note ? h('p', { class: 'note-box', style: { marginTop: '8px' } }, t.note) : null,
      h('div', { style: { margin: '12px 0' } }, chartHost),
      h('dl', { class: 'facts' },
        h('dt', null, 'Plan'), h('dd', null, r.planName),
        h('dt', null, 'Theme'), h('dd', null, themeById.get(t.theme)?.name_en ?? humanize(t.theme)),
        h('dt', null, 'Category'), h('dd', null, CATEGORY_LABEL[t.category] ?? humanize(t.category)),
        h('dt', null, 'Type'), h('dd', null, `${BINDING_LABEL[t.binding] ?? humanize(t.binding)} · ${t.kind}`),
        t.target_text ? h('dt', null, 'As printed') : null, t.target_text ? h('dd', null, t.target_text) : null,
        h('dt', null, 'Target'), h('dd', null, rangeText(t)),
        h('dt', null, 'Source'), h('dd', null, src ? h('a', { href: src, rel: 'noopener' }, t.source.title) : `${t.source?.title ?? EM_DASH} (no link yet)`)),
      t.placeholder ? h('p', { class: 'note-box warn', style: { marginTop: '12px' } }, 'Values for this target are synthetic placeholders and must not be cited.') : null,
      relatedDocs(r));
    chartHandle = mountTrajectory(chartHost, t, aDoc.actuals, res);
  }

  /** Documents tied to the target's plan first, then the rest of its theme's documents (newest first, capped). */
  function relatedDocs(r) {
    const th = themeById.get(r.t.theme);
    const byPlan = docs.filter((d) => d.related_plan_ids.includes(r.t.plan_id));
    const byTheme = (themeDocs.get(r.t.theme) ?? []).filter((d) => !byPlan.includes(d));
    const list = [...byPlan, ...byTheme.sort((a, b) => b.date_adopted.localeCompare(a.date_adopted))].slice(0, 6);
    if (!list.length) return null;
    return h('div', { style: { marginTop: '14px' } },
      h('h3', null, 'Related legislation and policy'),
      h('ul', { class: 'list', style: { marginTop: '8px', gap: '8px' } }, list.map((d) =>
        h('li', null, h('span', null, h('a', { href: `legislation.html#sel=${encodeURIComponent(d.id)}` }, d.title_en),
          h('span', { class: 'cell-sub' }, `${d.issuer} · ${formatIsoDate(d.date_adopted, d.date_precision)}${byPlan.includes(d) ? ' · carries this plan' : ''}`))))),
      th?.legislation_topics?.length ? h('p', { class: 'card-foot' }, h('a', { href: `legislation.html#topic=${th.legislation_topics.map(encodeURIComponent).join(',')}` }, `All ${(themeDocs.get(th.id) ?? []).length} documents for ${th.name_en.toLowerCase()}`)) : null);
  }

  const csvColumns = [
    { label: 'id', get: (r) => r.t.id },
    { label: 'plan', get: (r) => r.planName },
    { label: 'theme', get: (r) => r.t.theme },
    { label: 'category', get: (r) => r.t.category },
    { label: 'indicator_en', get: (r) => r.t.indicator_en },
    { label: 'indicator_zh', get: (r) => r.t.indicator_zh },
    { label: 'unit', get: (r) => r.t.unit },
    { label: 'binding', get: (r) => r.t.binding },
    { label: 'kind', get: (r) => r.t.kind },
    { label: 'direction', get: (r) => r.t.direction },
    { label: 'baseline_year', get: (r) => r.t.baseline?.year },
    { label: 'baseline_value', get: (r) => r.t.baseline?.value },
    { label: 'target_year', get: (r) => r.t.target.year },
    { label: 'target_value', get: (r) => r.t.target.value },
    { label: 'latest_year', get: (r) => r.result.latest?.year },
    { label: 'latest_value', get: (r) => r.result.latest?.value },
    { label: 'latest_qualifier', get: (r) => r.result.latest?.qualifier },
    { label: 'latest_as_of', get: (r) => r.result.latest?.as_of },
    { label: 'latest_source_title', get: (r) => r.result.latest?.source?.title },
    { label: 'latest_source_url', get: (r) => r.result.latest?.source?.url },
    { label: 'progress_pct', get: (r) => (r.result.progress === null ? null : Math.round(r.result.progress * 1000) / 10) },
    { label: 'expected_pace_pct', get: (r) => (r.result.expected === null ? null : Math.round(r.result.expected * 1000) / 10) },
    { label: 'status', get: (r) => r.result.status },
    { label: 'placeholder', get: (r) => r.t.placeholder },
    { label: 'source_title', get: (r) => r.t.source?.title },
    { label: 'source_url', get: (r) => r.t.source?.url },
    { label: 'note', get: (r) => r.t.note },
  ];

  sync(store.state);
  render();
}

main();

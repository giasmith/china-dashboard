import { h, byId, clear, put, add } from '../lib/dom.js';
import { loadDatasets } from '../lib/data.js';
import { formatIsoDate, humanize, textMatches, safeUrl, EM_DASH } from '../lib/format.js';
import { inSet } from '../lib/state.js';
import { createStore } from '../lib/store.js';
import { toCsv, downloadCsv } from '../lib/csv.js';
import { renderShell, kpi, tag, emptyState, showError, announce, initFilterDisclosure, revealProfile } from '../lib/ui.js';
import { searchField, selectField, checkGroup, dropdownCheckGroup, yearField, resetButton } from '../lib/filters.js';

const TYPE_LABEL = {
  law: 'Law', administrative_regulation: 'Administrative regulation', departmental_rule: 'Departmental rule',
  plan: 'Plan', policy_notice: 'Policy notice', judicial_interpretation: 'Judicial interpretation', other: 'Other',
};
const STATUS_LABEL = { in_force: 'In force', expired: 'Plan period ended', superseded: 'Superseded', repealed: 'Repealed', draft: 'Draft' };
const TOPIC_LABEL = { ai: 'AI', edwc: 'EDWC (East Data West Computing)', e_commerce: 'E-commerce', fintech: 'Fintech', five_year_plan: 'Five-year plan' };
const topicLabel = (t) => TOPIC_LABEL[t] ?? humanize(t);
// Relevance to data-center expansion, derived from topics so it never drifts from the record. Core = governs where
// and how capacity is built; demand = policies that create computing load; governance = the data/cyber framework
// that shapes where data (and therefore facilities) may sit.
const CORE_TOPICS = new Set(['data_center', 'computing_power', 'edwc', 'energy_efficiency', 'green_development', 'carbon', 'cloud', 'energy_law']);
const DEMAND_TOPICS = new Set(['ai', 'digital_economy', 'digital_china', 'industrial_internet', 'e_commerce', 'platform_economy', 'smart_city', 'telecom', 'five_year_plan', 'fintech', 'digital_government']);
const RELEVANCE_LABEL = { core: 'Core: data-center build-out', demand: 'Demand: digital economy and AI', governance: 'Governance context' };
const RELEVANCE_SHORT = { core: 'Core', demand: 'Demand', governance: 'Governance' };
function relevanceOf(doc) {
  if (doc.topics.some((t) => CORE_TOPICS.has(t))) return 'core';
  if (doc.topics.some((t) => DEMAND_TOPICS.has(t))) return 'demand';
  return 'governance';
}
const SORTS = [
  { value: '', label: 'Adopted (newest first)' },
  { value: 'date_asc', label: 'Adopted (oldest first)' },
  { value: 'title', label: 'Title (A to Z)' },
];

const app = byId('app');

async function main() {
  let data;
  try {
    data = await loadDatasets(['meta', 'targets', 'legislation']);
  } catch (err) {
    renderShell('legislation.html', null);
    showError(app, err);
    return;
  }
  renderShell('legislation.html', data.meta);
  start(data);
}

const yearOf = (d) => Number(String(d.date_adopted).slice(0, 4));

function start({ meta, targets: tDoc, legislation }) {
  const docs = legislation.documents;
  const plans = tDoc.plans;
  const planName = (id) => plans.find((p) => p.id === id)?.name_en ?? id;
  const topics = [...new Set(docs.flatMap((d) => d.topics))].sort();
  const years = docs.map(yearOf).filter(Number.isFinite);
  const minYear = Math.min(1949, ...years);
  const maxYear = Math.max(2100, ...years);

  const spec = {
    q: { type: 'text', max: 80 },
    type: { type: 'set', allowed: Object.keys(TYPE_LABEL) },
    status: { type: 'set', allowed: Object.keys(STATUS_LABEL) },
    topic: { type: 'set', allowed: topics },
    plan: { type: 'choice', allowed: plans.map((p) => p.id) },
    rel: { type: 'choice', allowed: Object.keys(RELEVANCE_LABEL) },
    from: { type: 'int', min: minYear, max: maxYear },
    to: { type: 'int', min: minYear, max: maxYear },
    sort: { type: 'choice', allowed: ['date_asc', 'title'] },
    sel: { type: 'choice', allowed: docs.map((d) => d.id) },
  };

  const count = (fn) => {
    const m = new Map();
    for (const d of docs) for (const k of [].concat(fn(d))) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  };
  const byType = count((d) => d.doc_type);
  const byStatus = count((d) => d.status);
  const byTopic = count((d) => d.topics);

  const store = createStore(spec, (state) => {
    sync(state);
    render();
  });

  const c = {
    q: searchField({ id: 'f-q', label: 'Search', placeholder: 'Title (English or Chinese), issuer, topic', onInput: (v) => store.set({ q: v.replace(/\s+/g, ' ').trim().slice(0, 80) }) }),
    type: checkGroup({ legend: 'Document type', name: 'type', options: Object.keys(TYPE_LABEL).filter((k) => byType.has(k)).map((v) => ({ value: v, label: TYPE_LABEL[v], count: byType.get(v) })), onChange: (s) => store.set({ type: s }) }),
    status: checkGroup({ legend: 'Status', name: 'status', options: Object.keys(STATUS_LABEL).filter((k) => byStatus.has(k)).map((v) => ({ value: v, label: STATUS_LABEL[v], count: byStatus.get(v) })), onChange: (s) => store.set({ status: s }) }),
    topic: dropdownCheckGroup({ id: 'f-topic', label: 'Topic', placeholder: 'All topics', options: topics.map((v) => ({ value: v, label: topicLabel(v), count: byTopic.get(v) })), onChange: (s) => store.set({ topic: s }) }),
    rel: selectField({ id: 'f-rel', label: 'Relevance to data centers', options: [{ value: '', label: 'All documents' }, ...Object.entries(RELEVANCE_LABEL).map(([value, label]) => ({ value, label: `${label} (${docs.filter((d) => relevanceOf(d) === value).length})` }))], onChange: (v) => store.set({ rel: v }) }),
    plan: selectField({ id: 'f-plan', label: 'Related plan', options: [{ value: '', label: 'Any' }, ...plans.map((p) => ({ value: p.id, label: p.name_en }))], onChange: (v) => store.set({ plan: v }) }),
    from: yearField({ id: 'f-from', label: 'Adopted from', min: minYear, max: maxYear, onChange: (v) => store.set({ from: v }) }),
    to: yearField({ id: 'f-to', label: 'Adopted to', min: minYear, max: maxYear, onChange: (v) => store.set({ to: v }) }),
    sort: selectField({ id: 'f-sort', label: 'Sort by', options: SORTS, onChange: (v) => store.set({ sort: v }) }),
  };

  const details = h('details', { class: 'card filters' },
    h('summary', null, h('span', null, 'Filters')),
    h('div', { class: 'body' },
      h('div', { class: 'field-stack' }, c.q.el, c.rel.el, c.topic.el, c.plan.el, c.sort.el,
        h('div', { class: 'row' }, h('div', { style: { flex: '1 1 90px' } }, c.from.el), h('div', { style: { flex: '1 1 90px' } }, c.to.el))),
      c.type.el, c.status.el,
      h('div', { class: 'filters-foot' }, resetButton(() => store.reset(['sel'])), h('span', { class: 'hint' }, 'Leaving a group empty means no restriction.'))));
  initFilterDisclosure(details);

  const kpis = h('div', { class: 'kpis' });
  const tableHost = h('div');
  const profile = h('aside', { class: 'card profile', 'aria-label': 'Selected document' });

  put(app, 
    h('div', { class: 'page-head' },
      h('h1', null, 'Legislation and policy library'),
      h('p', null, 'The documents behind the plan targets and the data-center build-out, each with its number, dates and a link to the primary source. "Core" records govern where and how capacity is built (hub approvals, PUE and green-power rules, carbon and energy-efficiency plans); "Demand" records create computing load (digital economy, AI); "Governance" records are the data and cyber framework that decides where data may sit. Records marked Unverified have not yet been checked against the primary source.')),
    h('div', { class: 'layout with-profile' }, details, h('div', { class: 'stack' }, kpis, tableHost), profile));

  const cmpTitle = (a, b) => a.title_en.localeCompare(b.title_en);
  const comparators = {
    '': (a, b) => b.date_adopted.localeCompare(a.date_adopted) || cmpTitle(a, b), // ISO dates sort lexicographically
    date_asc: (a, b) => a.date_adopted.localeCompare(b.date_adopted) || cmpTitle(a, b),
    title: cmpTitle,
  };

  function sync(st) {
    c.q.set(st.q);
    c.type.set(st.type);
    c.status.set(st.status);
    c.topic.set(st.topic);
    c.plan.set(st.plan);
    c.rel.set(st.rel);
    c.from.set(st.from);
    c.to.set(st.to);
    c.sort.set(st.sort);
  }

  function render() {
    const st = store.state;
    const invalidRange = st.from !== null && st.to !== null && st.from > st.to;
    c.to.setError(invalidRange ? '"To" is earlier than "From", so nothing can match.' : '');

    const shown = invalidRange ? [] : docs.filter((d) => {
      const y = yearOf(d);
      return textMatches(st.q, d.title_en, d.title_zh, d.issuer, d.doc_number, d.id, d.topics.join(' ')) &&
        inSet(st.type, d.doc_type) && inSet(st.status, d.status) &&
        (st.topic.size === 0 || d.topics.some((t) => st.topic.has(t))) &&
        (!st.plan || d.related_plan_ids.includes(st.plan)) &&
        (!st.rel || relevanceOf(d) === st.rel) &&
        (st.from === null || y >= st.from) && (st.to === null || y <= st.to);
    }).sort(comparators[st.sort] ?? comparators['']);

    const inForce = shown.filter((d) => d.status === 'in_force').length;
    const unverified = shown.filter((d) => !d.verified).length;
    put(kpis, 
      kpi('Documents shown', String(shown.length), `of ${docs.length} total · ${shown.filter((d) => relevanceOf(d) === 'core').length} core`),
      kpi('In force', String(inForce), shown.length ? `${shown.length - inForce} not in force` : 'None in view'),
      kpi('Unverified', String(unverified), 'not yet checked against the source'),
    );

    renderTable(shown);
    renderProfile();
    announce(`${shown.length} of ${docs.length} documents shown`);
  }

  function renderTable(shown) {
    const st = store.state;
    clear(tableHost);
    const head = h('div', { class: 'row between', style: { marginBottom: '8px' } },
      h('span', { class: 'muted', 'aria-hidden': 'true' }, `${shown.length} document${shown.length === 1 ? '' : 's'}`),
      h('button', { type: 'button', class: 'btn', disabled: shown.length === 0, onclick: () => downloadCsv(`china-legislation-${meta.as_of}.csv`, toCsv(shown, csvColumns)) }, 'Export filtered CSV'));
    if (shown.length === 0) {
      add(tableHost, head, h('div', { class: 'card' }, emptyState('No documents match', 'Try clearing a filter or widening the year range.')));
      return;
    }
    add(tableHost, head, h('div', { class: 'table-wrap' },
      h('table', null,
        h('caption', { class: 'sr-only' }, 'Legislation and policy documents'),
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Title'), h('th', { scope: 'col' }, 'Type'), h('th', { scope: 'col' }, 'Issuer'), h('th', { scope: 'col' }, 'Adopted'), h('th', { scope: 'col' }, 'Status'))),
        h('tbody', null, shown.map((d) =>
          h('tr', { 'aria-current': st.sel === d.id ? 'true' : null },
            h('td', null,
              h('button', { type: 'button', class: 'link-btn', onclick: () => { store.set({ sel: d.id }); revealProfile(profile); } }, d.title_en),
              d.title_zh ? h('span', { class: 'cell-sub zh', lang: 'zh' }, d.title_zh) : null,
              !d.verified ? tag('Unverified', { warn: true }) : null),
            h('td', null, TYPE_LABEL[d.doc_type] ?? humanize(d.doc_type), h('span', { class: `cell-sub rel-${relevanceOf(d)}` }, RELEVANCE_SHORT[relevanceOf(d)])),
            h('td', null, d.issuer),
            h('td', { class: 'num' }, formatIsoDate(d.date_adopted, d.date_precision)),
            h('td', { class: 'nowrap' }, STATUS_LABEL[d.status] ?? humanize(d.status))))))));
  }

  function renderProfile() {
    const d = docs.find((x) => x.id === store.state.sel);
    clear(profile);
    if (!d) {
      add(profile, h('div', { class: 'profile-empty' }, h('strong', null, 'Selection profile'), h('p', null, 'Choose a document to see its dates, issuer and source.')));
      return;
    }
    const src = safeUrl(d.source?.url);
    add(profile, 
      h('h2', null, d.title_en),
      d.title_zh ? h('div', { class: 'zh', lang: 'zh' }, d.title_zh) : null,
      h('div', { class: 'row', style: { margin: '8px 0 12px' } }, tag(STATUS_LABEL[d.status] ?? humanize(d.status)), d.verified ? tag('Verified') : tag('Unverified', { warn: true })),
      d.summary_en ? h('p', null, d.summary_en) : null,
      h('dl', { class: 'facts' },
        h('dt', null, 'Type'), h('dd', null, TYPE_LABEL[d.doc_type] ?? humanize(d.doc_type)),
        h('dt', null, 'Issuer'), h('dd', null, `${d.issuer} (${d.issuer_level})`),
        d.doc_number ? h('dt', null, 'Document no.') : null, d.doc_number ? h('dd', null, d.doc_number) : null,
        h('dt', null, 'Adopted'), h('dd', null, formatIsoDate(d.date_adopted, d.date_precision)),
        d.date_published ? h('dt', null, 'Published') : null, d.date_published ? h('dd', null, formatIsoDate(d.date_published)) : null,
        h('dt', null, 'Effective'), h('dd', null, d.date_effective ? formatIsoDate(d.date_effective) : EM_DASH),
        d.superseded_by ? h('dt', null, 'Superseded by') : null,
        d.superseded_by ? h('dd', null, h('button', { type: 'button', class: 'link-btn', onclick: () => store.set({ sel: d.superseded_by }) }, docs.find((x) => x.id === d.superseded_by)?.title_en ?? d.superseded_by)) : null,
        h('dt', null, 'Topics'), h('dd', null, d.topics.length ? h('span', { class: 'row' }, d.topics.map((t) => tag(topicLabel(t)))) : EM_DASH),
        h('dt', null, 'Plans'), h('dd', null, d.related_plan_ids.length ? d.related_plan_ids.map(planName).join(', ') : EM_DASH),
        h('dt', null, 'Source'), h('dd', null, src ? h('a', { href: src, rel: 'noopener' }, d.source.title) : `${d.source?.title ?? EM_DASH}`)),
      d.note ? h('p', { class: 'note-box', style: { marginTop: '12px' } }, d.note) : null,
      !d.verified ? h('p', { class: 'note-box warn', style: { marginTop: '12px' } }, 'This record has not been fully checked against its primary source. Confirm the title, dates and status before citing it.') : null);
  }

  const csvColumns = [
    { label: 'id', get: (d) => d.id },
    { label: 'title_en', get: (d) => d.title_en },
    { label: 'title_zh', get: (d) => d.title_zh },
    { label: 'doc_type', get: (d) => d.doc_type },
    { label: 'issuer', get: (d) => d.issuer },
    { label: 'issuer_level', get: (d) => d.issuer_level },
    { label: 'doc_number', get: (d) => d.doc_number },
    { label: 'date_adopted', get: (d) => d.date_adopted },
    { label: 'date_published', get: (d) => d.date_published },
    { label: 'date_precision', get: (d) => d.date_precision },
    { label: 'date_effective', get: (d) => d.date_effective },
    { label: 'status', get: (d) => d.status },
    { label: 'superseded_by', get: (d) => d.superseded_by },
    { label: 'topics', get: (d) => d.topics },
    { label: 'related_plans', get: (d) => d.related_plan_ids },
    { label: 'source_title', get: (d) => d.source?.title },
    { label: 'source_url', get: (d) => d.source?.url },
    { label: 'verified', get: (d) => d.verified },
    { label: 'placeholder', get: (d) => d.placeholder },
    { label: 'summary_en', get: (d) => d.summary_en },
    { label: 'note', get: (d) => d.note },
  ];

  sync(store.state);
  render();
}

main();

import { h, byId, put } from '../lib/dom.js';
import { CONFIG } from '../config.js';
import { loadDatasets } from '../lib/data.js';
import { computeStatus, summarizeStatuses, yearOf, STATUS, STATUS_ORDER } from '../lib/status.js';
import { formatPercent, formatIsoDate, formatValue, EM_DASH } from '../lib/format.js';
import { renderShell, kpi, statusBadge, tag, showError } from '../lib/ui.js';
import { statusBar } from '../lib/charts.js';
import { STATUS_STYLE } from '../lib/maprender.js';

const app = byId('app');

async function main() {
  let data;
  try {
    data = await loadDatasets(['meta', 'targets', 'actuals', 'legislation', 'hubs']);
  } catch (err) {
    renderShell('index.html', null);
    showError(app, err);
    return;
  }
  renderShell('index.html', data.meta);
  start(data);
}

function start({ meta, targets: tDoc, actuals, legislation, hubs }) {
  const asOfYear = yearOf(meta.as_of);
  const rows = tDoc.targets.map((t) => ({ t, result: computeStatus(t, actuals.actuals, { tolerance: CONFIG.statusTolerance, asOfYear }) }));
  const sum = summarizeStatuses(rows);
  const docs = legislation.documents;
  const sites = hubs.features.map((f) => f?.properties).filter(Boolean);
  // One cluster can be drawn as several sites (part_of); count clusters, not points.
  const clusters = sites.filter((c) => !c.part_of);
  const hubCount = new Set(clusters.map((c) => c.hub)).size;

  // "Needs attention": targets that are behind or missed, ordered by how far they trail the expected pace.
  // Threshold/rate targets have no progress figure, so they sort after the level targets, then by name.
  const gap = (r) => (r.result.progress === null ? Infinity : r.result.progress - (r.result.expected ?? 0));
  const attention = rows
    .filter((r) => [STATUS.BEHIND, STATUS.MISSED].includes(r.result.status))
    .sort((a, b) => gap(a) - gap(b) || a.t.indicator_en.localeCompare(b.t.indicator_en))
    .slice(0, 5);

  const latestDocs = [...docs].sort((a, b) => b.date_adopted.localeCompare(a.date_adopted)).slice(0, 5);

  const clusterCounts = Object.keys(STATUS_STYLE).map((k) => [k, clusters.filter((c) => c.status === k).length]);

  put(app, 
    h('div', { class: 'page-head' },
      h('h1', null, 'China policy and infrastructure at a glance'),
      h('p', null, 'Five-year plan targets compared with reported results, the legislation behind them, and the East Data West Computing build-out.')),
    h('div', { class: 'stack', style: { marginTop: '12px' } },
      h('div', { class: 'kpis' },
        kpi('Plan targets tracked', String(sum.total), `${sum.assessable} with enough data to score`),
        kpi('On track or achieved', formatPercent(sum.healthyShare), sum.assessable ? `${sum.healthy} of ${sum.assessable} scored targets` : 'Nothing scored yet'),
        kpi('Legislation records', String(docs.length), `${docs.filter((d) => d.status === 'in_force').length} in force`),
        kpi('Computing clusters', String(clusters.length), `across ${hubCount} national hub${hubCount === 1 ? '' : 's'}`)),

      h('div', { class: 'grid-2' },
        h('section', { class: 'card', 'aria-labelledby': 'ov-status' },
          h('h2', { id: 'ov-status' }, 'Target status'),
          statusBar(sum, { onToggle: (s) => { location.href = `plan.html#status=${encodeURIComponent(s)}`; } }),
          h('p', { class: 'card-foot' }, h('a', { href: 'plan.html' }, 'Open the plan tracker'))),

        h('section', { class: 'card', 'aria-labelledby': 'ov-attn' },
          h('h2', { id: 'ov-attn' }, 'Needs attention'),
          attention.length
            ? h('ul', { class: 'list' }, attention.map((r) =>
              h('li', null,
                h('span', null, h('a', { href: `plan.html#sel=${encodeURIComponent(r.t.id)}` }, r.t.indicator_en),
                  h('span', { class: 'cell-sub' }, r.result.latest ? `Latest ${r.result.latest.year}: ${formatValue(r.result.latest.value, r.t.unit)}` : EM_DASH)),
                statusBadge(r.result.status))))
            : h('p', { class: 'muted' }, 'No targets are behind pace or missed.'),
          h('p', { class: 'card-foot' }, h('a', { href: `plan.html#status=${STATUS.BEHIND},${STATUS.MISSED}` }, 'See all behind or missed targets'))),

        h('section', { class: 'card', 'aria-labelledby': 'ov-leg' },
          h('h2', { id: 'ov-leg' }, 'Recent legislation and policy'),
          latestDocs.length
            ? h('ul', { class: 'list' }, latestDocs.map((d) =>
              h('li', null,
                h('span', null, h('a', { href: `legislation.html#sel=${encodeURIComponent(d.id)}` }, d.title_en),
                  h('span', { class: 'cell-sub' }, `${d.issuer} · ${formatIsoDate(d.date_adopted, d.date_precision)}`)),
                d.verified ? null : tag('Unverified', { warn: true }))))
            : h('p', { class: 'muted' }, 'No legislation records yet.'),
          h('p', { class: 'card-foot' }, h('a', { href: 'legislation.html' }, 'Open the legislation library'))),

        h('section', { class: 'card', 'aria-labelledby': 'ov-map' },
          h('h2', { id: 'ov-map' }, 'East Data West Computing'),
          h('div', { class: 'cluster-counts' }, clusterCounts.map(([k, n]) =>
            h('div', { class: 'line' },
              h('span', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'marker-key', style: { '--fill': STATUS_STYLE[k].fill, '--stroke': STATUS_STYLE[k].stroke }, 'aria-hidden': 'true' }), STATUS_STYLE[k].label),
              h('strong', { class: 'num' }, String(n))))),
          h('p', { class: 'card-foot' }, h('a', { href: 'map.html' }, 'Open the map'))))));
}

main();

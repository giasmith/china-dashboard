import { h, byId, clear, put, add } from '../lib/dom.js';
import { loadDatasets } from '../lib/data.js';
import { CONFIG } from '../config.js';
import { formatNumber, formatYearMonth, humanize, textMatches, safeUrl, EM_DASH } from '../lib/format.js';
import { inSet } from '../lib/state.js';
import { createStore } from '../lib/store.js';
import { toCsv, downloadCsv } from '../lib/csv.js';
import { renderShell, kpi, tag, emptyState, showError, announce, initFilterDisclosure, revealProfile } from '../lib/ui.js';
import { searchField, selectField, checkGroup, resetButton } from '../lib/filters.js';
import { createMap, STATUS_STYLE, PROJECT_STYLE } from '../lib/maprender.js';

const REGION_LABEL = { east: 'East (demand)', west: 'West (supply)' };
const PRECISION_NOTE = {
  point: 'Exact site', district: 'District-level position', county: 'County-level position', city: 'City-level position', area: 'Approximate area',
};
const COMPANY_LABEL = {
  china_telecom: 'China Telecom', china_mobile: 'China Mobile', china_unicom: 'China Unicom', china_broadnet: 'China Broadnet', huawei: 'Huawei',
  alibaba: 'Alibaba', tencent: 'Tencent', gcbd_apple: 'GCBD (Apple)', chindata: 'Chindata', vnet: 'VNET (21Vianet)', ucloud: 'UCloud', kingsoft: 'Kingsoft Cloud',
  bank_finance: 'Bank / finance', state_owned_other: 'Other state-owned', other: 'Other', unknown: 'Not stated',
};
const FLAG_LABEL = {
  no_name_zh: 'no Chinese name', no_source: 'no source link', shared_centroid: 'shared centroid', company_mismatch: 'company differs from title',
  outside_start_zone: 'outside start-up zone', unparsed_investment: 'investment not numeric', duplicate_name_suspected: 'possible duplicate', truncated_name: 'name truncated in sheet', repeated_name_text: 'name repeated in sheet (de-duplicated)',
};
const projectName = (pr) => pr.name_zh ?? pr.name_en ?? pr.id;

const app = byId('app');

async function main() {
  let data;
  try {
    data = await loadDatasets(CONFIG.showProjectLayer ? ['meta', 'hubs', 'projects'] : ['meta', 'hubs']);
  } catch (err) {
    renderShell('map.html', null);
    showError(app, err);
    return;
  }
  renderShell('map.html', data.meta);
  start(data);
}

const validCoord = (lon, lat) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;

function start({ meta, hubs, projects: projDoc = { projects: [] } }) {
  const projectsOn = CONFIG.showProjectLayer === true;
  // GeoJSON order is [lon, lat]. Features with unusable geometry are skipped and reported, never plotted at (0,0).
  const rows = [];
  let skipped = 0;
  for (const f of hubs.features) {
    const [lon, lat] = f?.geometry?.type === 'Point' ? f.geometry.coordinates ?? [] : [];
    if (!f?.properties?.id || !validCoord(lon, lat)) {
      skipped += 1;
      continue;
    }
    rows.push({ id: f.properties.id, p: f.properties, lon, lat });
  }

  // Curated project inventory. A project hangs off its site feature when it has one, else off the cluster.
  // Projects whose cluster is not on the map are kept out of every count and reported once in the console.
  const featureIds = new Set(rows.map((r) => r.id));
  const projects = [];
  let orphanProjects = 0;
  for (const pr of projDoc.projects) {
    const owner = pr.site_id ?? pr.cluster_id;
    if (!featureIds.has(owner) || !featureIds.has(pr.cluster_id)) {
      orphanProjects += 1;
      continue;
    }
    const [lon, lat] = Array.isArray(pr.coordinates) ? pr.coordinates : [];
    projects.push({ ...pr, owner, lon: validCoord(lon, lat) ? lon : null, lat: validCoord(lon, lat) ? lat : null });
  }
  if (orphanProjects) console.warn(`${orphanProjects} project record(s) point at a cluster that is not in edwc_hubs.geojson and were ignored.`);
  const projectsOf = (featureId, { includeSites = true } = {}) =>
    projects.filter((pr) => pr.owner === featureId || (includeSites && pr.cluster_id === featureId && !rows.find((r) => r.id === featureId)?.p.part_of));
  const investmentOf = (list) => {
    const withFigure = list.filter((pr) => pr.record_type === 'project' && Number.isFinite(pr.investment_planned_100m_cny));
    return { withFigure: withFigure.length, total: withFigure.reduce((sum, pr) => sum + pr.investment_planned_100m_cny, 0) };
  };

  const hubNames = [...new Set(rows.map((r) => r.p.hub))].sort();
  // A cluster whose start-up zone spans separate places is drawn as several points; count it once.
  const clusterKey = (r) => r.p.part_of ?? r.id;
  const distinct = (list) => new Set(list.map(clusterKey)).size;
  const clusterTotal = distinct(rows);
  const spec = {
    q: { type: 'text', max: 80 },
    status: { type: 'set', allowed: Object.keys(STATUS_STYLE) },
    region: { type: 'set', allowed: ['east', 'west'] },
    hub: { type: 'choice', allowed: hubNames },
    layers: { type: 'set', allowed: ['projects'] },
    sel: { type: 'choice', allowed: rows.map((r) => r.id) },
  };
  // Facet counts are per cluster (a multi-site cluster counts once), matching the KPIs.
  const count = (fn) => {
    const m = new Map();
    for (const r of rows.filter((x) => !x.p.part_of)) m.set(fn(r), (m.get(fn(r)) ?? 0) + 1);
    return m;
  };
  const byStatus = count((r) => r.p.status);
  const byRegion = count((r) => r.p.region);

  const store = createStore(spec, (state) => {
    sync(state);
    render();
  });

  const c = {
    q: searchField({ id: 'f-q', label: 'Search', placeholder: 'Cluster, hub, province or start-up zone', onInput: (v) => store.set({ q: v.replace(/\s+/g, ' ').trim().slice(0, 80) }) }),
    status: checkGroup({ legend: 'Project status', name: 'status', options: Object.entries(STATUS_STYLE).map(([v, s]) => ({ value: v, label: s.label, count: byStatus.get(v) ?? 0 })), onChange: (s) => store.set({ status: s }) }),
    region: checkGroup({ legend: 'Region', name: 'region', options: Object.entries(REGION_LABEL).map(([v, label]) => ({ value: v, label, count: byRegion.get(v) ?? 0 })), onChange: (s) => store.set({ region: s }) }),
    hub: selectField({ id: 'f-hub', label: 'National hub', options: [{ value: '', label: 'All hubs' }, ...hubNames.map((n) => ({ value: n, label: n }))], onChange: (v) => store.set({ hub: v }) }),
    layers: checkGroup({ legend: 'Layers', name: 'layers', options: [{ value: 'projects', label: 'Curated project sites', count: projects.filter((pr) => pr.lon !== null).length }], onChange: (s) => store.set({ layers: s }) }),
  };

  const details = h('details', { class: 'card filters' },
    h('summary', null, h('span', null, 'Filters')),
    h('div', { class: 'body' }, h('div', { class: 'field-stack' }, c.q.el, c.hub.el), c.status.el, c.region.el, projectsOn ? c.layers.el : null,
      h('div', { class: 'filters-foot' }, resetButton(() => store.reset(['sel'])), h('span', { class: 'hint' }, 'Leaving a group empty means no restriction.'))));
  initFilterDisclosure(details);

  const kpis = h('div', { class: 'kpis' });
  const mapHost = h('div', { class: 'map-wrap' });
  const keyRow = h('div', { class: 'chart-legend', 'aria-label': 'Map key' },
    Object.values(STATUS_STYLE).map((s) =>
      h('span', { class: 'key' }, h('span', { class: 'marker-key', style: { '--fill': s.fill, '--stroke': s.stroke } }), s.label)));
  const projectKey = h('span', { class: 'key' }, h('span', { class: 'marker-key square', style: { '--fill': PROJECT_STYLE.fill, '--stroke': PROJECT_STYLE.stroke } }), `${PROJECT_STYLE.label} (position from the inventory sheet; many are shared centroids)`);
  const tableHost = h('div');
  const profile = h('aside', { class: 'card profile', 'aria-label': 'Selected cluster' });

  put(app, 
    h('div', { class: 'page-head' },
      h('h1', null, 'East Data West Computing map'),
      h('p', null, `National computing hubs and data center clusters. Positions are approximate (see each cluster’s precision note). The table below the map lists the same clusters${projectsOn ? '; each cluster profile lists the announced projects from the curated inventory' : ''}.`)),
    skipped > 0 ? h('div', { class: 'note-box warn', role: 'status', style: { marginTop: '12px' } }, `${skipped} feature${skipped === 1 ? ' was' : 's were'} skipped because of missing ids or invalid coordinates. Run scripts/validate_data.py.`) : null,
    h('div', { class: 'layout with-profile' }, details,
      h('div', { class: 'stack' }, kpis, h('div', { class: 'stack' }, mapHost, keyRow), tableHost), profile));

  const map = createMap(mapHost, { onSelect: (id) => store.set({ sel: id }) });

  const matches = (r, st) =>
    textMatches(st.q, r.p.name_en, r.p.name_zh, r.p.hub, r.p.hub_zh, r.p.province, r.p.start_zone_en, r.p.start_zone_zh, r.id) &&
    inSet(st.status, r.p.status) && inSet(st.region, r.p.region) && (!st.hub || r.p.hub === st.hub);

  function sync(st) {
    c.q.set(st.q);
    c.status.set(st.status);
    c.region.set(st.region);
    c.hub.set(st.hub);
    c.layers.set(st.layers);
  }

  function render() {
    const st = store.state;
    const shown = rows.filter((r) => matches(r, st)).sort((a, b) => a.p.name_en.localeCompare(b.p.name_en));

    // Reported racks: sum only the clusters that report a value; say how many do.
    const reporting = shown.filter((r) => Number.isFinite(r.p.racks_k));
    const racks = reporting.reduce((sum, r) => sum + r.p.racks_k, 0);
    const operating = shown.filter((r) => r.p.status === 'operating').length;
    const shownClusters = distinct(shown);
    const operatingClusters = distinct(shown.filter((r) => r.p.status === 'operating'));
    const shownIds = new Set(shown.map((r) => r.id));
    const shownProjects = projects.filter((pr) => shownIds.has(pr.owner) && pr.record_type === 'project');
    const inv = investmentOf(shownProjects);
    put(kpis, 
      kpi('Clusters shown', String(shownClusters), `of ${clusterTotal} national clusters${shown.length !== shownClusters ? ` (${shown.length} sites)` : ''}`),
      kpi('National hubs', String(new Set(shown.map((r) => r.p.hub)).size), `of ${hubNames.length} total`),
      kpi('Reported racks', reporting.length ? `${formatNumber(racks, { digits: 0 })}k` : EM_DASH, reporting.length ? `${reporting.length} of ${shownClusters} clusters report an official value; reporting dates differ` : 'No official cluster-level values in view'),
      kpi('Operating', shownClusters ? `${operatingClusters} of ${shownClusters}` : EM_DASH, 'clusters with operating capacity'),
      projectsOn ? kpi('Curated projects', String(shownProjects.length), inv.withFigure ? `${inv.withFigure} with a planned-investment figure totalling ${formatNumber(inv.total, { digits: 0 })} 亿元 (announced, unaudited)` : 'no investment figures in view') : null,
    );

    const showProjects = projectsOn && st.layers.has('projects');
    const plotted = showProjects
      ? shownProjects.filter((pr) => pr.lon !== null).map((pr) => ({ id: pr.id, lon: pr.lon, lat: pr.lat, clusterId: pr.cluster_id, label: `${projectName(pr)}${pr.location_precision === 'city' ? ' (shared centroid)' : ''}` }))
      : [];
    if (showProjects && !keyRow.contains(projectKey)) add(keyRow, projectKey);
    if (!showProjects && keyRow.contains(projectKey)) projectKey.remove();
    map.update(shown, st.sel, plotted);
    renderTable(shown);
    renderProfile();
    announce(`${distinct(shown)} of ${clusterTotal} clusters shown`);
  }

  function renderTable(shown) {
    const st = store.state;
    clear(tableHost);
    const head = h('div', { class: 'row between', style: { marginBottom: '8px' } },
      h('span', { class: 'muted', 'aria-hidden': 'true' }, `${shown.length} site${shown.length === 1 ? '' : 's'} · ${distinct(shown)} cluster${distinct(shown) === 1 ? '' : 's'}`),
      h('button', { type: 'button', class: 'btn', disabled: shown.length === 0, onclick: () => downloadCsv(`china-edwc-clusters-${meta.as_of}.csv`, toCsv(shown, csvColumns)) }, 'Export filtered CSV'));
    if (shown.length === 0) {
      add(tableHost, head, h('div', { class: 'card' }, emptyState('No clusters match', 'Try clearing a filter.')));
      return;
    }
    add(tableHost, head, h('div', { class: 'table-wrap' },
      h('table', null,
        h('caption', { class: 'sr-only' }, 'Data center clusters'),
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Cluster'), h('th', { scope: 'col' }, 'Hub'), h('th', { scope: 'col' }, 'Province'), h('th', { scope: 'col' }, 'Status'), h('th', { scope: 'col', class: 'num' }, 'Racks (k)'))),
        h('tbody', null, shown.map((r) => {
          const s = STATUS_STYLE[r.p.status];
          return h('tr', { 'aria-current': st.sel === r.id ? 'true' : null },
            h('td', null,
              h('button', { type: 'button', class: 'link-btn', onclick: () => { store.set({ sel: r.id }); revealProfile(profile); } }, r.p.name_en),
              r.p.site_label ? h('span', { class: 'cell-sub' }, r.p.site_label) : null,
              r.p.name_zh ? h('span', { class: 'cell-sub zh', lang: 'zh' }, r.p.name_zh) : null),
            h('td', null, r.p.hub), h('td', null, r.p.province),
            h('td', null, s ? h('span', { class: 'row nowrap', style: { gap: '6px' } }, h('span', { class: 'marker-key', style: { '--fill': s.fill, '--stroke': s.stroke }, 'aria-hidden': 'true' }), s.label) : humanize(r.p.status)),
            h('td', { class: 'num' }, Number.isFinite(r.p.racks_k) ? formatNumber(r.p.racks_k, { digits: 0 }) : EM_DASH));
        })))));
  }

  function renderProfile() {
    const r = rows.find((x) => x.id === store.state.sel);
    clear(profile);
    if (!r) {
      add(profile, h('div', { class: 'profile-empty' }, h('strong', null, 'Selection profile'), h('p', null, 'Select a cluster on the map or in the table.')));
      return;
    }
    const p = r.p;
    const s = STATUS_STYLE[p.status];
    const approvalUrl = safeUrl(p.approval_url);
    const metricsUrl = safeUrl(p.metrics_source?.url);
    add(profile, 
      h('h2', null, p.name_en),
      p.site_label ? h('div', { class: 'muted' }, p.site_label) : null,
      p.name_zh ? h('div', { class: 'zh', lang: 'zh' }, p.name_zh) : null,
      h('div', { class: 'row', style: { margin: '8px 0 12px' } },
        s ? h('span', { class: 'badge' }, h('span', { class: 'marker-key', style: { '--fill': s.fill, '--stroke': s.stroke }, 'aria-hidden': 'true' }), s.label) : tag(humanize(p.status)),
        p.placeholder ? tag('Placeholder metrics', { warn: true }) : null,
        !p.verified ? tag('Unverified', { warn: true }) : null),
      h('dl', { class: 'facts' },
        h('dt', null, 'Hub'), h('dd', null, p.hub_zh ? `${p.hub} (${p.hub_zh})` : p.hub),
        h('dt', null, 'Region'), h('dd', null, REGION_LABEL[p.region] ?? humanize(p.region)),
        h('dt', null, 'Province'), h('dd', null, p.province),
        h('dt', null, 'Designated'), h('dd', null, approvalUrl
          ? h('span', null, formatYearMonth(p.designated), ' · ', h('a', { href: approvalUrl, rel: 'noopener' }, p.approval_doc ?? 'approval letter'))
          : h('span', null, formatYearMonth(p.designated), p.approval_doc ? ` · ${p.approval_doc}` : '')),
        p.start_zone_en ? h('dt', null, 'Start-up zone') : null,
        p.start_zone_en ? h('dd', null, p.start_zone_en, p.start_zone_zh ? h('span', { class: 'cell-sub zh', lang: 'zh' }, p.start_zone_zh) : null) : null,
        h('dt', null, 'Racks'), h('dd', null, Number.isFinite(p.racks_k)
          ? `${formatNumber(p.racks_k, { digits: 0 })}k standard racks${p.racks_as_of ? ` (as of ${formatYearMonth(p.racks_as_of)})` : ''}`
          : 'Not reported at cluster level'),
        h('dt', null, 'Computing power'), h('dd', null, Number.isFinite(p.compute_eflops)
          ? h('span', null, `${formatNumber(p.compute_eflops, { digits: 1 })} EFLOPS${p.compute_as_of ? ` (as of ${formatYearMonth(p.compute_as_of)})` : ''}`,
            p.compute_note ? h('span', { class: 'cell-sub' }, p.compute_note) : null)
          : 'Not reported at cluster level'),
        Number.isFinite(p.pue) ? h('dt', null, 'Average PUE') : null,
        Number.isFinite(p.pue) ? h('dd', null, `${formatNumber(p.pue, { digits: 2 })}${p.pue_as_of ? ` (as of ${formatYearMonth(p.pue_as_of)})` : ''}`) : null,
        metricsUrl || p.metrics_source?.title ? h('dt', null, 'Metrics source') : null,
        metricsUrl || p.metrics_source?.title ? h('dd', null,
          metricsUrl ? h('a', { href: metricsUrl, rel: 'noopener' }, p.metrics_source.title) : p.metrics_source.title,
          p.metrics_source?.confidence ? h('span', { class: 'cell-sub' }, `Confidence: ${p.metrics_source.confidence}`) : null) : null,
        h('dt', null, 'Position'), h('dd', null, `${PRECISION_NOTE[p.location_precision] ?? p.location_precision}: ${r.lat.toFixed(2)}°N, ${r.lon.toFixed(2)}°E`,
          p.coord_reference ? h('span', { class: 'cell-sub' }, p.coord_reference) : null)),
      p.note ? h('p', { class: 'note-box', style: { marginTop: '12px' } }, p.note) : null,
      p.placeholder ? h('p', { class: 'note-box warn', style: { marginTop: '12px' } }, 'Status and rack figures for this cluster are synthetic placeholders and must not be cited.') : null,
      projectsOn ? renderProjects(r) : null);
  }

  /** Announced projects for the selected feature, from the curated inventory. Planned figures, not audited spending. */
  function renderProjects(r) {
    const list = projectsOf(r.id).slice().sort((a, b) => {
      const ai = Number.isFinite(a.investment_planned_100m_cny) ? a.investment_planned_100m_cny : -1;
      const bi = Number.isFinite(b.investment_planned_100m_cny) ? b.investment_planned_100m_cny : -1;
      return bi - ai || projectName(a).localeCompare(projectName(b));
    });
    const facilities = list.filter((pr) => pr.record_type === 'project');
    const parks = list.filter((pr) => pr.record_type === 'park');
    const inv = investmentOf(facilities);
    const withSource = facilities.filter((pr) => pr.source_url).length;
    const head = h('div', { class: 'row between', style: { marginTop: '16px', marginBottom: '6px' } },
      h('h3', { style: { margin: 0 } }, `Announced projects (${facilities.length})`),
      facilities.length ? h('button', { type: 'button', class: 'btn', onclick: () => downloadCsv(`china-edwc-projects-${r.id}-${meta.as_of}.csv`, toCsv(list, projectCsvColumns)) }, 'Export CSV') : null);
    if (list.length === 0) return h('div', null, head, h('p', { class: 'muted' }, 'No projects from the curated inventory are attached to this site.'));
    const items = facilities.map((pr) => {
      const url = safeUrl(pr.source_url);
      const flags = pr.flags.filter((f) => f !== 'no_source').map((f) => FLAG_LABEL[f] ?? humanize(f));
      return h('li', { class: 'project-item' },
        h('div', { class: 'row between', style: { gap: '8px', alignItems: 'baseline' } },
          h('span', null, pr.name_zh ? h('span', { lang: 'zh' }, pr.name_zh) : pr.name_en, pr.name_zh && pr.name_en ? h('span', { class: 'cell-sub' }, pr.name_en) : null),
          h('span', { class: 'num nowrap' }, Number.isFinite(pr.investment_planned_100m_cny) ? `${formatNumber(pr.investment_planned_100m_cny, { digits: 2 })} 亿元` : EM_DASH)),
        h('div', { class: 'cell-sub' },
          [COMPANY_LABEL[pr.company_group] ?? humanize(pr.company_group), pr.company && COMPANY_LABEL[pr.company_group] !== pr.company ? pr.company : null, pr.city_zh, pr.sub_area_zh,
            pr.site_id ? rows.find((x) => x.id === pr.site_id)?.p.site_label : null].filter(Boolean).join(' · '),
          url ? h('span', null, ' · ', h('a', { href: url, rel: 'noopener' }, 'source')) : null,
          flags.length ? h('span', { class: 'muted' }, ` · ${flags.join(', ')}`) : null));
    });
    return h('div', null, head,
      h('p', { class: 'cell-sub' }, `${inv.withFigure} of ${facilities.length} carry a planned-investment figure (sum ${formatNumber(inv.total, { digits: 2 })} 亿元); ${withSource} link to a source. Figures are announced plans from press and government releases, compiled by hand; they are not audited spending.`),
      h('ul', { class: 'project-list' }, items),
      parks.length ? h('p', { class: 'cell-sub' }, `Park-level rows (not counted above): ${parks.map((pk) => `${projectName(pk)}${Number.isFinite(pk.area_investment_100m_cny) ? ` — ${formatNumber(pk.area_investment_100m_cny, { digits: 2 })} 亿元 area investment` : pk.investment_text ? ` — ${pk.investment_text}` : ''}`).join('; ')}.`) : null);
  }

  const projectCsvColumns = [
    { label: 'id', get: (pr) => pr.id },
    { label: 'cluster_id', get: (pr) => pr.cluster_id },
    { label: 'site_id', get: (pr) => pr.site_id },
    { label: 'record_type', get: (pr) => pr.record_type },
    { label: 'name_zh', get: (pr) => pr.name_zh },
    { label: 'name_en', get: (pr) => pr.name_en },
    { label: 'city_zh', get: (pr) => pr.city_zh },
    { label: 'sub_area_zh', get: (pr) => pr.sub_area_zh },
    { label: 'company', get: (pr) => pr.company },
    { label: 'company_group', get: (pr) => pr.company_group },
    { label: 'investment_planned_100m_cny', get: (pr) => pr.investment_planned_100m_cny },
    { label: 'investment_text', get: (pr) => pr.investment_text },
    { label: 'area_investment_100m_cny', get: (pr) => pr.area_investment_100m_cny },
    { label: 'date_opened', get: (pr) => pr.date_opened },
    { label: 'longitude', get: (pr) => pr.lon },
    { label: 'latitude', get: (pr) => pr.lat },
    { label: 'location_precision', get: (pr) => pr.location_precision },
    { label: 'source_url', get: (pr) => pr.source_url },
    { label: 'flags', get: (pr) => pr.flags },
    { label: 'note', get: (pr) => pr.note },
    { label: 'sheet_row', get: (pr) => pr.sheet_row },
  ];

  const csvColumns = [
    { label: 'id', get: (r) => r.id },
    { label: 'name_en', get: (r) => r.p.name_en },
    { label: 'name_zh', get: (r) => r.p.name_zh },
    { label: 'part_of', get: (r) => r.p.part_of },
    { label: 'site_label', get: (r) => r.p.site_label },
    { label: 'hub', get: (r) => r.p.hub },
    { label: 'region', get: (r) => r.p.region },
    { label: 'province', get: (r) => r.p.province },
    { label: 'status', get: (r) => r.p.status },
    { label: 'racks_k', get: (r) => r.p.racks_k },
    { label: 'racks_as_of', get: (r) => r.p.racks_as_of },
    { label: 'compute_eflops', get: (r) => r.p.compute_eflops },
    { label: 'compute_as_of', get: (r) => r.p.compute_as_of },
    { label: 'compute_note', get: (r) => r.p.compute_note },
    { label: 'metrics_source_title', get: (r) => r.p.metrics_source?.title },
    { label: 'metrics_source_url', get: (r) => r.p.metrics_source?.url },
    { label: 'designated', get: (r) => r.p.designated },
    { label: 'approval_doc', get: (r) => r.p.approval_doc },
    { label: 'approval_url', get: (r) => r.p.approval_url },
    { label: 'start_zone_zh', get: (r) => r.p.start_zone_zh },
    { label: 'start_zone_en', get: (r) => r.p.start_zone_en },
    { label: 'longitude', get: (r) => r.lon },
    { label: 'latitude', get: (r) => r.lat },
    { label: 'location_precision', get: (r) => r.p.location_precision },
    { label: 'coord_reference', get: (r) => r.p.coord_reference },
    { label: 'note', get: (r) => r.p.note },
    { label: 'placeholder', get: (r) => r.p.placeholder },
    { label: 'verified', get: (r) => r.p.verified },
  ];

  sync(store.state);
  render();
}

main();

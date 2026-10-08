// Two interchangeable map renderers behind one interface:
//   { update(rows, selectedId, projects), destroy() }
// `projects` is an optional list of small secondary markers ({id, lon, lat, label, clusterId}); clicking one
// selects its cluster.
// Leaflet (loaded from a CDN by map.html) when window.L exists; otherwise a plain SVG grid so the page still works
// offline, behind a firewall, or if the CDN is blocked.

import { h, svg, put, add } from './dom.js';
import { CONFIG } from '../config.js';

export const STATUS_STYLE = Object.freeze({
  designated: { label: 'Designated', fill: '#fcfcfb', stroke: '#1c5cab' },
  under_construction: { label: 'Under construction', fill: '#6da7ec', stroke: '#1c5cab' },
  operating: { label: 'Operating', fill: '#184f95', stroke: '#fcfcfb' },
});
const FALLBACK_STYLE = { label: 'Unknown', fill: '#c3c2b7', stroke: '#52514e' };
/** Style of the curated project-site markers (small squares, neutral so cluster status colours stay legible). */
export const PROJECT_STYLE = Object.freeze({ label: 'Curated project site', fill: '#52514e', stroke: '#fcfcfb' });
const styleOf = (status) => STATUS_STYLE[status] ?? FALLBACK_STYLE;

const idsKey = (rows) => rows.map((r) => r.id).join('|');

export function createMap(container, { onSelect }) {
  return typeof window !== 'undefined' && window.L && typeof window.L.map === 'function'
    ? leafletMap(container, onSelect)
    : svgMap(container, onSelect);
}

// ------------------------------------------------------------------ Leaflet

function leafletMap(container, onSelect) {
  const L = window.L;
  const el = h('div', { id: 'map', role: 'application', 'aria-label': 'Map of East Data West Computing clusters. A table of the same clusters follows the map.' });
  put(container, el);

  const map = L.map(el, { zoomControl: true, attributionControl: true }).setView(CONFIG.mapCenter, CONFIG.mapZoom);
  let warned = false;
  const tiles = L.tileLayer(CONFIG.tileUrl, { attribution: CONFIG.tileAttribution, maxZoom: 12 }).addTo(map);
  tiles.on('tileerror', () => {
    if (warned) return;
    warned = true;
    add(container, h('div', { class: 'map-note', role: 'status' }, 'Basemap tiles could not be loaded; cluster positions are still shown.'));
  });
  const layer = L.layerGroup().addTo(map);
  let lastKey = null;

  return {
    kind: 'leaflet',
    update(rows, selectedId, projects = []) {
      layer.clearLayers();
      const latLngs = [];
      // Project squares go first so cluster markers always sit on top of them.
      for (const pr of projects) {
        const sq = L.marker([pr.lat, pr.lon], {
          icon: L.divIcon({ className: 'project-marker', iconSize: [9, 9], iconAnchor: [4.5, 4.5] }),
          keyboard: false, // the table below lists every project; squares are a visual aid
        });
        sq.on('click', () => onSelect(pr.clusterId));
        sq.bindTooltip(pr.label, { direction: 'top' });
        sq.addTo(layer);
      }
      for (const r of rows) {
        const s = styleOf(r.p.status);
        const selected = r.id === selectedId;
        const marker = L.circleMarker([r.lat, r.lon], {
          radius: selected ? 12 : 9, weight: selected ? 4 : 2.5, color: selected ? '#0b0b0b' : s.stroke, fillColor: s.fill, fillOpacity: 1,
        });
        marker.on('click', () => onSelect(r.id));
        marker.bindTooltip(r.p.name_en, { direction: 'top' });
        marker.addTo(layer);
        latLngs.push([r.lat, r.lon]);
      }
      const key = idsKey(rows);
      if (key !== lastKey && latLngs.length) {
        // Re-fit only when the visible set changes, not on every selection.
        if (latLngs.length === 1) map.setView(latLngs[0], 7);
        else map.fitBounds(latLngs, { padding: [40, 40], maxZoom: 7 });
      }
      lastKey = key;
      map.invalidateSize();
    },
    destroy: () => map.remove(),
  };
}

// ------------------------------------------------------------------ SVG fallback

function svgMap(container, onSelect) {
  let rows = [];
  let projects = [];
  let selectedId = null;
  let ro = null;

  const draw = () => {
    const width = Math.max(280, Math.round(container.clientWidth || 640));
    const height = width < 600 ? 400 : 520;
    // Equirectangular with a cos(35 deg) horizontal squeeze so shapes look roughly right at China's latitude.
    const lon0 = 72;
    const lon1 = 136;
    const lat0 = 16;
    const lat1 = 54;
    const k = Math.cos((35 * Math.PI) / 180);
    const xSpan = (lon1 - lon0) * k;
    const ySpan = lat1 - lat0;
    const scale = Math.min((width - 40) / xSpan, (height - 40) / ySpan);
    const ox = (width - xSpan * scale) / 2;
    const oy = (height - ySpan * scale) / 2;
    const X = (lon) => ox + (lon - lon0) * k * scale;
    const Y = (lat) => oy + (lat1 - lat) * scale;

    const root = svg('svg', { class: 'map-fallback', viewBox: `0 0 ${width} ${height}`, width, height, role: 'group', 'aria-label': 'Plain grid showing cluster positions. A table of the same clusters follows.' });
    add(root, svg('rect', { class: 'land', x: ox, y: oy, width: xSpan * scale, height: ySpan * scale }));
    for (let lon = 80; lon <= 130; lon += 10) {
      add(root, svg('line', { class: 'graticule', x1: X(lon), x2: X(lon), y1: oy, y2: oy + ySpan * scale }), svg('text', { x: X(lon), y: oy + ySpan * scale + 14, 'text-anchor': 'middle' }, `${lon}°E`));
    }
    for (let lat = 20; lat <= 50; lat += 10) {
      add(root, svg('line', { class: 'graticule', x1: ox, x2: ox + xSpan * scale, y1: Y(lat), y2: Y(lat) }), svg('text', { x: ox - 6, y: Y(lat), dy: '0.32em', 'text-anchor': 'end' }, `${lat}°N`));
    }

    // Direct labels are selective: only the selected cluster is named on the plot. Every marker carries a native
    // <title> tooltip, and the table below the map lists all of them.
    for (const r of rows) {
      const s = styleOf(r.p.status);
      const selected = r.id === selectedId;
      const cx = X(r.lon);
      const cy = Y(r.lat);
      const activate = () => onSelect(r.id);
      add(root,
        svg('circle', { cx, cy, r: selected ? 11 : 8, fill: s.fill, stroke: selected ? '#0b0b0b' : s.stroke, 'stroke-width': selected ? 3.5 : 2.5 }),
        svg('circle', {
          cx, cy, r: 16, fill: 'transparent', tabindex: '0', role: 'button', style: { cursor: 'pointer' },
          'aria-label': `${r.p.name_en}, ${s.label}`,
          onclick: activate,
          onkeydown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              activate();
            }
          },
        }, svg('title', null, `${r.p.name_en} \u2014 ${s.label}`)));
    }
    // Project squares are drawn above the cluster circles: most inventory coordinates sit on the cluster
    // centroid, so drawn underneath they would simply vanish at this scale.
    for (const pr of projects) {
      if (pr.lon < lon0 || pr.lon > lon1 || pr.lat < lat0 || pr.lat > lat1) continue; // outside the plotted window
      add(root, svg('rect', { class: 'project-square', x: X(pr.lon) - 3.5, y: Y(pr.lat) - 3.5, width: 7, height: 7, fill: PROJECT_STYLE.fill, stroke: PROJECT_STYLE.stroke, 'stroke-width': 1, onclick: () => onSelect(pr.clusterId), style: { cursor: 'pointer' } },
        svg('title', null, pr.label)));
    }

    const sel = rows.find((r) => r.id === selectedId);
    if (sel) {
      const cx = X(sel.lon);
      const flip = cx > width * 0.6; // keep the label inside the plot near the right edge
      const name = sel.p.name_en.replace(/\s*\(.*?\)|\s+cluster.*$/gi, '');
      add(root, svg('text', { class: 'label-strong', x: flip ? cx - 16 : cx + 16, y: Y(sel.lat), dy: '0.32em', 'text-anchor': flip ? 'end' : 'start' }, name));
    }
    put(container, root, h('div', { class: 'map-note', role: 'note' }, 'Basemap library unavailable; showing cluster positions on a plain grid.'));
  };

  if (typeof ResizeObserver !== 'undefined') {
    let lastW = 0;
    ro = new ResizeObserver(() => {
      const w = Math.round(container.clientWidth);
      if (w !== lastW) {
        lastW = w;
        requestAnimationFrame(draw);
      }
    });
    ro.observe(container);
  }

  return {
    kind: 'svg',
    update(nextRows, nextSelected, nextProjects = []) {
      rows = nextRows;
      projects = nextProjects;
      selectedId = nextSelected;
      draw();
    },
    destroy: () => ro?.disconnect(),
  };
}


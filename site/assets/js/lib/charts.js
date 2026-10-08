// Dependency-free charts (HTML + SVG). All text from data goes through textContent via dom.js.

import { h, svg, put, add } from './dom.js';
import { STATUS_META, STATUS_ORDER, usablePoints } from './status.js';
import { linear, niceScale, yearTicks } from './scale.js';
import { formatNumber, formatValue, formatActual, qualifierPrefix, formatPercent, formatIsoDate, safeUrl, EM_DASH } from './format.js';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// ---------------------------------------------------------------- tooltip (one shared element)

let tipEl = null;
function tip() {
  if (!tipEl) {
    tipEl = h('div', { class: 'tooltip', role: 'tooltip', id: 'chart-tooltip' });
    add(document.body, tipEl);
  }
  return tipEl;
}

/** Show the tooltip near a client-space point. `valueText` leads (strong), `labelText` follows. */
function showTip(clientX, clientY, valueText, labelText) {
  const el = tip();
  put(el, h('div', { class: 't-value' }, valueText), h('div', { class: 't-label' }, labelText));
  el.classList.add('on');
  const { width, height } = el.getBoundingClientRect();
  const x = clamp(clientX + 12, 8, window.innerWidth - width - 8);
  const y = clientY - height - 12 < 8 ? clientY + 16 : clientY - height - 12;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

function hideTip() {
  tip().classList.remove('on');
}

// ---------------------------------------------------------------- status distribution

/**
 * Single stacked bar + legend. Segments and legend items are buttons so the same control filters by status.
 * @param {{counts: object, total: number}} summary  from summarizeStatuses()
 * @param {{active?: Set<string>, onToggle?: (status: string) => void}} [opts]
 */
export function statusBar(summary, { active = new Set(), onToggle } = {}) {
  const { counts, total } = summary;
  if (!total) return h('p', { class: 'muted' }, 'No targets match the current filters.');

  const present = STATUS_ORDER.filter((s) => counts[s] > 0);
  const press = (s) => (active.has(s) ? 'true' : 'false');

  const bar = h('div', { class: 'statusbar', role: 'group', 'aria-label': 'Targets by status' },
    present.map((s) =>
      h('button', {
        type: 'button',
        class: 'seg',
        style: { '--n': counts[s], '--c': `var(--st-${s})` },
        'aria-pressed': press(s),
        'aria-label': `${STATUS_META[s].label}: ${counts[s]} of ${total}`,
        onclick: () => onToggle?.(s),
        onpointerenter: (e) => showTip(e.clientX, e.clientY, String(counts[s]), `${STATUS_META[s].label} · ${formatPercent(counts[s] / total)} of targets`),
        onpointermove: (e) => showTip(e.clientX, e.clientY, String(counts[s]), `${STATUS_META[s].label} · ${formatPercent(counts[s] / total)} of targets`),
        onpointerleave: hideTip,
        onblur: hideTip,
      })));

  const legend = h('div', { class: 'legend' },
    present.map((s) =>
      h('button', { type: 'button', class: 'item', 'aria-pressed': press(s), onclick: () => onToggle?.(s) },
        h('span', { class: 'glyph', 'aria-hidden': 'true', style: { '--c': `var(--st-${s})`, '--c-ink': `var(--st-${s}-ink)` } }, STATUS_META[s].icon),
        STATUS_META[s].label, h('strong', null, String(counts[s])))));

  return h('div', null, bar, legend);
}

// ---------------------------------------------------------------- progress meter (level targets)

export function meter(res) {
  if (res.progress === null || res.progress === undefined) return h('span', { class: 'muted' }, EM_DASH);
  const fill = clamp(res.progress, 0, 1) * 100;
  const pace = clamp(res.expected ?? 0, 0, 1) * 100;
  return h('div', { class: 'meter-wrap' },
    h('div', {
      class: 'meter',
      role: 'img',
      'aria-label': `${formatPercent(res.progress)} of the way to the target; expected pace ${formatPercent(res.expected)}`,
    },
    h('div', { class: 'fill', style: { width: `${fill}%` } }),
    h('div', { class: 'pace', style: { left: `calc(${pace}% - 1px)` } })),
    h('span', { class: 'meter-label' }, `${formatPercent(res.progress)} · pace ${formatPercent(res.expected)}`));
}

// ---------------------------------------------------------------- trajectory (target detail)

/**
 * Line chart of reported values against the target. Re-renders when the container width changes.
 * @returns {{destroy(): void}}
 */
export function mountTrajectory(container, target, actuals, res) {
  const points = usablePoints(target, actuals);
  let lastWidth = 0;
  let ro = null;

  const draw = () => {
    const width = Math.max(280, Math.round(container.clientWidth || 360));
    lastWidth = width;
    put(container, buildTrajectory(target, points, res, width));
  };

  draw();
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      const w = Math.max(280, Math.round(container.clientWidth || 360));
      if (w !== lastWidth) requestAnimationFrame(draw); // only when the width really changed (avoids a resize loop)
    });
    ro.observe(container);
  }
  return { destroy: () => ro?.disconnect() };
}

function buildTrajectory(target, points, res, width) {
  const unit = target.unit;
  const t = target.target;
  const isLevel = target.kind === 'level';
  const base = isLevel ? target.baseline : null;

  const M = { t: 22, r: 74, b: 30, l: 46 };
  const H = 280;
  const innerW = width - M.l - M.r;
  const innerH = H - M.t - M.b;

  // ---- domains
  const lastYear = points.length ? points[points.length - 1].year : null;
  let x0;
  let x1;
  if (isLevel) {
    x0 = base.year;
    x1 = Math.max(t.year, lastYear ?? t.year);
  } else if (target.kind === 'rate') {
    x0 = target.period.start;
    x1 = target.period.end;
  } else {
    const years = [t.year, ...points.map((p) => p.year)];
    x0 = Math.min(...years);
    x1 = Math.max(...years);
    if (x0 === x1) {
      x0 -= 1;
      x1 += 1;
    }
  }
  const values = [t.value, ...points.map((p) => p.value)];
  if (isLevel) values.push(base.value);
  const ny = niceScale(Math.min(...values), Math.max(...values), 4);

  const xs = linear([x0, x1], [10, innerW - 10]);
  const ys = linear([ny.min, ny.max], [innerH, 0]);

  const g = svg('g', { transform: `translate(${M.l},${M.t})` });

  // ---- grid + axes
  for (const v of ny.ticks) {
    add(g, 
      svg('line', { class: 'grid', x1: 0, x2: innerW, y1: ys(v), y2: ys(v) }),
      svg('text', { x: -8, y: ys(v), dy: '0.32em', 'text-anchor': 'end' }, formatNumber(v)),
    );
  }
  add(g, svg('line', { class: 'axis', x1: 0, x2: innerW, y1: innerH, y2: innerH }));
  for (const yr of yearTicks(x0, x1, Math.max(3, Math.floor(innerW / 56)))) {
    add(g, svg('text', { x: xs(yr), y: innerH + 18, 'text-anchor': 'middle' }, String(yr)));
  }

  // ---- reference marks: expected pace (level) or target line (threshold/rate)
  if (isLevel) {
    add(g, svg('line', { class: 'line-pace', x1: xs(base.year), y1: ys(base.value), x2: xs(t.year), y2: ys(t.value) }));
  } else {
    add(g, svg('line', { class: 'line-pace', x1: xs(x0), y1: ys(t.value), x2: xs(x1), y2: ys(t.value) }));
  }

  // target marker + label (diamond), label sits to the right in the margin
  const tx = xs(isLevel ? t.year : x1);
  const ty = ys(t.value);
  const cmp = isLevel ? '' : target.direction === 'increase' ? '≥ ' : '≤ ';
  add(g, 
    svg('path', { class: 'target-mark', d: `M${tx},${ty - 6} L${tx + 6},${ty} L${tx},${ty + 6} L${tx - 6},${ty} Z` }),
    svg('text', { class: 'label-strong', x: tx + 12, y: ty, dy: '-0.1em' }, 'Target'),
    svg('text', { x: tx + 12, y: ty, dy: '1.1em' }, `${cmp}${formatNumber(t.value)}`),
  );

  // ---- actual line (level: starts at the baseline so the path reads from where the plan began)
  const linePts = [...(isLevel ? [{ year: base.year, value: base.value, baseline: true }] : []), ...points.filter((p) => !(isLevel && p.year === base.year))];
  if (linePts.length >= 2) {
    add(g, svg('path', { class: 'line-actual', d: linePts.map((p, i) => `${i ? 'L' : 'M'}${xs(p.year)},${ys(p.value)}`).join(' ') }));
  }

  // ---- markers + hit areas + hover crosshair
  const cross = svg('line', { class: 'cross', y1: 0, y2: innerH });
  add(g, cross);
  const marks = svg('g');
  const reported = points.map((p) => ({ ...p, baseline: false }));
  const all = isLevel && !points.some((p) => p.year === base.year) ? [{ year: base.year, value: base.value, baseline: true }, ...reported] : reported;

  for (const p of all) {
    const cx = xs(p.year);
    const cy = ys(p.value);
    const partialNote = p.partial ? ` (partial year, as of ${formatIsoDate(p.as_of)})` : '';
    const label = `${p.year}${p.baseline ? ' · baseline' : ' · reported'}${partialNote}${p.placeholder ? ' (placeholder)' : ''}`;
    // Baseline and partial-year points are drawn hollow so a mid-year figure never reads as a year-end one.
    const hollow = p.baseline || p.partial;
    const dot = svg('circle', { class: `dot${p.partial ? ' partial' : ''}`, cx, cy, r: 4.5, style: hollow ? { fill: 'var(--surface)', stroke: 'var(--series-1)' } : null });
    const on = (clientX, clientY) => {
      cross.setAttribute('x1', cx);
      cross.setAttribute('x2', cx);
      cross.style.opacity = '1';
      dot.classList.add('hot');
      showTip(clientX, clientY, formatActual(p, unit), label);
    };
    const off = () => {
      cross.style.opacity = '0';
      dot.classList.remove('hot');
      hideTip();
    };
    const hit = svg('circle', {
      class: 'hit', cx, cy, r: 14, tabindex: '0', role: 'img',
      'aria-label': `${label}: ${formatActual(p, unit)}`,
      onpointerenter: (e) => on(e.clientX, e.clientY),
      onpointermove: (e) => on(e.clientX, e.clientY),
      onpointerleave: off,
      onfocus: () => {
        const r = hit.getBoundingClientRect();
        on(r.left + r.width / 2, r.top + r.height / 2);
      },
      onblur: off,
    });
    add(marks, dot, hit);
  }
  add(g, marks);

  // ---- one direct label: the latest reported value
  if (points.length) {
    const last = points[points.length - 1];
    const ly = ys(last.value);
    add(g, svg('text', { class: 'label-strong', x: xs(last.year), y: ly < 14 ? ly + 20 : ly - 12, 'text-anchor': 'middle' }, `${qualifierPrefix(last.qualifier)}${formatNumber(last.value)}`));
  }

  const chart = svg('svg', {
    viewBox: `0 0 ${width} ${H}`, width, height: H, role: 'group',
    'aria-label': `Chart: ${target.indicator_en}. ${points.length} reported value${points.length === 1 ? '' : 's'} against a target of ${formatValue(t.value, unit)} by ${t.year}. A table view follows.`,
  }, g);

  // ---- legend (HTML, mirrors the marks)
  const key = (shape, text) => h('span', { class: 'key' }, shape, text);
  const hasPartial = points.some((p) => p.partial);
  const legend = h('div', { class: 'chart-legend' },
    key(svg('svg', { viewBox: '0 0 22 10', 'aria-hidden': 'true' },
      svg('line', { x1: 0, y1: 5, x2: 22, y2: 5, class: 'line-actual' }), svg('circle', { cx: 11, cy: 5, r: 4, class: 'dot' })), 'Reported'),
    hasPartial ? key(svg('svg', { viewBox: '0 0 22 10', 'aria-hidden': 'true' },
      svg('circle', { cx: 11, cy: 5, r: 4, class: 'dot partial', style: { fill: 'var(--surface)', stroke: 'var(--series-1)' } })), 'Partial year') : null,
    key(svg('svg', { viewBox: '0 0 22 10', 'aria-hidden': 'true' }, svg('line', { x1: 0, y1: 5, x2: 22, y2: 5, class: 'line-pace' })), isLevel ? 'Expected pace' : 'Target level'),
    key(svg('svg', { viewBox: '0 0 22 12', 'aria-hidden': 'true' }, svg('path', { class: 'target-mark', d: 'M11,0 L17,6 L11,12 L5,6 Z' })), 'Target'));

  // ---- table view (the chart's data is always reachable without hovering; every reported value names its source)
  const rows = [];
  if (isLevel) rows.push(['Baseline', base.year, base.value, null]);
  for (const p of points) if (!(isLevel && p.year === base.year)) rows.push(['Reported', p.year, p.value, p]);
  rows.push(['Target', t.year, t.value, null]);
  const sourceCell = (rec) => {
    if (!rec) return h('td', { class: 'muted' }, 'Plan document'); // baseline and target rows come from the plan itself
    const title = rec.source?.title ?? EM_DASH;
    const url = safeUrl(rec.source?.url);
    return h('td', { class: 'src' }, url ? h('a', { href: url, rel: 'noopener' }, title) : title);
  };
  const typeText = (kind, rec) => {
    const bits = [kind];
    if (rec?.partial) bits.push(`as of ${formatIsoDate(rec.as_of)}`);
    if (rec?.placeholder) bits.push('placeholder');
    return bits.join(' · ');
  };
  const table = h('details', { class: 'table-view' },
    h('summary', null, 'Table view and sources'),
    h('table', null,
      h('caption', { class: 'sr-only' }, `Values and sources for ${target.indicator_en}`),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Year'), h('th', { scope: 'col', class: 'num' }, 'Value'), h('th', { scope: 'col' }, 'Type'), h('th', { scope: 'col' }, 'Source'))),
      h('tbody', null, rows.map(([kind, year, value, rec]) =>
        h('tr', null, h('td', { class: 'num' }, String(year)), h('td', { class: 'num' }, rec ? formatActual(rec, unit) : formatValue(value, unit)),
          h('td', null, typeText(kind, rec)), sourceCell(rec))))));

  return h('div', { class: 'chart' }, chart, legend, table);
}

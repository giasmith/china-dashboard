// Shared page chrome and small components.

import { h, byId, clear, put, add } from './dom.js';
import { CONFIG } from '../config.js';
import { STATUS_META } from './status.js';
import { formatIsoDate, safeUrl, EM_DASH } from './format.js';

const NAV = [
  { href: 'index.html', label: 'Map' },
  { href: 'plan.html', label: 'Plan targets' },
  { href: 'legislation.html', label: 'Legislation' },
];

const THEMES = ['auto', 'light', 'dark'];

function readTheme() {
  try {
    const t = localStorage.getItem('theme');
    return THEMES.includes(t) ? t : 'auto';
  } catch {
    return 'auto'; // storage can be unavailable (private mode, blocked cookies)
  }
}

function applyTheme(theme) {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

function themeButton() {
  let theme = readTheme();
  const btn = h('button', { class: 'btn', type: 'button' });
  const paint = () => {
    btn.textContent = `Theme: ${theme[0].toUpperCase()}${theme.slice(1)}`;
    btn.setAttribute('aria-label', `Colour theme: ${theme}. Activate to change.`);
  };
  btn.addEventListener('click', () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    applyTheme(theme);
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* non-fatal: the choice just will not persist */
    }
    paint();
  });
  paint();
  return btn;
}

/** Render header, data-status banner and footer. `meta` may be null if loading failed. */
export function renderShell(activeHref, meta) {
  const header = byId('site-header');
  put(header, 
    // Like the U.S. tracker: the tracker's title and the navigation on the left, partner logos at the top right
    // (Gia, 15 Oct 2026).
    // Two groups so the logos stay at the top right whatever the width or font: when space runs out the left group
    // wraps inside itself (the nav drops under the title) instead of pushing the logos onto a second row.
    h('div', { class: 'wrap' },
      h('div', { class: 'header-left' },
        h('a', { class: 'brand', href: 'index.html' }, CONFIG.siteTitle),
        h('nav', { class: 'nav', 'aria-label': 'Primary' },
          NAV.map((n) => h('a', { href: n.href, 'aria-current': n.href === activeHref ? 'page' : null }, n.label)))),
      h('div', { class: 'header-right' },
        themeButton(),
        CONFIG.partners?.length
          ? h('div', { class: 'partner-logos' }, CONFIG.partners.map((p) => h('img', { src: p.src, alt: p.alt, width: p.width, height: p.height, decoding: 'async' })))
          : null)),
  );

  // No data-status banner above the pages (removed at Gia's request, 15 Oct 2026). The footer still states the
  // dataset status, and each map layer's legend carries its source and tier.
  const banner = document.getElementById('banner');
  if (banner) {
    clear(banner);
    banner.hidden = true;
  }

  const footer = document.getElementById('site-footer');
  if (footer) {
    const repo = safeUrl(CONFIG.repoUrl);
    put(footer, 
      h('div', { class: 'wrap' },
        h('span', null, meta ? `Data as of ${formatIsoDate(meta.as_of)}` : 'Data date unavailable'),
        meta ? h('span', null, `Dataset status: ${meta.data_status}`) : null,
        meta ? h('span', null, `Schema v${meta.schema_version}`) : null,
        repo ? h('a', { href: repo, rel: 'noopener' }, 'Source on GitHub') : null),
    );
  }
}

export function kpi(label, value, note) {
  return h('div', { class: 'kpi' },
    h('div', { class: 'label' }, label),
    h('div', { class: 'value' }, value ?? EM_DASH),
    note ? h('div', { class: 'note' }, note) : null);
}

export function statusBadge(status) {
  const meta = STATUS_META[status] ?? STATUS_META.invalid;
  const key = STATUS_META[status] ? status : 'invalid';
  return h('span', { class: 'badge', style: { '--c': `var(--st-${key})`, '--c-ink': `var(--st-${key}-ink)` } },
    h('span', { class: 'glyph', 'aria-hidden': 'true' }, meta.icon), meta.label);
}

export function tag(text, { warn = false } = {}) {
  return h('span', { class: warn ? 'tag warn' : 'tag' }, text);
}

export function emptyState(title, message) {
  return h('div', { class: 'empty' }, h('strong', null, title), message);
}

export function showError(container, err) {
  const hint = err?.hint ?? null;
  put(container, 
    h('div', { class: 'card error-card', role: 'alert' },
      h('h2', null, 'Could not load the data'),
      h('p', null, err?.message ?? 'Unexpected error.'),
      hint ? h('p', { class: 'muted', style: { 'margin-top': '8px' } }, hint) : null),
  );
  // Visible for debugging, but never crash silently.
  console.error(err);
}

/** Polite screen-reader announcement (e.g. "12 results"). */
export function announce(message) {
  const live = document.getElementById('live');
  if (live) live.textContent = message;
}

/** Collapse the filter <details> on small screens, keep it open on desktop. */
export function initFilterDisclosure(details) {
  const mq = window.matchMedia('(min-width: 861px)');
  details.open = mq.matches;
}

/**
 * Debounce with a pending() probe. Controls use it to ignore state pushed back from the store while the user's own
 * keystrokes are still waiting to be committed; otherwise a stale value could overwrite what they just typed.
 */
export function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  wrapped.pending = () => timer !== null;
  return wrapped;
}

/** When the profile is stacked below the list (narrow screens), bring it into view after the user selects a row. */
export function revealProfile(profile) {
  if (!window.matchMedia('(max-width: 1100px)').matches) return; // wide layouts keep it sticky beside the list
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  profile.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
}

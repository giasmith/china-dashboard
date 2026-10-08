// Site-wide settings. Edit here, not in the page modules.

export const CONFIG = Object.freeze({
  siteName: 'China Dashboard',
  tagline: 'Five-year plans, legislation and East Data West Computing',

  // Set to your repository URL once it exists, e.g. 'https://github.com/<user>/china-dashboard'.
  repoUrl: 'https://github.com/giasmith/china-dashboard',

  // Basemap for the map page. OpenStreetMap's public tile servers are for light use only; for heavier
  // traffic switch to a provider with an API key or self-hosted tiles. Boundary depiction on a basemap is the
  // provider's choice, so review it before publishing.
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  mapCenter: [35.0, 104.0], // [lat, lon]
  mapZoom: 4,

  // Project layer on the EDWC map (curated inventory in data/edwc_projects.json). OFF until the source
  // spreadsheet's licence is confirmed; when off, the file is neither requested nor published (it is git-ignored).
  showProjectLayer: false,

  // Share of the full baseline->target distance a target may trail the expected pace before it is "behind".
  statusTolerance: 0.1,
});

export const DATA_FILES = Object.freeze({
  meta: 'data/meta.json',
  targets: 'data/plan_targets.json',
  actuals: 'data/plan_actuals.json',
  legislation: 'data/legislation.json',
  hubs: 'data/edwc_hubs.geojson',
  projects: 'data/edwc_projects.json',
});

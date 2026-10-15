// Site-wide settings. Edit here, not in the page modules.

export const CONFIG = Object.freeze({
  siteName: 'China Dashboard',
  tagline: 'Data centers, power, water and policy by province',

  // Set to your repository URL once it exists, e.g. 'https://github.com/<user>/china-dashboard'.
  repoUrl: 'https://github.com/giasmith/china-dashboard',



  // Share of the full baseline->target distance a target may trail the expected pace before it is "behind".
  statusTolerance: 0.1,
});

export const DATA_FILES = Object.freeze({
  meta: 'data/meta.json',
  targets: 'data/plan_targets.json',
  actuals: 'data/plan_actuals.json',
  legislation: 'data/legislation.json',
  provinces: 'data/provinces.json',
  facilities: 'data/facilities.json',
  plants: 'data/power_plants.json',
  lines: 'data/power_lines.json',
});

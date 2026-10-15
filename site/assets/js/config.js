// Site-wide settings. Edit here, not in the page modules.

export const CONFIG = Object.freeze({
  siteName: 'China Dashboard',
  tagline: 'Data centers, power, water and policy by province',

  // Set to your repository URL once it exists, e.g. 'https://github.com/<user>/china-dashboard'.
  repoUrl: 'https://github.com/giasmith/china-dashboard',

  // Partner logos at the top left of every page (files in site/assets/img/). width/height are the files' pixel sizes;
  // they only reserve the aspect ratio before the image loads - the CSS sets the displayed height.
  partners: [
    { src: 'assets/img/uva-nsi.png', alt: 'University of Virginia National Security Institute', width: 1142, height: 120 },
    { src: 'assets/img/scsp.png', alt: 'Special Competitive Studies Project', width: 597, height: 120 },
  ],



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

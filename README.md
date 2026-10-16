# China Dashboard

A static dashboard (no build step, no runtime dependencies) modelled on the
[U.S. Data Center Ecosystem Tracker](https://ntimbs.github.io/us-data-center-dashboard/): a **province map of China's
data-center inventory** with layer tabs for status, capacity, installed power, 2024 generation, electricity cost and
water, plus two secondary pages that compare **five-year plan targets with reported results** and catalogue the
**legislation** behind them. Designed to be published on GitHub Pages.

> **Location rule.** The inventory merges a licensed DataCenterMap export with public crawls. It is published at
> **province level only**: `site/data/facilities.json` holds no coordinates, addresses, cities or profile links, the
> build script strips them, the validator and the browser test both assert their absence, and the map draws one
> bubble per province. Map tabs are shown only for layers that have data (the U.S. tracker's hazard and
> opposition tabs are left out until a source exists).

## Run it

```bash
python3 -m http.server 8000 --directory site      # then open http://localhost:8000/
```

Opening `site/index.html` straight from disk will not work: browsers block `fetch()` and ES modules on `file://`.
The page tells you so if you try.

## Layout

```
site/                     the published site (this folder is what GitHub Pages serves)
  index.html              the map dashboard;  plan.html, legislation.html  the secondary pages
  assets/css/style.css    design tokens (light/dark), layout, components;  dashboard.css  the map page
  assets/js/lib/          pure logic + small UI helpers   <- unit-tested (inventory.js = map filtering/binning)
  assets/js/pages/        one module per page (dashboard.js, plan.js, legislation.js)
  data/                   meta.json, provinces.json, facilities.json, power_plants.json, power_lines.json,
                          plan_targets.json, plan_actuals.json, legislation.json
data_sources/             hand-transcribed official tables that feed provinces.json (see data_sources/README.md)
schemas/                  JSON Schema for every data file (the contract the build script must meet)
scripts/build_dashboard_data.py   builds the three map files from the EDWC research folder (see Data below)
scripts/build_power_lines.py      builds power_lines.json from the OpenStreetMap GeoPackage (see Data below)
scripts/validate_data.py  schema + cross-file checks (referential integrity, derived values, privacy rule, dates ...)
pipeline/                 data-gathering pipeline (stub: polite fetcher, source registry) - see pipeline/README.md
tests/js  tests/py  tests/browser   unit tests and a Playwright smoke test
.github/workflows/        validate.yml (PRs) and pages.yml (deploy on push to main)
```

## The map dashboard

Layout follows the U.S. tracker: filters on the left (search, project status, facility type, reported capacity,
inventory source; there is deliberately no CSV export, the inventory is view-only), KPI tiles, a tab
strip of map layers, a legend that also carries the source attribution for the active layer, a profile chart (donut
for the selection, ranked bars for province comparisons) and a detail panel on the right. The map is a plain SVG (Albers equal-area outlines pre-projected by the
build script), so there is no tile server, no map library and nothing loaded from a CDN.

There is no province dropdown: **clicking a province on the map focuses the dashboard on it.** The KPI tiles, the
sidebar counts and the profile card narrow to that province (on the Generation and Power tabs the card becomes its
power infrastructure profile, GEM units or installed capacity by technology; on the comparison tabs its bar is
highlighted, with its rank, even outside the top eight), and the Generation tab draws only its plant units. Other
provinces dim but keep their bubbles and stay clickable. Clicking the province again, clicking empty map, Close or
Reset returns to all of China; dragging the map never changes the focus.

| Tab | Province shade | Points / bubbles | Source |
|---|---|---|---|
| Status | facility count in the selection | one status wheel per province, sized by count | inventory |
| Capacity | known MW in the selection | bubble sized by known MW | inventory |
| Power | installed MW of GEM units (choose a technology) | pale count bubbles; transmission lines ≥250 kV | Global Energy Monitor; OpenStreetMap (ODbL) |
| Generation | 2024 generation (NBS yearbook 9-19) | GEM plant units by technology; transmission lines ≥250 kV | NBS + GEM; OpenStreetMap (ODbL) |
| Electricity cost | 1–10 kV industrial & commercial rate, May 2025 | pale count bubbles | China Briefing compilation (tier C) |
| Water scarcity | per-capita resources, use÷resources, totals, industrial use (2024) | pale count bubbles | MWR bulletin via NBS yearbook 8-8 / 8-9 |
| Policy | EDWC national-hub provinces | pale count bubbles | NDRC approvals; legislation topics in the chart |

The URL hash carries the active tab (`#view=cost`), so a view can be linked to.

## How a target's status is computed

`site/assets/js/lib/status.js` is the single source of truth. Three kinds of target:

| kind | meaning | status rule |
|---|---|---|
| `level` | reach a value relative to a baseline by a year | `progress = (latest - baseline) / (target - baseline)`, compared with the share of the baseline-to-target period that has elapsed |
| `threshold` | stay at or above (or below) a value, e.g. a grain-output floor | met or not at the latest year |
| `rate` | average annual rate over the plan period, e.g. GDP growth | average of reported years vs the target |

Statuses: **achieved**, **on track** (within 10 percentage points of the expected pace, `statusTolerance` in
`config.js`), **behind pace**, **missed** (a full-year figure for the target year falls short), **unresolved** (the
target year has passed, judged by `meta.as_of`, but no full-year figure for it has been published), **no data**,
**invalid** (the target definition cannot be evaluated; the reason is shown).

Two rules keep the scoring honest. An actual may carry an `as_of` date; anything other than 31 December is a
*partial-year* figure, which is drawn hollow, counts only the elapsed share of its year towards the expected pace,
can confirm an early achievement, but can never settle a deadline. And values reported *after* the target year are
plotted for context but never count towards meeting a dated target (a 2025 target is not achieved by a 2026 value).

Why `threshold` exists: "at least 650 Mt" with a 2020 baseline of 669 looks like a *decrease* if modelled as a level
target, and every good year would score as "behind". The validator rejects that mistake.

## Data

All data lives in `site/data/` and is checked by `python3 scripts/validate_data.py` (also run in CI; a failing
validation blocks deployment). Plan targets, actuals and legislation records carry `placeholder` / `verified` flags. Setting `meta.json` `data_status` to `"live"` makes the validator reject any placeholder or unverified
record. The dataset is currently `partial` (compiled 2026-10-04).

**Source rule.** Values come only from official primary sources — government documents, NBS/NHC/MOHRSS statistical
communiqués and bulletins, ministry briefings, 数字中国发展报告 — or from Xinhua / People's Daily reproductions of
them (tagged `medium`). Secondary estimates (CAICT white papers, trade press, academic papers) are never stored as
values; where they are the only figure in circulation they are mentioned in a `note`. Figures the source prints as a
floor or ceiling (超过 / 以上 / 不超过) carry `qualifier: "floor" | "ceiling" | "approx"` and are shown as ≥ / ≤ / ≈;
the status engine scores the printed value. No value is derived: five-year cumulative reductions are recorded only
when an official document prints them, never compounded from annual rates.

**Plan targets and actuals** (`plan_targets.json`, `plan_actuals.json`): every target carries a `theme` that places it in
the data-center story (compute · energy/PUE/carbon · digital demand · AI/innovation · macro context); the `themes`
block names the map tab and legislation topics each theme links to, and the plan page is grouped by it. The
headline indicator tables of the 14th
(2021–2025) and 15th (2026–2030) Five-Year Plan outlines (the 15th read from the NDRC PDF, whose table is text; the
gov.cn copy is an image), the 14th FYP Digital Economy plan, the four data-center / computing-power action plans
(MIIT 2021, MIIT 2023, NDRC EDWC opinions 2023, green data-center plan 2024), the ICT industry 15th FYP (MIIT PDF,
工信部规〔2026〕188号) and the MOST national AI pilot-zone guideline (国科发规〔2019〕298号; 17 zones by Dec 2021 vs
"about 20" by 2023, Xinhua count). Each actual carries `source.url`, a verbatim `quote`, `retrieved` and `confidence`. Target
`note` fields record modelling choices and definition changes — read them before quoting a status: energy intensity
switched to an adjusted basis in 2023; computing power is FP32 to 2024 and FP16 智能算力 from 2025; the national PUE
series changed population in 2025; 5G 普及率 is per 100 population, not a share of mobile users. Known gaps with no
official figure: total FP32 EFLOPS and all-facility PUE for end-2025, 智能算力占比, 先进存力占比, industrial-internet
platform penetration, the hub green-power share, and a point value for the pension participation rate (floor only).

**Legislation** (`legislation.json`): 94 national laws, regulations, departmental rules, standards, plans and policy
notices on the digital economy — data governance and security, cybersecurity, AI, platform economy, e-commerce,
fintech, digital government, computing power and data-center energy use — with document numbers,
adoption/publication/effective dates and a short summary. `verified: true` (93 of 94) means the dates were read from a
government page; the one exception (the 2018 等级保护条例 draft) says why in `note`. `date_precision: month` means
the issuing day is not published; the record then carries the first of the month and the release date in
`date_published`.

**Province outlines and indicators** (`provinces.json`, built by `scripts/build_dashboard_data.py`): 31 provinces +
Hong Kong and Macau, with SVG paths, a label anchor, the East Data West Computing hub each belongs to, and these
indicators: 2024 generation and hydro generation (NBS yearbook table 9-19), 2020/2024 electricity consumption (9-14),
2024 water resources and per-capita resources (8-8), 2024 water use incl. industrial (8-9), the May 2025 1–10 kV
industrial-and-commercial tariff (China Briefing compilation, tier C — Jilin, Gansu, Tibet and the SARs are not in
that source and Inner Mongolia shows the eastern grid only), and installed MW by technology summed from the GEM
units inside each outline. Two values are computed and labelled as such in the UI: generation − consumption, and
water use ÷ water resources. The transcribed source tables live in `data_sources/` with their URLs; the yearbook
publishes them as images, so they were typed by hand and should be spot-checked before citation.

**Facilities** (`facilities.json`): 833 records merged from the DataCenterMap export (licensed; 459), the baxtel
crawl (108), the DCKB sample (11), the two UVA geojsons (hyperscale 36, western 44) and 307 datacenters.com listings
(see below), de-duplicated on source id, normalised name, and proximity (unnamed records within 400 m of a named one). Each record keeps name, operator,
province, status (Operating / Development / Proposed / Unknown), facility type, reported MW and capacity class,
PUE and online year where the source had them, and the list of sources. Twenty DataCenterMap rows have no
coordinates in the export and were placed by their market name. Three rows fell outside every outline (one in
Taiwan, which the map does not cover). Run with `--publish-names false` to anonymise names and operators.

The datacenters.com rows (`data_sources/datacenters_com_sites.csv`, source key `dccom`) are China listings that were
compared with this inventory on 15 Oct 2026 and approved one by one: listings already in the inventory, resellers and
cloud regions, and uncertain matches were left out. The directory gives no status, so these records are entered as
Operating with facility type Unknown and no MW; they carry no coordinates and are placed by province. Where the
inventory holds only one city-level record for an operator (for example "China Telecom Shanghai") and the directory
names several buildings, at most one of those buildings can be that record, so such cities may be over-counted by one.

**Power plants** (`power_plants.json`): 16,284 Global Energy Monitor units (coal, hydro, wind, solar, nuclear,
bioenergy) projected to the view box with their province. Status was filtered to operating upstream in the IGARSS
workflow; several units of one plant share a point. Gas, oil and waste plants came from OpenStreetMap in that
workflow with capacities in kW, so they are excluded here.

**Transmission lines** (`power_lines.json`, built by `scripts/build_power_lines.py`): OpenStreetMap `power=line`
ways from the November 2025 China extract (`_SCSP_export_large/EDWC_China_GIS/04_grid_transmission_osm/`), kept when
`max_voltage` is at least 250 kV. China has no voltage class between 220 and 330 kV, so this means 330 kV and up
(330/500/750 kV AC, ±400 to ±1100 kV DC, 1000 kV UHV AC); every 220 kV line is left out. Four classes are drawn, by
colour and width: 330–400 kV, 500 kV, 660–750 kV and UHV ≥800 kV. Result: 22,284 ways, about 292,600 km of mapped
route (500 kV 183,800 · UHV 42,600 · 330–400 kV 35,200 · 660–750 kV 31,100). Read the km as a lower bound on route
length, not as official circuit length: 30% of OSM power lines carry no voltage tag and are dropped, and parallel
lines mapped as separate ways count separately. Ways tagged construction or disused (93) are excluded. Lines are
simplified to about 1 km, split at province borders (each segment goes to the province holding its midpoint) and
dimmed outside a focused province; the paths never take pointer events, so province clicks pass through them.
**The GeoPackage stores every power line twice** (22,376 OSM ids appear twice with identical tags and geometry, and
the same is true of `01_working/data/working/osm_filtered.gpkg`); the build de-duplicates by OSM id, but any
analysis that sums lengths straight from either file double-counts. OSM data is © OpenStreetMap contributors under
the ODbL; `power_lines.json` is a derived database under the same licence, and the map legend carries the credit.

Rebuild the map files from the EDWC folder (this repository sits inside it):

    python3 scripts/build_dashboard_data.py --edwc-root .. --check
    python3 scripts/build_power_lines.py --edwc-root ..            # after provinces.json; --min-kv 220 to add 220 kV

## Deploy to GitHub Pages

Live site: **https://giasmith.github.io/china-dashboard/** (repository `giasmith/china-dashboard`, public).

First publish, from this folder on your Mac:

```bash
bash scripts/publish_to_github.sh            # or: DRY_RUN=1 bash scripts/publish_to_github.sh to rehearse
```

The script installs the two workflows into `.github/workflows/`, validates the data, makes the first commit (using
GitHub's no-reply address if you have no git email set), refuses to commit the private project inventory or any
`.env`, then creates the repo and pushes — with the GitHub CLI if it is installed and logged in, otherwise after
asking you to create the empty repo at github.com/new. If the first deploy job reports that Pages is not enabled,
set **Settings → Pages → Build and deployment → Source: GitHub Actions** and re-run the workflow.

After that, every push to `main` re-validates the data and republishes `site/`. All asset and data URLs are
relative, so the site works under the `/china-dashboard/` sub-path.

## Tests

```bash
pip install -r requirements-dev.txt
python3 scripts/validate_data.py
python3 -m unittest discover -s tests/py -v
python3 -m unittest discover -s pipeline/tests -v
node scripts/check_js.mjs && node --test
python3 -m playwright install chromium     # once
python3 -m http.server 8000 --directory site & python3 tests/browser/smoke.py
```

The browser smoke test loads every page at desktop and phone widths in light and dark mode, and fails on console
errors, horizontal scroll, or stray `null`/`undefined`/`NaN` text. On the map it switches tabs, filters, focuses a
province by clicking it (also with real mouse input, plus a drag that must not change the focus), opens a facility,
and asserts that there is no export control and no coordinate or profile link reaches the browser.

## Before you publish (checklist)

- [ ] Confirm that the DataCenterMap licence allows publishing facility names, operators and MW at province level; if not, rebuild with `--publish-names false`.
- [ ] Spot-check the hand-transcribed yearbook tables in `data_sources/` against the source images.
- [ ] Replace the China Briefing tariff compilation with the provincial 代理购电 notices (and fill Jilin, Gansu, Tibet, 蒙西).
- [ ] Re-check the remaining `medium`-confidence actuals (Xinhua / People's Daily reproductions) against the ministry pages when they become reachable.
- [ ] Add year-end 2025 figures if MIIT/NDA publish them (FP32 total compute, all-facility PUE, storage) so the `unresolved` 2025 targets resolve; add the NBS final 2025 digital-economy share (due ~Dec 2026).
- [ ] Set `meta.json` `data_status` to `live` only once every record is verified (the validator enforces this).
- [ ] Set a real contact in the pipeline's `DEFAULT_UA`, and complete the access review for each source in
      `pipeline/config/sources.yml` before enabling it.

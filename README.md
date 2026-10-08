# China Dashboard

A static dashboard (no build step, no runtime dependencies) that compares **Chinese five-year plan targets with
reported results**, catalogues the **legislation and policy documents** behind them, and maps the
**East Data West Computing** hubs and clusters. Designed to be published on GitHub Pages.

> **Status: scaffold.** The plan targets, actuals and cluster metrics shipped here are **synthetic placeholders**, and
> the legislation records are **unverified**. The site says so in a banner. Do not cite anything until the checklist at
> the bottom is done.

## Run it

```bash
python3 -m http.server 8000 --directory site      # then open http://localhost:8000/
```

Opening `site/index.html` straight from disk will not work: browsers block `fetch()` and ES modules on `file://`.
The page tells you so if you try.

## Layout

```
site/                     the published site (this folder is what GitHub Pages serves)
  index.html plan.html legislation.html map.html
  assets/css/style.css    design tokens (light/dark), layout, components
  assets/js/lib/          pure logic + small UI helpers   <- unit-tested
  assets/js/pages/        one module per page
  data/                   meta.json, plan_targets.json, plan_actuals.json, legislation.json, edwc_hubs.geojson
schemas/                  JSON Schema for every data file (the contract the pipeline must meet)
scripts/validate_data.py  schema + cross-file checks (referential integrity, coordinate order, date logic ...)
pipeline/                 data-gathering pipeline (stub: polite fetcher, source registry) - see pipeline/README.md
tests/js  tests/py  tests/browser   unit tests and a Playwright smoke test
.github/workflows/        validate.yml (PRs) and pages.yml (deploy on push to main)
```

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
validation blocks deployment). Every record has a `placeholder` flag; legislation, clusters and projects also have
`verified`. Setting `meta.json` `data_status` to `"live"` makes the validator reject any placeholder or unverified
record. The dataset is currently `partial` (compiled 2026-10-04).

**Source rule.** Values come only from official primary sources — government documents, NBS/NHC/MOHRSS statistical
communiqués and bulletins, ministry briefings, 数字中国发展报告 — or from Xinhua / People's Daily reproductions of
them (tagged `medium`). Secondary estimates (CAICT white papers, trade press, academic papers) are never stored as
values; where they are the only figure in circulation they are mentioned in a `note`. Figures the source prints as a
floor or ceiling (超过 / 以上 / 不超过) carry `qualifier: "floor" | "ceiling" | "approx"` and are shown as ≥ / ≤ / ≈;
the status engine scores the printed value. No value is derived: five-year cumulative reductions are recorded only
when an official document prints them, never compounded from annual rates.

**Plan targets and actuals** (`plan_targets.json`, `plan_actuals.json`): the headline indicator tables of the 14th
(2021–2025) and 15th (2026–2030) Five-Year Plan outlines (the 15th read from the NDRC PDF, whose table is text; the
gov.cn copy is an image), the 14th FYP Digital Economy plan, the four data-center / computing-power action plans
(MIIT 2021, MIIT 2023, NDRC EDWC opinions 2023, green data-center plan 2024) and the ICT industry 15th FYP (MIIT PDF,
工信部规〔2026〕188号). Each actual carries `source.url`, a verbatim `quote`, `retrieved` and `confidence`. Target
`note` fields record modelling choices and definition changes — read them before quoting a status: energy intensity
switched to an adjusted basis in 2023; computing power is FP32 to 2024 and FP16 智能算力 from 2025; the national PUE
series changed population in 2025; 5G 普及率 is per 100 population, not a share of mobile users. Known gaps with no
official figure: total FP32 EFLOPS and all-facility PUE for end-2025, 智能算力占比, 先进存力占比, industrial-internet
platform penetration, the hub green-power share, and a point value for the pension participation rate (floor only).

**Legislation** (`legislation.json`): 88 national laws, regulations, departmental rules, standards, plans and policy
notices on the digital economy — data governance and security, cybersecurity, AI, platform economy, e-commerce,
fintech, digital government, computing power and data-center energy use — with document numbers,
adoption/publication/effective dates and a short summary. `verified: true` (87 of 88) means the dates were read from a
government page; the one exception (the 2018 等级保护条例 draft) says why in `note`. `date_precision: month` means
the issuing day is not published; the record then carries the first of the month and the release date in
`date_published`.

**EDWC clusters** (`edwc_hubs.geojson`): the 8 national hubs / 10 national clusters as approved by the NDRC letters
of 2021-12-20 and 2022-02-07 (document numbers and URLs on each feature), with the official start-up-zone wording.
The 和林格尔 cluster has two official sites and is drawn as two points (`part_of`). Coordinates are start-zone
centroids, not facility locations. Rack, EFLOPS and PUE figures are kept only when an official body published them
(currently 张家口, 芜湖, 贵阳贵安); each names its scope, date and source. Trade-press figures for the other clusters
are quoted in `note` as unused context.

**Project inventory** (`edwc_projects.json`, built by `scripts/convert_projects.py` from the owner's spreadsheet
`EDWC_11.11.xlsx`): 94 announced data-center projects and 4 park-level rows across the 10 clusters, with company,
planned investment (亿元, as announced — not audited spending), source link and, for 25 of them, coordinates. The
converter never cleans silently: every oddity becomes a `flags` entry (`shared_centroid`, `no_source`,
`company_mismatch`, `outside_start_zone`, …).

**This layer is switched off on the public site** until the spreadsheet's licence is confirmed: the generated file is
git-ignored, `CONFIG.showProjectLayer` is `false`, and the map neither requests nor mentions it. Tests use a
synthetic fixture (`tests/fixtures/edwc_projects.sample.json`). To publish it later: confirm the licence, run the
converter, set `showProjectLayer: true` in `site/assets/js/config.js`, remove the `site/data/edwc_projects.json`
line from `.gitignore`, and commit.

    python3 scripts/convert_projects.py path/to/EDWC_11.11.xlsx --compiled 2024-11-11

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
errors, horizontal scroll, or stray `null`/`undefined`/`NaN` text. Where the Leaflet CDN is unreachable it exercises
the SVG fallback; its Leaflet code path is tested against a stub of the Leaflet API.

## Before you publish (checklist)

- [ ] Confirm the licence / ownership of `EDWC_11.11.xlsx` before switching the project layer on (see Data → Project inventory).
- [ ] Re-check the remaining `medium`-confidence actuals (Xinhua / People's Daily reproductions) against the ministry pages when they become reachable.
- [ ] Add year-end 2025 figures if MIIT/NDA publish them (FP32 total compute, all-facility PUE, storage) so the `unresolved` 2025 targets resolve; add the NBS final 2025 digital-economy share (due ~Dec 2026).
- [ ] Cluster-level official metrics for 和林格尔, 庆阳, 中卫, 天府, 重庆 and the 长三角 demonstration zone: the provincial portals were unreachable from the research environment; check them from a normal browser.
- [ ] Set `meta.json` `data_status` to `live` only once every record is verified (the validator enforces this).
- [ ] **Basemap:** `config.js` uses OpenStreetMap's public tiles, which are for light use. Review how the basemap draws
      boundaries, and switch providers if needed.
- [ ] **Leaflet** is loaded from cdnjs in `map.html`. For stricter supply-chain control, vendor it into
      `site/assets/vendor/` and add Subresource Integrity attributes.
- [ ] Set a real contact in the pipeline's `DEFAULT_UA`, and complete the access review for each source in
      `pipeline/config/sources.yml` before enabling it.

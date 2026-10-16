# Hand-transcribed source tables

These CSVs feed `scripts/build_dashboard_data.py` → `site/data/provinces.json`. Each was transcribed on
2026-10-12 from a table that the publisher only offers as an image, so values should be spot-checked against the
source before they are cited. Units are in the column names.

| File | Source | Tier |
|---|---|---|
| `nbs_2025_yearbook_9-19_generation_2024.csv` | 中国统计年鉴 2025, 表 9-19 分地区主要能源产品产量 (发电量, #水电), https://www.stats.gov.cn/sj/ndsj/2025/html/C09-19.jpg | A |
| `nbs_2025_yearbook_9-14_consumption.csv` | 中国统计年鉴 2025, 表 9-14 分地区用电量 (2020, 2023, 2024; CEC data), https://www.stats.gov.cn/sj/ndsj/2025/html/C09-14.jpg | A |
| `nbs_2025_yearbook_8-8_water_resources_2024.csv` | 中国统计年鉴 2025, 表 8-8 水资源情况 (from 水利部《中国水资源公报》), https://www.stats.gov.cn/sj/ndsj/2025/html/C08-08.jpg | A |
| `nbs_2025_yearbook_8-9_water_use_2024.csv` | 中国统计年鉴 2025, 表 8-9 供水用水情况, https://www.stats.gov.cn/sj/ndsj/2025/html/C08-09.jpg | A |
| `tariff_china_briefing_may2025.csv` | China Briefing, "China's Industrial Power Rates 2025" (1–10 kV general industrial & commercial, non-TOU, as of May 2025), https://www.china-briefing.com/news/chinas-industrial-power-rates-category-electricity-usage-region-classification/ | C |
| `baxtel_site_names.csv` | Baxtel site listings (names, operators, Baxtel type and stages) for baxtel crawl rows, which carry no names; transcribed by Gia from baxtel.com on 2026-10-15 (Guizhou). `match` pairs a row with the inventory record from another source that is the same site ("new" = a site of its own). Used by `build_dashboard_data.py`: Baxtel's name and operator replace the other sources' for these sites; type, status and MW stay as merged. | C |
| `datacenters_com_sites.csv` | datacenters.com China directory listings approved by Gia on 2026-10-15 after a province-by-province comparison with the inventory (645 listings reviewed). Columns: hashed `dccom_id`, name, operator, province, status, optional facility type and explicit `match`. No addresses, cities, coordinates or page links; the map from ids back to directory pages is kept outside the repo. | C |
| `facility_details.csv` | Per-facility figures that no inventory source carries (standard racks, computing power in PFLOPS, AI accelerator cards, building area, PUE), keyed by facility id with the facility name as a check. Every row states its `basis` (e.g. vendor-reported, first-phase design) and cites its sources in words; no links or locations. Shown in the facility profile on the map. Added 2026-10-16 for China Unicom (Xinjiang) Cloud Data Center and the China Mobile–Alibaba Cloud Hami Yiwu Intelligent Computing Center. | C |

Notes

- Table 8-8: from 2024 the fourth column changed meaning (地下水与地表水资源不重复量); only total, surface,
  groundwater and per-capita are used.
- Table 9-19 regional rows are 2024 full-caliber generation (the national row reads 100,868.81 亿kWh); they are
  higher than the 规模以上 figures quoted in trade press.
- The tariff file is a secondary compilation. It lacks Jilin, Gansu, Tibet, Hong Kong and Macau; the Inner Mongolia
  row is the eastern (State Grid) network only. Replace with the monthly provincial 代理购电 price notices when
  those can be fetched.
- `baxtel_site_names.csv`: the crawl rows were paired with the listing by Baxtel type and stage (the one Guizhou row
  with a Construction stage is NetEase) and, for the two Carrier rows, by distance to the China Telecom and China
  Unicom points. The 400 m proximity merge now takes the nearest listed facility, not the first one found; under the
  old rule the China Unicom row had been folded into China Mobile. The eighth Guizhou crawl row (Fintech, under
  construction, Guiyang city) is not in the listing and stays unnamed.
- `datacenters_com_sites.csv`: of 645 listings, rows already in the inventory, resellers/brokers and cloud regions
  were skipped; 143 uncertain rows and 13 more found on a second look (likely duplicates of inventory records, e.g.
  "Xi'an IDC" vs "China Telecom Xian", and Chindata's ChinaNorth codes) are held for review. Status is Operating by
  decision (the directory lists existing sites), type Unknown. Princeton Digital LF2 is filed under Hebei (LF =
  Langfang) although the directory gives the same Mianyang address as LF1. The directory is a commercial site; check
  its terms before reusing the data elsewhere.
- `facility_details.csv`: the China Unicom (Xinjiang) figures (18,876 racks, 8,192 PFLOPS, PUE 1.3) come only from an
  equipment vendor's case study; the 2017 announcement planned over 10,000 racks. For the Hami Yiwu centre, Xinhua and
  Chongqing Daily (11 Sep 2026) report construction starting 9 Sep 2026 with service planned for June 2027; the
  directory text that supplied the 100,000-card and 26,090 m² figures gives 8 Dec 2025 as the groundbreaking, which
  matches a start ceremony reported by the Chongqing government on 10 Dec 2025. The same directory row was corrected
  in `datacenters_com_sites.csv` (truncated name, operator, status Development).

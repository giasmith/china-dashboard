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

Notes

- Table 8-8: from 2024 the fourth column changed meaning (地下水与地表水资源不重复量); only total, surface,
  groundwater and per-capita are used.
- Table 9-19 regional rows are 2024 full-caliber generation (the national row reads 100,868.81 亿kWh); they are
  higher than the 规模以上 figures quoted in trade press.
- The tariff file is a secondary compilation. It lacks Jilin, Gansu, Tibet, Hong Kong and Macau; the Inner Mongolia
  row is the eastern (State Grid) network only. Replace with the monthly provincial 代理购电 price notices when
  those can be fetched.

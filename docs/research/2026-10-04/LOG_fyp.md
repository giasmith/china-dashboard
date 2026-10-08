# LOG_fyp — 15th FYP table verification and 14th-FYP / digital-economy actuals

Date: 2026-10-04. Rules followed: RULES.md (official primary sources only; no chaining; exact quotes; definition changes flagged).
Tooling notes: direct `curl` to *.gov.cn hosts is blocked by the egress proxy (CONNECT 403), so everything was fetched through WebFetch. The WebSearch budget for this session was exhausted mid-task (after the non-fossil 2021 search); the remaining items were reached by navigating ministry index pages and known URL patterns. WebFetch truncates very long HTML pages (the gov.cn / Xinhua / 12371 full texts of the outline were cut before 专栏1) and rejects PDFs above ~30 MB (the 2023 中国生态环境状况公报).

## PART 1 — 专栏1 "十五五"时期经济社会发展主要指标

Source used: NDRC PDF of the adopted outline, https://www.ndrc.gov.cn/fggz/fzzlgh/gjfzgh/202603/U020260317369114704096.pdf — the table is on p.10 and is text-extractable. Fetched three times (raw-text dump, cell-by-cell re-check, full-text keyword search). Both readings agree on every cell. Header: 类别 | 指标 | 2025年 | 2030年 | 年均/累计 | 属性. Notes under the table: ①〔〕为5年累计数。②带*的为2024年数据。③全社会研发经费投入增速按不变价格计算。④粮食综合生产能力指可以稳定达到的粮食产出能力。

Cross-checks attempted (none yielded table text): gov.cn HTML https://www.gov.cn/yaowen/liebiao/202603/content_7062633.htm (table is an image; body text confirms 二氧化碳排放降低17%, 人均预期寿命提高到80岁, 森林覆盖率达到25.8%, 粮食综合生产能力1.45万亿斤左右, 能源综合生产能力58亿吨标准煤); Beijing copy https://wb.beijing.gov.cn/home/gjjwzx/xxzl/202603/t20260316_4557729.html (truncated); Xinhua full text https://www.news.cn/politics/20260313/085af5de5a4b4268aa7d87d90817df2f/c.html (truncated); https://www.12371.cn/2026/03/13/ARTI1773410307876581.shtml (truncated); https://www.mee.gov.cn/zcwj/zclcfh/202603/t20260308_1146021.shtml (Xinhua feature on the draft, 2026-03-08, no table).

Key findings:
- 20 numbered rows (21 lines: row 10 has sub-rows 执业医师数 / 注册护士数). The dataset's 18 fyp15_* targets transcribe every numeric cell correctly (baseline, target, 约束性/预期性, unit). The three rows not in the dataset (GDP增长, 全员劳动生产率增长, 居民人均可支配收入增长) carry qualitative targets.
- 单位GDP能耗: there is NO energy-intensity row in the table (and a full-text search of the PDF for 能耗/能源消耗/能耗强度 returned nothing — caveat: WebFetch may not have processed the whole PDF). So the table does not print a cumulative 2021–2025 figure for 单位GDP能耗.
- 单位GDP二氧化碳排放降低: the 2025 column prints 〔17.7〕 and the 年均/累计 column prints 〔17〕. The dataset's attribution of 17.7 to this table is CONFIRMED verbatim: "14.单位GDP二氧化碳排放降低（%） 〔17.7〕 — 〔17〕 约束性".
- Values in the 年均/累计 column (＞7, ＜5.5, 〔6〕, 〔17〕) are period averages/ceilings/cumulatives, not 2030 levels — relevant to fyp15_rd_growth and fyp15_unemployment, which the dataset stores under target.year 2030.
- fyp15_physicians: the table's 2025 value 3.1 is confirmed, but the NHC 2025 bulletin (released 2026-08-28) gives 每千人口执业医师 3.25 (and 3.04 for 2024) — the plan column was a preliminary estimate. Nurses 4.3 vs NHC 4.32 (consistent). Life expectancy 79.25 = NHC final. Forest 25.1* = white paper 25.09 (2024). Energy capacity 51.3 = NBS 一次能源生产总量 51.3亿吨标准煤.

## PART 2 — official actuals

### (a) fyp14_physicians
- NBS 2025 communiqué https://www.stats.gov.cn/sj/zxfb/202602/t20260228_1962662.html: "卫生技术人员1340万人，其中执业医师和执业助理医师529万人，注册护士603万人。" and "年末全国人口140489万人…". Headcount only.
- NHC 2025 bulletin (nhc.gov.cn PDF, 2026-08-28): https://www.nhc.gov.cn/guihuaxxs/c100133/202608/1b45959033524f48867d90e822be5394/files/2025年我国卫生健康事业发展统计公报-20260828105402342.pdf — "2025年，每千人口执业（助理）医师3.78人，每千人口执业医师3.25人，每千人口注册护士4.32人"; 表2 gives 2024/2025 columns (3.61/3.78; 3.04/3.25; 4.16/4.32; headcounts 508.2/530.6, 428.0/456.5, 585.5/606.2). Direct ratio → no computation needed. Found via Tier-C leads (gmw.cn 2026-08-28) then the NHC PDF.
- NHC 2024 bulletin PDF: https://www.nhc.gov.cn/guihuaxxs/c100133/202512/f1c3a3c617484a27a1a26a468afbaeee/files/2024年我国卫生健康事业发展统计公报-20251201161542231.pdf (3.61; 2023 column 3.40). gov.cn People's Daily report of it: https://www.gov.cn/lianbo/bumen/202512/content_7050152.htm.
- NHC 2023 bulletin (gov.cn PDF): https://www.gov.cn/lianbo/bumen/202408/P020240829729470466631.pdf (3.40; 2022 column 3.15; 执业医师 401.0万).
- NHC 2022 bulletin (gov.cn PDF): https://www.gov.cn/lianbo/bumen/202310/P020231012649046990925.pdf (3.15; 2021 column 3.04; 托位 2.57).
- NHC 2021 bulletin: nhc.gov.cn page http://www.nhc.gov.cn/guihuaxxs/s3586s/202207/51b55216c2154332a660157abf28b09d.shtml → HTTP 412; gov.cn guess content_5700670 → 404; nwccw.gov.cn copy → 403; wjw.chengde.gov.cn → robots timeout; nmg.gov.cn PDF P020220429384608387292.pdf was a different document (Inner Mongolia plan). 2021 value taken from the 2022 bulletin's table instead.
- NBS 75-year health report https://www.stats.gov.cn/sj/sjjd/202409/t20240925_1956696.html confirms 2023 3.40 and life expectancy 2021 78.2 / 2023 78.6.
- Outcome: 2021 3.04, 2022 3.15, 2023 3.40, 2024 3.61, 2025 3.78 (target 3.2 exceeded).

### (b) fyp14_pension_coverage
- MOHRSS: https://www.mohrss.gov.cn/SYrlzyhshbzb/zwgk/szrs/ and …/szrs/tjgb/ return empty bodies to WebFetch; curl 403. 2025年度人社统计公报 exists (Tier-C article 163.com 2026-08-03 reports it: 职工基本养老保险覆盖54672万人, 城乡居民52919万人) but no official copy reached.
- gov.cn SCIO 2025-09-26 https://www.gov.cn/lianbo/bumen/202509/content_7042477.htm: participants 10.72亿 (end-Aug 2025), no rate. Xinhua same day https://www.news.cn/politics/20250926/761621a07cb04d03bae03335e1063bb7/c.html and …/6daf590523dc46c0b9dbf220f6117769/c.html: "参保率从91%提高到95%以上" (王晓萍).
- NDRC transcript 2025-07-09 https://www.ndrc.gov.cn/fzggw/wld/zsj/zyhd/202507/t20250709_1399091.html: "义务教育巩固率和基本养老保险、基本医疗保险参保率都在95%以上".
- NBS 十四五成就系列报告之一 https://www.stats.gov.cn/sj/sjjd/202606/t20260602_1963864.html: "“十四五”以来，基本养老保险参保率超过95%". Recorded as a FLOOR (95, medium).
- gmw.cn 2026-08-01 (2025年度国家老龄事业发展公报): "全国参加基本养老保险超10亿人" — counts only.
- 2026 GWR gazette https://www.gov.cn/gongbao/2026/issue_12646/202603/content_7064134.html: no rate.

### (c) fyp14_nursery_places
- 2021: NBS 2021年《中国儿童发展纲要》统计监测报告 https://www.stats.gov.cn/sj/zxfb/202304/t20230417_1938688.html — "2021年底全国每千人口托位数2.03个". Corroboration: NHC presser 2022-08-17 via 中新网 https://www.chinanews.com.cn/gn/2022/08-17/9829356.shtml (Tier C, note only).
- 2022: NHC 2022 bulletin PDF (above) "全国千人口托位数2.57个"; NBS 2022 monitoring report https://www.stats.gov.cn/sj/zxfb/202312/t20231229_1946067.html same.
- 2023: NBS 2023 monitoring report https://www.stats.gov.cn/sj/zxfb/202501/t20250124_1958440.html "全国每千人口拥有3岁以下婴幼儿托位数3.38个"; People's Daily on 国务院 report to NPCSC https://paper.people.com.cn/rmrb/html/2024-09/12/nw.D110000renmrb_20240912_1-04.htm (3.38); jiemian.com (Tier C) only as lead; gov.cn content_6977540 was an unrelated State Council meeting.
- 2024: NHC 2024 bulletin PDF "每千人口3岁以下婴幼儿托位数达到4.08个".
- 2025: NHC 2025 bulletin PDF "2025年末全国每千人口拥有3岁以下婴幼儿托位数达到4.73个…托位总数665.7万个". Target 4.5 exceeded.

### (d) fyp14_life_expectancy
- 2021 78.2: NBS 75-year report (above). 2022: not published in the NHC 2022 bulletin; no official value found. 2024 79.0: NHC 2024 bulletin PDF; also NBS 社会民生统计报告 https://www.stats.gov.cn/sj/zxfbhjd/202509/t20250928_1961404.html. 2025 79.25: NHC 2025 bulletin PDF (replaces the plan-table source) — also in the 2026 GWR gazette.

### (e) fyp14_energy_intensity
- Annual communiqués: 2021 https://www.stats.gov.cn/sj/zxfb/202302/t20230203_1901393.html (−2.7%, 注 按2020年价格计算); 2022 https://www.stats.gov.cn/sj/zxfb/202302/t20230228_1919011.html (−0.1%); 2023 https://www.stats.gov.cn/sj/zxfb/202402/t20240228_1947915.html ("初步测算，扣除原料用能和非化石能源消费量后…下降0.5%" — definition change starts here); 2024 https://www.stats.gov.cn/sj/zxfb/202502/t20250228_1958817.html ("扣除原料用能和非化石能源消费量后…下降3.8%"); 2025 (above) ("初步测算，扣除原料用能和非化石能源消费量后…下降5.1%").
- Official cumulative: NBS 十四五成就系列报告之十四 https://www.stats.gov.cn/sj/zxfbhjd/202606/t20260604_1963892.html — "2021—2025年，扣除原料用能和非化石能源消费量后，全国万元国内生产总值能耗累计降低16.1%，年均下降3.0%，超额完成“十四五”累计降低13.5%的约束性目标". Replaces the aisixiang.com (ERI author) source, which had the same number but no official standing (https://www.aisixiang.com/data/179429.html, checked: it cites only "统计公报显示"). Four-year cumulative −11.6%: NDRC transcript 2025-07-09 (above) and white paper 2025-11-08 (below); gmw.cn https://economy.gmw.cn/2025-07/09/content_38143279.htm and Xinhua https://www.news.cn/politics/20250709/0e171682f65f473793549da969842f38/c.html were the leads. 2026 GWR: only the annual "单位国内生产总值能耗降低5.1%". The 2024 GWR https://www.gov.cn/yaowen/liebiao/202403/content_6939153.htm: "单位国内生产总值能耗降低2.5%左右" (2023 target, not used).

### (f) fyp14_co2_intensity
- Annual: 2021 −3.8%, 2022 −0.8%, 2023 与上年持平, 2024 −3.4%, 2025 −5.0% (same communiqués). Cumulative: only the 15th FYP table 〔17.7〕 (NDRC PDF p.10). MEE 2022 NDC progress report (p.6) adds 2021 vs 2005 −50.8%; MEE 2023-10-27 presser adds 2022 vs 2005 "超过51%". No NBS/MEE 2021–2025 cumulative sentence found.

### (g) fyp14_nonfossil_share
- 2021 16.6: MEE 中国落实国家自主贡献目标进展报告（2022） https://www.mee.gov.cn/ywgz/ydqhbh/qhbhlf/202211/W020221111763716523691.pdf p.13.
- 2022 17.5: MEE October 2023 regular presser transcript https://www.mee.gov.cn/ywdt/xwfb/202310/t20231027_1044184.shtml (夏应显). Reached via MEE news archive page https://www.mee.gov.cn/ywdt/xwfb/index_33.shtml.
- 2023 17.9: MEE November 2024 presser transcript https://www.mee.gov.cn/ywdt/xwfb/202411/t20241106_1093622.shtml (via index_22/index_23).
- 2024 19.8 and 2020 16.0: white paper 《碳达峰碳中和的中国行动》 full text on mee.gov.cn https://www.mee.gov.cn/ywgz/ydqhbh/qhbhlf/202511/t20251108_1132414.shtml (index https://www.mee.gov.cn/ywgz/ydqhbh/qhbhlf/).
- 2025 21.7: NBS report No.14 (above) and NBS report No.1; 2026 GWR gazette.
- Dead ends: 《中国的能源转型》白皮书 https://www.gov.cn/zhengce/202408/content_6971115.htm and NEA interpretation https://www.gov.cn/zhengce/202408/content_6971349.htm give only 清洁能源 26.4% (2023); NBS 十八大以来 energy report https://www.stats.gov.cn/zt_18555/zthd/lhfw/2023/fjxsd/202302/t20230227_1918909.html has no share; China Statistical Yearbook 2024 https://www.stats.gov.cn/sj/ndsj/2024/indexch.htm is frame-based and tables are images (C09-02.jpg not readable).

### (h) fyp14_air_quality_days
- 2023 85.5 (direct): https://www.mee.gov.cn/ywdt/xwfb/202401/t20240125_1064784.shtml ("平均空气质量优良天数比例为85.5%，扣除沙尘异常超标天后，实际为86.8%"). Found by paging the MEE news archive (index_31). The 2023 公报 PDF https://www.mee.gov.cn/hjzl/sthjzk/zghjzkgb/202406/P020240604551536165161.pdf exceeded the fetch size limit (公报 index: https://www.mee.gov.cn/hjzl/sthjzk/zghjzkgb/). The monthly 城市空气质量报告 PDF for Dec 2023 (https://www.mee.gov.cn/hjzl/dqhj/cskqzlzkyb/202401/W020240125537152570501.pdf) covers December only.
- Upgrades: 2021 https://www.mee.gov.cn/ywdt/xwfb/202201/t20220131_968703.shtml (87.5%); 2022 https://www.mee.gov.cn/ywdt/xwfb/202301/t20230128_1014006.shtml (86.5%). Archive pages visited: index_40, index_28, index_32, index_31, index_52, index_33, index_23, index_22; monthly-report listing https://www.mee.gov.cn/hjzl/dqhj/cskqzlzkyb/ (+index_1, index_2).

### (i) fyp14_forest_cover
- 2024 25.09: white paper on mee.gov.cn (above) "2024年，森林覆盖率达25.09%，森林蓄积量达209.88亿立方米" — replaces the plan-table 25.1.
- 2022 / 2025: forestry.gov.cn 国土绿化公报 column https://www.forestry.gov.cn/c/www/gtlhgb.jhtml lists only the 2020 bulletin (https://www.forestry.gov.cn/c/www/gtlhgb/146618.jhtml); home page, 森林资源 page https://www.forestry.gov.cn/slzy.jhtml and 政府信息公开 https://www.forestry.gov.cn/zfxxgk.jhtml give no 公报 links. Search budget exhausted before a gov.cn copy of the 2022/2025 公报 could be found. Floors only for 2025 (GWR "25%以上"; NBS "超25%"). Not found.

### (j) fyp14_digital_core_share / de14_core_share 2025
- 2026 GWR gazette (gov.cn) "数据要素潜力加快释放，数字经济核心产业增加值占国内生产总值的比重提高到10.5%以上。" → replaces the Xinhua relay (https://www.news.cn/tech/20260430/7967362c67cc4f9492253f0099854d31/c.html, which says the 数字中国发展报告（2025年） was released 2026-04-29 at the 9th Digital China Summit). NBS report No.1: "数字经济核心产业增加值占GDP比重超过10.5%". nda.gov.cn https://www.nda.gov.cn/ renders no content to WebFetch, so the 2025 report PDF was not located. NBS final 2025 value not yet published.

### (k) de14_ipv6_users
- 2021 6.08亿: 数字中国发展报告（2021年） CAC PDF https://www.cac.gov.cn/rootimages/uploadimg/1675765283208335/1675765283208335.pdf (landing page https://www.cac.gov.cn/2022-08/02/c_1661066515613920.htm) — replaces 中新网.
- 2024 8.23亿: confirmed in the 数字中国发展报告（2024年） copy https://zsj.nmg.gov.cn/xwzx/sznmg/202506/P020250603712115743005.pdf p.11 ("截至2024年底，IPv6活跃用户数达8.23亿"); no cac/nda original located → remains Tier B.
- 2022 7.28亿 confirmed in the CAC 2022 report PDF https://www.cac.gov.cn/rootimages/uploadimg/1686402331296991/1686402331296991.pdf (p.3).

### (l) de14_industrial_internet
- 数字中国发展报告 2021/2022/2024 contain platform counts and device connections but no 应用普及率. No MIIT release found. Not found (indicator is CAICT-produced).

### (m) de14_gov_users
- 2021: CAC 2021 report p.7 "全国一体化政务服务平台实名用户已超过10亿人" (new floor actual). 2022 report p.13 repeats "超过10亿人". 2024 report: no user count. 国家政务服务平台 home https://gjzwfw.www.gov.cn/ shows no user statistic. 2023–2025 not found.

### (n) fyp14_schooling
- NBS commentaries by 王萍萍: 2022-01-18 https://www.stats.gov.cn/xxgk/jd/sjjd2020/202201/t20220118_1826609.html (2020 10.75 only); 2023-01-18 https://www.stats.gov.cn/xxgk/jd/sjjd2020/202301/t20230118_1892285.html (2022 10.93); 2024-01-18 https://www.stats.gov.cn/xxgk/jd/sjjd2020/202401/t20240118_1946711.html (2023 11.05); 2025-01-17 https://www.stats.gov.cn/sj/sjjd/202501/t20250117_1958337.html (2024 11.21). Also https://www.stats.gov.cn/sj/sjjd/202409/t20240920_1956588.html and gov.cn https://www.gov.cn/lianbo/bumen/202409/content_6976172.htm (2023 11.05); NBS 社会民生统计报告 (2024 11.21). 2025 11.3: NBS 2025 communiqué "16—59岁人口平均受教育年限为11.3年，比上年提高0.1年" → replaces plan-table source. 2021: not printed anywhere official (only implied by "比2021年提高0.11年") → not found. Tier-C lead: https://www.sfccn.com/2023/7-11/wOMDE0NzBfMTg0MjMwOA.html.

## Other URLs fetched (dead ends / misc)
- https://www.stats.gov.cn/sj/sjjd/ , https://www.stats.gov.cn/sj/zxfbhjd/ , https://www.stats.gov.cn/zt_18555/ztfx/ — redirect loops in WebFetch.
- https://www.stats.gov.cn/sj/sjjd/202606/t20260603_1963878.html — 404 (ID guess for other 十四五 series reports).
- https://www.mee.gov.cn/ywgz/sthjjcgl/hjzljcypj/ — recent items only.
- https://www.bing.com/… and https://duckduckgo.com/html/… — robots-disallowed (no workaround for the exhausted search budget).
- https://www.163.com/dy/article/L3CSCOFU05446M2K.html , https://m.gmw.cn/2026-08/28/content_1304555465.htm , https://m.gmw.cn/2026-08/01/content_1304541268.htm , https://www.jiemian.com/article/13792092.html — Tier C leads only.

## Summary of discrepancies worth acting on
1. fyp15_physicians: plan 2025 column 3.1 vs NHC final 3.25 (same 执业医师 definition) — plan baseline is a preliminary estimate.
2. fyp15_unemployment: baseline 5.2 (2025) missing; ＜5.5 is an annual ceiling in the 年均/累计 column, not a 2030 level.
3. fyp15_rd_growth: 9.1 should be a baseline field; ＞7 is a period-average rate.
4. fyp14_energy_intensity 2025: official NBS cumulative −16.1% (adjusted basis) now available — replace the ERI-author source; the dataset note's annual list (−2.7, −0.1, −0.5, −3.8, −5.1) matches the communiqués, with the definition change from 2023.
5. fyp14_physicians / nursery / life expectancy: full official 2021–2025 series now exist (3.78, 4.73, 79.25 in 2025) and both 14th-FYP targets (3.2, 4.5) were exceeded; the dataset notes saying 'no comparable actual' / 'no official series' should be removed.
Also: fyp14_co2_intensity 17.7 confirmed verbatim in the NDRC PDF; three non-fossil-share actuals (2021–2023) and three air-quality actuals (2021–2023) upgraded from Tier C/B to ministry sources; forest 2024 upgraded to 25.09.

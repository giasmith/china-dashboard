# LOG_compute — computing-power infrastructure & 东数西算 hubs (retrieved 2026-10-04)

Rules followed: RULES.md (official primary sources only; Tier A = *.gov.cn originals, Tier B = Xinhua/People's Daily
verbatim or gov.cn-hosted copies, Tier C = note only). Tooling constraints hit during the task:

- `curl` to any external host is refused by the egress proxy (CONNECT 403) — only WebFetch/WebSearch worked.
- The WebSearch budget (200 calls/session) ran out at the start of Part 2 (cluster work); the rest was done with
  direct WebFetch of known/guessable URLs.
- Many provincial/municipal portals are unreachable from this environment (robots/SSL/DNS/403): see "Dead ends".

## 1. Part 1 — national series: what was fetched and what it gave

### Tier A pages used (value-bearing, confidence high)
| URL | What it is | Key figures taken |
|---|---|---|
| https://www.nda.gov.cn/sjj/swdt/xwfb/0608/ff808081-9e81e648-019e-a78ceae4-00c3.pdf | 数字中国发展报告（2025年）, NDA, cover 2026-05 (released 2026-06-08) | p.9: 在用算力设施机架 超过1373万标准机架; 智能算力 159万PFLOPS（FP16，下同）; 万卡集群42; 超大型算力设施平均PUE 1.34; 枢纽地区新增算力占全国新增算力 80%以上. p.10: 试验验证平台 已监测1129个算力设施, 可监测总算力 102万PFLOPS (智算83.4万, 可调度11万). p.5: 数据存储总量 2.53 ZB. p.8: 10G PON 3162万, 超千兆用户 672万, 5G基站 483.8万. **No FP32 算力总规模, no 存力总规模, no 绿电, no 上架率.** |
| https://www.nda.gov.cn/sjj/ywpd/sjzg/0530/ff808081-96b465bf-0197-200a135e-0536.pdf | 数字中国发展报告（2024年）, NDA, 2025-05 | p.12: 截至2024年底 在用算力中心标准机架 超过900万; 算力规模 280EFLOPS（FP32）; PUE 1.46; 甘肃庆阳等绿电使用率超过80%. p.11: 枢纽节点地区新增算力 60%以上. No 智能算力/存力/上架率. |
| https://www.cac.gov.cn/rootimages/uploadimg/1675765283208335/1675765283208335.pdf | 数字中国发展报告（2021年）, CAC | p.3: 算力规模 140 EFLOPS; p.16: 520万标准机架, 平均上架率超过55%, 存储容量800EB. → replaces 中国证券报 for ndc3_total_compute 2021. |
| https://www.cac.gov.cn/rootimages/uploadimg/1686402331296991/1686402331296991.pdf | 数字中国发展报告（2022年）, CAC | p.3: 算力总规模超180EFLOPS; 650万标准机架; p.5: 存力总规模超1000EB, 数据存储量724.5EB; p.4: 8枢纽 2022年新建数据中心规模超130万标准机架; p.25: 规划在建大型以上DC设计PUE 1.3. |
| https://www.miit.gov.cn/jgsj/yxj/xxfb/art/2026/art_bea806f4dd20457cb0158795cc210aa7.html | 2025年通信业统计公报 (MIIT, 2026-01-28) | 千兆用户 2.38亿户 (34.5%); 5G用户 12.04亿户 (65.9% of mobile users); 电信业务收入 1.75万亿元 (+0.7%); 三家基础电信企业 对外服务机架 93.8万个 (+10.8万) — operators only. No 算力/存力/PUE. |
| https://www.miit.gov.cn/cms_files/filemanager/1226211233/attach/20269/3e520e61597143b69b6098beb479dc96.pdf | 信息通信行业发展“十五五”规划 full PDF (MIIT, 2026-09-07; notice page https://www.miit.gov.cn/jgsj/txs/wjfb/art/2026/art_f55fe09a1e26411fa6926e5195850990.html) | 专栏1 table, 2025 → 2030: 信息通信行业收入 3.8→4.1万亿; 新建大型超大型算力设施运行PUE 1.25→<1.2; 每万人5G基站 34→50; 智能算力 1590→9800 EFLOPS; 先进存力 540→1700 EB; 5G用户普及率 85.7→95%; 千兆以上宽带用户 2.4→3.2亿户; 终端连接数 54→65亿. Note③: 收入 includes 基础电信企业及规模以上互联网企业. No 发展基础 section in the PDF. |
| https://www.miit.gov.cn/xwfb/bldhd/art/2026/art_4ba01aa6d2f54ced8ba3490ea4fb52c4.html | SCIO briefing on 2025 results, full 实录 (MIIT, 2026-01-21) | 谢存: 万卡智算集群42个, 智能算力规模超过1590EFLOPS; 5G用户超12亿户 占65.9%; 千兆宽带用户2.4亿户; 10GPON 3162万. 张云明: 智能算力规模达1590EFLOPS; 数字产业收入约38.3万亿元. **No 算力总规模, 机架, 存力, PUE.** |
| https://www.miit.gov.cn/xwfb/bldhd/art/2026/art_bc4cf76777cb4fd2896082ca2ff7039d.html | SCIO briefing on H1-2026 (MIIT, 2026-07-20) | 截至6月底 智能算力 2185EFLOPS（FP16）; 全国算力设施整体上架率 71.4%; regional 智算 shares 55.9/10.6/32.6/0.9%; 5G基站 510.2万. |
| https://www.miit.gov.cn/xwfb/bldhd/art/2025/art_2c3e9dd628e04e87a5f79ba542cd2581.html | SCIO briefing on Q1-2025 (MIIT, 2025-04-18) | 截至3月底: 在用算力中心机架总规模超过900万标准机架, 算力总规模 280EFLOPS; 5G用户普及率 75.9%; 千兆用户 2.18亿; 5G用户 10.68亿. |
| https://www.miit.gov.cn/jgsj/jns/nyjy/art/2025/art_7caf70f0c83b459a956e0aaa1c16ad00.html | MIIT 节能司 article on 2025 国家绿色算力设施 list | 累计306家; 2025 list PUE 平均值1.25, 较全国算力设施PUE平均值低14.4%; 可再生能源利用率平均值超过70%. (National PUE not printed → not inferred.) |
| https://www.nda.gov.cn/sjj/swdt/xwfb/0728/20260728171544950646970_pc.html | 文字实录 数博会 press conference (NDA, 2026-07-28) | 余英: 全国智算总规模 240万PFLOPS, 八大枢纽已建成智算总规模占全国 超80%, 140万PFLOPS 接入试验验证平台. 王宏 (贵阳市长): 贵阳贵安 算力规模已突破174EFLOPS、智算占比超98%、平均PUE低至1.19; 年底190, 2030 300. |
| https://www.ndrc.gov.cn/fzggw/wld/llh/zyhd/202608/t20260831_1407318.html | NDRC page: 刘烈宏 at 2026 数博会 (2026-08-29/31) | 截至2026年7月底 全国智算总规模 245万PFLOPS（FP16）; 145万PFLOPS 纳入国家级监测调度平台; 八大枢纽+三个算电协同发展区 智算占全国 超85%; 贵阳贵安 算力规模已突破17.6万PFLOPS（FP16）, PUE最低1.12 (郑莉). |
| https://www.nea.gov.cn/20250318/764a752a063f48e590068bdd521d0cee/c.html | NEA 绿证 press conference 实录 (2025-03-18) | 高波 (NDA): 八大枢纽节点数据中心集群平均PUE 1.3左右, 最低1.04; 力争2025年 枢纽新建DC绿电占比80% (target). |
| https://www.gov.cn/lianbo/bumen/202408/content_6971147.htm | 新华社 on gov.cn (2024-08-29) | 刘烈宏: 截至2024年6月底 八大枢纽 直接投资超435亿, 机架总规模超过195万架, 整体上架率63%左右, 新建DC PUE最低1.04. |
| https://www.stats.gov.cn/sj/zxfb/202602/t20260228_1962662.html | NBS 2025年国民经济和社会发展统计公报 | 1000M及以上宽带用户 23839万户 (+3157万); 5G基站 484万; 电信业务总量 18627亿元 (+9.1%). No 算力 items. |
| https://www.szzg.gov.cn/2024/xwzx/szkx/202406/P020240630600725771219.pdf | 数字中国发展报告（2023年）PDF on the summit's gov.cn site (treated as medium — copy) | p.4: 算力总规模230EFLOPS; 存力总规模约1.2 ZB; 5G用户8.05亿 (46.6%). p.5: 810万架; 智能算力70EFLOPS (+70%). p.9: 数据存储总量1.73 ZB. p.37: 数据中心平均PUE 1.48; 国家绿色数据中心 1.27. |

### Tier B / gov.cn-hosted copies used (confidence medium)
- https://dzswgf.mofcom.gov.cn/news/43/2025/8/1756100846352.html — 中新社 report (hosted on mofcom.gov.cn) of MIIT Vice Minister 熊继军, 2025中国算力大会 (2025-08-23): 截至6月底 1085万架, 智能算力788 EFLOPS, 存力超过1680 EB, 全国算力中心平均PUE 1.42. Cross-checked with Xinhuanet/经济参考报 https://www.xinhuanet.com/tech/20250825/e0c74211b58d40048e0bbd278b0bfcef/c.html and 科技日报 https://www.stdaily.com/web/gdxw/2025-08/23/content_389429.html (same sentence). MIIT's own page for the speech not found; szzg.gov.cn copy blocked by robots.
- https://paper.people.com.cn/rmrb/html/2024-04/19/nw.D110000renmrb_20240419_3-02.htm — People's Daily on MIIT 单忠德 (2024-04-18): 810万标准机架, 230EFLOPS, 智能算力70EFLOPS (end-2023); 5G普及率超60% (Mar-2024).
- https://www.ncsti.gov.cn/kjdt/kjrd/qtrd_kjrd/202407/t20240723_172472.html — 北京日报 copy on a gov.cn domain of NDA 杜巍 (SCIO 2024-07-22): 截至2024年3月底 10集群 146万标准机架, 上架率62.72% (+4pp vs 2022), 新建DC PUE最低1.10, 部分先进DC绿电约80%.
- https://xxzx.fj.gov.cn/jjxx/szjj/202409/t20240929_6531351.htm — 光明网 copy on fj.gov.cn of MIIT 赵志国 (2024-09, 2024中国算力大会): 算力总规模246EFLOPS, 830万标准机架, PUE 1.47 (mid-2024). Used only in notes.
- https://www.news.cn/local/20260409/cc83e167d55f4b199f3254decd54d504/c.html — 新华社 (2026-04-09), 张家口: 已建成数据中心49个、投运标准机架81万架 (刘永刚, 市数据和政务服务局局长). City-wide.

### Tier C pages consulted (context only, NOT value-bearing)
- https://www.thepaper.cn/newsDetail_forward_31458752 (dataset's current source for 1680 EB / 1.42 — Tier C; should be swapped for the gov.cn-hosted copy above).
- https://www.news.cn/tech/20260720/63025e398f234092b9876272271417fb/c.html (Xinhua, 2026-07-20; Tier B) — superseded by the MIIT page.
- https://www.cnfin.com/yw-lb/detail/20260822/4458983_1.html and /gs-lb/detail/20260822/4458982_1.html (新华财经 "数读绿色算力", 2026-08-22): 内蒙古 33.8万P (高敬, 2026-08-18), 和林格尔新区 绿电>85%, plus restatements of national figures.
- https://www.nbd.com.cn/articles/2026-07-28/4521834.html, https://www.news.cn/fortune/20260728/702973fc286b4b78a2f932566d7f43b6/c.html — reports of the NDA 2026-07-28 presser (used to locate the transcript).
- https://m.c114.com.cn/w16-1308857.html — MIIT 张云明 SCIO 2026-04-21: 截至3月底 智能算力1882 EFLOPS（FP16）. MIIT page not fetched (no search budget) → not recorded as a value.
- https://www.ithome.com/0/978/576.htm — WAIC 2026 高文 (academician, not official): 在用算力中心标准机架 1445万架 (Mar-2026). Not official.
- https://www.stdaily.com/web/gdxw/2026-09/28/content_589073.html, https://paper.people.com.cn/rmrbhwb/pc/content/202609/24/content_30182959.html — 2021 EB / 32% advanced (mid-2026) are CAICT/算力产业发展方阵 figures → Tier C even in 人民日报海外版. Dataset records for cpi23_storage 2026 and cpi23_adv_storage_share 2026 should be downgraded.
- https://paper.people.com.cn/zgnyb/pc/content/202607/20/content_30170400.html (中国能源报, 2026-07-20): restates 1373万 / 1.34 and gives 算力设施总用电量1960亿千瓦时 (1.9% of national) — attributed to NDA/节能中心 officials; not recorded.
- https://www.rmzxw.com.cn/c/2026-01-04/3844587.shtml — reprint of the MIIT green-facility article (2024 用电量 1660亿千瓦时, 1.7%).
- https://www.cnfin.com/hg-lb/detail/20250418/4219773_1.html, https://www.cnfin.com/hg-lb/detail/20240418/4037736_1.html, http://www.cww.net.cn/article?id=589237, https://www.stdaily.com/web/gdxw/2025-01/21/content_289068.html (MIIT Jan-2025: 880万架 end-2024, 算力规模 +16.5% vs 2023; 千兆用户突破2亿; 电信业务收入超1.7万亿) — used to cross-check.
- https://www.thepaper.cn/newsDetail_forward_18809079 (2022-06-29 MIIT/山东 presser: 2021 figures 140 EFlops, 520万架, 800EB) — replaced by the CAC PDF.
- https://m.gmw.cn/2026-01/28/content_1304322356.htm, https://www.chinanews.com.cn/gn/2026/01-28/10560597.shtml, https://www.nbd.com.cn/articles/2026-01-28/4238491.html — used to confirm 公报 figures before the MIIT original was found.
- https://www.news.cn/info/20260907/94a493717274496698619e989a5e5faf/c.html (Xinhua on 十五五 plan) — no numbers; superseded by the MIIT PDF.

## 2. Part 2 — clusters

| Cluster | Official (Tier A/B) found | Tier C seen (note only) |
|---|---|---|
| 张家口 | 新华社 2026-04-09: 49个DC, 投运81万架 (city-wide) | — |
| 长三角示范区 | shqp.gov.cn 2025-09-17: project-level only (吴江1号 506 PFLOPS; 移动5G生态谷 4768架; 电信嘉兴 约1.56万架; 云湖 约4000) ; sheitc.sh.gov.cn 2021 notice (3万架 approved) | — |
| 芜湖 | wuhu.gov.cn 2025-10-31: 建成12万架, 智算2.6万P, 15 projects / 6 投运 (re-verified) | — |
| 韶关 | sg.gov.cn 2024-03-16: first 智算中心 operating (华南数谷), 2024 target 4万P; sg.gov.cn 2023-05-25: 12 projects, 36.1万架 planned, 395亿 | 科技日报 2026-01-27 / 新浪 2026-02-25 (mayor 吴庆华): 承载12万架 + 18万P 智算; 2026 target 30万架, 250 MW; 科技日报 2026-06-13: 17.3万架 承载能力, 6 projects 建成投用, 规划超130万架, 20 projects/620亿; 科技日报 via news.cn 2026-07-14: 17万架 built, 15万 in construction, 5个万卡集群 投产, 上架智算4万P; yicai 2026-06-12: 20 projects/970亿, year-end 上架算力10万P+ |
| 天府 | none cluster-level; dsjj-type provincial plan only via press | C114 2025-12-04 (四川通管局 钱海燕): 全省36万标准机架, 智算25.4EFLOPS; yicai/川观 2026-08-03: 四川 plan 60/120/240 EFLOPS (2026/27/28), 新建大型DC PUE<1.2, 绿电80% |
| 重庆 | dsjj.cq.gov.cn draft plan 2025-09: targets 调度智算 3→5→11万P (2025–27), PUE 1.50→1.35, 绿色算力占比 50→70%; no baseline | — |
| 和林格尔 | none reachable | 新华财经 2026-08-22: 内蒙古 33.8万P (province), 和林格尔新区 绿电>85% |
| 贵安 | NDA 实录 2026-07-28: 贵阳贵安 174 EFLOPS, 智算>98%, 平均PUE 1.19; NDRC 2026-08-31: 17.6万PFLOPS（FP16）end-July 2026, PUE最低1.12 | — |
| 庆阳 | NDA 2024 report p.12: 甘肃庆阳等绿电使用率超过80% | — |
| 中卫 | none | — |

8-hub aggregates found: 195万架 / 63% (Jun-2024, gov.cn); 146万架 / 62.72% (Mar-2024, 10 clusters); 平均PUE 1.3左右 (Mar-2025, NEA); 智算 stock share >80% (Jul-2026, NDA) / >85% incl. 3 算电协同区 (Jul-2026, NDRC); 2022 new build 130万架 (CAC). No 2025–2026 rack or EFLOPS aggregate for the 8 hubs.

## 3. Discrepancies / definition changes spotted
1. **edwc23_new_compute_share 2025**: official full-year figure is **80%以上** (NDA 2025 report), not the 60% floor currently in the dataset (mid-year Xinhua).
2. **gdc24_avg_pue 2025**: NDA switched the reported PUE to 超大型 facilities only (1.34). Not comparable to 1.46 (2024, all 算力中心). No all-facility end-2025 value.
3. **FP32 total compute series ends at 280 EFLOPS** (end-2024/Mar-2025). End-2025 only has FP16 智算 1,590 EFLOPS — cpi23_total_compute 300 cannot be scored like-for-like.
4. **Racks end-2024**: NDA report 超过900万 vs MIIT Jan-2025 超过880万 (same reference date).
5. **Rack series label drift**: 数据中心机架 → 算力中心机架 → 算力设施机架.
6. **5G 普及率** (per 100 pop.: 85.7%) vs **5G share of mobile users** (65.9%) — two different series both called "普及率/占比" in press.
7. **信息通信行业收入 3.8万亿** (telecom + internet firms) vs **电信业务收入 1.75万亿**.
8. **Dataset source tiers**: cpi23_storage 2025 (1680) and gdc24_avg_pue 2025 (1.42) currently cite 澎湃新闻 (Tier C) with "high"; cpi23_storage/adv_storage_share 2026 (2021 EB / 32%) are CAICT numbers; cpi23_ai_share 2023 (25.4%) is CAICT. The 2024 PUE 1.46 can be upgraded from the nmg.gov.cn mirror to the NDA PDF.
9. **韶关 status**: municipal portal shows the first 智算中心 operating since 2024 → "under_construction" should become "operating" (build-out ongoing).
10. **贵安**: NDA transcript gives 174 EFLOPS (贵阳贵安, Jul-2026) vs dataset 92 EFLOPS (Guizhou hub, Aug-2025, Xinhua) — different scopes and dates; the new figure is Tier A.

## 4. Dead ends (do not repeat)
- MIIT 工信数据 index pages (https://www.miit.gov.cn/gxsj/tjfx/txy/index.html, /xwfb/bldhd/index.html) render without article lists via WebFetch; the 公报 URL had to come from search.
- scio.gov.cn: robots.txt fetch fails (self-signed cert) → transcripts must be read from miit.gov.cn / nda.gov.cn / gov.cn copies.
- gov.cn/lianbo/bumen/ index: redirect loop. gov.cn 2026 transcript of the SCIO briefings not located (no search budget left).
- nda.gov.cn: /sjj/swdt/xwfb/index.html is 404; the working list is https://www.nda.gov.cn/sjj/swdt/xwfb/list/index_pc_1.html.
- nea.gov.cn/xwfb/xwfbh/index.html → 404 (the 2025-03-18 transcript URL above works).
- Blocked (robots/SSL/DNS/403/412): szzg.gov.cn article pages (PDF fetch works), gxt.hunan.gov.cn, data.beijing.gov.cn, gd.gov.cn, gdstc.gd.gov.cn, zhangjiakou.gov.cn (DNS), hebei.gov.cn, nmg.gov.cn (403), zsj.nmg.gov.cn (403), huhhot.gov.cn (SSL), qingyang.gov.cn (DNS; real domain zgqingyang.gov.cn → 403), gansu.gov.cn (412), zhongwei.gov.cn (DNS; real domain nxzw.gov.cn works), guizhou.gov.cn, gaxq.gov.cn, cq.gov.cn, dsjj.cq.gov.cn homepage (the .doc attachment works).
- sg.gov.cn: homepage and article pages work, but the 要闻 index (Sept–Oct 2026) and 政府工作报告 index (404) gave no 2026 capacity figures; sg.gov.cn/xwzx/sgyw/ is 404 (use /xw/xwzx/bdxw/).
- wuhu.gov.cn & sjzyj.wuhu.gov.cn news indexes (late Sept–Oct 2026): no data-center items; /zwgk/zfgzbg/index.html 404.
- ithome.com/0/917/189.htm 404; cls.cn/detail/2478026 returns binary; m.c114.com.cn/w16-1295622.html fetch error; ycwb content_54175342 empty.
- Searching for an official national 智能算力占比, end-2025 存力总规模, end-2025 all-facility PUE, 2023/2025 national 上架率 and hub 绿电 outcome: nothing official exists (see not_found in JSON).

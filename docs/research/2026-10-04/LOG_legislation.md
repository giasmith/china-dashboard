# LOG_legislation.md — legislation library verification & expansion

Retrieved: 2026-10-04. Rules followed: RULES.md (Tier A official sources only for values; Tier B/C only in notes).

## Part 1 — verification of the 10 `verified: false` records

### mlps_regulation_draft_2018 (网络安全等级保护条例（征求意见稿）)
- WebSearch "网络安全等级保护条例 征求意见稿 公安部 2018年6月27日" → only law-firm/secrss commentary (Tier C).
- WebFetch https://www.mps.gov.cn/n2254536/n4904355/c6159136/content.html → robots.txt fetch failed (HTTP 521). MPS site unreachable from here.

### gb_40879_2021_dc_energy_efficiency_standard
- curl openstd.samr.gov.cn → proxy CONNECT 403 (egress denied for curl); WebFetch works.
- WebFetch https://openstd.samr.gov.cn/bzgk/gb/std_list?p.p1=0&p.p90=circulation_date&p.p91=desc&p.p2=GB%2040879-2021 → entry GB 40879-2021 数据中心能效限定值及能效等级: 发布日期 2021-10-11, 实施日期 2022-11-01, 状态 现行 (强制性国家标准). CONFIRMED (Tier A).

### green_dc_5g_implementation_plan_2021 (发改高技〔2021〕1742号)
- WebFetch https://www.ndrc.gov.cn/xxgk/zcfb/tz/202112/t20211208_1307015.html → 404; _ext variant → 404.
- WebFetch https://www.gov.cn/zhengce/zhengceku/2021-12/08/content_5659212.htm → 404 (guessed URL).
- WebFetch https://www.ncsti.gov.cn/kjdt/ztbd/yf5gzhwl/zcdx/ (北京市科委 — gov.cn) → lists the document, dated 2021-12-08, 来源: 国家发展和改革委员会网站.
- WebFetch https://www.ncsti.gov.cn/kjdt/ztbd/yf5gzhwl/zcdx/202204/t20220414_69453.html → 发改高技〔2021〕1742号, four issuers (国家发展改革委、中央网信办、工业和信息化部、国家能源局), 成文 2021年11月30日. CONFIRMED (Tier A mirror on *.gov.cn; NDRC original page no longer online).

### fourteenth_fyp_national_informatization_plan
- WebFetch https://www.cac.gov.cn/2021-12/27/c_1642205314518676.htm → PDF-only page, published 2021-12-27 11:07; the page does not state the issuer or 印发 date.
- WebSearch site:cac.gov.cn → no CAC news item giving the issuance date surfaced.

### digital_china_overall_layout_plan_2023
- WebFetch https://www.gov.cn/xinwen/2023-02/27/content_5743484.htm → "近日，中共中央、国务院印发了《数字中国建设整体布局规划》", dateline 新华社北京2月27日电; no 成文日期. 

### data_element_x_action_plan_2024_2026
- WebFetch https://www.gov.cn/zhengce/zhengceku/202401/content_6925353.htm → 404 (guessed URL).
- WebFetch https://www.gansu.gov.cn/gsszf/c100055/202403/173877723/files/69852d94fd824eaa8d0b1455af799ae4.pdf → Gansu implementation plan (甘政办发〔2024〕25号) quoting 国数政策〔2023〕11号 and "数据产业年均增速超过20%"; not the national original.

### data_center_green_low_carbon_action_plan_2024
- WebFetch https://www.ndrc.gov.cn/fggz/fgzy/xmtjd/202407/t20240730_1392078.html (专家解读) → confirms 发改环资〔2024〕970号 and the four issuers.
- WebFetch https://www.gov.cn/zhengce/zhengceku/202407/P020240724272072479001.pdf → text confirms 2025 targets verbatim ("到2025年底…整体上架率不低于60%，平均电能利用效率降至1.5以下，可再生能源利用率年均增长10%"); header/成文日期 not in extracted text.
- WebFetch https://www.gov.cn/zhengce/zhengceku/202407/content_6964341.htm → 404 (guessed URL).

### national_data_infrastructure_guidelines_2025
- WebFetch https://www.gov.cn/zhengce/202501/content_6996612.htm → this is a gov.cn news story ("新一轮数字基础设施布局开启", 2025-01-07) saying 三部门近日联合印发; no 发文字号 / 成文日期.

### computing_interconnection_action_plan_2025
- WebSearch site:miit.gov.cn → nothing on miit.gov.cn surfaced; Xinhua 2025-06-03 release only.
- WebFetch https://www.shanghai.gov.cn/cmsres/ee/eee81f4b313c4c8a97a8eb9bb2bcd213/bcde20759064d3d545e88e150a6c59e7.pdf → Shanghai notice 沪经信基〔2026〕151号 (2026-03-19) on 国家算力互联互通行业节点建设; does not reproduce the MIIT plan's number.

### ict_industry_fifteenth_fyp_2026
- WebFetch https://www.ncsti.gov.cn/kjdt/kjrd/202609/t20260908_255472.html (北京市科委, gov.cn) → "9月7日从工业和信息化部获悉，该部近日印发《信息通信行业发展"十五五"规划》"; 2030 targets: 行业收入4.1万亿元, 5G(含5G-A)普及率95%, 每万人50个5G基站, 智能算力9800EFLOPS, 信息基础设施累计投资3.8万亿元, 电信业务总量年均增速7%. No document number.

### Part 1 follow-ups (official pages found with extended search)
- data_element_x: https://www.nda.gov.cn/sjj/xxgk/gknr/ghjh/0909/20240909160155798592998_pc.html (NDA) → 国数政策〔2023〕11号, signed 2023年12月31日, published 2024-01-04, 17 issuers listed. Also https://www.cac.gov.cn/2024-01/05/c_1706119078060945.htm → 2026 goal "打造300个以上…典型应用场景". CONFIRMED.
- national_data_infrastructure_guidelines_2025: https://www.ndrc.gov.cn/xxgk/zcfb/tz/202501/t20250106_1395455.html → 发改数据〔2024〕1853号, 成文 2024-12-31, 发布 2025-01-06. gov.cn copy https://www.gov.cn/zhengce/zhengceku/202501/content_6996487.htm shows metadata 成文日期 2025-01-01 but signature line 2024年12月31日 (gov.cn metadata inconsistency; NDRC/NDA value used). NDA copy https://www.nda.gov.cn/sjj/zwgk/zcfb/0106/20250106095112713400492_pc.html agrees (2024-12-31). CONFIRMED.
- Bonus found on NDRC: https://www.ndrc.gov.cn/xxgk/zcfb/tz/202412/t20241230_1395341.html → 关于促进数据产业高质量发展的指导意见, 发改数据〔2024〕1836号, 成文 2024-12-28, 发布 2024-12-30, six issuers, 2029 target CAGR >15%. (new record)
- computing_interconnection_action_plan_2025: https://www.gov.cn/zhengce/zhengceku/202505/content_7025968.htm and https://wap.miit.gov.cn/zwgk/zcwj/wjfb/tz/art/2025/art_1bbbd7e75dcc4fd8b75d6d2109f2e9ab.html → 工信部信管〔2025〕119号, 成文 2025-05-21, 发布 2025-05-30. CONFIRMED (2026/2028 targets are in the PDF annex, not re-read).
- ict_industry_fifteenth_fyp_2026: https://www.miit.gov.cn/jgsj/txs/wjfb/art/2026/art_f55fe09a1e26411fa6926e5195850990.html → 工信部规〔2026〕188号, 成文 2026-08-12, 发布 2026-09-07. CONFIRMED.
- data_center_green_low_carbon_action_plan_2024: https://www.ndrc.gov.cn/xxgk/zcfb/tz/202407/t20240723_1391894.html → 发改环资〔2024〕970号, signed 2024年7月3日, NDRC 发布 2024-07-23; gov.cn https://www.gov.cn/zhengce/zhengceku/202407/content_6964165.htm agrees (成文 2024-07-03, 发布 2024-07-24). CONFIRMED.
- fourteenth_fyp_national_informatization_plan: https://www.cac.gov.cn/2021-12/27/c_1642205312337636.htm → "近日，中央网络安全和信息化委员会印发《"十四五"国家信息化规划》", 2021-12-27 10:31; 2025 goal "数字中国建设取得决定性进展". Issuance day not published → date_precision month.
- digital_china_overall_layout_plan_2023: https://www.cac.gov.cn/2023-02/27/c_1679136694986243.htm (Xinhua text) — same "近日" wording; no 成文日期 anywhere official. Keep 2023-02-27 as release date, precision month.
- mlps_regulation_draft_2018: official MPS URL exists (https://www.mps.gov.cn/n2254536/n4904355/c6159136/content.html, title "公安部关于《网络安全等级保护条例（征求意见稿）》公开征求意见的公告") but MPS blocks fetch (HTTP 521); provincial mirrors sjt.sc.gov.cn / gaj.zhanjiang.gov.cn timed out. Status check: 国务院2026年度立法工作计划 (国办发〔2026〕14号, 2026-05-08) copy on https://www.mee.gov.cn/zcwj/gwywj/202605/t20260514_1152263.shtml lists 网络安全等级保护条例 under 预备制定 → still NOT enacted as of 2026-10-04. (moj.gov.cn copy blocked by robots.)

## Part 2 — new records (URLs fetched)
- 电子商务法: https://www.gov.cn/xinwen/2018-08/31/content_5318194.htm (主席令第七号) → adopted 2018-08-31 (13th NPCSC 5th session), effective 2019-01-01. npc.gov.cn pages blocked (robots/SSL).
- 密码法: https://www.gov.cn/xinwen/2019-10/26/content_5445366.htm (主席令第三十五号) → adopted 2019-10-26, effective 2020-01-01.
- 反垄断法 2022: http://www.nopss.gov.cn/n1/2022/0627/c432288-32457207.html (主席令第一一六号 reproduced on 全国哲学社会科学工作办公室 gov.cn site) → decision adopted 2022-06-24, effective 2022-08-01. gov.cn/xinwen guess URL 404; ssf.gov.cn PDF SSL error.
- 反不正当竞争法 2025: https://www.gov.cn/yaowen/liebiao/202506/content_7029686.htm (主席令第五十号) → revised 2025-06-27 (14th NPCSC 16th session), effective 2025-10-15.
- 电子签名法: https://www.miit.gov.cn/jgsj/zfs/fl/art/2022/art_e3f623f70c23497e88a941170093446a.html → adopted 2004-08-28, effective 2005-04-01, amended 2015-04-24 and 2019-04-23; 5 chapters 36 articles.
- 消费者权益保护法实施条例: https://www.gov.cn/zhengce/content/202403/content_6940158.htm → 国务院令第778号, passed 2024-02-23 (国务院第26次常务会议), signed 2024-03-15, effective 2024-07-01; Art. 9 (差别定价) & Art. 10 (自动续费).
- 未成年人网络保护条例: https://www.cac.gov.cn/2023-10/24/c_1699806932316206.htm → 国务院令第766号, passed 2023-09-20, signed 2023-10-16, effective 2024-01-01, 7 chapters 60 articles.
- 非银行支付机构监督管理条例: https://www.gov.cn/zhengce/zhengceku/202312/content_6920725.htm → 国务院令第768号, passed 2023-11-24, signed 2023-12-09, published 2023-12-17, effective 2024-05-01.
- 网络安全审查办法: https://www.cac.gov.cn/2022-01/04/c_1642894602182845.htm → 13-department 令第8号, CAC 室务会议 2021-11-16, signed 2021-12-28, effective 2022-02-15; Art. 7 (>100万用户 赴国外上市).
- 深度合成管理规定: https://www.cac.gov.cn/2022-12/11/c_1672221949354811.htm → 令第12号 (CAC/MIIT/MPS), passed 2022-11-03, signed 2022-11-25, effective 2023-01-10.
- 个人信息出境标准合同办法: https://www.cac.gov.cn/2023-02/24/c_1678884830036813.htm → 国家互联网信息办公室令第13号, passed 2023-02-03, signed 2023-02-22, effective 2023-06-01.
- 网络暴力信息治理规定: cac.gov.cn guess URL 404; mps.gov.cn 521; used https://wxb.xzdw.gov.cn/zcfg/bmgz/202406/t20240615_479057.html (西藏网信办, gov.cn) → 令第17号, passed 2023-12-25, signed 2024-06-12, effective 2024-08-01.
- 网络反不正当竞争暂行规定: https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/fgs/art/2024/art_80019fe59e464196bef173dc56678a42.html → 总局令第91号, published 2024-05-06, effective 2024-09-01, 5 chapters 43 articles.
- 平台经济领域的反垄断指南: https://www.samr.gov.cn/zt/ndzt/2025n/sqxzjcgs/jcbz/art/2025/art_27c2be1ca40b42a9949c12dbd213ba8e.html → issued by 国务院反垄断委员会 2021-02-07, 5 chapters 23 articles; doc number not printed on this page (gkml.samr.gov.cn and Guiyang mirror unreachable).
- 互联网平台分类分级指南/落实主体责任指南 drafts: SAMR 反馈 page https://www.samr.gov.cn/hd/zjdc/jgfk/art/2023/art_9f056bd8ae4f4ea6a67c8faedaf7a929.html → 404; only Tier C 2021-10-29 news. No finalised version located on samr.gov.cn → still draft.
- 网络交易平台规则监督管理办法 (2026): https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/fgs/art/2026/art_85b474fc5a08494bb60ca6a280b98d7d.html + https://www.gov.cn/gongbao/2026/issue_12666/202604/content_7065115.html → 总局/国家网信办令第116号, passed 2025-11-24, published 2025-12-18, effective 2026-02-01, 8 chapters 47 articles.
- GB/T 45654-2025: https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=F67D3F376E0A0A0FF5317FB36B32A30A → 发布 2025-04-25, 实施 2025-11-01, 推荐性.
- GB 45438-2025: https://openstd.samr.gov.cn/bzgk/std/std_list?p.p2=GB+45438-2025 → 发布 2025-02-28, 实施 2025-09-01, 强制性, 现行.
- GB/T 43697-2024: https://openstd.samr.gov.cn/bzgk/std/std_list?p.p2=GB%2FT+43697-2024 → 发布 2024-03-15, 实施 2024-10-01, 现行.
- 企业数据资源相关会计处理暂行规定: https://www.mof.gov.cn/gkml/caizhengwengao/wg2023/wg202308/202312/t20231227_3924258.htm → 财会〔2023〕11号, 2023-08-01 (effective date 2024-01-01 is in the PDF annex, not re-read here; widely reported).
- 关于加强数据资产管理的指导意见: https://www.gov.cn/zhengce/zhengceku/202401/content_6925470.htm → 财资〔2023〕141号, signed 2023-12-31, published 2024-01-11.
- 公共数据资源登记管理暂行办法: https://www.nda.gov.cn/sjj/xxgk/zc/xzgfxwj/0121/ff808081-93de5a43-0194-8680d3e3-0ba7.pdf → 发改数据规〔2025〕26号, 2025-01-08, effective 2025-03-01 (5-year validity), 6 chapters 24 articles. List page https://www.nda.gov.cn/sjj/xxgk/zc/xzgfxwj/list/index_pc_1.html also shows 公共数据资源授权运营实施规范（试行） 发改数据规〔2025〕27号, 2025-01-08.
- 数据流通安全治理实施方案: https://www.nda.gov.cn/sjj/xxgk/gknr/qtzc/0115/20250115173302396617093_pc.html → 发改数据〔2025〕18号, six issuers, signed 2025-01-06, published 2025-01-15.
- 国家人工智能产业综合标准化体系建设指南（2024版）: https://wap.miit.gov.cn/zwgk/zcwj/wjfb/tz/art/2024/art_e8ebf5600ec24d3db644150873712c5f.html → 工信部联科〔2024〕113号, 成文 2024-06-05, 发布 2024-07-02; 2026 targets 50+ national/industry standards, 20+ international standards, 1000+ firms.
- 数字政府指导意见: https://www.gov.cn/zhengce/zhengceku/2022-06/23/content_5697299.htm → 国发〔2022〕14号, 成文 2022-06-06, 发布 2022-06-23.
- 数字乡村发展战略纲要: https://www.gov.cn/zhengce/2019-05/16/content_5392269.htm → "近日，中共中央办公厅、国务院办公厅印发", 新华社 2019-05-16; no 成文日期 → precision month.
- 城市全域数字化转型: https://www.ndrc.gov.cn/xxgk/zcfb/tz/202405/t20240520_1386326.html → 发改数据〔2024〕660号, four issuers, signed 2024-05-14, published 2024-05-20; 2027/2030 goals.
- 金融科技发展规划（2022—2025年）: pbc.gov.cn blocked by robots; https://www.gov.cn/zhengce/2022-01/07/content_5666817.htm → "近日，中国人民银行印发", gov.cn 2022-01-07; 4 principles / 6 goals / 8 tasks / 5 safeguards. Document number 银发〔2021〕335号 seen only in Tier C listings → not confirmed; precision month.
- 数字经济促进共同富裕实施方案: https://www.nda.gov.cn/sjj/xxgk/gknr/qtzc/0909/20240909151045180623871_pc.html → 发改数据〔2023〕1770号, NDRC+NDA, signed 2023-12-23, published 2024-01-05.
- 平台经济 2019: https://www.gov.cn/zhengce/content/2019-08/08/content_5419761.htm → 国办发〔2019〕38号, 成文 2019-08-01, 发布 2019-08-08.
- 平台经济 2022 若干意见: NDRC page not surfaced; https://www.beijing.gov.cn/zhengce/zhengcefagui/qtwj/202202/t20220226_2617192.html (首都之窗, gov.cn) → 发改高技〔2021〕1872号, nine issuers, signed 2021-12-24; NDRC 解读 pages dated 2022-01-19 (https://www.ndrc.gov.cn/xxgk/jd/jd/202201/t20220119_1312336.html).
- 新一代人工智能发展规划: https://www.gov.cn/zhengce/content/2017-07/20/content_5211996.htm → 国发〔2017〕35号, 成文 2017-07-08, 发布 2017-07-20; three-step targets quoted.
- 场景培育实施意见: NOT a 2024 NDRC document — it is 国务院办公厅 国办发〔2025〕37号, signed 2025-11-02 (https://www.mee.gov.cn/zcwj/gwywj/202511/t20251111_1132672.shtml; gov.cn news https://www.gov.cn/yaowen/liebiao/202511/content_7047426.htm).
- 国家数据标准体系建设指南: https://www.ndrc.gov.cn/xxgk/zcfb/tz/202410/t20241008_1393509.html → 发改数据〔2024〕1426号, six issuers, signed 2024-09-25, published 2024-10-08; 2026 goal (30+ standards) quoted from https://www.ncsti.gov.cn/kjdt/kjrd/qtrd_kjrd/202410/t20241010_181441.html.
- 企业数据资源开发利用意见: https://www.nda.gov.cn/sjj/xxgk/gknr/qtzc/1225/20241225154636252082589_pc.html → 国数资源〔2024〕125号, five issuers, signed 2024-12-20, published 2024-12-25 (it is a 2024 document, not 2025).
- 增值电信开放试点: https://wap.miit.gov.cn/zwgk/zcwj/wjfb/tg/art/2024/art_2326271e1b424e09b6e5924ad2948863.html → 工信部通信函〔2024〕107号, 成文 2024-04-08, 发布 2024-04-10; IDC/CDN/ISP etc. foreign-equity caps removed in 4 pilot zones.
- Bonus: 关于加强数字经济创新型企业培育的若干措施: https://www.nda.gov.cn/sjj/xxgk/gknr/qtzc/0926/20250926162823983586641_pc.html → 发改数据〔2025〕1154号, six issuers, signed 2025-09-04, published 2025-09-26.
- 民营经济促进法: https://www.gov.cn/yaowen/liebiao/202504/content_7021962.htm (主席令第四十六号: adopted 2025-04-30, effective 2025-05-20); digital articles (Art. 13, 29) read on https://www.stats.gov.cn/gk/tjfg/xgfxfg/202506/t20250609_1960123.html.
- 公共数据资源授权运营实施规范（试行）: https://www.nda.gov.cn/sjj/xxgk/zc/xzgfxwj/0120/20250120175648588490013_pc.html → 发改数据规〔2025〕27号, 2025-01-08, published 2025-01-20, effective 2025-03-01 (5 yrs), 7 chapters 27 articles.
- 企业数据资源会计处理 effective date: https://www.gov.cn/zhengce/202308/content_6899399.htm (MOF Q&A) → "自2024年1月1日起施行".

### 2025–2026 documents (NDA/NEA/MIIT)
- NDA 政策发布 list: https://www.nda.gov.cn/sjj/zwgk/zcfb/list/index_pc_1.html (items 2025-11 → 2026-07 listed; used to pick records).
- 关于促进人工智能与能源双向赋能的行动方案: https://www.nea.gov.cn/20260508/4dae97ca01d348e4871bb8654be34b3a/c.html → 国能发科技〔2026〕34号, four issuers, signed 2026-04-08, NEA page 2026-05-08; 2027/2030 goals quoted.
- 培育数据流通服务机构意见: https://www.nda.gov.cn/sjj/zwgk/zcfb/0205/20260205185635251370340_pc.html → 国数政策〔2026〕6号, signed 2026-02-03, published 2026-02-07; 2029 goal.
- 2026年数字经济发展工作要点: https://www.nda.gov.cn/sjj/ywpd/szjj/0519/20260519194643007508935_pc.html → NDA release 2026-05-19 ("近日"), eight task areas; no number.
- 普惠算力赋能中小企业专项行动: https://www.miit.gov.cn/jgsj/txs/wjfb/art/2026/art_e5c990d4ec924dbc9da5818da97940ac.html → 工信厅通信〔2026〕14号, 成文 2026-03-27, 发布 2026-04-02; 2028 goal (≥10 of 15 SME industries).
- 数据产权登记工作指引（试行）: https://www.nda.gov.cn/sjj/zwgk/zcfb/0704/20260703230745065425855_pc.html → 国数综政策〔2026〕35号, signed 2026-07-01, published 2026-07-04. System launch news: https://www.nda.gov.cn/sjj/swdt/xwfb/0911/20260911171614017938821_pc.html (2026-09-11, sjcqdj.nda.gov.cn 上线试运行).
- 行业高质量数据集建设行动实施方案: https://www.nda.gov.cn/sjj/zwgk/zcfb/0608/20260608172117399715004_pc.html → 国数科基〔2026〕25号, signed 2026-06-03, published 2026-06-08; 2028 goal.
- 国家数据局关于加强数据科技创新的实施意见: https://www.nda.gov.cn/sjj/zwgk/zcfb/1227/20251227100433509018891_pc.html → 国数科基〔2025〕70号, signed 2025-12-25, published 2025-12-27; 2027/2030 goals.
- 汽车数据出境安全指引（2026版）: https://www.nda.gov.cn/sjj/zwgk/zcfb/0203/20260203171849356062918_pc.html → 工信部联网安〔2026〕27号, eight issuers, signed 2026-01-30, published 2026-02-03.
- 绿电直连 2025: https://www.ndrc.gov.cn/xxgk/zcfb/tz/202505/t20250530_1398138.html → 发改能源〔2025〕650号, signed 2025-05-21, published 2025-05-30; no DC/算力 wording.
- 2026年度国家绿色算力设施推荐工作通知: https://www.ncsti.gov.cn/kjdt/tzgg/202609/t20260921_256885.html (Beijing S&T Commission repost) → 工信厅联节函〔2026〕433号, five issuers, signed 2026-09-08, published 2026-09-21; thresholds: GB 40879 grade ≥2, ≥3000 standard racks, 上架率 ≥60%, renewable share ≥ provincial 消纳责任权重, GB/T 44989 grade ≥2.
- NDRC 新型基础设施 definition: https://www.ndrc.gov.cn/xwdt/xwfb/202004/t20200420_1226031.html → 404; https://www.ndrc.gov.cn/fggz/fgzy/shgqhy/202004/t20200427_1226808.html → definition text (信息基础设施/融合基础设施/创新基础设施); press-conference statement, not a formal document.
- Other NDRC items seen but not recorded (energy-only): 关于促进新能源消纳和调控的指导意见 发改能源〔2025〕1360号 (https://www.ndrc.gov.cn/xxgk/zcfb/tz/202511/t20251110_1401469.html); 非化石能源电力消费核算指南（试行） (NDA list 2026-06-01).

## Dead ends / access notes (for the next person)
- curl to *.gov.cn / openstd.samr.gov.cn is blocked by the egress proxy (CONNECT 403); only WebFetch reaches these sites.
- npc.gov.cn, pbc.gov.cn, moj.gov.cn, mps.gov.cn, gkml.samr.gov.cn, amr.guiyang.gov.cn, sjt.sc.gov.cn, gaj.zhanjiang.gov.cn, ssf.gov.cn: robots/SSL/timeouts — use gov.cn, cac.gov.cn, mee.gov.cn, stats.gov.cn or provincial *.gov.cn reposts instead.
- Standard WebSearch rarely returns gov.cn results for Chinese titles; `mode: extended` with the exact 《title》 + 发文字号 reliably surfaces ndrc/nda/miit/gov.cn pages.
- Guessed gov.cn content_ URLs are unreliable (several 404s) — always search for the exact URL.
- NDA site (nda.gov.cn) home page is JS-rendered; list pages (/sjj/zwgk/zcfb/list/index_pc_1.html, /sjj/xxgk/zc/xzgfxwj/list/index_pc_1.html) are fetchable and are the best index of NDA documents.

## Definition / unit notes
- GB 40879-2021 grades are PUE bands; the 2026 green computing notice requires grade 2 or better and uses "标准机架" (annex definition) and 上架率 — not comparable with "2.5 kW 机架" counts in older MIIT statistics.
- ICT 15th FYP intelligent computing target (9,800 EFLOPS) is FP16 per the existing record; the MIIT release read here does not state the precision — keep the FP16 qualifier only if confirmed in the plan PDF.
- 数字经济核心产业 share of GDP targets (14th FYP 10%; 15th FYP 10.5%→12.5%) are in existing records; the 2026 工作要点 contains no new numeric target.

## Summary of discrepancies found in existing records
1. data_center_green_low_carbon_action_plan_2024: 成文日期 is 2024-07-03 (not 2024-07-01/month).
2. national_data_infrastructure_guidelines_2025: signed 2024-12-31, published 2025-01-06, 发改数据〔2024〕1853号 (record had 2025-01-07, no number).
3. computing_interconnection_action_plan_2025: signed 2025-05-21 (record had 2025-05-30 = publication), 工信部信管〔2025〕119号.
4. ict_industry_fifteenth_fyp_2026: signed 2026-08-12 (record had 2026-09-07 = publication), 工信部规〔2026〕188号.
5. fourteenth_fyp_national_informatization_plan and digital_china_overall_layout_plan_2023: issuance day not published → month precision.
6. mlps_regulation_draft_2018: still 预备制定 in the 2026 State Council legislative plan (国办发〔2026〕14号) — never finalised.
7. Task-list corrections: 场景培育实施意见 is 国办发〔2025〕37号 (2025-11-02), not a 2024 NDRC document; 关于促进企业数据资源开发利用的意见 is 国数资源〔2024〕125号 (2024-12-20), not 2025.

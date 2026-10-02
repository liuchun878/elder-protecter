# 独立核验报告：用药依从性干预的系统综述与 RCT 证据

核验角度：用药依从性干预的系统综述与 RCT 证据
核验日期：会话内完成；检索与抓取均为一手摘要页/全文页
方法：Europe PMC REST API（core 记录，含完整摘要字段）+ PMC 全文页 + Cochrane 官方证据页 + ClinicalTrials.gov API + DARE/CRD 记录。PubMed 直接抓取返回 HTTP 203 空壳，故改走 Europe PMC 镜像同一 MEDLINE 记录。

---

## 核验项清单

### 1. Cochrane CD000011.pub4《Interventions for enhancing medication adherence》（2014，Nieuwlaat et al.）

**报告中的原论断：** 纳入 182 项 RCT；结论原话为 "most interventions were complex and ... largely ineffective" 或类似；偏倚风险最低的 17 项试验中只有 5 项同时改善依从性与临床结局；"即使是最有效的干预，也没有带来依从性或临床结局的大幅改善"。

**核验结果：**
- 182 项 RCT —— **核验一致**
- 17 项最低偏倚风险试验中 5 项双改善 —— **核验一致**
- "即使最有效干预也无大幅改善" —— **核验一致**（逐字见下）
- "most interventions were complex and ... largely ineffective" —— **核验不一致（正确原话见下）**。Cochrane 从未使用 "largely ineffective" 这一表述。

**证据：**

[Tier 1] Nieuwlaat R, et al. *Interventions for enhancing medication adherence*. Cochrane Database Syst Rev 2014, Issue 11, Art. No.: CD000011. DOI 10.1002/14651858.CD000011.pub4 — [Cochrane 官方证据页](https://www.cochrane.org/evidence/CD000011_ways-help-people-follow-prescribed-medicines)（发布 2014-11-20）；[PMC7263418 全文页](https://pmc.ncbi.nlm.nih.gov/articles/PMC7263418/)

逐字引文（Main results，PMC 全文与 Cochrane 页一致）：
> "The present update included 109 new RCTs published since the previous update in January 2007, bringing the total number of RCTs to 182; we found five RCTs from the previous update to be ineligible and excluded them."

> "Of all 182 RCTs, 17 had the lowest risk of bias for study design features and their primary clinical outcome, 11 from the present update and six from the previous update."

> "Only five of these RCTs reported improvements in both adherence and clinical outcomes, and no common intervention characteristics were apparent. Even the most effective interventions did not lead to large improvements in adherence or clinical outcomes."

逐字引文（Authors' conclusions —— 报告想要的"复杂且效果不佳"原话实际在此）：
> "Current methods of improving medication adherence for chronic health problems are mostly complex and not very effective, so that the full benefits of treatment cannot be realized."

**备注（口径）：**
- 应引用的确切口径是 **"mostly complex and not very effective"**（作者结论），不是 "largely ineffective"。若报告正文写作 "mostly complex and not very effective"，即为逐字正确。
- 另一处附带数字：**182 项 RCT 的总参与者为 46,962 人**（逐字："The overall number of RCT participants was 46,962."），报告未使用，可用于补强。
- 检索截止 2013-01-11；该综述**拒绝做 meta 分析**，理由是异质性过大（逐字："we could not justify meta-analysis"）。若报告暗示这是定量合并结果，则口径错误——它是**定性叙述性综述**。
- Pub4 替代 Pub3（2008 Haynes 版，78 项 RCT）。

---

### 2. Cochrane CD005025.pub3《Reminder packaging for improving adherence to self-administered long-term medications》（2011）

**报告中的原论断：** 12 项 RCT / 2,196 人；"服用的药片数量比例平均 +11%（95% CI 6–17%）"；"舒张压下降 5.89 mmHg"；"自报依从人数比例无效 OR 0.89（0.56–1.40）"。

**核验结果：全部四项 —— 核验一致**（但"舒张压"与"药片比例"两项口径需修正/限定，见备注）

**证据：**

[Tier 1] Mahtani KR, Heneghan CJ, Glasziou PP, Perera R. *Reminder packaging for improving adherence to self-administered long-term medications*. Cochrane Database Syst Rev 2011, Issue 9, Art. No.: CD005025. DOI 10.1002/14651858.CD005025.pub3 — [Cochrane 官方证据页](https://www.cochrane.org/evidence/CD005025_reminder-packaging-help-people-take-long-term-medications)（发布 2011-09-07）；PMID 21901694

逐字引文（Main results）：
> "We included twelve studies containing data on 2196 participants; four of these studies were newly included in this 2011 update of our 2006 Cochrane review."

> "Six intervention groups in four trials provided data on the percentage of pills taken. Reminder packaging increased the percentage of pills taken (mean difference (MD) 11% (95% confidence interval (CI) 6% to 17%)). Notable heterogeneity occurred among these trials (I2 = 96.3%)."

> "Two trials provided data for the proportion of self-reported adherent patients, reporting a reduction in the intervention group which was not statistically significant (odds ratio = 0.89 (95% CI 0.56 to 1.40))."

> "We conducted meta-analysis on data from two trials assessing the effect of reminder packaging on blood pressure measurements. We found that reminder packaging significantly decreased diastolic blood pressure (MD = -5.89 mmHg (95% CI -6.70 to -5.09; P < 0.00001; I2 = 0%)). No effect was seen on systolic blood pressure (mean change -1.01, 95% CI -2.22 to 0.20; P = 0.1, I2 = 0%)."

**备注（口径 —— 这是本项最需要注意的地方）：**
- **+11% 的口径是"服药片数百分比（percentage of pills taken）"**，且**仅来自 4 项试验的 6 个干预组**，不是全部 12 项。异质性极高（I² = 96.3%）。报告若表述为"全体 12 项试验的依从性提升 11%"则为口径错误。
- **−5.89 mmHg 的口径是"仅 2 项试验的 meta 分析"**，且严格而言原文写的是 **"decreased diastolic blood pressure"，并未说明这 2 项试验的人群/疾病**；来源未说明具体是哪两项试验或何种人群。异质性 I² = 0%。报告称"舒张压下降 5.89 mmHg"数字正确，但**不可表述为一般人群效应**。
- 同一综述还报告**糖化血红蛋白下降 MD −0.72（95% CI −0.83 至 −0.60，I² = 92%）**，报告未使用，可补强。
- 作者结论原文相对温和，与"无效"的强硬解读有张力：
> "Reminder packing may represent a simple method for improving adherence for patients with selected conditions. Further research is warranted to improve the design and targeting of these devices."

---

### 3. JAMA 2014;312(12):1237-1247《Electronic medication packaging devices and medication adherence: a systematic review》

**报告中的原论断：** 作者 Choudhry et al.；37 项研究 / 4,326 人；"依从率差异区间 −2.9% 至 +34.0%"、"依从人数比例差异 −8.0% 至 +49.5%"；原话 "data supporting their use are limited"；"接入照护体系 + 记录给药事件 的设备最常有效"。

**核验结果：**
- 37 项研究 / 4,326 人 —— **核验一致**
- 两个差异区间 —— **核验一致**（逐字）
- "data supporting their use are limited" —— **核验一致**（逐字存在）
- "设备最常有效" —— **核验一致**（逐字存在）
- **作者归属 —— 核验不一致（严重错误）。该论文作者不是 Choudhry，而是 Checchi KD, Huybrechts KF, Avorn J, Kesselheim AS。**

**证据：**

[Tier 1] Checchi KD, Huybrechts KF, Avorn J, Kesselheim AS. *Electronic medication packaging devices and medication adherence: a systematic review*. JAMA 2014;312(12):1237-1247. DOI 10.1001/jama.2014.10059 — PMID 25247520（Europe PMC core 记录 authorString 字段逐字："Checchi KD, Huybrechts KF, Avorn J, Kesselheim AS."）
[Tier 2 独立交叉验证] [DARE/CRD 记录 12014059336](https://www.crd.york.ac.uk/crdweb/ShowRecord.asp?LinkFrom=OAI&ID=12014059336)："Checchi KD, Huybrechts KF, Avorn J, Kesselheim AS. Electronic medication packaging devices and medication adherence: a systematic review. JAMA 2014; 312(12): 1237-1247"
[Tier 2 第三处交叉验证] [BMJ Open 稿件参考文献列表](https://pmc.ncbi.nlm.nih.gov/articles/instance/10895245/bin/bmjopen-2023-072502.draft_revisions.pdf)

逐字引文（Findings）：
> "Thirty-seven studies (32 randomized and 5 nonrandomized) including 4326 patients met inclusion criteria (10 patient interface-only "simple" interventions and 29 "complex" interventions integrated into the health care system [2 qualified for both categories]). Overall, the effect estimates for differences in mean adherence ranged from a decrease of 2.9% to an increase of 34.0%, and the those for differences in the proportion of patients defined as adherent ranged from a decrease of 8.0% to an increase of 49.5%."

逐字引文（Conclusions and relevance）：
> "Many varieties of EMP devices exist. However, data supporting their use are limited, with variability in the quality of studies testing EMP devices. Devices integrated into the care delivery system and designed to record dosing events are most frequently associated with improved adherence, compared with other devices. Higher-quality evidence is needed to determine the effect, if any, of these low-cost interventions on medication nonadherence and to identify their most useful components."

**备注（口径 —— 作者混淆的可能来源）：**
- 该 JAMA 2014 综述与 REMIND 试验（核验项 4）**是两篇不同论文、两组不同作者**，唯一交集是机构（Brigham and Women's Hospital / Division of Pharmacoepidemiology）。**Choudhry NK 是 2017 年 REMIND 试验的第一作者，不是 2014 年这篇 JAMA 综述的作者。** 报告很可能把两篇论文的作者串了。
- 研究构成口径：27 项随机 + 5 项非随机 = 32 随机 / 5 非随机；且**类别有重叠**（原文注明 2 项同时属于 simple 与 complex）。37 = 10 + 29 − 2。
- 两个区间是**单项研究效应估计的范围（range），不是合并效应量或置信区间**。报告若把它当作 meta 分析合并结果则为口径错误——该文是系统综述，未做定量合并。
- "data supporting their use are limited" 逐字存在，但需注意原文是 "the data supporting **their** use are limited"（无前导 "the" 时仍逐字命中 "data supporting their use are limited"）。

---

### 4. REMIND 试验

**报告中的原论断：** 一项 n≈54,000 的 RCT 发现药瓶盖计时器、定时药盒、短信提醒与对照组无可辨别差异；来源标注为 JAMA Internal Medicine，经 Psychiatric News 转引。

**核验结果：**
- 存在该 RCT、JAMA Intern Med 出处 —— **核验一致**
- 样本量 53,480 —— **核验一致**
- 「药瓶盖计时器、定时药盒」两种干预 —— **核验一致**
- **「短信提醒」作为第三种干预 —— 核验不一致**。REMIND 的第三种干预是 **pill bottle strip with toggles（带拨片的药瓶贴条，Take-n-Slide）**，与短信/文本提醒无关。
- 结论逐字 —— **核验一致**
- 非劣效还是优效设计 —— **核验一致，为优效（superiority）设计，非非劣效**

**证据：**

[Tier 1] Choudhry NK, Krumme AA, Ercole PM, Girdish C, Tong AY, Khan NF, Brennan TA, Matlin OS, Shrank WH, Franklin JM. *Effect of Reminder Devices on Medication Adherence: The REMIND Randomized Clinical Trial*. JAMA Intern Med. 2017;177(5):624-631. DOI 10.1001/jamainternmed.2016.9627 — PMID 28241271；[PMC5470369 全文页](https://pmc.ncbi.nlm.nih.gov/articles/PMC5470369/)
[Tier 1] [ClinicalTrials.gov NCT02015806](https://clinicaltrials.gov/api/v2/studies/NCT02015806) —— 注册名 "Assessing the Impact of Low-Touch Devices on Medication Adherence"，acronym "REMIND"，enrollment 53,480（ACTUAL），负责人 Niteesh K. Choudhry

逐字引文（设计）：
> "This 4-arm, block-randomized clinical trial involved 53 480 enrollees of CVS Caremark, a pharmacy benefit manager, across the United States."

逐字引文（三种干预 —— 请特别注意第三种）：
> "Patients were randomized to receive in the mail a pill bottle strip with toggles, digital timer cap, or standard pillbox. The control group received neither notification nor a device."

> "The REMIND trial evaluated 3 low-cost adherence devices: (1) a pill bottle with an affixed strip with toggles that can be slid after each day's dose has been taken (Take-n-Slide; IC Innovations), (2) a pill bottle cap with a digital timer displaying the time elapsed since the medication was last taken (Rx TimerCap; TimerCap LLC), and (3) a standard plastic pillbox with 1 compartment for each day of the week."

逐字引文（主要结局）：
> "The primary outcome was optimal adherence (medication possession ratio ≥80%) to all eligible medications among patients in the chronic disease stratum during 12 months of follow-up, ascertained using pharmacy claims data."

逐字引文（结论）：
> "Low-cost reminder devices did not improve adherence among nonadherent patients who were taking up to 3 medications to treat common chronic conditions. The devices may have been more effective if coupled with interventions to ensure consistent use or if targeted to individuals with an even higher risk of nonadherence."

逐字引文（主要结果数字）：
> "In the primary analysis, 15.5% of patients in the chronic disease stratum assigned to the standard pillbox, 15.1% assigned to the digital timer cap, 16.3% assigned to the pill bottle strip with toggles, and 15.1% assigned to the control arm were optimally adherent to their prescribed treatments during follow-up. There was no statistically significant difference in the odds of optimal adherence between the control and any of the devices (standard pillbox: odds ratio [OR], 1.03 [95% CI, 0.95-1.13]; digital timer cap: OR, 1.00 [95% CI, 0.92-1.09]; and pill bottle strip with toggles: OR, 0.94 [95% CI, 0.85-1.04])."

逐字引文（优效设计证据 —— 功效计算与注册假设）：
> "We randomized 37 532 patients in the chronic disease stratum to achieve more than 80% power to detect a 1% difference in the percentage of patients who were optimally adherent between each of the individual intervention arms and controls as well as between each 2-way comparison of active arms, assuming that 2% of patients in the control group were optimally adherent, and an α of 5%."

ClinicalTrials.gov 注册假设逐字：
> "with the hypothesis that low-touch devices improve adherence over control and that the increase in adherence is agnostic across devices."

**备注（口径与年份 —— 报告另有多处需更正）：**
- **干预组成有硬错误。** 报告写"药瓶盖计时器、定时药盒、短信提醒"三项。正确三项为：**digital timer cap（药瓶盖计时器）／standard pillbox（标准药盒，即报告所谓"定时药盒"其实 pillbox 并不定时）／pill bottle strip with toggles（带拨片药瓶贴条）**。**"短信提醒"不是 REMIND 的干预**，REMIND 全程未发任何短信。这一项应判为核验不一致。
- **"定时药盒"本身也是误称**：标准塑料药盒只是按天分格的收纳盒，无计时或提醒功能。原文将其描述为 "a standard plastic pillbox with 1 compartment for each day of the week"。
- **设计是优效性（superiority）检验，不是非劣效。** 证据：功效计算以"检测出 1% 差异"为目标、注册明确写 "the hypothesis that low-touch devices improve adherence over control"。文献类型标注为 Randomized Controlled Trial + **Pragmatic Clinical Trial**。来源未使用 "noninferiority" 一词。
- **年份应为 2017，不是 2014**（JAMA Intern Med 2017;177(5):624-631；在线首发 2017-02-27）。报告的 Psychiatric News 转引链属实：[Psych News Alert 2017-02](https://alert.psychnews.org/2017/02/low-cost-reminder-devices-may-not.html) —— 但按 Tier 分级，应直接引 JAMA Intern Med 原文，而非转引 Psychiatric News。
- 分析样本口径：随机化 53,480 人，但**实际分析样本为慢性病层 36,739 + 抗抑郁药层 15,555**（因部分人在设备投放前失去保险资格）。报告若把 53,480 当作分析样本则为口径不精确。
- 次要发现（报告未用）：**直接头对头比较中，标准药盒优于带拨片贴条（OR 1.10, 95% CI 1.00-1.21）**；而在女性亚组中带拨片贴条反而更差（OR 0.86, 95% CI 0.79-0.93）。这是该试验唯一达到统计学显著的主要/次要对比。
- 该试验针对"忘记服药"这一机制设计，但结论提示**低接触设备不改变依从性**，与核验项 3 的 JAMA 2014 综述结论方向一致。

---

### 5. Front Public Health 2025;13:1701622（社区 ≥60 岁多重用药 Meta，49 篇）

**报告中的原论断：** MMAS-4 自报量表 OR 1.55（1.08–2.28）；连续型客观测量 SMD 0.00（−0.08–0.09）；"生活质量与死亡率均无效应，证据确定性 very low"。

**核验结果：全部三项 —— 核验一致**

**证据：**

[Tier 1] Durán-Luque M, Robles-Muñoz MR, Velasco-García ME, Gómez-Peña C, Cobos-Vargas Á, Núñez-Núñez M, Bueno-Cavanillas A. *Interventions to enhance in-home taking medication among older adults with multimorbidity/polypharmacy: a systematic review and meta-analysis*. Front Public Health 2025;13:1701622. DOI 10.3389/fpubh.2025.1701622 — PMID 41684359；PMCID PMC12891206（开放获取，已下载全文 XML 逐字核对）

逐字引文（Results）：
> "Of 7,980 citations, 49 articles met the eligibility criteria, corresponding to 48 unique studies. Medication adherence measured with the MMAS-4 indicated a significant effect (OR = 1.55; 95% CI 1.08–2.28; I2 = 32.4%), while continuous measures showed no effect (SMD = 0.00; 95% CI = -0.08–0.09; I2 = 2%). Readmissions decreased at medium-term follow-up (OR = 0.41; 95% CI 0.25–0.69). Results for ED visits were inconclusive due to heterogeneity. Primary care contacts showed a weak, non-significant effect (SMD = 0.06; 95% CI = -0.04–0.16; I2 = 42%). No effect was found for quality of life or mortality. DRPs and costs lacked conclusive evidence. Most studies had a moderate to high risk of bias. Certainty of evidence was very low."

**备注（口径 —— 一处措辞需收紧）：**
- **"生活质量与死亡率均无效应，证据确定性 very low" 基本有原文支撑，但"very low"的附着对象需精确。** 原文是两句分开的话："No effect was found for quality of life or mortality." 以及独立一句 "Certainty of evidence was very low."。原文**并未明确说"生活质量与死亡率这两项结局各自的 GRADE 确定性为 very low"**；"very low" 是全综述讨论范围内的总体表述。结论段落另有一句作"certainty of evidence was low"（未加 very），与摘要的 "very low" 存在**同一文内的措辞不一致**，报告应注明。
- **注意一个与报告叙述直接冲突的原始数字**：报告未提，但该综述报告**中期随访再入院率下降 OR 0.41（0.25–0.69）**，这是全文中最强的一个效应。报告的"干预基本无效"叙述若不同时呈现该数字，属选择性引用。原文同时限定 "effects were not sustained"。
- 研究数口径：**49 篇文章对应 48 项独立研究**（逐字 "49 articles met the eligibility criteria, corresponding to 48 unique studies"）。报告写"49 篇"正确，但若称"49 项研究"则不精确。
- 纳入标准：RCT 或准实验设计；≥60 岁居家、≥2 种慢病或 ≥5 种药物；≥30 天随访。检索截至 2024-07-09。PROSPERO CRD42024513056。
- **"连续型客观测量" 是报告的转述，原文只写 "continuous measures"（连续型测量），未声明这些测量是否客观或是否包含客观测量装置。** 建议报告不要以"客观"加强原文措辞。
- 发表时间口径：期刊卷期与页码标注为 2025;13:1701622，但 Europe PMC 记录的 firstPublicationDate / electronicPublicationDate 为 **2026-01-28**，PMID 为 41684359（属 2026 年 PubMed 收录批次）。若报告称"2025 年发表"，与卷期一致但与电子出版日期不一致，建议注明"卷期 2025，电子出版 2026-01"。

---

### 6. Kim et al., J Med Syst 2025（PMID 39821698）

**报告中的原论断：** App 提醒类干预 Meta 分析，26 项 RCT / 5,174 人，OR 2.371，SMD 0.279。

**核验结果：**
- 26 项研究 / 5,174 人 —— **核验一致**
- OR 2.371、SMD 0.279 —— **核验一致**（逐字）
- **"App 提醒类干预" 这一范围界定 —— 核验不一致（过度收窄）**

**证据：**

[Tier 1] Kim SK, Park SY, Hwang HR, Moon SH, Park JW. *Effectiveness of Mobile Health Intervention in Medication Adherence: a Systematic Review and Meta-Analysis*. J Med Syst. 2025;49(1). DOI 10.1007/s10916-024-02135-2 — PMID 39821698（Europe PMC core 记录）

逐字引文（Abstract）：
> "Twenty-six studies with 5,174 participants were included (experimental group 2603, control group 2571). The meta-analysis findings showed a positive impact of mobile apps on improving medication adherence (OR = 2.371, SMD = 0.279)."

> "The subgroup analysis results revealed greater effectiveness of interventions using interactive strategies (OR = 2.652, SMD = 0.283), advanced reminders (OR = 1.849, SMD = 0.455), data-sharing (OR = 2.404, SMD = 0.346), and pill dispensers (OR = 2.453)."

> "This study conducted a systematic review and meta-analysis of mobile app interventions targeting medication adherence in patients with chronic diseases."

**备注（口径 —— 两处必须修正）：**
- **干预范围界定错误。** 该 Meta 分析的对象是**移动 App 干预整体**（"mobile app interventions"），**不是"App 提醒类干预"**。提醒（"advanced reminders"）只是其**亚组分析中的一个类别**，该亚组效应为 OR 1.849 / SMD 0.455，**与报告引用的 OR 2.371 / SMD 0.279（全样本合并效应）不是同一个数字**。报告把总体合并效应挂在了"提醒类"标签下，属口径混淆。
- **"26 项 RCT" 这一说法无法从摘要核验。** 摘要逐字只说 "Twenty-six studies with 5,174 participants were included"（26 项**研究**），**未使用 "RCT" 字样**，也未在摘要中说明纳入设计。文献类型标注为 Meta-Analysis / Systematic Review，题名亦未限定 RCT。研究正文（付费）声明聚焦既往 RCT（逐字："by focusing on previous randomized controlled trials"），故"26 项 RCT"**很可能成立但摘要层面无法确证**，建议报告改写为"26 项研究（正文称聚焦既往 RCT）"。
- 样本拆分可核验：实验组 2,603 + 对照组 2,571 = 5,174，内部自洽，**核验一致**。
- 检索口径：8 个数据库，检索日 **2023-04-21**，限 2013–2023 年发表。故该文**不覆盖 2023-04 之后**的证据，报告若用它代表"当前"证据需注明。
- 发表年份口径：DOI 为 10.1007/s10916-**024**-02135-2，卷期标注 2025;49(1)。"J Med Syst 2025" 与卷期一致。
- 该文为**订阅制，无开放获取全文**（Europe PMC isOpenAccess = N；Springer 抓取被重定向至 idp.springer.com 登录页）。以上全部结论基于 MEDLINE 摘要字段，**未能核验正文中的具体纳入研究清单、异质性 I²、发表偏倚结果或 GRADE 评级**。

---

## 新发现（补强用）

- **Nieuwlaat 2014 的参与者总数**：182 项 RCT 累计 46,962 名参与者（逐字 "The overall number of RCT participants was 46,962."）。另：其中 44 项 RCT 未达到每组 60 人的最低样本量要求（80% 功效检出 25% 绝对依从性差异），故部分阴性结果不具说服力。可用于说明"证据量增长但质量未同步"。
- **Nieuwlaat 2014 明确拒绝定量合并**：原文 "we could not justify meta-analysis"，理由为异质性过大致使合并会暗示不存在的可比性。任何把该综述结果表述为合并效应量的说法都与其方法不符。
- **Cochrane CD005025 额外的临床结局数字**：糖化血红蛋白 MD −0.72（95% CI −0.83 至 −0.60；P < 0.00001；**I² = 92%**，异质性很高）。与"舒张压 −5.89、I² = 0%"形成鲜明对比，可用于说明该综述内部证据稳健性差异极大。
- **REMIND 的注册编号与正式名称**：NCT02015806，"Robust Evaluation to Measure Improvements in Nonadherence From Low-cost Devices"，正式题名 "Assessing the Impact of Low-Touch Devices on Medication Adherence"。注册假设原文可作为"优效设计"的直接书证："the hypothesis that low-touch devices improve adherence over control and that the increase in adherence is agnostic across devices."
- **REMIND 唯一显著的设备间差异**：标准药盒 vs 带拨片贴条 OR 1.10（95% CI 1.00-1.21），即在三种低接触设备中，**最"笨"的普通药盒反而略优于带拨片的贴条**。这与"越复杂越有效"的直觉相反，是很有价值的一条反证。
- **Front Public Health 2025 的最强阳性结果**：中期随访**再入院率 OR 0.41（95% CI 0.25–0.69）**，但原文限定效应不持续（"effects were not sustained"）。报告的"普遍无效"叙述宜补入此条以平衡。
- **两篇文献的作者区分（供报告勘误）**：JAMA 2014;312(12):1237-1247 = **Checchi / Huybrechts / Avorn / Kesselheim**；JAMA Intern Med 2017;177(5):624-631（REMIND）= **Choudhry / Krumme / … / Franklin**。二者同属 Brigham and Women's Hospital 药物流行病学部门，极易混淆，报告当前已将两者作者对调。

## 缺口

- **CD005025 舒张压那 2 项试验的具体身份、人群与疾病未找到。** Cochrane 摘要原文只说 "two trials"、"blood pressure measurements"，未点名；Cochrane 全文与 Wiley 需订阅，多次抓取均被重定向至登录页。**来源未说明**该 −5.89 mmHg 适用于哪类患者，故该数字的适用人群目前**无法核验**。
- **CD005025 那 4 项（6 个干预组）提供"药片服用比例"的试验身份未找到**，同上原因为全文付费墙。+11% 的效应所依据的试验组合无法验证。
- **Kim 2025 正文未能获取**（订阅制，Europe PMC 无开放全文，Springer 链接被重定向至 idp.springer.com）。因此**无法核验**：26 项研究的清单、"RCT"设计确认、异质性 I²、发表偏倚 fail-safe N 结果、GRADE 评级，以及 OR 2.371 / SMD 0.279 各自的置信区间。**摘要未给出任何检验统计量的 95% CI**，报告若需引用区间则无来源可依。
- **JAMA 2014（Checchi）原文全文未能获取**（PMC4209732 在 Europe PMC 的 fullTextXML 端点返回 HTTP 500，HTML 镜像被 Cloudflare 403 拦截）。"接入照护体系 + 记录给药事件最常有效" 这句**已在摘要结论中逐字核验**，但**支撑该句的具体研究数量与效应量未能核验**。摘要仅给出两个区间范围，未给出任何合并估计。
- **未做**：本次核验未检索 Cochrane 更晚的更新版（CD000011 之后是否有 pub5、CD005025 之后是否有 pub4）。若报告要声称"最新证据"，需另查这两个综述的当前版本状态。CD005025.pub3 定为 2011 年，距今已远，报告若称其为"当前证据"存在时效风险。
- **未做**：未核验"短信提醒"类干预的相关 Cochrane 综述（CD011851，文本提醒对心脏病用药依从性），尽管它在本轮检索中作为相关条目出现过。若报告需要为"短信提醒无效"提供正当出处，CD011851 才是合适来源，而 REMIND 不是。
- **未做**：未检索任何中文数据库（CNKI/万方），未覆盖非英语文献。

---

## 置信度

**Established（已确立）** —— 针对核验项 1、2、3、4、5 中的**所有数字**。

理由：
- 每一项数字都取自**一级来源的官方记录**，而非二手转述：Cochrane 官方证据页与 PMC 全文（CD000011）、Cochrane 官方证据页与 MEDLINE 摘要（CD005025）、欧洲 PMC core 记录的摘要字段（JAMA 2014、JAMA Intern Med 2017）、开放获取全文 XML（Front Public Health 2025）、ClinicalTrials.gov 注册档案（REMIND 设计）。
- 关键论断均**做了独立第二来源交叉验证**：JAMA 2014 的作者归属由 Europe PMC、DARE/CRD 记录、BMJ Open 参考文献列表**三处独立确认**为 Checchi 等而非 Choudhry；REMIND 的设计与样本量由期刊论文与 ClinicalTrials.gov 注册**两处互证**（53,480 在两处逐字一致）；CD005025 的四个数字在 Cochrane 官方页与 MEDLINE 摘要**两处逐字一致**；CD000011 的 182/17/5 在 PMC 全文与 Cochrane 官方页**两处逐字一致**。
- 未依赖任何 Tier 3/4 来源。所有引文均为英文原文照抄，未经改写。

**该置信度不覆盖的部分**（对应上文缺口）：CD005025 舒张压与药片比例两项效应的**试验身份与适用人群**、Kim 2025 的**正文细节与置信区间**、Checchi 2014 支撑句的**具体研究数量**——这三处均因付费墙或端点故障未能取证，**来源未说明即为未说明，未做补白**。

**发现的三处实质性错误（主代理应据此修订报告）：**
1. **JAMA 2014 作者归属错误** —— 应为 Checchi KD, Huybrechts KF, Avorn J, Kesselheim AS，而非 Choudhry et al.（严重：影响引用可追溯性）
2. **REMIND 干预组成错误** —— "短信提醒"应为"pill bottle strip with toggles"；且"定时药盒"实为无计时功能的标准药盒（严重：改变干预性质）
3. **Kim 2025 范围界定错误** —— 该 Meta 分析是移动 App 干预整体，OR 2.371 为全样本合并效应；"提醒"亚组效应是 OR 1.849 / SMD 0.455，两者不可混用（中等：混淆了亚组与总体）

**另需主代理注意的口径风险（非错误但易被误读）：** CD005025 的 +11% 仅基于 4 项试验（I²=96.3%）且为"服药片数百分比"；−5.89 mmHg 仅基于 2 项试验且原文未说明人群；JAMA 2014 的两个差异是单项研究效应范围而非合并估计；CD000011 的"complex and not very effective"是作者结论措辞，报告所引 "largely ineffective" 无出处；Front Public Health 2025 的 "very low" 是总体确定性表述而非逐结局评级，且全文另有 "certainty of evidence was low" 的不一致措辞。

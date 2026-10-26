# 企业报表（W2-02）

来源：`rules/sources/official/enterprise-2019-appendix2.pdf`，资产负债表第2–3页及说明第3–10页、利润表第10–11页及说明第11–15页、现金流量表第15–16页。此文件是报表格式，不是完整科目编码来源；`books-enterprise-review` 的9科目只是待核工程样例。

## 功能清单

- 本次实现：报表管理→`w_bb_get` 引入、`w_bb_proc` 生成/重算、`w_bb_saveas` Excel 导出的企业表样，编码201/202/203，严格使用实际 `ReportTemplateSchema`。表样包含所有列示项目（含其中项、其他综合收益扩展项、每股收益），不是会计科目模板，也不会自动登记成已完成的法定报表。
- 本次实现：`buildBalanceSheetSlice` 按显式组成角色映射启用部分期末余额；固定资产原值、累计折旧、减值、清理四个角色缺一即拒绝，不能用原值roots列表启用净额。在建工程、使用权资产、无形资产、商誉等也要求各自全部组成角色。各角色必须是`mapped`真实账户、`zero`真实账户及声明理由，或`notApplicable`及理由；零声明仍取实际数并单独勾稽，不适用声明进入报表供核对，全部角色不适用时保持文字。借正贷负求净额，负债/权益改为贷方正数；拒绝重复、父子重叠及不存在账户。不启用需重分类项目、未分配利润和各合计。
- 本次实现：`buildCashflowSlice` 按明确的现金账户和现金流量项目映射取当前月净发生额；退款反向冲减、已映射账户间同项目内部划转净抵销。所有直接组成项均配置后才计算相应小计。政府补助应映射到“收到其他与经营活动有关的现金”（PDF第16页说明），不能按资产相关/收益相关分流。
- 本次实现：待配置金额以文字保留；比较数不冒充本月期初；完整性未满足时保留全表“未完成”提示。勾稽检查直接引用实际总计，待配置时显示错误，不能据局部金额判断全表平衡。
- 沿用引擎：只读表样可复制；重复编码不覆盖、未过账先确认、权限检查、同事务取数、生成失败保留上次快照、真实xlsx。独立测试使用core/testkit，不依赖同波其他页面。
- 接入共享PR112后的实际切片（`period-slice.ts`）：201两列独立组成角色声明，取生成期末及上年12月末；202按当前月/本年累计净发生、仅排`pnl`结转，保留普通及自定义转账，直接组成项目齐备才计算营业利润/利润总额/净利润；203当前月/本年累计及上年同期项目与小计。三表均经真实router及独立浏览器生成、Excel下载验证，默认JSON表样仍不自动绑定账户。
- 应收/预收重分类切片：`addReceivableReclassification`按末级和partner分别分正借/正贷，不同往来不抵销；应收坏账准备必须单独映射或声明，10500分应收净额/5000分预收已手算回归。未实现的其他重分类不据此称完成。
- 采购侧候选已停用、不可放行：`purchase-reclassification.ts`的`buildPurchaseReclassificationComparatives({period,current,previous},accounts,partners)`保留201全部官方项目及采购两行数值候选，但四个结果格均无条件引用文本，沿真实`generate`公式错误路径拒绝所有期间的新快照。没有启用参数或本地validator通过标志。独审发现原固定日期公式可被公共接口存成其他月份快照；仅换相对期间也不能证明分类适用于新报告日，因此在公共持久化guard接入前不再交付可生成形态。正黄金13000/5500、4000/15000分及xlsx/UI断言均保留，不删断言或标skip；它们当前会被停用保护阻断，属于待共享接入的目标，未声称通过。
- 保留的采购数值候选使用真实`BALANCE`的`current`/`previousYearEnd`，逐末级逐partner先取正借/正贷再汇总，贷方不再取负；两日期的来源及分类仍须独立明确。两方向分别核对来源与已分类金额（含明确排除），不以净额抵销代替分类完整性。新增202601/202602均不可生成/导出的停用负黄金，以及“202601正例成功后，202602即使有新采购发生也必须因日期绑定拒绝”的待共享目标测试；前者只是局部停用保护，不是公共期间门禁。所有新增运行测试仍未验证。

## 未完成项与共享需求

- 完整资产负债表取数；上年年末/年初和追溯调整比较数；应收、预付、应付、预收逐末级/往来借贷重分类；应交税费中待抵扣等增值税借方明细的资产列报；坏账准备逐项目分配；期限及正常营业周期分类；合同资产/负债同合同净额及减值；债权投资、租赁负债一年内到期拆分；合同取得/履约/退货成本与应付退货款；金融资产及权益工具分类；未分配利润加结转前本年损益；长期应付款扣融资费用并加专项应付款；投资性房地产计量模式等。未映射账户不推断为不适用或零。
- 完整利润表及任意比较口径；当前切片已实现月度/本年累计和上年同期、排除真实损益结转及净发生额的退回/损失符号。研发/管理要求账户映射不重叠，尚无自动分析分摊；利息/投资其中项仅支持明确映射，未自动判断；持续/终止经营、税后其他综合收益明细与每股收益仍待实现。默认202.json仍只有表样，只有显式映射的builder产物才有已实现部分数值。
- 完整现金流量表：项目多对多分配及分配完整性、无项目现金分录定位、内部划转/非现金交易自动排除、现金等价物/受限资金定义、汇兑影响、期初期末及比较期间；本切片不根据货币资金余额冒充现金及现金等价物。
- 已读取并使用共享的实际`BalanceFunctionSchema/balanceFormula({原7字段,options})`，第8参数由唯一helper序列化。`from/to`支持`current|yearStart|previousMonth|previousYearEnd|previousYearSameMonth|previousYear|previousYearStart|YYYYMM`；`previousYear`是上年同月别名。opening取from前期初、closing取to期末、发生额取闭区间、ytd按to年度。`closing=include|exclude|excludePnl`仅允许发生额，余额不排结转；`side=debit|credit`按末级及groupBy先分方向后返回正数，仅本币期初/期末signed。安全比较、惰性IF/MAX使用共享实现，不另造引擎。启用前、缺失期间或未知累计来源拒绝，不编零。
- 原子模板预检及同编码只读模板的安全升级仍缺，不通过覆盖/删除绕过。当前跨期/排结转/重分类项目禁止使用旧页面底部自动明细链接，表内已显示明确提示；准确期间、结转过滤及分组穿透等待web owner。合同仍需合同ID净额及流动性元数据，民非限定/非限定元数据仍未实现，不用项目替代。
- 采购候选仅覆盖明确来源内的逐末级逐往来分类，不判断未映射来源是否齐全，不把一组内不同合同/期限自动拆分，不自动分配减值或填入排除金额的另列去向。相对期间只能决定取数时点，无法验证旧分类在新报告日仍有效；表头日期和警告不能充当绑定。科目结构或期限事实变化后同样须重新核对；原末级新增下级时`BALANCE`仍包含下级，不能把范围核对当作结构门禁。原完整三表目标及上列全部未完成项保留，采购候选当前整体不可生成。
- 公共法定profile持久绑定、`generate`原子预检、审核失败阻止导出仍缺。采购模板内的范围核对公式只约束该特定builder产物，不是公共强制门禁，不能阻止通用导入自行编写的其他模板。局部金额正确时，整表待配置项目仍会使审核报错，而公共`exportResult`目前仍可导出；新增单测明确保留这个缺口。
- 共享期间guard所需契约（需求，尚无对应公共字段/API）：引入时须以结构化数据持久化账套/profile及其修订、唯一分类报告期、由此确定的上年12月末、两个时点各自的来源/流动分类及依据、映射修订和科目/往来结构版本，并与模板ID/修订绑定，不能从A3文字推断。具体字段及业务错误码由公共owner定义；当前严格`ReportTemplateSchema`没有这些字段，本模块不伪造扩展API。
- 公共`generate`必须在同一事务中、任何幂等快照回放/余额取数/快照写入之前验证绑定：input.period必须等于分类报告期，上年末来源必须属于该绑定的上年12月末，profile/映射/科目与往来版本均有效。缺失、日期不符或过期必须明确拒绝，不能自动复用本期分类或把“不变的余额”当作期限依据。新快照须保存绑定修订；导出/打印及幂等回放同样须拒绝无效、跨期、未绑定和审核未通过的法定结果。旧快照不因候选有表头日期而自动可信。公共owner实现并经正例/跨期负例验证前，不移除本地停用保护。
- 仅正常合入根授权的共享PR112快照，没有手改共享server/shared/web；无自动模板安装/映射页面。原引擎README全部未完成项继续有效：旧S/W/F别名、外币/数量累计、现金流量期初分配、跨账套/旧备份引入、粘贴撤销及插删行列、完整格式/分页套打、布尔审核、取数追踪及辅助穿透、关闭确认与草稿合并、超大报表性能、报税及共享打印/桌面，均未在此补齐。

## 试用

1. `cd app`，Node24与pnpm10.28，`pnpm install --frozen-lockfile`。
2. `pnpm exec vitest run modules/report-engine/test/enterprise`；`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm check`（未设置CI时零retry），或先`pnpm build:web`再`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm exec playwright test modules/report-engine/e2e/enterprise --retries=0`。
3. 报表管理→引入JSON模板→本目录201/202/203文件仅试表样。实际取数请在新的独立账套直接导入builder产物，不要先导入同编码表样：已有同编码只读模板的安全升级尚未实现，重复编码会拒绝。
4. 局部取数：`buildBalanceSheetSlice({ fixedAssets: { gross: {state:'mapped', accounts:['原值编码']}, accumulatedDepreciation: {state:'mapped', accounts:['折旧编码']}, impairment: {state:'mapped', accounts:['减值编码']}, disposalClearing: {state:'notApplicable', reason:'该账套本期无固定资产清理业务'} } }, await svc.accounts.list())`。其中不适用是调用方明确声明，会显示在报表供复核，程序不据科目编码自动判断会计含义；`zero`声明必须带实际账户及理由，实际余额非零时仍计算真实净额并审核失败。现金流量接口继续为`buildCashflowSlice({ cashAccounts: ['确认过的现金账户编码'], items: { salesReceipts: '确认过的现金流量项目编码' } }, await svc.accounts.list())`。各角色最多6个账户根。具体造数、127000原值→95000净额及零/不适用回归见`test/enterprise`。不要用9科目工程样例替代完整科目映射。
5. 比较期及利润切片使用`buildBalanceSheetComparatives(本期角色,上年末角色,accounts)`、`buildProfitSlice(本期项目,accounts,真实损益类别ID数组,{scope:'month'或'yearToDate',previous:上年同期项目})`和`buildCashflowComparatives(本期映射,上年同期映射,accounts,scope)`。可执行的两年造数、损益结转、年结期初、期间缺失与真实UI流程在`period-fixture.ts`、`period-slice.test.ts`及`e2e/enterprise/period-slice.spec.ts`；不需要其他模块页面。
6. 采购候选目前仅供审阅结构，直接引入后在202601或202602均应拒绝生成，不可试作可用报表；不先引入同编码空表样。`current`和`previous`各含`prepayments`/`payables`来源根及`items`；每项指定末级`account`/`partner`和`debit`/`credit`两方向分类，流动为`{state:'current',reason:'该报告日依据'}`，排除为`{state:'excluded',reason:'排除依据',destination:'另列去向'}`。完整合成输入在`test/enterprise/purchase-fixture.ts`。8条新单测和3条新E2E均未运行；待共享的正黄金、分类/期间拒绝及xlsx目标未skip，当前因整体停用不能全绿。正黄金E2E保留B40与排除依据行的UI断言，通过真实“网格起始行”控件分别切到对应范围，不用xlsx代替这两项UI验证。本轮标准安装被`baseline-browser-mapping@2.11.33`最小发布年龄策略拒绝，未绕过；完整`pnpm check`仍未执行。

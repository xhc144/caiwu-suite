# 民非2026两表计算模块

本模块提供财会〔2024〕25号自2026年起施行的资产负债表、业务活动表计算预览、明确缺失原因、两表净资产勾稽及安全CSV/本地HTML打印导出。只接收显式分类、期间和覆盖声明，不记账、不修改账套；所有结果始终 `CanIssueAsFormal=false`。完整数值表示本模块约定内的计算完成，不表示整套财务报告或软件整体合规。

## 入口与集成

生产项目 `Caiwu.Nonprofit.Reporting.csproj` 为 `net10.0`，只引用既有 `Caiwu.Contracts`；无新生产NuGet依赖，不引用WPF、SQLite、Core或规划服务。根集成方可把此项目加入solution并给Desktop增加项目引用；此分支没有修改这些公共文件。

```csharp
using Caiwu.Nonprofit.Reporting;

// 用户先在独立WPF分类面板完成分类并另存JSON；宿主指定用户数据目录。
var snapshot = ledgerService.GetSnapshot();
var files = new ClassificationJsonStore(userDataDirectory);
var manifest = files.Load(selectedClassificationFileName, snapshot);
var source = new LedgerSnapshotStatementDataSource(ledgerService.GetSnapshot, manifest);
var preview = source.CreateBoundPreview(generatedAt);
var balance = preview.Statements.BalanceSheet;
var activity = preview.Statements.ActivityStatement;
// 绑定Columns与Lines.Values；Amount为null必须显示缺失原因。
// 若源已变化，下列带来源检查的导出会在写入前拒绝旧分类。
using var output = new FileStream(userSelectedCsvPath, FileMode.CreateNew);
preview.WriteCsv(NonprofitStatementForm.ActivityStatement, output);
```

`LedgerSnapshotStatementDataSource`已实现 `INonprofitStatementDataSource`，从当前保存快照和与来源绑定的显式分类清单提供数据。也可用 `source.CreateContext(generatedAt)`取得相同来源上下文，再调用两个Read方法。`SourceLedgerRevision`是账簿版本，不能用规划版本替代。[数据源、JSON和操作流程](Classification/README.md)；[独立WPF接线](Wpf/README.md)。

### 与现有两种来源的差异

| 现有来源 | 已有信息 | 尚不能直接提供的报表信息 |
|---|---|---|
| `LedgerSnapshot` / `VoucherLine` | 账套、账簿版本、日期、凭证状态、科目、借贷 | 稳定行ID、限定类别、限制ID/版本/来源、项目及成本组成、转类/结转/前期调整角色、到期与减值归属、完整年度覆盖和年初依据 |
| 民非领域 `PlanningState`（当前代码的实际类型名） | 单月、分类余额、限制证据、规划版本、来源账簿版本、规划阶段 | 已批准记账事实、年初报表、完整YTD普通发生额、全套资产负债分析；结转后的零损益余额不能恢复本期发生额 |
| `NonprofitProposal.ProjectedState` / `VoucherSuggestion` | 待审建议、稳定建议行ID、业务类型和证据 | 审核/记账状态、真实持久化与历史完整性；投影不是账簿 |

`LedgerSnapshotGapAnalyzer.Analyze`描述原快照的固有缺口；现已提供 `LedgerSnapshotStatementDataSource`＋显式分类JSON解决可操作的读取与补维度。科目语义、分录角色/类别、成本组成、到期与受托明细、完整覆盖和年初依据由用户明确输入，未确认的仍缺失。账套/科目/已记账金额直接来自保存快照；基础余额禁止手填覆盖。未修改Contracts或SQLite。定位采用BookId＋revision＋快照hash、凭证ID＋分录序号＋内容hash；源变更必须重核，未声称跨revision永久稳定行ID已经落盘。

调用方若用于规划预览，必须指定 `PendingReviewProjection`，导出和DTO都会保留“待审假设投影，非已记账事实”。即使规划阶段为 `ClassifiedClosingComputed`，也不能据此改称真实结账。可选集成测试调用固定提交 `7b8e8b74dfa4b704b439722573687ee1044ac424` 的真实规划服务，演示这一边界；未再造计划服务。

`StatementContext.SourceLimitations`用于来源已知但本版未覆盖的事项，例如直接投入注册资金、额外主要收入单列或行业专门列报要求。传入后整体保持 `Incomplete`，即使各数值都有值。宿主不能为了得到完整状态清空已知限制。

## 精确输入口径

### 资产负债表

`BalanceSheetInput`分别包含同年1月1日 `YearOpening`、报告期末 `Closing`。两列的日期必须吻合；本期期初不能替代年初。`BalanceColumnInput`中每一个 `BalanceFact`须单独提供有证据的金额，包括经确认的零；省略或 `Amount=null`将产生 `NP_BALANCE_FACT`，并传播到依赖合计。

一般资产为借方正；一般负债、净资产及抵减准备为贷方正。固定资产清理允许贷方负值；应付职工薪酬、应交税费允许借方负值；净资产也保留负数。准备/累计折旧摊销负值及到期部分超过总余额会标记 `NP_BALANCE_ANALYSIS`。

- `Cash/BankDeposits/OtherMonetaryFunds` 对应1001/1002/1009全部相关末级一次汇总；`AgencyMonetaryFunds`是其中受托代理明细，货币资金扣除、受托代理资产加回一次。`DedicatedAgencyAssets`仅为1801专门科目，不能再包含货币科目中的同一资产。
- 短期投资1101与1102、应收票据1111/应收账款1121/其他应收款1122与1131、预付1141、存货1201与1202、待摊1301均分别取数。
- 长期投资1401/1402/1403与1421减值归属、长期债权/其他投资的一年内到期部分须显式分析。`LongDebtInvestments/OtherLongInvestments`为重分类前总余额；相应到期事实是其子集，不能同时输入已扣除到期部分的总余额。若 `DueWithinYearInvestmentAllowance`非零，流动投资净额可计算，受影响非流动行和总计保留缺失，要求复核到期减值与长期减值的归属，避免重复扣减。本版不猜测分配。
- 固定1501/1502、在建1505、文物1506、清理1509、无形1601/1602、长期待摊1701按表样取数；另显式提供固定/无形资产减值准备（如无须明确0）。固定净值及无形净值抵减减值准备，未编造新的官方一级科目编码。
- 应付款项对应2201/2202/2209，职工2204、税费2206、预收2203、预提2301，短借2101、长借2501、长期应付2502、预计2503、受托代理负债2601；长期借款/应付/其他长期负债先按显式到期部分转列流动。其他流动资产/负债、其他长期负债由有依据的分析余额提供。
- 非限定3101、限定3102仅在 `ClosedAndReconciled`声明及证据齐备时取值。未结转或状态不明时这两行与依赖合计留缺失，不能擅加未结转损益。
- 2026年初可用 `Reviewed2026TransitionLedger`；以后年度须按当年口径复核上年末报表。未核年初依据会保留整列缺失。

输出47个基础金额项目，保留官方左右两侧各自顺序、标签和说明项号；在DTO/HTML中按组串行展示，未声称复刻官方左右排版。资产等于负债加净资产不平衡时记录 `NP_BALANCE_EQUATION`，禁止倒挤。

### 业务活动表

`ActivityWindowInput`是一个明确起讫期间的完整发生额集合。`Current`须精确覆盖本月/季/半年，`YearToDate`须覆盖1月1日至报告期末。二者重叠的稳定发生额ID与数据必须完全相同。缺窗口会留下该组列的 `NP_ACTIVITY_WINDOW`；错日期、重复ID及冲突口径直接拒绝。

- `CoveredFacts`是逐项目的完整覆盖声明，覆盖两类和已确认零发生额；须有 `CoverageEvidenceReference`。**只有该项目已明确完整覆盖且没有发生额时才计算0**。未覆盖项目不是0；声明必须来自真实业务完整性核对。
- 普通收入按贷方减借方，普通费用按借方减贷方；`Amount`允许经审的负收入、投资净损失、冲回费用与减值转回。模块只列报，不作收入确认/退款/税务决定。
- 收入依官方表样顺序为捐赠4101、会费4201、服务4301、政府4401、销售4501、总部4701、投资4601、其他4901；费用为业务5101、税金5201、管理5301、筹资5401、减值5501、所得税5601、其他5901。
- 限定性行需限制ID、版本、项目、外部提供者/法律行政法规来源与证据。内部预算不能当限定类别。类别未知时两类及合计均留缺失；不能用科目总额猜分。
- `IncomeExpenseClosing`只用于收入费用结转并从普通发生额排除，不得用于转类/前期调整。结转前后普通活动金额保持一致。不能把期末已结零的余额当成本期收入费用。
- `ReleaseToUnrestricted`、`TransferToRestricted`是已审定的方向性转类，均须绑定具体限定范围。解除显示非限定+、限定−；增加限制显示非限定−、限定+；合计均0。限定费用直接减少限定净资产，**使用受限资产不会自动生成解除行**。
- `PriorYearNetAssetAdjustment`按3201最终影响分类，增加净资产为正；输入只记录调整事实一次，不能同时再把其转入3101/3102的机械分录重复列报。
- `Components`定义项目/服务/业务组成；每笔5101须关联已知组成且声明完整。`CharitableTrustEstablishment`生成“其中：设立慈善信托支出”。5401按 `FundraisingDisclosure`明确是否适用募捐成本披露，相关子集生成其中行。组成和其中行不再次计入费用总额。
- 5601的一般费用分类说明与专门结转说明需要专门判断；非零限定性所得税在额外复核及证据缺失时阻断该值。本模块不替代专业复核，也没有放开原领域服务的自动处理限制。
- 逐列净资产变动 = 收入合计 − 费用合计 + 限定转非限定 + 非限定转限定 + 以前年度调整。

中期为本期三列＋YTD三列。年度使用本年三列，年度上年比较可按合计列提供；2026首次执行未传上年比较时标记 `NotRequiredOn2026FirstAdoption`且不造0列。2027起缺上年比较会明确缺失。本版未实现中期比较列，若传入会拒绝，不能悄悄丢弃。

`NonprofitStatementReconciliation.Compare`以年初到期末两类净资产差额对照**本年累计**变动，同时核对账套、账簿版本、来源性质/证据和期间。已知来源存在本表未覆盖的直接净资产业务时，须传 `SourceLimitations`，勾稽失败不倒挤。

## DTO与导出边界

`NonprofitStatement`包含期间/账套/版本/时间、表号、状态、列、稳定项目键、公式与来源定位、`decimal?`值及缺失原因。集合为只读快照。`PresentationOrder`不是官方行次；原表样没有印行号，`OfficialRowNumber`始终为null，填列说明(1)…(43)等只作为定位。

金额为decimal且精确到分，采用对称Int64分范围；用BigInteger累计中间分值，结果越界抛异常。非显示的相抵中间和不提前当作金额字段截断。不舍入、不中途用double、不把缺失转换为0。结构错误直接抛异常；有效结构但资料不足返回 `Incomplete`与可显示的缺失原因。

既有 `Caiwu.Reporting.ReportDocument/ReportRow/ReportCell`构造器为internal，无法跨程序集直接构造。本适配沿用现有导出的安全政策，在新目录对独立DTO实现：CSV为RFC4180、CRLF、等宽记录、金额独立数值；危险文本含前置空白/格式字符/控制字符及全角公式符号时加单引号；流重载UTF-8 BOM。HTML全动态文本编码、自包含、无脚本/远程资源、CSP、重复表头和可设逻辑分页，保留状态、缺失原因、来源和公式。数值行没有额外“全表求和”而重复合计。

导出允许带明显缺失提示的计算预览；`FormalReport`目的总在写入前拒绝。流默认不关闭，I/O失败向宿主传播。宿主负责选路径、覆盖确认及成功提示。UI可直接使用本DTO；若根希望统一原ReportExporter，最小后续建议是在原owner审定后提供公开通用表格工厂，再替换此适配，不需要修改Contracts。

## 依据与覆盖限制

2026-10-25读取仓库Rules2026民非包，并直接核对官方原文。代码固定规则包 `nonprofit-2026-official` / `2026.10.25.1`，规则JSON SHA256 `0730548fdc4cd1db74f587ba050c2fd8849b32804e50c9eefa1394c561d3a4df`。

- [财政部《民间非营利组织会计制度》正式全文](https://yn.mof.gov.cn/caizhengjiancha/202504/P020250415689506085583.pdf)，SHA256 `35b47fb928e167293150187fff4b03cfc0b8c814b978b5dcbbb750650a4417c6`。PDF128–129资产负债表、130–131业务活动表、134–142资产负债填列说明、142–146活动表说明；28–35页分类/收入费用、103–107页3101/3102/3201处理；124–125页5601专门说明。
- [财政部财会〔2025〕6号衔接规定](https://www.mof.gov.cn/jrttts/202505/P020250521563512745169.pdf)，SHA256 `bdc2a3b37dc85d73ddf347a27679d854a448b176ce43c838168f53c5ac17aadf`，PDF4–5页2026年初表与首次比较数例外。

本模块未实现现金流量表、附注、行业/慈善监管全部要求、全部新增/自定义主要收入单列、注册资金直接投入完整列报、税务判断、完整新旧迁移。真实Core/SQLite读取、显式分类JSON和独立WPF面板已实现；主Desktop接线、分类纳入主备份和Windows实际操作验收仍由根集成。到期投资减值归属非零时主动留缺失；业务确认计量、成本分配合理性、解除条件与权限继续由来源和既有领域流程负责。没有修改安装/更新/卸载逻辑或账套保护。

验证与两组独立手算见 `../../tests/Caiwu.Nonprofit.Reporting.Tests/VALIDATION.md`。浏览器实际打印、Windows界面和真实业务账套尚未验收；没有以编译或测试数量宣称产品整体完成。

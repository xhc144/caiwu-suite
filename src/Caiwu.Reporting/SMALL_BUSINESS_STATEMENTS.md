# 小企业资产负债表、利润表计算预览

本首版根据财会〔2011〕17号正式表样计算会小企01表、会小企02表，逐行保留官方行次、名称和公式依据。资产负债表53行，利润表32行。所有输出恒为 `IsVerifiedForProduction=false`、`IsCompleteFormulaSet=false`；全部金额都有数值也不等于财务报表合规。未实现现金流量表、附注、企业准则财报、民非双维报表或自动年结。

依据与冻结范围：

- [财政部正式附录](https://kjs.mof.gov.cn/zhengcefabu/201111/P020111118325852734144.pdf)，PDF第68—75页资产负债表及编制说明，第75—78页利润表及编制说明；损益结转参见第52—54页。SHA256 `5e0b73597f57f3eb4d3a22ffcd5a1043df6ab852e1e852b5fc7212f6dfa17a65`，已与指定 rules 提交内归档字节核对。
- [固定规则快照](https://github.com/xhc144/caiwu-suite/blob/e00a404bc447bb7e0d56972ef320e1b2efc9d846/rules/packages/small-business.json)：`small-business-2011-base-2026-snapshot@2026.10.25.1`。该包只有代表性公式，仍保留其未验证生产和非完整公式集状态；本模块另记录公式版本 `sb-2011-17-statements-preview.1`，未修改 rules 包。
- 利润表行3等行名保留2011正式表样。规则包5403已有限更名为“税金及附加”；本模块未声称2011各税种其中行覆盖2026全部后续政策，说明会随CSV/HTML输出。

## API 与宿主显示

命名空间 `Caiwu.Reporting`，只引用既有 Contracts。无需修改 Core 或 SQLite 接口，直接传完整 `service.GetSnapshot()`。所有计算只使用科目期初和所选截止日之前的 Posted 分录；Draft、Reviewed、未来期间凭证不计入。

```csharp
SmallBusinessStatement SmallBusinessStatements.BalanceSheet(
    LedgerSnapshot snapshot, DateOnly asOf, DateTimeOffset generatedAt,
    SmallBusinessStatementOptions? options = null);
SmallBusinessStatement SmallBusinessStatements.IncomeStatement(
    LedgerSnapshot snapshot, int month, DateTimeOffset generatedAt,
    SmallBusinessStatementOptions? options = null);

var snapshot = service.GetSnapshot();
var balance = SmallBusinessStatements.BalanceSheet(snapshot,
    new DateOnly(2026, 1, 31), DateTimeOffset.Now);
var income = SmallBusinessStatements.IncomeStatement(snapshot, 1, DateTimeOffset.Now);
ReportExporter.WriteCsv(income.Document, csvStream);
ReportExporter.WriteHtml(balance.Document, htmlStream, new HtmlExportOptions(4));
```

仅支持2026年度、1月启用的完整账套、月报。资产负债表报告日须月末，两列为期末余额/年初余额。利润表指定月，两列为本年累计/本月；12月仍是12月月报，不把本月栏冒称上年比较。年中启用、其他年度、跨年数据、企业及民非制度明确抛 `NotSupportedException` 或 `ArgumentException`，不回填缺失历史。

`SmallBusinessStatement.Document` 供现有 CSV/HTML 导出；`Lines` 为只读官方行列表。每个 `StatementLine` 有 `RowNumber`、`Label`、`First`、`Second`、`Formula`、`SourceLocator`。`StatementValue` 包含 `decimal? Amount`、`Coverage`（Calculated/MissingData）、`Explanation`；空金额导出为“资料不足”，绝不转为数字0。`Issues` 列出未知科目、缺失行和资产负债勾稽差异。`HasAllNumericValues` 只说明数值是否齐全，不能用于开启“合规/已验证”状态。

宿主必须显示两列覆盖状态、缺失说明、公式版本及“未经生产核验”。绑定 `Document.Rows` 时，`Document.IncludeTotal=false`，不要再追加或累加通用 `Document.Total`：官方行间总计已在正文，资产总计不加存货其中行或固定资产原价/折旧/净值三行。

CSV/HTML元数据记录账套制度和原模板版本、规则包/提交/公式版本、快照 revision、期间/生成时间、覆盖/缺失行次、显式映射和结转排除 ID、未核验标志、附件地址与哈希。所有动态项沿用安全文本编码及 CSV 公式防护，无网络加载。分页与浏览器实际纸张页数边界沿用主 README；本轮未重试被阻的 Chromium，不声称完成打印版式验收。

## 数据、映射与明确缺口

完整快照是取数前提：未设置的正式科目且无凭证引用，表示这份账套没有该科目业务，其贡献为0；这不证明账外业务不存在。空科目表一律缺失。有余额或本年发生额的未知根科目会阻断所有行的确定取数，不丢到“其他”或忽略。无余额/发生额的未知科目仍列入问题。未平衡期初/Posted凭证、父行携带期初、非末级或未知科目分录、跨年Posted凭证、重复ID、循环或缺失父节点会拒绝。

默认仅按正式2011一级编码映射，多级沿真实 `ParentCode` 归根，只累计末级。自定义一级编码须显式传 `StatementAccountMapping(actualRootCode, officialCode)`，不按科目名字猜；映射限制于正式66个一级编码。未覆盖的法定可选科目也需显式映射/后续规则审定。

`SmallBusinessStatementOptions` 构造参数：

```csharp
new SmallBusinessStatementOptions(
    IEnumerable<Guid>? profitClosingVoucherIds = null,
    IEnumerable<StatementAccountMapping>? accountMappings = null,
    IEnumerable<IncomeDetailMapping>? incomeDetails = null,
    IEnumerable<ReportSource>? additionalSources = null,
    bool settlementLeavesAreCounterpartySeparated = false,
    IEnumerable<SettlementTermMapping>? settlementTerms = null);
```

往来科目1122/1123/2202/2203需要单位或合同分户，科目末级本身不证明已分户；总净额为0也可能藏有相反余额。未确认分户则相关六行留缺失。确认 `settlementLeavesAreCounterpartySeparated=true` 后，按末级借贷余额重分类：应收/预收的借方列应收账款，应付/预付的贷方列应付账款；预付及应付借方进入预付，应收及预收贷方进入预收。后两类还需每个相关末级的 `SettlementTermMapping(code, openingOverOneYear, closingOverOneYear)`，分别确定年初和期末是否超过1年，长期部分列其他非流动资产/负债；缺期限则两个可能承接行均缺失。分类来源是调用方提供资料，未独立核验。

1501长期债券投资、1801长期待摊费用、2501长期借款、2701长期应付款和2401递延收益有余额时缺到期/摊销明细，相关流动与非流动项目及依赖总计留缺失。1901待处理财产损溢缺资产类别、4101/4401/4403未处理成本归集时也显式留缺失。1404材料成本差异可带符号进入存货总额，但未按原材料归属时原材料其中行缺失。

固定资产净值=1601借正贷负余额+1602借正贷负余额；折旧单独展示为贷方正数，不再次扣减其负余额。生产性生物资产和无形资产使用同样的带符号抵减原则；税费借方及固定资产清理贷方按正式说明负列。

未分配利润行51严格按正式说明的3104填列。损益科目或3103仍有余额时，此行及依赖权益总计留缺失；首版不自行发明结转或把未结转净利塞入利润分配。年初栏从账簿1月期初计算，尚未与上年末法定资产负债表核对。

利润表主项目从经营净发生额计算，贷方收入正列，借方费用正列，退回、投资损失、利息收入和亏损保留符号。结转会使净发生额归零，因此调用方须用 `profitClosingVoucherIds` 明确标记结转；只接受已记账、含3103且仅涉及损益/3103/3104的凭证。未分类但涉及3103与损益的凭证会让利润表留缺失，不按摘要或凭证字猜测。损益年初余额非零也留缺失。

利润表“其中”行只接受 `IncomeDetailMapping(officialRowNumber, actualAccountCode)` 的显式类别映射，可映射一个父科目的末级集合；须属于该行主科目且各映射不得重叠。同一费用仅计一次。无映射但对应主科目有发生额时留缺失；完整期间确无该主科目经营分录时才可证为0。所得税仅取5801实际账簿金额，不测算税法申报额。

## 独立手算与实际验证

样例A：银行期初100000/资本100000；购材料10000、费用1200、收入20000。银行108800，材料10000，资产118800，利润18800。试算借方合计120000包含费用，不能拿来作资产总额。未结转时行51/53缺失；12月显式结转到3103再3104后，资产/负债权益两边118800，累计利润仍18800，12月经营利润0。

样例B：期初银行20000、材料1000、固定资产5000、累计折旧贷1000、资本25000。1月收入10000、成本6000、管理费2000、利息收入100、投资损失200、营业外收入500、营业外支出300、所得税525，净利1575。2月收入4000、成本3000、管理费1500、利息费50、投资收益100、营业外支出25，亏损475。累计营业利润1450、利润总额1625、所得税525、净利1100；2月末银行21100、资产26100。期初固定资产净值4000，相关父/子与原价/净值均不重复计入。

另有分户重分类手算：银行100；应收借100/贷30、预付贷20、应付贷80/借10、预收贷40/借5、资本45。贷40确认超过1年，其余所需期限为流动，则应收105、预付10、应付100、预收30、其他非流动负债40，资产215=负债170+权益45。不给分户或期限资料就保持缺失。

单元测试55项、真实Core＋SQLite集成测试10项通过，均为Release、警告视为错误，0失败/跳过。新增集成用例直接使用重开后的真实小企业账套快照生成两表，并输出/独立回读安全CSV与HTML覆盖元数据。复用主 README 中两条测试项目命令与锁定官方NuGet还原；未新增生产依赖。

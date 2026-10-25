# 保存账簿→明确分类→两表预览

`LedgerSnapshotStatementDataSource`已经实现 `INonprofitStatementDataSource`。它每次向宿主的 `Func<LedgerSnapshot>`读取当前已保存快照，校验来源后取实际末级科目期初和已记账凭证；不读取原包、不写账簿、不执行SQL或重新记账。用户通过独立WPF面板或本节typed DTO补齐缺维度，完成后可以得到通过两表勾稽的计算预览，不再只有永久missing。

## 来源和失效规则

清单 `LedgerClassificationManifest` v1包括：

- `SnapshotBinding`：BookId、来源revision、快照SHA256。哈希规范排序科目、凭证及审计集合，保留凭证内分录顺序，覆盖账套/科目/凭证/审计的实际内容。
- `LedgerAccountClassification`：末级代码、科目内容hash、用户明确的科目语义和损益项目、依据。不从名称、摘要、数字前缀、借贷方向自动判定限定类别或业务角色。
- `VoucherLineReference`：凭证ID、0起分录序号、含凭证身份/日期/状态和原分录全部内容的hash。这个定位只在冻结revision内稳定；分录重排、改内容、跨账套、来源revision变化均拒绝。
- 分录显式角色、分类、限制ID/版本/项目/来源/证据、组成和转类组；余额事实取数/分析；完整覆盖与复核声明；已知未覆盖事项。

即使新增的只是草稿或修改了与当前报告期无关的来源内容，旧清单也会因绑定失效而抛 `ClassificationStaleException`，稳定代码 `NP_CLASSIFICATION_STALE`。面板显示重核提示并禁用保存/导出；“读取新快照并重新分类”建立新未分类清单，保留旧JSON，不静默套用旧分类。没有创建第二套总账，也未让规划版本冒充真实账簿版本。

## 最小宿主API

```csharp
var saved = ledgerService.GetSnapshot(); // 现有ILedgerService.GetSnapshot，每次读保存状态
var period = new ReportingPeriod(new(saved.Book.FiscalYear, 6, 1),
    new(saved.Book.FiscalYear, 6, 30), ReportingPeriodKind.Monthly);
var draft = LedgerClassificationDraft.Create(saved, period, generatedAt);
// draft只生成未分类行、真实定位和未明确余额事实，绝不自动填0或猜分类。
var editor = new ClassificationEditorSession(saved, draft);
// 宿主可绑定editor.Accounts/Lines/Balances/Components/Review/Limitations；
// 本模块WPF子项目已提供完整编辑面板，无需再造此界面。
LedgerClassificationManifest reviewed = editor.BuildManifest();
var source = new LedgerSnapshotStatementDataSource(ledgerService.GetSnapshot, reviewed);
var bound = source.CreateBoundPreview(generatedAt);
var issues = bound.Statements.Issues;
// RequireCompleteReconciliation仅表示已覆盖输入下的计算/勾稽通过。
bound.Statements.RequireCompleteReconciliation();
using var csv = new FileStream(selectedNewCsvPath, FileMode.CreateNew);
bound.WriteCsv(NonprofitStatementForm.ActivityStatement, csv);
```

`CreateBoundPreview`返回 `ClassifiedLedgerPreview`：每次ToCsv/ToHtml/WriteCsv/WriteHtml前重读并校验来源，失效时在写入前拒绝。`NonprofitStatement`本身是不可变历史数值DTO；直接调用通用Exporter不会自动知道实时账簿是否变化，宿主对当前账套应使用带来源检查的bound接口。数据源在一次预览内冻结同一快照，避免两表混版；未声称跨外部进程的导出和记账事务具有同一个数据库锁。

## 用户应明确什么

1. **科目语义**：每个末级明确为普通资产/负债余额、收入费用、非限定/限定净资产或前期调整。收入费用再选正式表项目。原科目名称与账簿方向只显示。未使用普通余额科目可以有据确认期初/期末为零，程序会核对实际金额；非零不会因勾选而丢弃。
2. **分录角色和类别**：已记账普通资产/负债对方行标 `BalanceOnly`；普通收入费用选 `RecognizedActivity`并补类别；收入费用结转两侧标 `IncomeExpenseClosing`。限定性需要外部/法律限制ID、版本、项目及证据；内部预算不构成限定。
3. **转类**：限定转非限定/反向转类两侧同凭证同组ID。限定侧填同一限制范围，非限定侧填非限定；程序核对两类净资产方向、金额及平衡，仅生成一次转类活动。使用受限资产不自动转类。
4. **前期调整**：真实调整发生选 `PriorYearAdjustment`，其结入净资产的机械分录选 `PriorYearAdjustmentClosing`，避免重复；未结清3201会阻断。
5. **余额事实**：基础余额明确选择相关末级代码，固定按事实的借/贷正数口径计算，不采用Account.Name推断。基础项禁止以“分析金额”手填覆盖账簿；同一末级不能重复进入不同基础事实。受托货币子集、到期部分及对应到期减值可有据分析，包含年初/期末分别金额；缺数据不能默认零。确认无此项目/零值必须由用户明确选择并留依据。存在未归属余额时，相关确认零值也不放行。
6. **组成和复核**：成本分录关联项目/服务/业务组成，慈善信托及募捐成本按既有类型；确认CNY、完整年度覆盖、科目与分录复核、成本组成及年初依据，并留复核引用。此声明不绕过实际缺项、错分类、不平衡或未结转。

收入费用来自普通发生额，不取已结零的期末余额。已记账以外状态不入计算。所有收入费用明细按“科目＋明确类别/限制范围”核对结转后是否净零，只有结清时才提供净资产正式项目的数值。日期用账套年度与用户选定完整期间；非1月启用的账套不能用启用期初冒充1月年初或补造YTD。

完整覆盖和所有已记账行均明确后，没有任何普通发生额的活动项目可以确认为0；未分类/覆盖不明的相关项目继续missing。余额事实仍须逐项映射或显式确认零，不采用字典缺键=0。

## JSON保留分类

```csharp
var files = new ClassificationJsonStore(hostChosenUserDataDirectory);
var path = files.SaveNew("nonprofit-202606-rev42-review1.json", reviewed);
var imported = files.Load("nonprofit-202606-rev42-review1.json", ledgerService.GetSnapshot());
```

宿主须传绝对用户数据目录，例如自己管理的每账套用户目录。构造器拒绝应用程序目录及其下级、链接/重解析路径；文件名仅为basename，禁止目录穿越。保存写同目录临时文件后原子发布为新文件，目标存在则拒绝，不覆盖旧版本；I/O错误向宿主传播。

外层JSON含格式版本、payload SHA256和typed清单。导入检查大小/深度、未知字段、重复属性、枚举、金额精度、完整结构、payload hash、BookId/revision/快照hash、每科目与分录内容定位；过精度数字/指数表示不会通过decimal解析而静默变零。部分未分类草稿也可保存，但导入后仍需要补齐和校验。直接编辑文件会使完整性校验失败，应通过UI/typed API编辑再另存。

**分类JSON未接入现有主账套备份、恢复、安装或更新流程。** 面板明确显示保存目录和这一边界；宿主需让用户另行保管分类，后续是否纳入备份由对应owner实现，不能宣称SQLite备份已包含它。

## 已验证和仍缺

真实Core＋SQLite测试保存/审核/记账、关闭重开，再经显式分类、JSON保存导入、两表预览、文件导出和源变更失效。合成案例：限定捐赠1000、限定成本300、解除A范围200、增加C限制50；结转后银行700、非限定150、限定550，两表勾稽一致；旧分类在新增草稿后读取和导出均拒绝，原JSON不变。

原官方依据及特殊边界沿用主README。非零到期投资减值归属、没有明细可映射的混合长期减值分配等复杂分析仍需复核/补资料，不以手填基础余额绕过。注册资金直接投入、额外主要收入单列等未覆盖业务须保留SourceLimitations。WPF窗口实际Windows验收待跑专用探针；已完成Linux交叉构建和共享编辑缓冲的真实SQLite闭环，二者不冒充Windows实机验收。

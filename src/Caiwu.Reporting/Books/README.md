# 原版账簿切片

本模块实现本币总分类账、现金日记账、银行日记账的一组只读查询、CSV/HTML 导出及独立 WPF 条件/结果窗口。它是原版保真升级中的一个切片，不替代完整原软件，不提供原 SQL Anywhere 读取、辅助/外币/数量账，也不声称原打印格式或 Windows 实机验收完成。

## 输入与计算

`BooksReportBuilder.Build(BooksLedgerInput, BooksQuery)` 消费完整单年度 ledger，返回按科目分组的不可变结果。总账只含已过账凭证；日记账可显式包含草稿和已审核凭证，该筛选同时作用于期初、逐笔、月计和累计。选择月区间以整月为单位，首尾月均含。总账条件窗按原设计只选年度/科目范围，查询覆盖启用月到12月。

- 期初为账套启用月首余额，加查询开始月之前已纳入的发生额。
- 月计只累加当月分录；本年累计另加启用前累计及之前月份，不能把小计再次相加。
- 普通账簿包括损益结转凭证；不按摘要猜结转并将它排除。红字发生额保持原借贷侧的负数。
- 父子关系按 `ParentCode`，现金/银行分类由明确标志并沿父链继承；不以 1001/1002 编码推断。
- 末级期初须全账套借贷平衡，父级不能重复带期初或累计。年中启用缺启用前本年借/贷累计时拒绝生成完整累计，不能补零假装完整。
- 月份、年度、科目树、凭证身份/状态/分录行序、末级科目、借贷平衡与金额精度均检查。金额使用 decimal 和已有精确分值累加器，禁止静默舍入。

`BooksSnapshotAdapter.FromSnapshot` 只适配现有简化 `LedgerSnapshot`。现金/银行标志及年中启用前累计必须由调用方明确提供。原接口没有结算、支票、票据等字段，不能用空字段投影充当原账套兼容。直接扩展输入可提供 `BooksLine.Sequence/SettlementType/CheckNumber/BillNumber/SourceKey`，行号、前导零和原来源键随结果/导出保留。

`BooksDocumentBuilder.Create` 生成现有 `ReportDocument`，复用 `ReportExporter` 的 CSV 转义、公式注入防护、UTF-8 和 HTML 转义/分页。金额与文本保持区分，月计/累计不重复汇总。余额对外显示方向及绝对额；计算结果的 `Balance` 保持借正贷负。科目范围可含父/子科目，各自成账，不做跨层级总计。

## 模块 UI 与宿主接线

WPF 独立项目：`../Wpf/Caiwu.Reporting.Wpf.csproj`。入口：

```csharp
var input = BooksSnapshotAdapter.FromSnapshot(snapshot, explicitJournalKinds, explicitPreOpeningActivity);
BooksWindow.Open(owner, new SingleYearBooksSource(input), BooksKind.BankJournal,
    input.Book.FiscalYear, reference => host.OpenOriginalVoucher(reference));
```

上面的 `host.OpenOriginalVoucher` 是宿主实际凭证窗口处理器，需自行绑定。没有处理器时不提供“查看”动作；本模块不另造凭证编辑流程。联查参数包含 BookId/Revision/FiscalYear/VoucherId，不能跨账套重贴。`BooksResultView` 可直接嵌入 MDI sheet，必须传入真正关闭当前 sheet 的 `Action`，避免关闭整个主框架。宿主保留原菜单及权限；本分支不改 Desktop。

`IBooksLedgerSource` 提供实际可读取的年度集合；没有该年度时箭头不可用，不拿当前数据改标签。单年度源即可独立使用。重选和查找真实过滤科目并重算；条件窗确定校验后才打开结果。结果窗提供另存、重选、原凭证 handler 联查、预览、系统打印、记录移动、返回，以及 Ctrl+P/Ctrl+Home/Ctrl+End/Ctrl+F4。当前不启用列头重排排序，保持逐笔余额的顺序。

原对象 `w_zc_zc/w_zc_xjrjz/w_zc_yhrjz` 及结果窗的来源见 `docs/parity-handoffs/books.md`。条件窗/结果头/科目查找使用已知 PBU 控件相对起点；Viewbox 仅做比例适配，不声称校准了 PBU→像素。下拉框关闭高度、字体、表格屏幕列序和 Windows DPI 仍待验。表格逻辑列和 FlowDocument 打印是本切片实现，原 DataWindow 视觉、套打与分页格式验收未完成。

## 公共接口 PR #52

基线不依赖未合入接口。若 `src/Caiwu.Contracts/ParityModules.cs` 存在，项目自动启用 `CAIWU_PARITY_MODULES_V1`，编译 `BooksModuleAdapter`；已在隔离目录使用精确 `5bb60d24b9c60c9eecfcc5adc37bced4688adf85` 契约核验。不是将 PR52 或浮动分支合入本分支。

```csharp
var state = parityLedger.GetModuleSnapshot(); // 一次读取
var projection = BooksModuleAdapter.FromSnapshot(state, optionsFromThisSameState);
var registration = BooksModuleAdapter.Registration("qingsong/main");
// projection.Input 用于本币查询；RetainedDocuments 持有全部模块原始 JSON 原文。
```

`BooksProjectionOptions` 携带同一 snapshot 的 BookId/Revision，以及由模块权威字段解析的明确标志、启用前累计和票据注释；旧版本/其他账套拒绝。票据注释按 VoucherId/行号匹配，还检查科目、摘要、借贷值，避免把旧注释贴到改后的分录。所有模块的原始 JSON 字符串逐字保留，包括辅助、外币、数量和未知列；本币计算不解释它们，也不将投影写回覆盖权威文档。

本模块只读，没有 `SaveModuleDocuments` 或 `AcceptVoucherProposal` 写入需求。权限及模块文档解析由宿主负责；它们尚未接入本分支。注册仅列三产品已核菜单入口，不能把注册记录当可执行按钮。

## 验证与后续

从仓库根执行：

```sh
dotnet test tests/Caiwu.Reporting.Tests/Caiwu.Reporting.Tests.csproj -p:RestoreLockedMode=true
dotnet test tests/Caiwu.Reporting.Tests/Integration/Caiwu.Reporting.Integration.Tests.csproj -p:RestoreLockedMode=true
dotnet build tests/Caiwu.Reporting.Tests/WindowsSmoke/Caiwu.Books.WindowsSmoke.csproj -p:RestoreLockedMode=true
```

Linux 测试均使用合成数据。集成测试经真实 `LedgerService.SaveDraft/Review/Post/CloseMonth` 与 SQLite 重新打开，比较领域明细余额及输出，确认查询没有修改 snapshot/audit/revision。这证明现有简化 ledger 通路，不证明原账套兼容。

Windows 专用命令、未运行项及后续清单见模块 handoff 和 `tests/Caiwu.Reporting.Tests/WindowsSmoke/README.md`；不得用构建或测试项数代替全功能保真结论。

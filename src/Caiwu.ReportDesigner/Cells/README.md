# 二维单元格报表：第一保真切片

这是新增的 `Caiwu.ReportDesigner.Cells` API，不把原先 `TemplateColumn` 列公式设计器计为原报表完成。只读既有原版分析，未解析安装包、运行原程序或接触真实账套。原版证据及剩余验收见 [reports handoff](../../../docs/parity-handoffs/reports.md)。

## 实际支持

- 1–999 行、1–250 列的稀疏二维表，最多10000个显式单元格；单元格文字/数值/公式与格式分别保存。
- 行高以**英寸**、列宽以**字符**保存；默认值和逐行/逐列覆盖；水平普通/左/中/右、垂直上/中/下、换行、0–6位小数、千位分隔。显示舍入不改变数值。
- `=A1+B2`、矩形 `SUM(A1:B3,5)`、四则/括号、`ABS`、`ROUND(value,0..6)`；范围内空格为0，文字引用报错。拓扑计算会定位循环、依赖、越界、除零、溢出/精度和数据缺失；任何失败均不返回可导出结果。
- 取数函数默认 `OPENING/CLOSING/DEBIT/CREDIT/YTDDEBIT/YTDCREDIT("科目"[,"EXACT"|"TREE"])`。**这些是新版独立切片语法，不是从原 dba.bbfun 验证的别名/参数。** `ReportFunctionCatalog` 只接入明确提供并核验过的同语义别名，不猜原名。其他签名/多币种/辅助取数须另做适配。
- 一次生成只 Capture 一次，只在同一账套/期间/revision快照中取数；相同请求缓存。`LedgerReportSource` 接受自己的完整本位币 DTO，复制科目、凭证、分录后验证树、末级、借贷及覆盖区间；仅计 Posted，排除未过账/未来，余额是借减贷。TREE沿实际父节点汇总末级，不按前缀猜，不把不存在的科目填零。年中启用且缺历史时拒绝累计。
- 严格、重复键拒绝、有界 JSON；协作文件锁 + hash/version CAS + 临时写入/flush/原子发布；重开保留公式和格式。HTML有编码/CSP及来源标记，CSV有正确引号和文本公式注入防护，导出不覆盖已有目标。

## 使用

引用已有独立项目 `src/Caiwu.ReportDesigner/Caiwu.ReportDesigner.csproj`。业务示例以 [CellSheetTests.cs](../../../tests/Caiwu.ReportDesigner.Tests/CellSheetTests.cs) 为准：

```csharp
var engine = new CellReportEngine();
var result = engine.Generate(sheet,
    new ReportQueryContext(bookId, from, to, capturedRevision), source);
var saved = CellReportStore.Save(absoluteJsonPath, sheet); // 新文件
var reopened = CellReportStore.Load(absoluteJsonPath);
var updated = CellReportStore.Save(absoluteJsonPath,
    reopened.Report with { Version = reopened.Report.Version + 1 }, reopened.Sha256);
CellReportExport.WriteHtml(newHtmlPath, result);
CellReportExport.WriteCsv(newCsvPath, result);
```

宿主提供现存受管目录；不能用原 `.vts/.db` 路径替代 `.json`。协作锁不保证不合作进程/路径替换、断电、网络盘耐久或跨文件事务；本轮未实测这些。CSV是纯单元格网格，来源元数据可通过 `CellReportExport.Audit(result)` 单独保留；HTML自带来源。

公式上限512字符/128节点/32层/64参数，单矩形5000格、全表100000条依赖/200000次引用访问和10000个不同取数请求；精确中间值复用原 `SafeFormula.Rational`（512位），禁止脚本、反射、SQL、文件访问和动态编译。不能精确转decimal的最终数值必须显式ROUND。输入/预算失败不会导出部分正确的表。

## WPF

引用 `Wpf/Caiwu.ReportDesigner.Wpf.csproj`，控件 `Caiwu.ReportDesigner.Wpf.Cells.CellReportControl(source, contextProvider, managedDirectory, initialReport)`；可用 `CanClose()` 进行未保存检查。`CellWindowsSmoke` 是能交互运行的独立合成宿主。

编辑二维 DataGrid，文件菜单/工具栏的打开、存盘 Ctrl+S、另存、生成、取数，显示菜单的网格/定义显示/公式显示，格式菜单的行高、列宽、排列和数字均有实际动作；报表选择会列出受管目录的 `*.cells.json` 并真实打开。未知或未做菜单不提供假按钮，完整原菜单仍在 handoff 待验清单中。

行高/列宽/排列对话框只按三产品 windows.json 已有 PBU 位置组成**比例设计面**，不声称像素换算、字体或 Windows 视觉通过。原 ole_1.x 未知，主控件仅遵循标签/选择框/状态从左到右、工具栏在上、网格在下的证据关系；没有补造其绝对坐标。数字格式由原 OLE 的 u_f_num 调用，资料没有内部布局；此切片用自适应对话框，保真位置仍未知。排列的填充/两端/跨列置中、完整函数向导/生成参数窗口、打印等未做。

## 公共契约适配器（可选，须 PR52 契约）

`Integration/Caiwu.ReportDesigner.Parity.csproj` **不在基线产品/方案里激活**，需要 `ParityModules.cs`（PR52固定SHA `5bb60d24b9c60c9eecfcc5adc37bced4688adf85`）或其兼容后继。已在该固定树的临时副本中真实编译/合成测试，未修改本 checkout 的 Contracts。

`ParityReportAdapter.Open/New` 从同一 `ModuleLedgerSnapshot` 捕获 `LedgerMutationContext`。`Save` 只提交 `reports` 的一个显式文档到 `SaveModuleDocuments`，从不刷新 token、自动重试、调用凭证建议或写外部权威文件。原字段放 `OriginalPayloadJson` 原字符串中；envelope 的未知字段通过 JsonElement 保留，数值不经 double。未知报告 schema直接拒绝，不能降级覆盖。成功后宿主显式重读新快照再编辑。

`CreateBaseCurrencySource` 从简化 Ledger DTO 取数前必须获得明确的完整本位币、无辅助/外币/数量/未知列证据；缺证明拒绝，不静默降级。完整业务账套应实现 `IReportDataSource` 以处理保留字段。该适配器测试仅证明调用与字段保留，**不证明 Core/SQLite 实际事务或原账套兼容**。

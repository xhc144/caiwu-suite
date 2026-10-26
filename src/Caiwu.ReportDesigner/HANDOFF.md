> 当前保真切片（2026-10-26）：请先读 [reports handoff](../../docs/parity-handoffs/reports.md) 和 [二维单元格 API](Cells/README.md)。下文是旧模块的历史交接，其测试与完成声明不替代本轮二维报表或原账套验收。

# 可交接成果

2026-10-25，`codex/report-designer`。可集成模块已实现：现有账表结果→列/公式/页眉/方向/小计编辑→重新预览→原子保存JSON→读回校验→安全HTML/CSV；真实WPF数据及A4页面预览、Windows打印入口和可运行Windows smoke宿主均已交付。精确提交SHA见本交付的私有草稿PR及最终回报。基线为 `b3b85eb3ab7fa859a3c44cca5bb6d25d48d7b434`。

- 核心API/支持边界/宿主接入：`README.md`。
- 已运行证据、独立手算、完整合成闭环、实际Core/SQLite闭环、Windows未验范围：`../../tests/Caiwu.ReportDesigner.Tests/VALIDATION.md`。
- 生产项目引用：`src/Caiwu.ReportDesigner/Wpf/Caiwu.ReportDesigner.Wpf.csproj`；公开控件 `Caiwu.ReportDesigner.Wpf.ReportDesignerControl`，构造参数为 `ReportInputSnapshot`、`ReportDesignerHost`、可选初始模板。
- 不依赖新增Contracts；没有修改Reporting、MainWindow、Core或SQLite。仅新增本owner的两个目录；solution/菜单/主workflow未改。源快照只读，不影响安装、升级、账套及分发暂停保护。

57项行为测试与1条真实Core/SQLite端到端用例通过；严格Release的WPF和WindowsSmoke交叉编译通过。这些是具体行为证据，不能代替Windows执行或完整设计器完工。模板保存的跨进程、断电/网络盘耐久性未实测；协作锁/并发调用及失败保留有单元验证。

必须由集成owner完成：项目/菜单接入、精确LedgerSession代次与报表上下文校验、受管模板路径和备份附件登记；Windows运行 `Run-WindowsSmoke.ps1`，检查真窗口/主题/页面布局、打印对话框、实际打印或PDF驱动输出。未通过前不声称这些已完成。现有Reporting的internal呈现构造器使通用自定义列不能直接进入原exporter；本模块复用结果结构和已审安全规则，提供已测试的renderer。进一步合并导出代码请由Reporting owner增加公开且校验过的扩展点，未擅改共享文件。

没有权限阻断或未完成远端操作需要用户批准；若推送/PR操作失败，以最终回报的精确状态为准。原包字节、真实原窗口/SQL/对象目录和新派生catalog未读取/上传；所有测试和样本均为自写合成数据。本轮按用户时间上限提前收尾，不承诺完整原版设计器/全法定财报。

## 文件用途与证据

| 文件 | 用途 | 置信度/依据 |
|---|---|---|
| Models.cs | 来源复制、不可变输入/预览、模板与审计标记 | high：快照/指纹/上下文/闭环测试 |
| SafeFormula.cs | 封闭语法AST、精确有理数与decimal输出约束 | high：算术/拒绝/精度/复杂度测试 |
| ReportDesignerEngine.cs | 字段/依赖/布局声明校验、逐行计算与末级/期初汇总 | high：三来源类型、循环、缺字段、独立合计测试 |
| TemplateStore.cs | 有界严格JSON、hash/version CAS、协作锁和原子发布 | high：并发调用/冲突/锁/失败不覆盖；Windows发布待验 |
| ReportDesignerExport.cs | 编码/CSV防注入、带审计分页及新文件导出 | high：旧Reporting策略对照、独立CSV解析和实际I/O |
| Wpf/ReportDesignerControl.* | 真WPF列编辑/数据与A4页面预览/保存读回/导出 | medium：严格交叉编译；Windows交互待验 |
| Wpf/ReportDesignerPrinter.cs | 原生PrintDialog、A4/方向与FlowDocument | medium：严格交叉编译；Windows打印/PDF待验 |
| tests/.../WindowsSmoke/Program.cs | 真窗口/DataGrid编辑/按钮闭环/分页/PNG的有界探针 | medium：交叉编译通过；实际运行待验 |

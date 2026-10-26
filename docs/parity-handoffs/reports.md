# Reports parity handoff

2026-10-26 UTC。独占分支 `codex/parity-reports-20261026`；起点/当前代码基线 `3b0c59b02d8941c32ac176309555c03c94bb4213`。独立 checkout `/workspace/caiwu-reports`；未修改默认 book-project。

## Ownership / integration

只改 `src/Caiwu.ReportDesigner/**`、`tests/Caiwu.ReportDesigner.Tests/**` 和本文；共享 Contracts/Core/Persistence.Sqlite/Desktop/MainWindow/solution/props/workflows 均由集成者拥有。本模块继续复用原有有界精确算术，不把旧列公式设计器当作原版完成。

计划新增 `Caiwu.ReportDesigner.Cells`：二维稀疏单元格、行高（英寸）、列宽（字符）、单元格格式、安全公式/单元格依赖、报表取数源接口、原子保存读回、HTML/CSV 导出。公共 API 以本模块 DTO 为界，不等待简化 Core。

原窗口归属：`w_bb_def`/`m_bb_def`（u_save/u_open/u_proc/u_proc_1/u_help/u_formu/u_grid）；`w_bb_def_rowh`/u_rowh、`w_bb_def_colw`/u_colw、`w_bb_def_format`/u_format、`w_bb_def_help`、`w_bb_proc`。新增 WPF 放模块 Wpf/Cells；保留已知相对布局，未知 ole_1.x 不猜。

## Evidence already read

main 的 original-analysis README/gap-analysis、三个产品 windows.json 中报表对象、qingsong windows/bb.md 与 m_bb_def 菜单、相关 tables.json/tables.md 与 d_bbml/dw_bb_help DataWindow；PR38@3ba29a0、PR39@11a8d77、PR40@8de73d5 的已有工程/数据/UI成果。PR38 等待 PB 工程/不切换实现的旧前提已被用户替换底层授权取代。

原设计最大 999 行/250 列；行高英寸、列宽字符。原函数清单数据来自 dba.bbfun（bz/mc/xh），本次资料只有 schema/查询，没有记录和完整函数语义；不能把自建函数名字当作原函数语法。原 ole 控件字节/VTS 与数据库 dba 载荷尚未解码，不能宣称已可打开原报表文件。

## Integration contract required (precise proposal)

1. 提供一次捕获的只读账套快照，含账套 id、会计制度/版本、generation/revision、完整期间、是否合成、币种、科目真实父子关系、各维度期初借贷、已过账/未过账状态和发生日期；取数过程必须固定同一代，禁止切账混入。缺字段必须拒绝/报告 missing，不能补零或丢弃。
2. 保留原 bbml 的 xh/bbname/row/col/bz1/bz2 和完整原 VTS/dba 数据为受管原始附件；本切片 JSON 是新版设计格式，不能覆盖原件或当作原文件转换器。将新模板登记到账套备份附件/事务中，受管路径由集成者统一提供。
3. 提供 bbfun 的经过核验的函数名/编号、参数顺序、币种/项目/部门/客户/个人过滤、未过账处理/舍入与跨账套规则。适配器可调用本模块查询接口，但未知函数必须报错，不按名字猜。
4. 接入原 `w_bb_main` 的定义入口，不替换成旧 ReportCenter；MDI、账套权限、原版菜单完整性、保存退出拦截、Windows 实机观察由集成者协调。

## Early checkpoint status (historical)

early-handoff：实现/测试尚未完成，未有新功能通过证据。最终提交会补齐命令、SHA、结果与未实现清单；该早期提交本身不是产品完成。

## Acceptance retained (not removed)

原报表管理/增加/删除/复制/引入/转出；原账套与 VTS/DB 报表读写；全部 bbfun/跨报表/辅助维度/外币/数量/多账套函数；插删行列及引用重写、边框字体/合并跨列/绘线、分页/打印标题/真实打印、报税接口、完整函数向导；三产品差异；所有原窗口/菜单与权限、Windows 原生交互与视觉回归。首片外全部待实现/待验，不能用编译或合成测试数量替代。

## First slice delivered / public integration checkpoint

早期交接提交 `1cf81228b2ded561dd022384200f7904605516ee`；草稿 PR #44。第一实现提交及验证提交见本分支提交记录（本文后续证据段固定具体SHA）。

新增API：`Cells/CellModels.cs` 的 `CellReport`、`CellDefinition`、`CellFormat`、`ReportQueryContext`、`IReportDataSource`/`IReportDataSnapshot`、`ReportSourceStamp`、`ReportDataRequest`；`CellReportEngine.Validate/Generate`；`CellReportStore.Load/Save`；`CellReportExport.Html/Csv/WriteHtml/WriteCsv/Audit`；`LedgerReportSource` 完整只读本位币DTO适配；`ReportFunctionCatalog` 明确函数别名。所有路径均相对 src/Caiwu.ReportDesigner。

运行链路：二维表文字/数值/公式→一次快照取数与依赖计算→行列/单元格格式显示→JSON原子保存并重开→重新计算→HTML/CSV实际新文件导出。原999行/250列上限保留；复杂度预算会明确拒绝而非截断。默认函数属于新切片语法，原bbfun别名、99/*参数、辅助/外币/数量/跨报表语义仍未实现。

WPF：`Wpf/Cells/CellReportControl` 为模块所有；使用真实DataGrid，实际打开/存盘/另存、生成、现场取数、格式与显示操作。行高/列宽/排列保留已有PBU证据的相对比例，未知ole_1.x未补造。数字格式用自适应对话框，不声称原OLE布局已还原。完整生成参数窗口/函数向导、原报表目录全部按钮和原菜单尚未完成，未删除验收。`tests/Caiwu.ReportDesigner.Tests/CellWindowsSmoke` 是可运行合成宿主；当前仅交叉编译，未实际运行Windows。

### PR52契约反馈

已读取固定 `5bb60d24b9c60c9eecfcc5adc37bced4688adf85` 的 integration handoff 与 ParityModules.cs。新增可选 `Integration/Caiwu.ReportDesigner.Parity.csproj`，未在基线产品/解决方案激活；本checkout仍保持旧Contracts。它已在该固定树的临时副本中编译/合成测试。

- `ParityReportAdapter.Open/New` 捕获同一 `ModuleLedgerSnapshot.Ledger` 的book/revision；Save只传该context到 `SaveModuleDocuments`，不刷新、不重试、不生成凭证；报表没有凭证建议业务，因此不调用 `AcceptVoucherProposal`。
- `reports` 模块文档为权威状态的拟接入点；外部JSON仅独立切片/投影。包络保存 `OriginalPayloadJson` 原字符串及未知envelope字段（JsonElement，不经double），拒绝未知schema，避免悄悄丢字段。
- 简化Ledger DTO适配必须显式提供 `ReportLedgerCompleteness`，证明覆盖区间及没有辅助/外币/数量/未知列；默认缺证明即拒绝。真实完整账套须另实现 `IReportDataSource`，不能默认把缺维度当零。原 `bbml.bz1/bz2` 与未知列应由compat传入原字符串，不由本模块猜含义。
- 集成者需确定文档/附件大小预算与拆分协议（本设计本体文件上限8MiB，原字段字符串4MiB），避免存储层上限使大表无法无损保存；应拒绝并保留编辑，不能截断。
- 权限至少区分报表定义/生成读取/文档保存/导出；shell须用真实会话授权并在切账/恢复时关闭旧控件。当前控件用宿主给定source/context/目录，没有真实OperatorSession，不能冒称已授权接入。适配器调用成功后的模块状态、审计与账套原子一致性仍需Core/SQLite集成测试，四项fake服务测试不能证明。
- 注册 `OriginalWindowReference` 为描述性，shell只有实际绑定handler后开放对应入口；本模块未改Desktop/MainWindow或菜单总表。

### Current verification

Linux合成模块测试82/82通过（其中旧列设计器57、新二维切片25），可选PR52契约适配测试4/4通过；WPF+CellWindowsSmoke严格Release交叉编译0警告/0错误。具体命令、手算、合成I/O和未验Windows项见 `tests/Caiwu.ReportDesigner.Tests/CELL-VALIDATION.md`。编译和数量不表示原版全功能完成。

没有权限拒绝、待批准或不确定远端写入：独占分支与草稿PR已创建。默认沙箱的.NET缓存/命名迁移锁失败后，仅对构建/合成测试申请沙箱外执行，自动审批通过。没有运行原程序、操作真实账套、上传原资源/完整新派生材料、改main或权限。

## Frozen implementation checkpoint

代码冻结提交：`4b7fbb5791c54412ce43fdd920ebd461a2181d02`。此前早期交接为 `1cf81228b2ded561dd022384200f7904605516ee`。集成需按此顺序取提交，不能只cherry-pick实现提交而漏掉新建handoff文件；本段属于随后单独的文档提交，不改已测代码。PR #44 保持草稿，分支独占私有。

最终本轮证据：`tests/Caiwu.ReportDesigner.Tests/evidence/cell-parity-20261026.json` 保存真实TRX计数/时间/哈希与对应模块源文件SHA256；最后源代码测试82/82、契约适配4/4，最后WPF/CellWindowsSmoke严格交叉编译退出0、0警告/0错误。局部手算与I/O链说明见CELL-VALIDATION。未运行Windows宿主、原程序、原账套；无原版全部功能/菜单或像素视觉完成声明。

文件用途（已读/已验证）：Cells/*.cs 为模型/闭语法/拓扑计算/完整快照/原子JSON/安全导出（high，合成行为测试）；Wpf/Cells/*.cs 为本模块单元格界面和比例格式对话框（medium，仅交叉编译）；Integration/* 为PR52可选权威模块文档适配（medium，固定契约fake服务验证，真实事务未接通）；CellSheetTests.cs 为独立手算及实际I/O闭环（high，已运行）；CellWindowsSmoke/* 为新WPF原生合成宿主（medium，仅编译）；ParityIntegration/* 为契约调用/未知字段保留/失败传播（high，仅其合成声明范围）。

# integration — 最小公共契约与交接

2026-10-26 UTC；私有仓库 `xhc144/caiwu-suite`；独立 checkout `/workspace/caiwu-integration`；分支 `codex/parity-integration-20261026`；基线 `3b0c59b02d8941c32ac176309555c03c94bb4213`。本文件的初始提交是**接口冻结检查点**，尚不是功能完成或 Windows 验收。

## 所有权和输入

已收到父任务完整 12 路唯一分工：shell、compat、ledger、books、reports、regimes、cashier、invoices、payroll、assets、inventory、integration；不重复派工。integration 仅编辑 Contracts/Core/SQLite 及其测试、根构建、packaging-next、workflows、tests/ParityAcceptance 和本交接。Desktop/MainWindow、各模块 Wpf 和其余业务文件由各 owner 独占；接线只 cherry-pick 父任务指定 SHA。

已读 `.ai-handoff/STATE.md`（旧证据不能替代本轮）、original-analysis README/gap-analysis、相关数据/窗口 JSON、PR38 工程路径、PR39 数据兼容、PR40 原 UI 契约。仓库内未发现适用 AGENTS.md。PR38 等待 PB 工程的旧前提已被用户授权覆盖；SQL Anywhere 原账套兼容仍为必需，当前 SQLite 不冒称原格式可用。

## 冻结 API v1

实际类型位于 `src/Caiwu.Contracts/ParityModules.cs`，基线 DTO 和 ILedgerService v1.2 不破坏。

1. `LedgerSnapshot`、`LedgerMutationContext(ExpectedBookId, ExpectedRevision)` 保持。上下文从用户开始编辑/确认时的**同一个**快照取得；提交不刷新 token、不自动重试，任何其他模块修改也使旧决策失效。
2. `IParityLedgerService.GetModuleSnapshot()` 返回 `ModuleLedgerSnapshot`：Ledger、Modules、ProposalReceipts 必须来自一次底层 Read，同一 revision。所有返回集合复制并只读。
3. `LedgerModuleDocument(DocumentId, SchemaVersion, PayloadJson)` 保存模块自有 JSON 对象，原始字符串逐字保留，不限于旧 Account/VoucherLine 的 RMB/无辅助项字段。辅助维度、外币金额、数量、原行号、原始字段及尚未解释的列应在模块版本化 DTO 中保留，禁止转换时悄悄丢弃。JSON 数值不经 double。模块自定数据语义，集成层检查 JSON 结构、重复键、大小、深度、ID 和版本，不认证原 SQL Anywhere 映射。
4. `SaveModuleDocuments(ModuleDocumentBatch, actor)`：只应用该 ModuleId 的显式变更；其他模块、未列出的文档、原始 JSON 保留。Document=null 是显式删除，DocumentId 必须匹配；不允许把已有高版本文档降级。修改仍用全账套 CAS，文档与审计一起原子写入；宿主继续以真实 OperatorSession 授权。
5. `AcceptVoucherProposal(VoucherProposal, actor)`：只生成一张**新草稿**，复用现有分录、金额精度、有效末级科目、期间、编号校验。不自动审核/过账，不推断科目。ProposalId 非空；SourceKeys 是稳定业务来源键，按 ModuleId 隔离。任何已消费 ProposalId 或来源键均拒绝，包含已删草稿；不能以重新生成随机来源键绕过重复检查。来源认领、模块变更、凭证、审计在单次 ILedgerStore.Write 中完成。返回 ModuleVoucherReceipt 供模块重开后恢复生成状态。
6. `ParityModuleRegistration(ModuleId, ContractVersion=1, OriginalWindows)` 是描述性注册，不是占位按钮。`OriginalWindowReference(Product,ObjectName,Entry)` 使用各产品既有 JSON 中的真实对象和入口；未知入口明确记录，不猜坐标。shell 只有在绑定真实模块窗口/事件 handler 及权限后才提供可执行菜单。

## 事务与兼容策略

第一切片采用现有 `audit_events` 的版本化追加事件 `ParityModuleCommit.v1` 保存模块变更和建议收据，保持 SQLite schema1 和旧 DTO 源兼容。完整状态由追加事件回放；普通账务操作原样保留这些事件，SQLite 原有整快照写入/深读回/备份也保留它们。不是伪造审计成功记录：提交内容与 voucher 在同一真实事务，CAS 或存储失败时一起回滚。后续独立索引表优化必须有无损迁移、备份及旧工具读写门禁，不能静默换格式。

本轮不提供多个 SQLite 文件/独立 JSON 文件的跨库原子性。需要统一事务的模块应把权威状态写入本账套的模块文档；外部文件仅作可重建投影，失败后依据 ProposalReceipts 对账。已有模块持久化如继续独立使用，必须标明尚未与总账原子接通。

## shell 接线建议（不改 shell 文件）

- 现有 LedgerService 将额外实现 IParityLedgerService，仍由同一受管 store 创建并随同账套会话销毁；切账套重建模块 host，不把旧 context 套到新账套。
- 将用户所见 ModuleLedgerSnapshot 交给各模块 adapter。保存用该快照 Context；报冲突时保留输入并要求显式重载，不捕获后假报成功。
- 模块内生成凭证只提交确认后的 VoucherProposal。先显示分录与来源，成功后通过 receipt 显示凭证位置；失败不标记来源已生成。
- 原版窗口归属：凭证接收关联 `w_pz_pzedit`/`w_pz_pzxsb`；来源窗口由 cashier/invoices/payroll/assets/inventory owner 各自提供。保留原菜单与相对布局，不由 integration 增设新导航。

## 当前状态与未实现验收

接口冻结提交：`5bb60d24b9c60c9eecfcc5adc37bced4688adf85`，草稿 [PR52](https://github.com/xhc144/caiwu-suite/pull/52)。实现提交随后提供，Windows 和最终 exact-SHA 本地复验另记，不把初始契约提交称为已运行的实现。

当前工作树已实现 Core 桥接/版本化事件回放；独立真实 SQLite 合成验收包括持久化重开、注入 ABORT 全回滚、旧/外账套决策拒绝、备份恢复和双连接来源竞争，均实际通过。既有 Core165、SQLite117 回归在 Linux 上通过，额外边界回归随后复验。验收项目 Release 构建零警告/零错误；官方 SDK10.0.402 下载 SHA512 与库内固定 metadata 一致。以上是未提交树的开发检查，不是绑定接口冻结 SHA 的验收。

新 `.github/workflows/parity-integration.yml` 和 `tests/ParityAcceptance/Run-WindowsParity.ps1` 固定完整 SHA/clean tree，准备真实 Windows Core/SQLite/提案验收及原生高清截图。截图复用现有新实现测试 host，只证明该新 SHA 的渲染，originalUiParity 和 realBookCompatibility 保持 not-tested；原版对照需要 shell 的后续 SHA/观测。不会把当前旧布局新拍一张就宣称原版保真。

仍待父任务提供各 owner 审核 SHA/HANDOFF；不自行拿浮动 branch HEAD 集成。原账套实际驱动/无损迁移、原流程全部按钮、44 制度模板、辅助/外币/数量业务规则、反过账/反结账持久化、打印及 Windows 实机对照都不以本接口替代。旧 gap-analysis 验收行保留。

Windows CI 只运行新实现和合成账套，记录完整 source SHA、运行环境及高清原尺寸截图；静态相对布局比较和新实现实际运行分开，原程序不运行。旧 0.1.0.4、编译成功、测试数量均不作为原版完整保真证据。

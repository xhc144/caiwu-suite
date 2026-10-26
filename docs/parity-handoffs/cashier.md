# 出纳模块交接（独立垂直切片，持续更新）

- 日期：2026-10-26（UTC 起始 2026-10-25 23:55）；负责人：cashier 委派任务。
- 独立 checkout：`/workspace/caiwu-cashier`；独占分支 `codex/parity-cashier-20261026`。
- 固定基线：`3b0c59b02d8941c32ac176309555c03c94bb4213`；早期 HANDOFF 提交 `ea74fa0fac652a9a8027e6c54189df3e243250e9`；主实现检查点 `975b0123945c9f0aca5d71539e42be93e298a2b4`；草稿 PR [#42](https://github.com/xhc144/caiwu-suite/pull/42)。最终修订 SHA 以本 PR 提交记录和最终回传为准。
- 文件所有权：仅 `src/Caiwu.Cashier/**`、`tests/Caiwu.Cashier.Tests/**`、本文件。不修改共享 Contracts/Core/Persistence.Sqlite/Desktop、解决方案、公共 props、工作流。

## 本切片 API 与所属原窗口

独立 `net10.0` 模块，模块内部 DTO、事务存储接口和合成数据 SQLite 适配器；WPF 独立 csproj 放 `src/Caiwu.Cashier/Wpf/`，不修改公共主窗口。`Integration/` 是另一个独立 csproj，不使独立模块被尚未进入 main 的契约阻塞。

| 原窗口/事件 | 拟公开入口 | 行为 |
|---|---|---|
| `w_cn_lr_qc` / 存盘 Ctrl+S | `CashierService.SaveOpening / SaveOpenings` | 按账套、科目、币种、年度保留期初；整屏一事务 |
| `w_cn_lr` / `ue_action_new,modify,del` → `w_cn_lr_add.cb_1` | `AddDocument / UpdateDocument / DeleteDocument` | 自动唯一单号，收支录入，禁止已勾账/结账/已生成凭证/其他系统转入记录直接改删 |
| `w_cn_lr`、`w_cn_slz_1` | `GetJournal` | 期初、按日期和单号的明细余额、本日小计 |
| `w_cn_dz_xz` → `w_cn_dz_ny` → `w_cn_dz` | `ReadReconciliation / Reconcile / CancelReconciliation / AutoReconcile` | 按账户/币种/年月读取；账务侧仅已过账，金额校验、组号、整组取消与事务 |
| `w_cn_pz` | `CreateVoucherPlan` / `CashierVoucherProposalAdapter` | 逐条/本月汇总借贷平衡计划；同快照建议/稳定来源键；适配公共原子接收，不自动审核/过账 |

`DocumentInput`/`CashierDocument` 包含科目+币种、日期、自动单号、摘要、收/支金额、对方科目、录入人、说明、对方户名/开户机构/账号、来源、凭证关联、勾账码、`OriginalFields`（类型声明+可空原值）；不通过旧 `Account/VoucherLine` 存储模块原数据。`Journal.SourceRevision` 和 `ReconciliationView.SourceRevision` 与其明细来自同一次读取。

`CashierWindows(service, actor, ICashierDataWindowFactory)` 提供 `CreateOpeningWindow / CreateEntryWindow / CreateJournalWindow / CreateReconciliationSelectionWindow / CreateReconciliationWindow`。单据编辑器接口是明确的未恢复布局边界，必须绑定真实编辑器才开放录单窗口。测试用表格编辑器仅位于 `tests/.../WpfProbe`，不得作为原布局验收结果。所有已显示按钮均有真实操作；未实现项仍在下文清单，不能直接挂空 handler。

## 已适配公共检查点（PR #52）

已定点读取 `5bb60d24b9c60c9eecfcc5adc37bced4688adf85` 的 integration HANDOFF 与 `ParityModules.cs`，通过独立只读 worktree `/workspace/caiwu-cashier-contracts` 编译，不修改本 checkout 的公共文件。

- `ParityCashierStore(IParityLedgerService, BookDefinition, actor)` 把权威状态保存为 `ModuleId=cashier / DocumentId=state / SchemaVersion=1`；`ModuleLedgerSnapshot` 一次读取，同账套/全局 revision CAS；同账套模块审计、流水号、勾账关系一批提交。外部 SQLite 只作独立合成切片，不参与这一事务路径。
- 公共分录从同一快照投影稳定 `voucher:{GUID}:line:{index}` ID 和内容 revision，当前仅本位币 CNY/无辅助项的旧 DTO；不根据科目前缀猜现金流量标志或外币。真实科目现金流量/币种元数据必须显式提供 `BookDefinition`。
- `CashierVoucherProposalAdapter.CreateProposal(sameSnapshot, plan, index, proposalId, kind, number?, attachments?)` 返回可审阅 `VoucherProposal`，不会提交。`AcceptConfirmed` 才调用公共接收。来源键为稳定 `document:{GUID}`，不使用每次变化的计划 revision 或随机新来源键。模块文档在同一建议里标记来源；`ProposalReceipts` 重开恢复真实凭证 ID。
- **不能称已接通**：本轮 12 项适配测试使用记录型 `IParityLedgerService` 替身，证明的是参数/快照/拒绝降级行为；公共 Core/SQLite 实现仍由集成者负责。不得把替身结果当公共原子事务证据。

### 提交给集成者的剩余具体要求

1. `SaveModuleDocuments` 当前返回 void，适配器依据现有账套一次写入递增 1 的约定返回 `expectedRevision+1`。请冻结此约定，或返回明确 mutation receipt（bookId+committedRevision），不能为获得新 token 而在失败后自动刷新重试。
2. 旧 `VoucherLine` 的整数分/非负金额边界仍在。桥接对外币、负数、超过两位小数、超 Int64 分范围、任何 `OriginalFields` 非空的单据明确拒绝转凭证，保留原值；需要富分录 DTO 支持币种/外币借贷/汇率/数量/单价/辅助/现金项目/原行号/未知列，才能解除相应拒绝。不能删除这些验收或舍入后上传。
3. 旧 `Account` 缺现金流量/明细/币种/辅助标志；宿主必须提供版本化、与同一账套快照一致的完整科目元数据，不能通过 `1001/1002` 前缀猜账户。目录变更/权限策略未完成。
4. 原 `pz.gz_bz/gzm` 不在旧公开 DTO；当前勾销权威信息在同账套出纳模块文档。若账务反过账/改行/删除影响已勾销行，模块会以内容 revision 检出并拒绝继续读取/写入，不能静默解绑。需要公共协调器统一定义阻止该操作或显式整组反勾销的原子策略，以及冲突恢复入口；未把这个缺口当全功能完成。
5. 建议每批多张生成提供一事务接收；当前 `AcceptVoucherProposal` 每次一张，逐条批次必须逐张回读状态和收据，不能在首次成功后复用旧 Context，不能假报全批成功。删除已生成凭证和重新生成的来源消费策略仍待完整实现。
6. 宿主需要明确授权真实 OperatorSession；仅传 actor 字符串不构成模块权限认证。`ParityCashierStore.Registration` 仅描述原窗口，不能自动生成可点击空菜单。`w_cn_pz` 目前只有服务/建议 API，没有已验产品窗口。

## 集成者需要提供的精确接口

1. 科目目录快照：账套身份、科目码/名、是否明细、是否含现金流量选项、币种目录；原出纳账户由含现金流量科目+币种组成，不通过代码前缀猜账户。
2. 账务对账适配：稳定凭证/分录 ID、修订 token、账套/日期/科目/币种、借/贷原精度、已过账状态、原勾账码。勾销/反勾销须与出纳一事务提交或由公共协调器提供一致性边界，不能在模块缓存成功后把账务写失败吞掉。
3. 生成凭证适配：公共事务内保留逐条来源关联、凭证编号策略、期间/权限/审核状态校验、原精度；安全重试和删除已生成凭证时的联动。模块计划不直接调用旧精简 `VoucherLine` 丢外币/辅助项。
4. 原格式适配：`cn_mx` 已知至少 8 变体，主要 16 字段外，DW 明示 `g_qymc/khyh/yhzh` 等；`cn_nc` 3 变体、`cn_hz` 2 变体。需要版本化 schema 指纹、原值/NULL/未知字段及原关联完整保留。当前模块合成存储不能宣称原 SQL Anywhere 账套兼容。
5. 宿主：独立出纳子系统/MDI sheet，保留 `m_frame_cn`、窗口操作菜单、父子窗口路径、Ctrl+A/Ctrl+S/Ctrl+F4，不改成公共主窗口新流程。

## 证据与当前状态

已读取原版 README/gap-analysis、qingsong/cn 菜单/导航/窗口/规则、出纳表定义和相关 JSON；读取 PR #38/#39/#40 现有工程/数据/UI 结论。#38 旧的“暂不切换底层”已被当前用户授权取代，不作为停工条件。

- 当前状态：独立模块、事务持久化、窗口外壳/事件、测试用 Windows 工具、公共适配器已实现。
- 编译：独立模块、WPF、Windows 合成工具、对 PR52 冻结契约的 Integration 项目均成功（0 警告/0 错误）。
- 合成行为：独立 SQLite 工作流 34 项通过；公共契约适配 18 项通过（替身，非 Core 实机）。包括闭环夹具、实际磁盘重开、整屏期初回滚、SQLite 写入失败回滚、两连接并发 CAS、单号不复用、结账改删限制、已生成/已勾账/外来记录保护、金额精度、月范围、前期未勾账、勾账与整组取消、原差额阈值、稳定来源键、字段降级拒绝，以及下述审核修复回归。
- 首轮发现/修复：外币乘积的测试预期手算错误；对账本身不套用单据改删的结账限制；视图携带真实读取 revision，避免显示明细和提交 token 来自不同读取。初次 SDK 命名互斥量初始化失败经允许的 SDK 初始化后消除，无审批拒绝。测试通过仅支持列出的合成行为。
- 最终定向复核：已生成/已勾账/已结账/外来记录在打开编辑器或删除确认前即检查；建议日期也与原计划核对，禁止只改日期后转凭证。Linux SDK `10.0.403`，锁文件模式下 32+12 合成测试全部通过、无跳过；WPF 与 Windows 合成工具编译 0 警告/0 错误。TRX 本地证据：`tests/Caiwu.Cashier.Tests/TestResults/cashier-domain.trx`、`tests/Caiwu.Cashier.Tests/Integration/TestResults/cashier-adapter.trx`（忽略的构建产物，未入库）。所有 Git 差异均在分配目录内，固定公共契约 worktree 源文件状态干净。
- Windows UI/键盘/DPI/原版逐窗口对照：未执行。
- 原程序/安装器/真实账套：未运行/未接触；禁止上传原始资源和完整派生资料。

## 保留未实现清单

原初始化及清空确认、出纳结账/反结账及年度滚转、账务/外部转入、批量删除、综合/定位查询、摘要和科目查找、自动对方科目参数全分支、已生成凭证删除/重生成、完整富字段总账落地、余额调节表、汇总/外币汇总余额表、打印预览/套打/格式定义/另存、多窗口菜单/权限/登录切换、隐藏项条件行为均需独立实现与验收。已实现窗口的完整 DataWindow 视觉列序、内部字段坐标、可见条件、键盘/焦点/DPI、原运行时路径与真实 Windows 验收仍缺证。`w_cn_slz_1` 原入口未静态证明，合成工具直开明确标为测试入口。当前切片不从原验收范围删除这些项目。

## 复现命令与文件归属

见 [模块 README](../../src/Caiwu.Cashier/README.md)。测试运行：

```sh
dotnet test tests/Caiwu.Cashier.Tests/Caiwu.Cashier.Tests.csproj
dotnet build tests/Caiwu.Cashier.Tests/WpfProbe/Caiwu.Cashier.WpfProbe.csproj
dotnet test tests/Caiwu.Cashier.Tests/Integration/Caiwu.Cashier.Integration.Tests.csproj \
  -p:ParityContractsProject=/path/to/fixed-pr52/src/Caiwu.Contracts/Caiwu.Contracts.csproj
```

源文件用途（均已直接检查）：`Models.cs` 模块完整 DTO；`CashierService.cs` 业务校验与闭环；`ICashierStore.cs` 原子 CAS 适配边界；`SqliteCashierStore.cs` 磁盘合成存储及格式保护；`Integration/` 公共事务/建议适配；`Wpf/` 原窗口外层相对布局与可执行事件；测试目录的 fixtures 是明确的合成数据，WpfProbe 只运行新实现。业务存储/适配用途置信度 high（对应合成验证）；WPF 运行效果 medium（仅编译，未在 Windows 运行）。

本轮没有权限拒绝、待决写入或结果不明的数据库操作。公共接口落地和 Windows/原账套证据是未完成工程项，不是用户拒绝授权。

## 独立审核修复：公共 CAS 竞争的窗口边界

2026-10-26 00:11 UTC 收到审核：`346b3ec` 的适配器在读取成功后发生公共 CAS 竞争时直接透传 `StoreConcurrencyException`，真实 WPF `Run` 没有处理此类型，可能成为未处理异常。该项确认为缺陷，原测试验证透传的预期已撤回。

- `ParityCashierStore.Transact` 及凭证 `AcceptConfirmed` 只在公共写入边界捕获 `StoreConcurrencyException`，规范为 `CashierConcurrencyException`，保留原异常作为 `InnerException`。未知竞争胜方 revision 使用 `Actual=null`，不为了构造异常再读快照，不刷新 token、不自动重试。
- 真实 WPF `Run` 使用共享的 `CashierOperationBoundary`，失败只提示冲突；后续成功分支不会执行，窗口/对话框、原 revision 与用户输入保持。反馈可注入，以便验证真实 routed menu handler，默认仍显示产品 MessageBox。
- Linux 已实跑：适配测试 14 项通过（新增公共异常→真实窗口共用操作边界、不重试/不刷新/不清输入/不执行关闭，以及凭证建议同类竞争）；既有 SQLite 32 项通过。
- `tests/Caiwu.Cashier.Tests/WindowsRegression` 是实际 WPF 菜单事件回归：两窗口读取后在公共 writer 注入 CAS 失败，触发真实期初窗口“存盘”菜单，断言提示、输入/窗口留存、原 Context、无额外 read/write/commit；第二次存盘仍拒绝旧 token。项目编译 0 警告/0 错误，但当前 Linux 未执行 Windows 程序，保持 `not-tested`，不可据此宣告实机通过。
- Windows 集成者可运行 `dotnet run --project tests/Caiwu.Cashier.Tests/WindowsRegression/Caiwu.Cashier.WindowsRegression.csproj -p:ParityContractsProject=/path/to/fixed-pr52/src/Caiwu.Contracts/Caiwu.Contracts.csproj`。真实公共 Core 竞争、Windows 运行与后续独立审核仍待完成。

## 独立审核修复：定义差异与结账后期初保护

- 已核实固定 PR52 `5bb60d2` 的 `Exceptions.cs`：`StoreConcurrencyException : Exception`，不是原 WPF 过滤器里的任一基类；因此上一项在这一精确契约下确为未处理异常风险。没有凭名称推断继承关系。若集成者更换契约，仍须定点复核，不把本结论扩大到未读版本。
- 原 P1 确认：旧 `ParityCashierStore.Project` 首次保存后直接沿用 `state.Book`，只替换 `ActiveMonth`，使宿主新定义失效。现在逐字段对照已保存与当前定义：开账日、日期上限、本位币、科目顺序/代码/名称/明细标志/现金流量标志/币种列表。任一差异抛出明确 `store.definition.changed`，不读旧定义后继续写入、不自动迁移、不刷新/重试。唯一排除项是 `ActiveMonth`，它始终取同次公共账套快照的结账期间，不采用宿主的旧值。
- 回归覆盖：重建 store 后删除 USD、撤销现金流量标志、收紧 LatestDocumentDate 均拒绝读写，旧模块 JSON、revision、写入次数保持；公共 ClosedThroughMonth 前进仍正常生效，不误报定义迁移。
- 期初政策证据：[w_cn_lr_qc](../original-analysis/products/qingsong/cn/windows/cn.md#w_cn_lr_qc--单据录入) 静态资料只记录期初表与刷新提示，没有直接给出结账后的编辑条件；[w_cn_fz](../original-analysis/products/qingsong/cn/windows/cn.md#w_cn_fz--结账) 明文显示“结账后，将不能再输入…月数据”；[w_cn_lr_qc_nf](../original-analysis/products/qingsong/cn/windows/cn.md#w_cn_lr_qc_nf--选择年份) 表明后续年度期初需结账建立。这不足以声称原版绝对禁止任何年度期初调整，也不能据提示缺失视为允许覆写已结账历史。
- 当前切片的明确保护：当公共/模块有效月份已经越过开账月份，`SaveOpening` 和整屏 `SaveOpenings` 均以 `opening.history.protected` 拒绝更新，保留原余额/审计/revision；读取与日记账仍可用。提示明确说明“原版结账后的期初修改规则尚未核实，本切片保护期初为只读”，不伪装成已证原规则。完整原版期初调整/反结账策略与无损重算依赖继续留在验收缺口，不能借此永久删除原功能。
- 此轮新增单项/整屏期初保护和定义回归；Linux 实跑 34+18 合成测试通过，真实窗口竞态回归编译通过。Windows 运行、真实公共 Core 竞争及原版政策对照保持未验证。没有扩大并行或实现新功能。

# inventory：原版出入库与成本核算切片交接

状态：2026-10-26，单月领域切片及契约 adapter 已验证；真实 Windows/原账套未验；基线 main `3b0c59b02d8941c32ac176309555c03c94bb4213`。
分支：`codex/parity-inventory-20261026`。独立 checkout：`/workspace/caiwu-inventory`。
早期 HANDOFF 提交：`2b0d24eeff54d5d2689d6bd7c54866111e89ec46`。已验证实现 SHA：`b5919e4512f2cbbc9a1d04b96776fb072bcc4261`；之后仅交接/证据文档更新以分支 HEAD 为准。
草稿 PR：[xhc144/caiwu-suite#51](https://github.com/xhc144/caiwu-suite/pull/51)。没有合并 main。

## 所有权与来源

仅修改 `src/Caiwu.Costing/**`、新 `tests/Caiwu.Costing.Tests/**` 和本交接。
不修改 Contracts、Core、Persistence.Sqlite、Desktop/MainWindow、解决方案、公共 props、工作流。
已检查仓库与上级目录，未发现适用 AGENTS.md；已读取 engineering-handoff-memory 技能。
直接使用 original-analysis README、gap-analysis、chengben/main 的 cb/ck 窗口、menus/rules/navigation、data/tables、相关 JSON，以及 PR38/39/40 的工程、数据、UI 成果；不重新解析安装包。
PR38 的“暂不切换实现”已被新授权取代。PR39 的字段/模板变体与副本验收限制、PR40 的相对布局/unknown 原则继续采用。

## 本轮完成与 API

新命名空间 `Caiwu.Costing.Parity`，使用本模块 DTO，保留旧 API 兼容性。
- `Parity/InventoryModels.cs`：`InventoryBook` 保存产品 cpda、仓库/车间、期初、单据 pjnr1/2 投影、盘点、核算、审核/凭证关联、来源认领和独立 revision/audit。`OriginalRow/OriginalCell` 保留声明、原值文字、可选原字节 Base64、NULL、尾空格和未知字段，不解释或写回原格式。
- `Parity/InventoryWorkflow.cs`：`Create`、`SaveProduct/DeleteProduct`、`SaveOpening`、`SaveDocument/DeleteDocument/ReviewDocument`、`SaveStocktake`、`CurrentStock`、`Calculate/CancelCalculation`、`ClaimPlan`。所有变更要求预期模块 revision，生成新只读状态；不修改输入或自动重试。
- `Parity/InventoryVoucherPlanner.cs`：`Plan`、`ValidateSource` 生成入库、销售收入、出库成本、盘盈盘亏的平衡凭证计划，来源键稳定；成本计划须先核算。零值不生成空凭证；重复来源跳过。只产生待确认计划，不记账。
- `Wpf/InventoryParityDialogs.cs`：`CostCalculation` / `CancelCostCalculation` 通过传入 `IInventoryBookStore` 实际提交 CAS；`WarehouseSelection` 返回真实仓库/车间选择。`Parity/InventoryWindowLayout.cs` 的三个对话框控件位置/尺寸/文案与既有 JSON 有直接回归；不猜 DataWindow 内部坐标。
- `Adapters/Caiwu.Costing.ParityAdapter.csproj` 独立编译，`ParityInventoryAdapter` 对接 PR52 `5bb60d24b9c60c9eecfcc5adc37bced4688adf85` 的 `ModuleLedgerSnapshot` / `SaveModuleDocuments` / `AcceptVoucherProposal` / 注册契约。领域项目与 Wpf 在原基线能单独构建；adapter 通过项目引用属性对精确外部 Contracts 检查点验证，未修改共享文件。

对应原窗口：`w_cb_cpda`、`w_cb_ckxz`、`w_cb_qc`、`w_ck_rk/rk1`、`w_ck_ck/ck1`、`w_ck_kc`、`w_cb_pdk_1`、`w_cb_hz`、`w_cb_fgz`、`w_cb_pz`。
旧 `InventoryCosting` 固定移动加权、人工 CostWorksheet 路线不能作为原版完成；保留供已有调用源兼容。本切片走出入库单据与月末加权。

## 给公共核心集成者的精确接口要求

1. 原账套适配器按 `(product, template/schema fingerprint, ledger/owner)` 读取 cpda、pjnr1/2、pdk、kcb、cb_hzk、xt 的完整原始行；保留 NULL、原声明、double 原值表示、尾空格、重复行以及变体字段，不能先压进当前简化 SQLite schema。
2. 模块的原始行扩展袋须随聚合保留；这只避免模块内编辑丢字段，不代表已实现原格式读取。显式规范化业务投影与 raw 行的差异需生成可审阅补丁，不覆盖原始袋。
3. 持久化需 `Load(ledger)`、`TryCommit(expectedRevision, aggregate, audit)` 的单事务 CAS；原单据键与新增模块业务 ID 分开，禁止擅自给原表加唯一约束/去重。月核算与期间锁、取消核算须原子提交。
4. 总账对接需查询启用末级科目，按 `(ledger, documentId, voucherKind)` 去重；只写草稿；凭证关联状态（草稿/审核/过账）与单据、核算取消的冲突检查须在同事务内完成。计划失效后禁止提交旧 revision。
5. Desktop 由集成者在 `m_frame_cb` 原菜单路径注册模块窗口和 MDI 归属。不能继续把人工工作表当作“成本核算”。新 UI 组件只在本模块 Wpf。

## 公共接口检查点的实际接入方式与缺口

已按父任务消息读取 integration.md 和 ParityModules.cs（PR52 SHA `5bb60d2`），不是读取浮动 HEAD。
`ParityInventoryAdapter(service, userObservedSnapshot, actor)` 使用用户开始本次编辑时的同一个全账套 revision；`Load` 校验 module schema、必需字段、重复 JSON 键、未知属性及核算来源。保存只修改本模块 `inventory-book-{ledgerId:N}` 文档。adapter 每实例最多一次提交，成功、失败或结果不确定后都须显式重载；不在提交前刷新 token，不自动重试。

`AcceptPlan` 一次发送稳定来源键、`ClaimPlan` 得到的模块状态及新草稿分录，权威状态由账套内模块文档保存。关联先存 `proposal:{ProposalId}` 引用，实际 VoucherId 从 `ModuleVoucherReceipt` 解析；不是伪造凭证 ID。删除过的凭证来源也不能靠换随机键再生成。合成服务已验证提交请求和故障行为；公共 Core/SQLite 的真实事务实现仍属 integration，未称已接通。

必须由集成者/后续 owner 补齐：

- `VoucherLine` v1 只有科目、摘要、借贷；原版的数量/单价、外币/汇率、项目/客供/部门/人员、现金流量、合同/到期日等不能压缩丢弃。需富分录提案（含原字段与已确认维度映射）和完整科目 flags。当前 `AcceptPlan` 对含任何未映射 OriginalRows 的账册明确拒绝转总账，但模块内原行仍保存；普通合成 RMB 新单据可走现有提案。该门禁不是删除验收范围。
- `Initialize` 只建立尚不存在的模块状态；不能覆盖原库存。当前 DocumentId 只承载一个月；多月需按期间分文档并保留历史、锁/取消顺序及期初衔接，不能用新月覆盖旧月。当前没有自动跨期。
- 原版“全部重新生成”需要受审核/过账状态约束的旧草稿替换事务；v1 仅接受新草稿且来源永久防重，不能绕过它伪造新来源。当前保留为待实现，不提供假按钮。
- 真实权限必须由宿主 OperatorSession 校验。module 只收调用者 actor，不能把这个字符串当身份认证。`ParityModuleRegistration` 只声明三处有实际 handler 的窗口；shell 注册菜单/MDI/关闭策略前不得把其他尚缺 UI 的 API 当已完成窗口。

## 算法选择与待核实细节

原证据：`w_cb_hz` 明示加权平均、盘点重算、核算后禁止本月输入；`w_cb_fgz` 为取消入口。采用月末可用金额/可用数量为基础，按仓库/产品分别计算。按 日期→单号→业务ID→行序号 累计派发到分，末次全出清余款；盘点实际数量按同一成本基数重估，独列差异。此处的具体尾差顺序与零数量调整是本切片明确实现选择，未被原程序实测确认。

投影金额限定两位、数量与单价小数位由参数显式指定（0–8）；原超精度值留原始行袋并拒绝静默取整，后续映射应依据真实模板/设置。单据价款、税额、价税为明确输入且校验合计，不按票种/税率推断抵扣资格。产品 `kmbm_xs` 信息保留为 SalesAccount，但当前收入科目由显式凭证设置选择，未擅自解释该原字段。

原出库库存不足有确认提示；本切片可显式 `NegativeStockConfirmed` 保存，核算仍拒绝月度总量不足或无成本基数盘盈。已核算期、审核单、已关联凭证的修改/删除受到保护；成本凭证仍关联时取消核算拒绝。负库存核算、凭证替换/状态同步和取消细节的完整等价性仍待核实。

## 验证、文件用途与剩余验收

本轮命令、手算、失败尝试及边界见 [PARITY_VALIDATION.md](../../tests/Caiwu.Costing.Tests/PARITY_VALIDATION.md)。领域 22 项、adapter 9 项合成回归均通过；Wpf Windows target 编译零错误/警告。以上不代表真实 Windows 或完整原版通过。

文件用途置信度：领域 DTO/规则/流程/计划、独立合成测试为 high（已读、编译及行为断言）；adapter 的契约请求/故障行为为 high，真实 Core/SQLite 接通为 unverified；三个 Wpf 窗口静态位置和编译为 high，原生交互为 unverified。没有新增外部 JSON 权威存储。

继续保留原窗口和未完成项（不能从总体验收中删除）：

| 原窗口/功能 | 本轮状态 | 后续验收 |
|---|---|---|
| w_cb_cpda / w_cb_qc | 产品/期初 API 可用 | 原产品双标签、改号、复制、批量设置、期初原 UI、权限及原字段映射 |
| w_cb_ckxz | 仓库/车间选择窗口及多仓键 | 原默认选择/实际仓号映射、Windows 焦点/键盘 |
| w_ck_rk/rk1 / w_ck_ck/ck1 | 入库/销售/领用、审核/删除保护 API 可用 | 浏览/编辑完整 UI、原菜单键位、采购合同复制、综合查询、复制单据、导入/导出、原编号规则 |
| w_ck_kc / w_cb_pdk_1 | 当前库存、盘点 API 可用 | 原表格列序/编辑、实际库存台账、综合汇总/销售明细/成本利润报表 |
| w_cb_hz / w_cb_fgz | 核算/取消 API 和真实 CAS 对话框可用 | Windows DPI/焦点/键盘、逐原版算法边界、跨月/年结与逆序取消 |
| w_cb_pz | 四类平衡计划和原子请求 adapter | 完整原窗口、生成/全部重新生成/转总账、凭证审核过账状态同步、富分录及生产成本/完工入库 |
| 原存储/其他 | 只保留原始字段袋及精确接口建议 | SQL Anywhere 副本驱动、全部模板变体、零丢失映射、调拨/退货、完整权限审计、原打印/特殊打印/报表、Desktop/MDI 接线及真实原账套兼容 |

原程序、真实账套、原安装资源均未运行/修改/上传。Linux 合成测试与真实 Windows/原账套验收始终分开。

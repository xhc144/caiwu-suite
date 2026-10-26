# invoices HANDOFF

2026-10-26 最终切片状态：**partial，可编译、合成业务闭环已验证**；生产公共总账和原账套未验收。实现 SHA：`ca292b078d79dd1f463b88703ea6f40240a90d70`；早期交接 SHA：`7fbec10a3aedb6f8411ed572c1e41d4a5d9c5032`；草稿 [PR #45](https://github.com/xhc144/caiwu-suite/pull/45)。最终文档提交以分支 HEAD 为准，不改已核实现内容。

- 分支：`codex/parity-invoices-20261026`；基线/当前已核 SHA：`3b0c59b02d8941c32ac176309555c03c94bb4213`。本文件首次提交后以 `git log` 为准，最终验证会补在下方。
- 独占：`src/Caiwu.Invoicing/**`、`tests/Caiwu.Invoicing.Tests/**`、本文件。没有修改共享 Contracts/Core/Persistence.Sqlite/Desktop/MainWindow、解决方案、props 或工作流。
- 范围：进销项单据录入/规范化导入去重/状态保护/票账比对/凭证生成计划与合成总账提交闭环；不是发票全模块完成，不做税务联网或合规认证。
- 原窗口：`w_fp_lr_1`/`w_fp_lr_2`（`m_fp_work_lr`）、`w_fp_pz`（预览生成与转到总帐分离）、`w_fp_zzs_hz`（按月/季对照）。新 UI 只在模块 `Wpf/`，使用已知控件关系，DataWindow 列序/未知运行时状态不猜。

## 首切片 API（已实现）

`InvoiceService` 使用本模块 `IInvoiceStore`；`InvoiceWorkspace` 带 BookId、Product、开账月/当前未结月、Revision。进销项文档保留逐行原字段 `LegacyInvoiceRow`，不会投影成共享简化 DTO。

- `Import` / `ImportTransfer`：规范化整票转入，原内容/当前导出内容重复跳过，内容冲突整批回滚。销项多行保留唯一 `xh`；进项一票一条汇总，禁止重复记录累加。
- `Save` / `SaveMany`、`Delete` / `DeleteRows` / `DeleteBatch`：CAS 存盘、逐行删除和保留受保护票的批删除。已审核/后续处理/未知标志/结账保护；批删除报告跳过。`SetReviewed` 只支持已知销项审核值，进项认证方式不被销项动作改写。
- `CreateVoucherPlan`：不改账，验证科目/源状态/月期/借贷/精度/重复编号，可逐票或月汇总。`CommitVoucherPlanToSandbox` / `DeleteGeneratedVoucherFromSandbox`：仅本模块合成总账的原子写入/回链及未审未过账撤销；不能把名称或结果当成生产总账接通。
- `CompareVat` / `ReadSandboxLedger`：实际分录对票面、按月/季、正反方向；缺账面或缺票税额维持 unknown/null。
- `MemoryInvoiceStore`、`SyntheticJsonInvoiceStore`：独立合成切片；JSON 排他锁/CAS/原子替换及读回。仅显式 `.invoice-synthetic.json`，不接原 `.db/.caiwu`。
- WPF：`InvoiceEntryView`、`InvoicePlanWindow`（可注入已确认 proposal 接收回调）、`InvoiceVatView`；`SyntheticHost` 提供明确选择轻松/成本、种入虚构票并重开的 Windows 验收宿主。没有修改生产主壳。

## 公共核心的精确接入要求

1. 原 `g_fp_mx` 主要变体 33 列、`g_fp_mx_2` 21 列，分别还有 4/3 个变体。适配器必须携带原表名、完整列名/空值/类型/行序及未知扩展列；不得只写金额/税额/号码后丢其他列。`yhzh/dzdh/djh/bz1/sh_bz` 存在导入格式和方向相关的重载语义，不能统一改名后丢原值。
2. 账套隔离键需包含原账套稳定标识及产品。保留轻松/成本产品上下文；发票包同名窗口相同不等于可抹去成本库和出库单联动差异。民非没有发票入口。
3. 原子事务：检查源修订、未结账期间、已有凭证/审核状态 → 验证明细科目与借贷 → 分配未占用凭证号 → 写 `pz/pzdj/pz_fj` 等完整凭证 → 同事务更新发票 `pz_bz/p_nf/p_yf/p_pzlx/p_pzbh`。失败不得先打已生成标志；多张发票共同凭证的回链必须一起删除/撤销。
4. 比对需按会计期间提供总账实际分录与科目/借贷方向，不可拿生成计划当账面。销项贷方净额、进项借方净额分别与票面比较；外部账面缺失时输出“未提供账面”，不能输出匹配。
5. 集成需要源修订/CAS、科目是否存在/启用/明细、凭证审核和过账状态、期间锁、原凭证编号规则、客户/供应商及辅助核算等接口。此模块不直接改公共核心；由线程 `01a1757c-3fa8-76aa-a1d6-9e3aa4858034` 集成者提供事务适配器。

## 保留验收与未实现项

- 真实 SQL Anywhere 读写、全部原表变体、原格式导入文件解析、数据库日志/回滚与原版复开：未测试，不能称兼容已完成。
- `w_fp_get_xz` 专/普票选择、旧税控多格式导入、试用日期限制、原权限及授权策略：保持待验。
- `w_fp_pz_xz` → `w_fp_pz_ckd` 出库单生成、成本结转、库存和销售服务收入差异、自动新建往来明细科目、全部重新生成、季度凭证：保留待实现，不用简化凭证替代。
- `w_fp_fz`/`w_fp_fjz` 结账/反结账、`w_fp_xtcsh` 初始化、参数设置两窗口、客户/供应商/发票汇总、综合查询、打印/预览/另存、隐藏与历史窗口：仍在验收清单。
- 原版 Windows/UIA、DPI/字体/PBU/焦点/菜单切换、MDI/独立进程与快捷键：未测试。Linux 编译、合成断言只证明本切片实现，不证明原版行为等价。

## 已读取证据

`docs/original-analysis/README.md`、`gap-analysis.md`、两产品 `fp/README.md`、`windows/fp.md`、`menus.md`、`rules.md`、`json/windows.json/menus.json/datawindows.json/tables.json/summary.json` 的相关条目及 `data/tables.md`。PR #38/#39/#40 的说明与工程/数据/UI 文档已读；#38 的“不切换底层”旧前提已被本轮用户授权取代。未重解包、未执行原程序、未接触真实账套、未上传原资源或完整派生资料。

## 验证状态

实现内容的实际验证（Linux，SDK 10.0.402；不运行原软件）：

| 命令 | 结果 | 证明范围 |
|---|---|---|
| `dotnet test tests/Caiwu.Invoicing.Tests/Caiwu.Invoicing.Tests.csproj --nologo -warnaserror` | 退出 0；37 通过、0 失败/跳过 | 录入/重复与冲突/多行/金额/保护/计划/合成提交/回链/按月季比对/持久化与 CAS；直接读取原 JSON 核验主要列覆盖和两产品录入区锚点 |
| `dotnet build src/Caiwu.Invoicing/Wpf/Caiwu.Invoicing.Wpf.csproj --nologo -warnaserror` | 退出 0；0 警告/错误 | Windows 目标交叉编译；不是窗口运行、像素、焦点或原版操作验收 |
| `dotnet test tests/Caiwu.Invoicing.Tests/ParityAdapter/Caiwu.Invoicing.ParityAdapter.Tests.csproj -p:ParityContractsProject=/workspace/caiwu-invoices-contracts/src/Caiwu.Contracts/Caiwu.Contracts.csproj --nologo -warnaserror` | 退出 0；12 通过、0 失败/跳过 | 对 PR52 **指定契约 SHA** 的构造/冲突测试；不证明 Core/SQLite 接收和重开 |
| `git diff --cached --check` | 退出 0 | 差异空白检查 |

上述测试和构建所用源内容已提交为 `ca292b0`；随后只更新本交接。环境最初缺 SDK，已在独立 `/workspace/.dotnet-caiwu` 安装仓库指定版本。首次 CLI 在沙箱内遇只读默认目录及 `NuGet-Migrations` 互斥量错误，转为独立 CLI_HOME/NUGET_PACKAGES 并获构建执行权限后通过；无自动审批拒绝。首次 JSON 读回断言错误地比较了中文转义字节，已改为 JSON 值/类型等价断言，真实字段并未丢失。未修改环境默认 book-project。

## PR52 冻结契约适配（已实现，尚未接实际 Core）

已读 `docs/parity-handoffs/integration.md` 和 `src/Caiwu.Contracts/ParityModules.cs`，固定 SHA `5bb60d24b9c60c9eecfcc5adc37bced4688adf85`；只读独立 checkout 用于编译引用，没有把共享文件复制/改写进此分支。

`src/Caiwu.Invoicing/ParityAdapter/` 是独立可选 csproj，默认领域/Windows 切片不依赖主基线尚未具备的 API。核心整合前使用上表 `ParityContractsProject` 指定精确 checkout；整合后默认指向仓库 Contracts。

- `ParityInvoiceAdapter.Read(snapshot, product)`：同 revision 的 ledger/module/receipt 视图，权威状态在模块文档 `invoices/workspace`，完整原票行/扩展字段保留，不读外部 JSON。
- `ParityInvoiceStore`：供录入 `InvoiceService` 使用，`SaveModuleDocuments` 一次提交；使用已显示 `origin` 的 Context，失败不刷新 token、不自动重试、不留本地假状态。宿主必须传已授权会话 actor。
- `PrepareVoucherProposal(origin, product, plan, proposalId, voucherKind, voucherDate, scope)`：一张月汇总或单票新草稿建议 + 源发票 `p_*` 状态变更在同一 proposal；完整日期/原数字类型到账务 Kind 映射由宿主明确提供。未调用 Accept 之前不改权威状态。
- `OriginFor(plan.WorkspaceRevision)`、`AcceptPreparedProposal`：不换快照，真实核心成功 receipt 才能显示接收。原日期、编号、权限、会计期间仍由 Core 再校验。
- 来源键由产品+方向+专普票+代码+号码确定；换 Guid 再导入也不释放消费记录，已有 receipt/已删草稿仍拒绝新建议。
- `Registration(product)` 保留两产品自身 `m_frame_fp/m_o/{m_o_10,m_o_pzsc,m_o_o35,m_o_30}` 四入口和原窗口名；只是描述性注册，shell 必须绑定实际控件及权限。

### 需要 integration/shell owner 处理的明确缺口

1. 公共 `AcceptVoucherProposal` 当前一事务一新草稿。多票逐票模式的多张原子接收需要 **batch proposal API**（共享同 Context、所有来源/回链/凭证/receipt 全成或全败）；本适配器拒绝 `plan.Vouchers.Length != 1`，不偷偷拆事务。
2. 当前回链使用明确计划编号；原自动编号需核心在同事务分配号码并把最终数字编号/类型写回源模块状态。仅返回 VoucherId 不足以预先构造 `p_pzbh`。原“全部重新生成”/删除凭证/冲回还需审核过账保护和消费来源版本管理；不能通过换 SourceKey 绕过去重。
3. `VoucherLine` 及 `Account` 缺辅助、外币、数量、现金流量、结算字段及科目标志。原票字段仍完整保留；发现 `xmbm/dwbm/bmbm/grbm/bz/pz_wb/pz_hl/pz_sl/pz_dj/xjbm/jslb/pz_ph` 非空则拒绝简化建议。宿主只有完成科目元数据核验后才可传 `VerifiedBaseCurrencyWithoutAuxiliary`；该枚举不代替核验。需要扩展凭证明细和账户元数据接口。
4. 原发票未结月属于模块状态，不能用普通账务月份永久代替。首次新合成/空模块暂以账套开账和已结账月份初始化；原 `xt` 发票期间、`nf/yf`、进项认证方式、无认证日时的选期规则仍需完整原映射。当前缺认证日暂用开票日，只是切片约定，不宣称原版规则已证实。
5. 单个 `workspace` 文档保留全部票，后续大量票/事件回放应拆为逐票文档及期间元数据，先做版本迁移与读回，再优化体积；不能为限制 payload 丢列或删历史。
6. 原发票菜单是独立模块/MDI 语境；本开发宿主不替代原壳。shell 可用 `ParityInvoiceStore` 绑定录入视图、向 `InvoicePlanWindow` 注入接收回调，并将实际 ledger 分录传给 `InvoiceVatView`。生产接线必须在指定 integration 实现 SHA 上做合成事务/重开验证；本轮未做，不称已接通。

### 原版保真验收仍待执行

原主要 schema 和 24 组录入控件锚点的**静态核验**已过；DataWindow 可视列序、原字段编辑风格、运行时布局/可见性、DPI/字体、焦点与快捷键、MDI/独立进程、原完整参数/打印/汇总/库存联动及所有前述未实现项继续保留。Linux 测试、Windows 目标编译、合成宿主和契约测试均不替代这些验收。

当前无被拒绝/结果不明的远端写入；早期分支推送和草稿 PR 创建均已确认。后续最终提交/推送结果以 PR 和本轮最终回复为准。

## PR45 静审返修：拒绝未知结构成员（2026-10-26）

只返修已有 PR45，审阅基线 `ad6e772d937dbca1929f456dfc5bae4dcad571c3`，不新增业务功能或任务。审阅指出的缺陷确认成立：`InvoiceJson.Options` 默认忽略 DTO 未匹配成员，原测试只证明 `Rows.Fields` 扩展列保留，不能证明 `InvoiceModuleState`/`InvoiceDocument` 等结构层无损。

- **复现：** 先新增合成回归，实际执行 `ParityInvoiceAdapter.Read → SetReviewed → PrepareSave`。在 module/document/key/row wrapper/month 五个层级分别注入 `FutureField=null`、超出 IEEE754 精确范围的高精度数值、包含空值和高精度数值/大指数的嵌套对象数组。修复前 15 案例全部未抛错误，严格拒绝断言失败（退出 1，15 失败）；静审指出的危险改写路径仍可执行。
- **修正：** `InvoiceJson.Options.UnmappedMemberHandling = Disallow`。不认识的结构成员现在抛含字段名的 `JsonException`，在读取阶段停止，不能将结构层扩展当作可忽略字段后降级保存。未增加另一套猜测的 schema，也未改源字段含义；`Rows.Fields` 仍是明确支持的原列扩展容器。
- **持久化回归：** 新合成文件分别在 workspace/document/row wrapper 注入多层未知对象；读取及 `TrySave` 均拒绝，前后文件字节相同且无临时替换残留；交换包内未知成员（包括 null）也拒绝。合法原列扩展里的 null 与 `9007199254740993.1234567890123456789` 经过审核和 `PrepareSave` 后保持类型及数值原文。
- **复验：** 原领域测试全量加此次回归 **41 通过/0 失败/0 跳过**；指定 PR52 契约 SHA 的适配测试全量 **28 通过/0 失败/0 跳过**；WPF Windows 目标交叉编译 **0 警告/0 错误**。仍使用前述三条命令，附加 `--no-restore`，全部 `-warnaserror`，退出均为 0。`git diff --check` 通过。

此修正采用“未知结构明确拒绝”，不会把未知结构层内容伪称为已支持。更高 schema、真实原账套和 Windows 原版验收的既有边界不变。没有自动审批拒绝或结果不明的写入；最终返修 SHA 以本轮提交/PR HEAD 为准。

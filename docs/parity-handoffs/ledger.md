# ledger 原版保真切片交接

状态：partial，第一垂直切片已实现；2026-10-26 UTC。工作区 `/workspace/caiwu-ledger`，独占分支 `codex/parity-ledger-20261026`，基线 `3b0c59b02d8941c32ac176309555c03c94bb4213`。早期交接提交 `def84fd4058da15a9b019ee5f0546c8fc829594b`，草稿 PR [46](https://github.com/xhc144/caiwu-suite/pull/46)。下方保留最初设计和未实现项，最终源码及证据节优先。

## 文件所有权

本任务只新增 `src/Caiwu.AccountingExtensions/**`、`tests/Caiwu.AccountingExtensions.Tests/**` 和本文件。不改 Contracts、Core、Persistence.Sqlite、Desktop、solution、公共 props 或 workflow。没有修改默认 book-project。没有安装包解析、原程序运行、真实账套访问或原资源上传。

## 原窗口与已读证据

- 三产品 `w_zw_fgz`：系统管理 → 反过账；年度、全年选项、起止月份，确定在取消左侧；禁止已结账月份反过账。涉及原 `cn_mx/hz/pz/pzdj/wlxx/xt`。
- 三产品 `w_zw_qxfz`：系统管理 → 反结账；最近结账期及全年选项，确定在取消左侧；不能早于开账日期。跨年年初数删除必须有来源标记及确认，不能把当前开账余额清零。
- 三产品 `w_zw_ydjz` → `w_zw_ydjz_1`：账务处理 → 月度结转；已结账期、未过账凭证禁止生成。轻松/成本明细有两张表，民非不同，不合并猜测。结转配置 `jzlx` 支持顺序、比例、转出类型等，第一切片只实现明确配置的全额损益结转计划，其他配置继续列为未实现。
- 已直接读取 original-analysis README、gap-analysis、qingsong/main README/menus/windows/zw、pzedit，及三产品 windows.json、tables.json；PR38 工程、PR39 数据兼容、PR40 UI 契约成果已读取。PR38 暂不更换底层前提已被本轮授权取代。简表的变体/未知属性不等于可丢字段。

## 拟交付 API（以最终源码为准）

1. 模块自有 `AccountingExtensionService`：绑定真实操作员会话、store 和原 snapshot/revision；反过账按区间/全年从 Posted 回到 Reviewed（保留独立审核人），反结账只撤销同年度最近期或全部已结期。一次 CAS Write 同时变更状态、revision 和审计，不重试。
2. 月度全额损益结转 `MonthlyTransferPlanner`：明确 source/target 科目，按已过账余额生成平衡草稿计划，返回原 token；通过现有 `ILedgerService.SaveDraft` 执行。不自动审核或过账；不能将扩展字段静默压成四字段 VoucherLine。
3. 自有辅助/外币/数量/原字段 DTO 及拒绝丢字段的 legacy 适配器。扩展持久化另由核心集成者统一处理。
4. 可实现的窗口放本模块 `Wpf/`；任何按钮只绑定真实行为，未支持项不放假按钮。原坐标证据已知项保留相对布局，不猜 PBU 到像素的固定倍率。

## 核心集成精确需求

核心集成线程：`01a1757c-3fa8-76aa-a1d6-9e3aa4858034`。

- 为凭证分录增加稳定 LineId；科目增加银行/复币/数量/辅助/现金流标志。分录需保留 `pz_wb/pz_hl/pz_sl/pz_dj/jslb/pz_ph/jzbz/xmbm/dwbm/bmbm/grbm/bz/dw/pzdj_bz` 及未识别原列，null 与 0 不能混同；原表变体需按具体模板核对。
- 原 `nc/xmnc/dwnc/bmnc/grnc` 保留本币/原币/数量、账前年初发生额、年度及维度。跨年结账应保存每份自动生成的年初数的来源年、来源 revision、生成批次，反结账只能在同一事务撤销对应自动生成项，不能删除人工期初。当前 BookInfo 单年模型不能执行跨年反结账。
- 反过账不是只改 pzdj 状态：原账套适配必须在同一事务回滚 `hz/slz/wlxx/cn_mx` 对应派生关系、清除过账人/时间并保留审核人/时间，确认受影响凭证清单；所有维度金额守恒。当前简化 SQLite 从 Posted 动态算账，不声称覆盖原表。
- 新权限应有独立 `ReversePost`、`ReopenPeriod`、`GenerateMonthlyTransfer`，映射原 b_rights 菜单权。现有权限只有 PostVoucher/ClosePeriod/PrepareVoucher，模块将采用保守会话守卫，不以 UI 姓名参数授权。
- 月度结转批次持久化需要唯一 `(book,year,month,rule-set,source-revision)` 标识、凭证关联、规则版本与原始结转标记；删除/反过账/重生成须同一事务。不得用外部 sidecar 与 ledger 两次写入假装原子。
- 持久化扩展和账务状态必须共用 revision、事务及备份/恢复；未知列和数值精度不可丢失。SQL Anywhere 兼容尚未实现，不能将 `.caiwu` 切片称为原账套兼容。

## 未实现验收项（保留）

原账套 SQL Anywhere 读写/模板变体；跨年年结、反结账与自动年初数；原过账派生表回滚及出纳勾账联动；独立原菜单权限；辅助/外币/数量实际持久化与凭证编辑 UI；原结转类型/比例/多规则顺序及自动重生成；断号检测重排；原全系列账簿与余额；Windows 原生 UI、键盘、DPI、三产品逐窗口对照。合成业务测试和 WPF 交叉编译不替代这些验收。

## 第一切片实际交付

- `AccountingExtensionService`：绑定活会话的反过账、同年反结账、真实 Core.SaveDraft 全额结转；只有基础账套可执行。反过账逐张审计并保留审核人；反结账保留人工开账余额；没有自动审核/过账。每次逆操作一次 Read/Write/CAS；结转计划及 Core 再读取用同一 token，竞争时拒绝，不自动重试。
- `MonthlyTransferPlanner`：明确科目配置，含开账及截至月末已过账余额；借贷、亏损、盈亏为零、未来期排除、重复/停用/相同科目、未过账及闭期均有合成验证。
- `ExtendedAccountingData`：辅助/原币/数量、原行标识、原字段与空值，以及年初数来源 DTO；legacy 适配遇任何扩展明确拒绝，尚无原账套读取或扩展编辑流程。
- `Wpf/` 两个原窗口：实际确定与取消事件、原快照 context、成功才关窗、错误保留输入；用现有 JSON 的 PBU 抽象比例定位，没有猜物理像素倍率。三产品控件集合/坐标/文字有静态比较。原模态、DPI、字体和键盘未实机验收。

## PR52 精确契约检查点回应

已读取 `5bb60d24b9c60c9eecfcc5adc37bced4688adf85` 的 `ParityModules.cs` 和 integration.md，未修改或拣选共享文件。独立 `Parity/` csproj 和 `tests/.../Parity/` csproj 在 `/workspace/caiwu-ledger-check52` 固定工作树组合编译；它们不在原基线基础项目的默认编译中。契约替身测试与实际 SQLite 基础切片测试分开。

`ParityAccountingAdapter`：

1. `GetSnapshot` 对接同一 revision 的 ModuleLedgerSnapshot。
2. `SaveRawReferenceDocument(context, document)` 用 SaveModuleDocuments 原样保存 reference/ JSON，保留未知数值文本和列，真实 Accountant/EditAccounts 守卫；只作未关联参考数据，不冒称已经入账。
3. `PreviewMonthlyTransfer`/`AcceptMonthlyTransfer` 从权威快照重算，使用原 context，生成稳定 `(book,year,month,rule-code)` 来源键和 ProposalId；规则版本变化不产生新来源。分录与结转规则/来源文档在同一 VoucherProposal 中交公共单事务接受。没有外部 JSON 权威状态或“两次写入即原子”的说法。
4. 公共快照尚无维度余额能力；遇本模块 reference/ 文档或其他模块文档就拒绝基础金额结转，避免忽略辅助/原币/数量。等待可验证能力后才能放开，不能给 shell 默认 always-true 绕过。
5. 描述注册仅有三产品 `w_zw_fgz` → `menu:m_frame_zw/m_s/m_s80`、`w_zw_qxfz` → `menu:m_frame_zw/m_s/m_s90`，已按 menus.json 检查。两个真实 Wpf handler 已提供，但只应对基础账套绑定；没有月度选择/设置假窗口。

**公共接口缺口反馈（待 integration owner）：**

- 当前 IParityLedgerService 没有反过账/反结账 API。建议新增持有原 book/revision 的期间命令；按范围验证 Posted/已结期，状态、模块来源/勾账/往来派生变更、年初数撤销、审计及 revision 一次事务提交。需真实活会话 ReversePost/ReopenPeriod 权限，不能把 ILedgerStore 暴露给 shell 来绕过公共命令。
- 第一次 shared module 写入会产生 `ParityModuleCommit.v1`。Legacy service 在任何 `ParityModuleCommit.*` 事件存在时拒绝逆操作和旧结转，防止绕过来源认领或只改总账状态而漏模块状态。读快照允许；拒绝不改原事件 PayloadJson。该门禁不是共享逆操作已完成。
- 需要可验证的账套/科目维度能力和按稳定 LineId 的辅助/外币/数量余额查询；VoucherProposal 除基础 Lines，还要与扩展分录文档建立可校验一一映射。Core 的 SaveDraft/DeleteDraft/CancelReview/Post/反操作必须守卫关联元数据，不能改基础凭证后留下陈旧扩展。
- SaveModuleDocuments 本身不验证辅助目录/科目标志/原币折算及数量勾稽，所以 raw reference 保存不等于辅助核算已启用。请勿将该存储接口替代会计业务校验。
- 现有 PostVoucher/ClosePeriod/PrepareVoucher 不区分逆操作/生成；暂行反操作要求 Administrator 加相应现有角色。待独立菜单权接通再替换，不放宽到姓名字符串。
- SourceKeys 已消费后，原结转“删除后重生成、改规则后重生成、增加交易后的补差”需要明确撤销/新批次协议，保留前次来源/收据并防重复。当前 parity 适配明确拒绝同规则同月再次认领，不能新随机来源键绕过。

## 验证状态与剩余阻塞

已成功：基础模块行为测试及 SQLite 独立回读/审计故障回滚；WPF 交叉编译零警告零错误；三产品原两窗口静态布局比较；PR52 契约组合编译与 adapter 契约替身测试。最终数量和证据源 SHA 见后续收尾追加。

未完成：共享 Core/SQLite 的真实 parity 接通、共享逆操作、真实 Windows 对话框操作、原账套 SQL Anywhere 兼容及上述未实现验收。原因分别为公共实现/接口尚未提供、当前环境 Linux、原格式无损适配在其他任务；不是权限拒绝。没有被拒绝的动作、待批准动作或结果不确定的远端写入；未运行原程序或真实账套。

## 已冻结源码与最终证据

产品和测试源码提交：`527604b974ef8d4decd2525405c16cfca8c27a2a`；产品子树 `730073fb61487519043f13ce43110b71770aec01`。该提交已推至草稿 PR46。后续收尾提交只添加证据和更新本交接，不改产品源码。

| 实际执行 | 结果 | 支持的结论/边界 |
|---|---|---|
| `tools/dotnet-local.sh test tests/Caiwu.AccountingExtensions.Tests/Caiwu.AccountingExtensions.Tests.csproj -c Release --logger 'trx;LogFileName=ledger-synthetic.trx' --results-directory tests/Caiwu.AccountingExtensions.Tests/evidence` | 49 passed，0 failed，0 skipped；构建无警告 | 基础状态机、权限撤销/到期、原 token/CAS、真实 Core 结转及 SQLite 独立回读/触发器故障回滚；只有合成账套 |
| 固定 PR52 工作树，`dotnet restore .../Parity/Caiwu.AccountingExtensions.Parity.Tests.csproj --locked-mode` 后 `dotnet test ... -c Release --no-restore` | 6 passed，0 failed，0 skipped；构建无警告 | 共享契约编译、稳定来源、原 context、未知 JSON 原样传递、保守维度拒绝；**契约替身，不是共享 Core 真实接通** |
| `tools/dotnet-local.sh restore src/Caiwu.AccountingExtensions/Wpf/Caiwu.AccountingExtensions.Wpf.csproj --locked-mode` 后 `build ... -c Release --no-restore` | 0 warning，0 error | Windows 交叉编译，未运行真实窗口 |
| `python -m unittest discover -s tests/Caiwu.AccountingExtensions.Tests -p 'test_*.py' -v` | 3 passed | 三产品两窗口已知控件集合/原相对几何/文字及事件接线；不是目视、UIA、DPI 或键盘验收 |
| Git 范围/空白检查 | 仅独占模块、测试、本交接；通过 | 未修改共享目录、main、workflow、私有权限或默认 book-project |

原始合成 TRX 与摘要位于 `tests/Caiwu.AccountingExtensions.Tests/evidence/`：`ledger-synthetic.trx`、`parity-contract.trx`、`validation-summary.json`。摘要含源码提交/子树、PR52 checkpoint、每文件 SHA256 和明确 not-run 状态；固定组合工作树中产品/测试 C#/XAML/csproj/lock 文件与源码逐一哈希相符。没有保存原程序、真实账套或新的完整派生资料。

建议集成顺序：先采用 PR52 兼容公共契约，再拣选本分支源码及收尾证据；基础 Wpf 菜单仅对当前无共享模块事件的账套绑定。共享 Core 实现完成后跑 Parity 项目与真实存储的组合验收，并补齐上述逆操作/维度能力接口，再扩展可用范围。不以静态注册激活未实现按钮。

# 独立验收：037a075，Windows CI 40172477245

**结论：尚不满足“快速真实可用”。有一项 CI 原图直接可见的显示阻断、三项实际数据/输入回归失败，以及一项实际 SQLite 错误与 UI 捕获范围不匹配。** 不能以原有测试全绿或截图元数据 `success=true` 作为交互验收通过。

本验收独立于主实现，生产模块未改。目标仓库 `xhc144/caiwu-suite`，目标分支 `codex/windows-mvp`，不可变提交 **`037a07585078d4dfcd443a2cc4a237c88aed07a0`**。2026-10-25 独立 Linux 回归使用官方 .NET SDK 10.0.402（官方元数据中的 SHA512 校验成功）。未运行原商业软件、未获取原安装器。该提交未包含 `docs/reference-ui` 入口，未见子页不作参考证据。

## 优先发现与复现

### P1 / ACC-001：列表、余额表、期初表的列收缩，不能正常辨认账务信息

**证据等级：已看该提交 Windows CI 原始 PNG；本地没有运行 WPF。**

CI：run `40172477245` / job `121106056815` / artifact `12591076154`，head 为上述完整 SHA。下载外层 ZIP 的 SHA256 与服务端记录一致；内部预览包与 manifest 的 **413 个文件**逐一核对 SHA256 全部一致。内层预览包 SHA256：`43696969042e63c6265f5533e6c76abd58685d38ed74b6a763f2a9f57ca9ee86`。见 [provenance.json](../../tests/Caiwu.Acceptance/evidence/ci/provenance.json)。

复现：打开该 CI 产物的 [凭证列表](../../tests/Caiwu.Acceptance/evidence/ci/verification/voucher-list.png)、[余额表](../../tests/Caiwu.Acceptance/evidence/ci/verification/trial-balance.png)、[期初表](../../tests/Caiwu.Acceptance/evidence/ci/verification/opening-balances.png)。整个表格很宽，但各列只在左侧占约二十像素。表头、日期、科目名称、金额遭截断，不能完整读出某行的银行余额 108800。不能可靠核对要审核/记账的凭证或期初输入位置。

定位线索：[MainWindow.xaml](../../src/Caiwu.Desktop/MainWindow.xaml) 第 3 行起的窗口级隐式 `DataGrid` Style 没有 `BasedOn`；各列原本声明了固定宽度或 `*`。独立凭证编辑器没有该局部样式，其 [表格截图](../../tests/Caiwu.Acceptance/evidence/ci/verification/posted-voucher.png) 的列宽可辨认。主题样式覆盖只是原因假设，需实现线程改后在 Windows 定点验证，不能视为已证实原因。编辑器截图还有透明/边缘裁切问题，不能据此宣称真实桌面背景和完整窗口均正确。

修复后必须重新查看新 CI PNG，并检查真实窗口表头、完整日期和六位金额。新 WPF 探针 `WPF-LAYOUT` 会检查实际列宽，仍须人工看图。

### P1 / ACC-002：两个实例编辑同一草稿，旧输入静默覆盖新输入

**证据等级：已运行真实 Core + 两个真实 SQLite 连接；双 Windows 窗口未执行。**

独立用例 `ACC-002`：

1. 实例 A 保存金额 10.00 的草稿，实例 B 读取并保留旧凭证。
2. A 把金额改成 20.00 并保存。
3. B 用原有 Id、日期、编号及旧分录保存。
4. 预期拒绝过期编辑并保留 B 输入；实际成功写入，金额从 20.00 退回 10.00，revision 变成 3，无冲突异常。

定位：[LedgerService.SaveDraft](../../src/Caiwu.Core/LedgerService.cs) 第 101 行重新读取当前 revision；第 131 行按这个新 revision 提交，但 `VoucherDraft` 不含用户打开时的版本。UI 的编辑器也只传旧 Id/分录。因此低层 store 的 CAS 只能防止一次命令内部的并发，无法防止人类编辑窗口过期。本次 `STORE-CAS-01` 通过，不能用该通过结果否定此问题。应把编辑版本或等价冲突检测贯穿实际保存路径；此验收不改 Contracts。

修复后按上述两个连接顺序重验，再做两个实际应用实例的窗口操作。已被其他实例记账的旧草稿则已验证会拒绝，见 `STALE-POSTED-01`。

### P1 / ACC-003：停用一个未使用的末级科目，就不能保存期初余额

**证据等级：已运行真实界面行模型 + Core + SQLite；没有点击 WPF 按钮。**

独立用例 `ACC-003`：创建三个启用末级科目 `1001`、`1002`、`3001`，停用无余额且未被引用的 `1001`。按 UI 的实际选行逻辑生成所有末级科目的 `OpeningBalanceEdit`，给 `1002` 填借方 `100.01`、`3001` 填贷方 `100.01`，保留停用 `1001` 的零余额。保存整个可见集合，实际抛出 `LedgerValidationException: 不能使用停用科目。`，不能完成开账。

定位：[MainWindow.ReloadOpeningRows/SaveOpening_Click](../../src/Caiwu.Desktop/MainWindow.xaml.cs) 第 250/273 行包含全部末级行；[SetOpeningBalances](../../src/Caiwu.Core/LedgerService.cs) 第 86 行对每行执行 `RequireUsableLeaf`。界面和领域对停用零余额行的契约不一致。修复要同时考虑已有余额科目停用，不能简单过滤后把已有余额清零。

修复后重验停用零余额行、停用非零余额行、总借贷平衡以及保存失败时原输入保留。

### P1 / ACC-004：错误的千分位格式静默变成更大金额

**证据等级：实际调用生产 `AmountInput.Parse`，`zh-CN` 区域。**

独立用例 `ACC-004` 的实际结果：

| 输入 | 实际金额 |
|---|---:|
| `1,23` | 123.00 |
| `1,,2` | 12.00 |
| `12,34.56` | 1,234.56 |
| `100,00` | 10,000.00 |

这些字符串没有合法的三位分组，应该给出可修改的错误，当前会直接成为分录/期初的十进制金额。定位：[EntryModels.cs](../../src/Caiwu.Desktop/Presentation/EntryModels.cs) 第 25 行用 `NumberStyles.Number` 接受任意逗号分组，随后只检查非负和两位小数，没有检查原始语法。合法 `1,234.56`、分位金额以及普通非法输入已有独立正反例通过，问题不在 decimal 精度。

修复后在 `zh-CN` 和目标 Windows 区域设置下重验合法分组、粘贴、两位小数、空值、负值、多个分隔符；中文 IME 另做实机验收。

### P1 / ACC-005：SQLite 锁冲突异常漏出凭证编辑器，无法保证错误时保留输入

**证据等级：已实际触发 SQLite busy；UI catch 的分类为静态核对，WPF 崩溃或输入丢失未实机执行。**

独立用例 `ACC-005`：一个真实连接持有 `BEGIN IMMEDIATE` 写事务，另一个真实 `LedgerService.SaveDraft` 尝试保存。实际异常为 **`Microsoft.Data.Sqlite.SqliteException` / SQLite Error 5 `database is locked`**。

定位：[VoucherEditorWindow.Save](../../src/Caiwu.Desktop/Dialogs/VoucherEditorWindow.xaml.cs) 第 103–105 行仅捕获 `LedgerValidationException`、`StoreConcurrencyException`、`ArgumentException`、`InvalidOperationException`、`OverflowException`、`IOException`，不包含这个实际异常。[App.xaml.cs](../../src/Caiwu.Desktop/App.xaml.cs) 没有 Dispatcher 异常兜底。保存按钮和 Ctrl+S 直接调用该方法，外层 `MainWindow.Run` 不能当作 Dispatcher 内按钮异常的可靠捕获器。

Console 用例重放了目标提交的 catch 类型分类，属于基线证据；修复后的 UI 是否真正保留输入必须执行 **实际处理器**。已提供 `WPF-SQLITE-BUSY-RETAINS-INPUT`：使用真实 SQLite 锁并触发实际 Save 按钮，再断言窗口仍开着、显示错误且输入保留。该 WPF 探针目前仅交叉编译，未运行。

### P2 / ACC-006：会计科目错误路径先关闭窗口，再报领域错误

**证据等级：静态路径核实，未执行 WPF。**

新增科目填 `123`、非空名称后点确定。`AccountWindow` 第 102 行只验证非空，第 107 行先设 `DialogResult=true` 关闭；`MainWindow.AccountEdit` 随后才调用 `Service.SaveAccount`。领域要求编码至少四位，因此返回错误时原对话框已退出，用户不能就地修正原输入。不存在的父科目、编码关系错误等也在关闭后才校验。应把最终校验/提交错误留在同一表单中。提供 `WPF-ACCOUNT-INVALID-RETAINS-INPUT` 待 Windows 执行。

## 实际回归与通过边界

命令（完整项目引用，未改 root solution）：

```sh
CAIWU_ACCEPTANCE_DOTNET=/path/to/dotnet tests/Caiwu.Acceptance/Regression/run.sh
```

结果：编译 **0 警告、0 错误**；独立 **18 项，14 PASS / 4 FAIL**，失败为 ACC-002/003/004/005，进程按预期返回 **1**。原始结果含运行时、区域、目标源树和异常信息：[regression-037a075.json](../../tests/Caiwu.Acceptance/evidence/regression-037a075.json)。ACC-005 的范围严格按上文说明。

通过项实际覆盖：创建文件、期初/草稿/独立审核/记账/重开精确余额；草稿/已审核不计入账；已记账禁止修改、删除、撤销审核和重复记账；同 Id 重复审核不多写 audit/revision；旧窗口不能改已被其他实例记账的凭证；锁期持久化及禁止跳月/重复结账/锁期录入/期初；未记账凭证阻止结账；非法草稿不改数据；备份恢复快照一致且后续相互独立；不覆盖已有文件；损坏备份不发布目标文件；真实会话切换隔离及坏文件打开保留旧会话；底层 stale revision 拒绝；全部三种现有模板可保存一分钱凭证。

这些是 backend/session/model 的实际回归，**不是 UI 操作全链路通过**。

| 用户关心的能力 | 本次实际证据 | 未覆盖部分 |
|---|---|---|
| 新建/打开账套 | 真实 SQLite 和会话创建、打开、切换及失败保护通过 | Windows 文件对话框和真实开账按钮未操作 |
| 保存草稿/审核/记账 | 真实服务与落盘重开通过；过期草稿覆盖失败 | UI 点击链路、双击保存不重复新增未执行 |
| 余额/明细联查 | 独立数据精确值与 VoucherId 通过；CI 余额截图存在 | 表格可读性当前失败；UI 双击跳转未执行 |
| 备份/恢复 | 真实文件/快照/目标不覆盖/源副本独立通过 | UI 选路径、取消及磁盘满提示未执行 |
| 锁期与已记账只读 | 后端拒绝与持久化通过；CI 已记账截图已看 | 实际编辑控件/键盘绕过未执行 |
| 错误时保留输入 | 后端拒绝不改持久数据；ACC-005/006 存在问题 | 实际 WPF 保留输入、关闭中的活动编辑未执行 |
| 连点/切账不串 | 同 Id 审核/记账防重复、真实会话隔离通过 | 新增保存连续点击、切账时保留/丢弃确认未执行 |
| 中文/金额/键盘焦点 | 生产金额模型已运行，发现 ACC-004 | IME 组合 Enter/Esc、F4/F7、Ctrl+S、Tab 焦点全未验 |

## Windows 证据与下一步

原 CI 的 Core 53 / SQLite 63 / presentation 13 / integration 9 通过，UI 程序确实在 Windows Server 2025 上运行并渲染。`UiVerification.Run` 先通过 `SampleLedger` 直接调服务预制三张已记账凭证，然后切页截图；没有经 UI 操作创建、保存、审核、记账。其 JSON 明确 `manualInteractionTested=false`。截图生成成功不包含列宽/可读性断言。

新增 Windows 脚本（只在 Windows 调用）：

```powershell
./tests/Caiwu.Acceptance/Wpf/run.ps1
```

此探针直接引用真实 Desktop，加载真实 App 资源，使用真实 SQLite，以 routed events/reflection 及一次原生鼠标连点执行上述定点检查（后续已扩充为七项，见 [Windows 探针交接](windows-probe-handoff.md)）。没有模拟或声称物理键盘/IME/原生文件对话框验收。输出 JSON 与新截图放 `tests/Caiwu.Acceptance/evidence/runtime/wpf`，默认不入 Git。它没有接入现有 root solution，也没有更改现有 workflow；原打包脚本不会自动构建/执行它。

Windows 手工补验：创建两个不同年度/制度账套；错误/取消时保留原输入；新草稿双击保存和连按 Ctrl+S 只落一张；改变审核员审核、记账后各入口只读；切 A/B 和开坏文件不串账；余额→明细→凭证可返回；备份恢复副本独立；锁期禁止原期操作且后期可新增；中文 IME 候选确认 Enter/Esc 不跳格/关窗；Tab、Enter、F4/F7、Ctrl+S 的焦点和活动单元格提交；活动期初编辑直接关窗的未保存提示；100%/125%/150% DPI 下看完整表头/金额/按钮。

没有修复生产模块，所以本次不声称任何上述缺陷已修复。主实现后续提交需要按其不可变 SHA 重新执行失败用例和 Windows 定点检查。前期曾怀疑账套日期重置会触发旧查询；继续检查实际事件绑定后未得到支持，未列作缺陷。

当前剩余阻塞：**实际执行 Windows WPF、物理键盘/IME 与手工文件对话框验收**，目标为上述当前提交及后续修复提交，原因是本执行环境为 Linux、无 Windows WPF 运行时。状态为**未执行/待 Windows**，并非权限拒绝，也没有执行结果不明的远端动作。独立 backend/model 回归及原 CI 图像/产物核验已完成。

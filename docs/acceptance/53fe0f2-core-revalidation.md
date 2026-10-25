# 独立定点复验：53fe0f2 的 ACC002 / ACC003

**实际结果：ACC002 旧草稿覆盖与 ACC003 停用科目期初路径，在下述准确后端提交中定点复验通过。独立 23 项全部 PASS，0 FAIL；不能据此解除试用分发阻断或宣称 Windows 双窗口操作通过。**

目标 Core 修复：`53fe0f2d2744e557dab98bf2652ffa5fce644c25`。使用其完整不可变源码的独立 detached 工作树，只读生产文件。主集成对照：`ce6064dc9a6e0831560314b0340d45da63a2f140`。

- Core `LedgerService.cs` blob：`8af6023ced9e53bf8e4a8fa3f9bb216bce34917e`。
- Contracts tree：两提交均为 `c88d36ff051dd784e92d96e66fd8ab37d0100adc`，包括 `ExpectedRevision` 与 `ExpectedBookId`。
- SQLite tree：两提交均为 `fa09da23acb4764e2d9006b59f988dbccbc04c70`。
- 生产工作树执行前后无修改；所有编译输出位于独立 Acceptance `.build`，没有改 root solution、生产模块或 Contracts。

## 独立 diff 审查

Core 此次生产变更为五行 token 强制校验，位于 `SaveDraft` 读取当前快照之后、任何业务变更或 Write 之前：已有 Id 缺少任一 token 必须抛 `StoreConcurrencyException`；任何已提供的 token 与当前账套 Id/版本不符也必须拒绝。原 store revision CAS 保留，没有偷偷重试。与主集成窄契约一致：已有草稿必填两个 token，新建可不填，提供的 token 仍须各自匹配。

停用期初修复已包含在该提交祖先中：停用末级科目允许原样保留余额；不能修改、遗漏已有非零余额后清零；新凭证继续禁止引用停用科目。本轮没有仅采信作者的 13/13 或复用作者测试，而是单独构造真实 SQLite 回归。

## 实际运行与夹具

```sh
CAIWU_REVIEW_SOURCE_ROOT=/workspace/caiwu-review-53fe0f2 \
CAIWU_ACCEPTANCE_DOTNET=/tmp/caiwu-acceptance-sdk/dotnet \
  tests/Caiwu.Acceptance/Revalidation53fe/run.sh
```

官方 SDK 10.0.402；实际运行时 .NET 10.0.13 / Debian Linux。编译 **0 warning / 0 error**，进程退出 **0**。完整运行身份及 23 个结果在 [revalidation-53fe0f2.json](../../tests/Caiwu.Acceptance/evidence/revalidation-53fe0f2.json)。

所有编辑夹具只在 `BeginEdit` 中读取一次同一份 `LedgerSnapshot`，从中取得凭证、BookId 和 Revision；在保存或重试时不补读 token。这个要求避免“旧窗口拿新 token 覆盖”的假通过，也避免旧夹具根本没带 token、只因缺 token 被拒就误称并发修复通过。

通过的关键路径：

- 两个真实连接先分别打开金额 10 的同一草稿，A 保存 20，B 带**原始完整 token**提交 30：抛并发错误，A 的 20 保持，B 请求对象不变。
- 缺少两项、仅缺 Revision、仅缺 BookId：直接经 `ILedgerService.SaveDraft` 拒绝。
- 跨账套故意构造**相同凭证 Id、相同 revision**，仅 BookId 不同：仍拒绝，两个账套均无副作用；不是靠找不到 Id 或版本不同凑通过。
- 其他命令改变版本、负版本、最大版本：拒绝。不存在 Id 但 token 正确时是领域错误；不存在 Id 且无 token 时是并发契约错误，两者均不意外新增凭证。
- 借贷不平衡拒绝后，不重新取 token，用原打开快照修正输入可正常保存；合法编辑可重开 SQLite 核实落盘，且没有追加成第二张。
- 用代理钩子仅在真实 store.Write 前安排另一真实 SQLite 连接提交，形成**token 校验后**的竞争：底层 CAS 继续拒绝，持久结果精确等于竞争者提交后的完整快照，不含外层失败审计。
- 新建无 token 的兼容调用仍成功；新建提供过期或错误 BookId 的 token 时拒绝；已记账凭证即使携带**当前正确 token**仍禁止改动。
- 实际 `OpeningBalanceEdit` 全末级行包含停用零余额行时，平衡期初可保存；停用非零余额可原样保留；遗漏、显式清零、从零新增停用余额均拒绝；新凭证继续拒绝停用科目。

每一个拒绝断言都比较完整序列化的持久快照，覆盖数据、审计和 revision，而不只检查异常或金额。竞争用例单独与竞争者提交结果比较，避免把合法竞争者的写入误判为失败副作用。

## Windows 可复用探针与仍未验范围

已有 WPF 探针增加第 **8** 项：`WPF-STALE-EDITOR-RETAINS-OPENING-TOKEN-AND-INPUT`。它打开实际凭证编辑器，保留 B 的原始快照；第二个真实 SQLite 连接用 A 的原始快照保存 20，B 输入 30 后两次触发实际 Save。必须留窗、有明确错误、保留摘要和原金额、两次均传原始 BookId/Revision，且完整持久快照保持为 A 的新值。它不使用保存时的新快照更新 token。

```powershell
./tests/Caiwu.Acceptance/Wpf/run.ps1 `
  -ReviewedSourceRoot C:\path\to\fixed-checkout `
  -OutputDirectory artifacts/independent-acceptance
```

WPF csproj 支持引用独立 `ReviewedSourceRoot`，运行器记录该源码工作树的 commit 和 src tree；全部八项结果缺失、FAIL 或 BLOCKED 均非零。对准确 53fe0f2 的交叉编译已完成：**0 warning / 0 error**。本环境没有执行 Windows WPF，这项 UI 结果仍为**未执行/待 Windows**。

主协调的实际双应用窗口补验应保持如下顺序：同一账套同时打开 A/B；B 打开旧草稿并输入 30，A 打开该草稿保存 20；B 保存应报冲突、留窗且保留 30；B 不重新加载再保存仍应冲突；重开账套核实是 20，并检查审计/凭证数量。之后按产品流程明确加载新版本，不能静默换 token 后直接覆盖。

不在本结论内：Windows 双应用窗口、鼠标/键盘焦点、中文 IME、实际连点、打印、高 DPI，以及 ACC001/004/005 的最终 Windows 关闭确认。原 `037a075` 失败证据保持不变，原 console 的 ACC005 旧 catch 表达式不再用于判定当前实际 Save handler。分发阻断继续保留，由主协调按全体验收决定。

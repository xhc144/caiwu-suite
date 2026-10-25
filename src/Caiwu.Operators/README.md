# 本地操作员模块（独立交付，尚未接入 Desktop）

提供可调用的认证/授权服务及真正的 WPF 首次设置、登录、操作员管理、修改密码窗口。仅新增本目录与 `tests/Caiwu.Operators.Tests`。初始读取基线为集成分支 `f68f863`，提交基线更新至 `4cfeb11`；没有修改 Desktop、Contracts、Core、账套 SQLite、全局 Theme 或安装器。

## 项目与依赖

- `Caiwu.Operators.csproj`：`net10.0`，独立本地身份存储、会话及权限服务，不依赖账套。
- `Wpf/Caiwu.Operators.Wpf.csproj`：`net10.0-windows`，引用服务层，不依赖 Desktop。宿主添加此 ProjectReference 即可使用。
- 密码直接使用官方 `Microsoft.Extensions.Identity.Core` **10.0.13** 的 `PasswordHasher<T>`，Identity V3 默认配置；没有自写密码算法。依赖精确固定并附锁文件。官方依据：[PasswordHasher API](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.identity.passwordhasher-1?view=aspnetcore-10.0)、[Identity 配置](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/identity-configuration?view=aspnetcore-10.0)。存储校验只检查 V3 包络与损坏工作因子上限，不代替官方校验。
- 无生产默认账户/密码、无网络身份服务、无自动登录。测试中的凭据仅用于自动创建并删除的虚构临时账户。

## 必须由主集成完成的最小接入

1. Desktop 加入上述 WPF 项目引用；根 solution 收录两个项目和测试项目。此分支未修改这些 owner 文件。
2. 应用启动时构造一个 `LocalOperatorService`，用户数据目录由宿主确定。例如 `Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CaiwuSuite", "Operators")`。保持安装更新后位置不变；不要按账套或窗口创建新身份库。
3. 用 `OperatorDialogs.Login(owner, operators)` 完成首次设置及登录。返回 `null` 表示取消，不能建立账务会话或回退到可编辑姓名下拉。首次设置只创建管理员，仍需显式登录。管理员只具备账户管理、恢复与查询权限，账务角色需要另行分配。
4. 移除/禁用 `MainWindow.OperatorInput` 的任意名称切换。顶栏显示 `session.Identity.DisplayName`。切换操作员时先 `Logout(oldSession)` 并关闭/废弃旧编辑器，再显示登录窗口；取消切换保持未登录。退出应用或退出登录也调用 `Logout`。
5. **每个实际入口**都通过服务检查，包括快捷键、菜单、工具条、命令、编辑器保存回调、后台任务。菜单启用状态可用 `RequirePermission` 探测，但不能只隐藏按钮。不要向普通 UI 暴露未守卫的 `ILedgerService`。
6. 传给 Core 所有 `operatorName` / `reviewer` 参数的值必须是授权回调返回的 **`actor.ActorKey`**。显示名、登录文本或从 UI 传来的 Guid 均不能作为认证凭据。显示时通过 `ResolveActor(session, actorKey)` 查只读身份（含停用身份），不要求管理权限；未映射历史值返回 null，要清楚标示。
7. 编辑器捕获打开时的 `OperatorSession`、账套会话和 `LedgerMutationContext`；保存必须再次检查这些原始对象。不要在保存瞬间偷偷换成当前登录者或刷新修订号。`ExecuteDraftEdit` 防止当前 Core 在保存草稿时把制单人改成其他编辑者；新草稿使用 `Execute(PrepareVoucher, ...)`。

```csharp
// 假定 shownVoucher / shownSnapshot 是用户实际核对的同一快照。
var shownContext = new LedgerMutationContext(shownSnapshot.Book.Id, shownSnapshot.Revision);
var editorSession = currentSession; // 打开编辑器时捕获，退出后该对象失效
var saved = operators.Execute(editorSession, OperatorPermission.PrepareVoucher,
    actor => originLedger.SaveDraft(newDraftWithOriginalTokens, actor.ActorKey));

var edited = operators.ExecuteDraftEdit(editorSession, shownVoucher.PreparedBy,
    actor => originLedger.SaveDraft(editedDraftWithOriginalTokens, actor.ActorKey));

operators.ExecuteReview(currentSession, shownVoucher.PreparedBy, actor =>
{
    originLedger.Review(shownVoucher.Id, actor.ActorKey, shownContext);
    return true;
});
```

所有 `Execute*` 回调是**同步**的，身份文件锁贯穿回调；请直接调用现有同步 Core API。不要传 `async` / Task 回调，不要在回调内再次调用本模块，也不要在锁内弹窗等待用户。先采集和确认输入，再进入守卫。授权与账务分别存储，不宣称跨文件事务；账套冲突仍由原 v1.2 快照令牌保护。

| 宿主操作 | 权限 / 守卫 |
|---|---|
| 查询、报表、打印、只读联查、打开账套 | `ReadLedger` |
| 科目新增/编辑/删除 | `EditAccounts` |
| 设置期初 | `EditOpeningBalances` |
| 新草稿、删除本人草稿 | `PrepareVoucher`；已有草稿保存用 `ExecuteDraftEdit`，删除也应限制原制单身份 |
| 审核 | `ExecuteReview`，传持久凭证的 `PreparedBy` |
| 取消审核 | `ReviewVoucher` |
| 记账 | `PostVoucher` |
| 结账 | `ClosePeriod` |
| 账套备份 | `BackupLedger` |
| 账套恢复、替换、创建用户数据目录等高权限宿主操作 | `RestoreLedger`；现有账套防覆盖保护必须继续保留 |
| 操作员目录、增改停用、重设密码、身份备份/恢复 | `ManageOperators`，管理 API 自带检查 |

角色明确分工：Administrator→管理/恢复；Accountant→科目/期初/账套备份；Preparer→制单；Reviewer→审核；Poster→记账；PeriodCloser→结账；Reader→只读。每个非空启用角色均可查询。可多选角色，但制单与审核相同 actor 仍被拒绝。未定义权限枚举值拒绝。

## 当前 Core 边界与历史账套

已检查的 `MainWindow.OperatorName()` 读取可编辑下拉；Core `SameActor` 只对字符串作 NFKC 与忽略大小写比较。稳定键 `operator:<Guid N>` 能直接被现接口保存，并在 Core 自审校验中保持稳定。测试使用真实当前 `LedgerService` 验证此接点。

当前 `ILedgerService` **本身不认识会话/角色**，直接调用仍可绕过宿主守卫；因此本模块不能声称已完成全应用身份集成或安全合规。若需要在领域层强制保障，最小后续契约是接收由可信授权服务验证的 actor 上下文，并把未授权原服务留在组合根内部，由 Contracts/Core owner 统一调整。

旧凭证中的自由文本姓名不能自动证明归属。`ExecuteReview` 对未映射的旧姓名拒绝审核；`ExecuteDraftEdit` 同样拒绝不同或旧身份。主集成需提供明确、人工核实的旧身份→稳定 actor 映射和受控迁移，保留原审计文本/迁移记录，不能根据显示名静默猜测或批量覆盖。此模块不改账套 SQL。当前 Core 编辑会重写 `PreparedBy`，宿主应使用本模块的原制单人编辑守卫；若要允许他人代改又保留原始制单身份，需要 owner 增加原始制单/最后修改身份字段。

ID 与 actor 键均系统生成、不可编辑；登录名不可改、不可重用。停用只改变状态，身份与历史显示名永久保留；改名不改变 actor，旧显示名也不能给另一账户使用。管理员可为不同人建不同身份，软件无法证明两个不同账户背后是否同一自然人，角色审批与账户归属仍由管理员负责。

## 存储、会话、保护与备份

`operators.json`、`operators.initialized`、`operators.lock` 位于宿主给定的绝对用户数据目录，拒绝安装目录。宿主负责该目录的 Windows 用户 ACL，以及限制对哈希和备份的访问。Unix 新建文件为用户读写；Windows 继承用户目录 ACL。文件不加密，不抵御有权直接修改本机文件的 OS 用户，也不修改外部安全设置。

同目录临时文件先写并 Flush 到磁盘，首次以不覆盖移动发布，后续 `File.Replace` 原子替换；写入前在跨进程排他锁下比较修订号。文件锁忙或旧版本均明确失败，无后台覆盖重试。原子发布依赖本地文件系统语义；不要放网络共享或不支持原子替换的目录。中断产生不完整初始化时保留标记并拒绝重新设管理员。文件损坏、缺一份、未知 schema 或身份不一致均拒绝，不静默重置。

会话是服务实例签发的不可外部构造对象，只在内存保存，默认固定8小时（可指定最多24小时），重启需重新登录。每次授权重读启用状态、角色、store ID 与 security stamp；资料/角色/密码变化撤销该身份所有旧会话（包括其他实例，下次操作即拒绝）。退出立即撤销。错误登录不会写身份库；实例内5次失败暂停30秒，重启不会保留节流计数。它是本地交互节流，不是系统级锁定或联网防护。

`BackupOperators(adminSession, absoluteNewFile)` 在同一锁内输出一致性完整备份，目标必须是新文件，不能覆盖存储。备份包含密码哈希及历史身份，**不含明文密码/会话**。账户身份库与账套应成对备份；仅备份账套无法恢复 actor 目录。

`RestoreOperatorsToNewDirectory(adminSession, backup, newDirectory)` 需活跃管理员，校验后只写尚不存在的新目录，保留全部 store ID、版本、角色、密码哈希、停用和旧显示名；不覆盖或清空现库，不恢复任何会话。宿主先验证备份来源并显式确认恢复，旧备份可能恢复旧密码及启用状态，不能当作自动修复。当前库损坏导致无法登录时，本模块不会提供“重建管理员”后门；需经过单独的受控离线恢复流程，此交付未提供该 UI。

## WPF 接口与窗口行为

- `OperatorDialogs.Login(owner?, service)`：首次设置→显式登录；取消为 `null`。
- `OperatorDialogs.Manage(owner, service, session)`：管理员管理，构造与每次提交都有服务层检查。
- `OperatorDialogs.ChangePassword(owner, service, session)`：本人旧密码验证；成功后原会话失效，宿主重新登录。

所有窗口必须以 `ShowDialog` 使用。输入错误、权限变化、冲突、文件忙均留窗并显示安全错误；取消不签发会话，关闭清空 PasswordBox。管理窗口保存资料与重设密码分为两个明确操作，避免只成功一半却误报完成。没有日志输出、遥测或保存密码输入。窗口继承宿主控件模板及全局 Window 样式；未嵌入主题、颜色、字体或主框架重画，精确窗口类样式可由宿主提供。

## 验证命令

```sh
./tools/dotnet-local.sh test tests/Caiwu.Operators.Tests/Caiwu.Operators.Tests.csproj -c Release
./tools/dotnet-local.sh build tests/Caiwu.Operators.Tests/WindowsSmoke/Caiwu.Operators.WindowsSmoke.csproj -c Release
```

Windows PowerShell 7：

```powershell
./tests/Caiwu.Operators.Tests/Run-WindowsSmoke.ps1 -OutputDirectory artifacts/operators-windows
```

Windows smoke 有120秒进程上限，仅创建/删除虚构临时身份。加载宿主当前 Modern.xaml，实际显示模态窗口并调用真实 Routed Button.Click，覆盖取消、校验留窗、登录、管理员新增/停用、非管理员拒绝、改密/退出，生成3张合成截图与 JSON；不等同物理键盘/IME验收。**本次 Linux 仅编译此 smoke，未实际运行 Windows 窗口。**结果见本目录 HANDOFF.md 与测试 evidence。

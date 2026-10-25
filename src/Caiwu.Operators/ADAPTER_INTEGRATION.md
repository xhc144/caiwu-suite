# ILedgerService 集中授权适配

`AuthorizedLedgerService` 实现现有完整 `ILedgerService`，产品只新增 Contracts 项目引用。没有修改 Desktop、Contracts 或 Core。`AuthorizedLedgerServiceFactory.BindSession(operators, fixedLogin, trustedFactory)` 返回可直接赋给当前 `DesktopBackend.CreateService` 的 `Func<ILedgerStore, ILedgerService>`。

## 固定会话与可信 actor

装饰器 private readonly 捕获原始 Core 服务、授权服务及精确登录对象，不公开 inner，也不接受可切换的 session getter。所有方法先按实时权限检查原登录对象；旧服务不会因为另一个账户登录而恢复。注销、停用、资料/角色/密码变化及到期使已有窗口持有的旧装饰器失效，新的登录需要新的 factory/服务。

兼容接口保留 `operatorName` / `reviewer` 参数，但装饰器**完全忽略**传入值，Core 收到的只会是授权服务返回的 `OperatorIdentity.ActorKey`。界面可以继续使用当前方法签名，传 `string.Empty`；顶栏及凭证显示用显示名映射，不能把显示名当凭据。

| 方法 | 服务层授权及其他限制 |
|---|---|
| `GetSnapshot` / `GetTrialBalance` / `GetLedger` | ReadLedger |
| `SaveAccount` / `DeleteAccount` | EditAccounts |
| `SetOpeningBalances` | EditOpeningBalances |
| `SaveDraft`（新建） | PrepareVoucher；原 draft 对象及 ExpectedBookId/ExpectedRevision 原样交给 Core |
| `SaveDraft`（已有） | PrepareVoucher；在原快照版本读取持久 PreparedBy，必须等于当前稳定 actor |
| `DeleteDraft` | PrepareVoucher；同上，只能原制单身份删除 |
| `Review` | ReviewVoucher；在原快照版本读取持久 PreparedBy，必须是本身份库已知 actor 且不同于审核者 |
| `CancelReview` | ReviewVoucher |
| `Post` | PostVoucher；Core 继续校验状态及独立审核身份 |
| `CloseMonth` | ClosePeriod |

管理员没有隐式账务特权。各角色可多选，制单与审核同一 actor 仍被拒绝。原始 Core 仍承担科目/状态/期间/平衡等领域规则。

## 所有权校验和 CAS 的顺序

已有草稿保存、草稿删除和审核需要读取持久身份，操作按以下顺序执行，整个过程处于同一同步身份锁中：

1. 核验固定登录会话与该操作权限；拒绝时不读 Core。
2. 检查调用方原始 context（草稿则由原 ExpectedBookId/ExpectedRevision 构成）存在。
3. 读取当前持久快照，只在其 BookId 和 Revision 与**调用方原值完全一致**时使用持久 PreparedBy；不一致立即 StoreConcurrencyException，不调用账务变更。
4. 用稳定身份做原制单人限制/独立审核限制，旧自由文本姓名不自动映射。
5. 将原 context 对象或原 draft 对象原样传给 Core，仍由 Core 最终 CAS。即使另一个账套进程在第3步后写入，本次也不能借新快照令牌越过冲突。

其余六个写入口直接原样转发 context，由 Core 强制其必填和一致性。装饰器不修复、刷新或补齐任何令牌。同步调用不弹窗、不等待 UI、不执行 async；不要对装饰器再套 Execute*。

## 真实 Desktop 组合根

可编译完整源码：`tests/Caiwu.Operators.Tests/WindowsSmoke/DesktopCompositionExample.cs`。它直接使用现有 `DesktopBackend`、`PreviewLedgerService`、`LedgerFilePolicy`、`SqliteLedgerStore`、`LedgerSession`、`SessionBoundMutation` 和 `VoucherEditorWindow`。该示例在测试工程里编译，不创建另一套产品框架或应用入口。

组合根的核心接法是：

```csharp
var createService = AuthorizedLedgerServiceFactory.BindSession(operators, fixedLogin,
    store => new PreviewLedgerService(new LedgerService(store)));
// DesktopBackend.CreateService = createService;
```

包装顺序必须保留现有民非预览只读限制。原始 Core 只在 trustedFactory 闭包内构造，不能另外保存在 ViewModel、静态变量或编辑器字段后由菜单直接调用。`MainWindow` / 报表只得到包装后的接口。

当前 `LedgerSession.BackupTo` 直接访问 ILedgerStore，`DesktopBackend.Open/Create/Restore` 也不属于 ILedgerService，不能假称此装饰器已覆盖。编译示例为 Open 加 ReadLedger、Create/Restore 加 RestoreLedger，并继续 LedgerFilePolicy 校验及存储原有防覆盖；Backup 明确加 BackupLedger。模板目录是静态元数据，非账务写入口。后续导入/成本/专用服务若不走 ILedgerService，也须由其 owner 单独绑定固定会话。

## 首次登录、注销和换人

- 首次启动使用宿主稳定用户数据目录创建 LocalOperatorService，临时设置 `Application.ShutdownMode = OnExplicitShutdown`，显示 OperatorDialogs.Login。首次管理员设置不会签发会话，随后仍显式登录。取消返回 null：不创建主工作会话，按宿主流程退出或保留未登录外壳。
- 登录成功后用该登录对象创建 backend，再创建 MainWindow 和新的 LedgerSession。绑定主窗口 Closed 撤销此登录；不要把不同窗口的退出回调改为撤销一个可变的“当前会话”。
- 用户申请注销/换人时，先在锁外处理未保存内容确认。确认后先 Logout(oldLogin)，再关闭/废弃旧编辑器、报表和主窗口/账套会话，清理已显示的缓存资料；最后显示新登录。取消新登录保持未登录。
- 同一窗口换人也必须丢弃原 backend/服务与账套 generation，重建完整会话后重新读取。不能只更换顶栏姓名或把旧 factory 的 session 变量重指向新登录。
- 角色变化或密码重设后，旧窗口调用装饰器将得到 OperatorAuthorizationException。宿主提示重新登录并保留未保存输入供用户决定；不能自行重试为其他用户。四个既有操作员窗口不需要重写。

## 各窗口/确认点捕获什么

| 打开/加载位置 | 捕获对象 | 提交/生成时 |
|---|---|---|
| 凭证编辑器 CreateVoucherEditor | 原包装 service、原 LedgerSession generation、完整 editSnapshot、原 BookId/Revision、voucher | `SessionBoundMutation.GetService().SaveDraft(originalDraft, string.Empty)`；装饰器限制原制单身份 |
| 科目 AccountWindow | 原 SessionBoundMutation 与所显示科目 | 保存回调调用其 guarded SaveAccount；不能重新拿当前账套服务 |
| 期初表加载 | 原 SessionBoundMutation 与原期初行数据 | guarded SetOpeningBalances，原 Context，不刷新令牌 |
| 草稿列表删除、审核、取消审核、记账确认 | 选中凭证及该列表快照的 SessionBoundMutation | 先锁外确认，再调用原 service + 原 Context；装饰器读取的持久身份需同版本 |
| 结账确认 | 用户核对的账套、月份、原 SessionBoundMutation | guarded CloseMonth 与原 Context |
| ReportCenterWindow / 打印导出回调 | 原 guarded service 与账套 session generation | 通过 ReportingQueries.Build 使用 guarded GetSnapshot/账簿查询；不要使用另一个原始 Core 或换人后保留的缓存报表 |
| 科目选择器/只读凭证 | 原只读快照与父窗口会话 | 换人后关闭/清空；返回选择值不得转移到新登录者的旧保存回调 |
| 新建/打开/恢复/备份 | 固定登录对象、用户确认的源和新目标路径 | 使用编译示例的额外权限包装，保留原文件校验和不覆盖保护 |

编译示例的 `CaptureVoucherEditor` 展示了原 SessionBoundMutation 保存闭包。主入口与各窗口 owner 负责实际接线，本分支没有越权改这些文件。

## 当前验证和边界

真实 Core + 合成内存账套测试覆盖：全部入口注销/换人拒绝、九个入口读者拒绝、九个入口正确角色及可信 actor/原令牌、本人原草稿编辑删除限制、自审拒绝、未知旧姓名拒绝、过期/异账套/缺令牌拒绝、持久读取后并发写入仍由 Core CAS 拒绝、跨实例角色/停用撤销，以及通过整个装饰器完成科目、期初、草稿、审核/取消审核、记账、账簿查询和结账闭环。

这里是软件授权边界，不证明自然人身份。原始 Core/存储若被宿主另行暴露给 UI，依然可能绕过包装，因此 owner 接线审查不可省略。历史姓名迁移和 Windows 实机验收仍待完成，未声称全应用安全合规。

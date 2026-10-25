# 本地操作员模块交接

2026-10-25 10:03 UTC 更新，仓库 `xhc144/caiwu-suite`，分支 `codex/local-operators` / 草稿 PR24。独立工作树 `/workspace/caiwu`。首阶段不可变提交 `7a1e67318194c14ebad865e5d412fbdd72f9f734`；本次继续补齐集中授权适配。开始时读取集成基线 `f68f86361f76dda786559623b1a76458a2fbd596` 的说明和实际代码，后快进到 `4cfeb11536298ca8a42ba413bf5e5b37a2591527`；当前适配使用同一现有 v1.2 Contracts。未重新分析安装包、未读写预挂载书库、未提交新派生原包资料。

## 后续实际交付：集中授权装饰器

`AuthorizedLedgerService` 完整实现 ILedgerService 九个写入口/三个查询，捕获 private readonly 原登录对象，忽略所有 UI 姓名参数并注入可信 ActorKey。`AuthorizedLedgerServiceFactory.BindSession` 可直接接现 DesktopBackend.CreateService，Core 只留组合根闭包。没有修改其他 owner 目录，产品只增加 Contracts 引用。

已有草稿编辑/删除与审核在同一同步身份锁内读取持久 PreparedBy，读取快照必须与原 BookId/Revision 完全一致；原 draft/context 不改传给 Core，保留最终 CAS。旧登录、换人、跨实例停用/角色变化不能让旧窗口持有的服务恢复。缺失、异账套、过期上下文均不补令牌。测试还在归属读取后插入真实 Core 并发写入，验证最终 CAS 拒绝且不覆写获胜状态。

`ADAPTER_INTEGRATION.md` 给出方法权限矩阵、首次登录/退出/换人、各窗口捕获点与不属于 ILedgerService 的存储入口。`tests/Caiwu.Operators.Tests/WindowsSmoke/DesktopCompositionExample.cs` 是已编译的真实 Desktop factory/PreviewLedgerService/文件校验/编辑器示例，不是新主入口。宿主仍需实际接线；不要对已包装服务再套 Execute，避免嵌套身份锁。

新增 **59项**适配行为测试，累计 **100通过、0失败、0跳过**；包含真实 Core 经适配器的完整科目/期初/草稿/审核与取消/记账/账簿/结账闭环（银行与资本期末各110的独立合成算例）。新证据 `tests/Caiwu.Operators.Tests/evidence/operators-adapter-linux.trx`；原41项 TRX保留为首阶段证据。带可编译组合根示例的 WindowsSmoke 组合编译仍为0警告/0错误，证据 `adapter-windows-cross-build.log`。Windows 实际执行仍 pending，原因与下文相同。

## 已完成且有行为测试支持

- 服务层：首次显式管理员初始化、官方 PasswordHasher 验证、内存登录会话/退出/到期、启用停用、明确多角色权限、管理员增改/重设密码、本人改密。
- 不可变 Guid/actor 键/登录名、历史显示名保留和不可他人复用、停用不删除、最后启用管理员保护。改名后 Core 审计身份不变、本人不能审核自己，不能靠同名重建身份。原制单人编辑守卫阻止 Core 的改写 PreparedBy 路径。
- 每次实际授权重读存储，跨实例修改密码/角色/启用状态后旧会话失效；拒绝操作不执行宿主回调。同步授权锁贯穿账务回调；Task/ValueTask 回调在调用前拒绝。
- 用户目录持久文件、排他锁、严格修订比较、原子发布、大小限制、损坏/未知版本/文件缺失拒绝重置。一致性身份备份和只恢复至全新目录，保留原有身份与禁用历史。
- 真实当前 Core + 合成内存账套：可信 actor 制单、改名后自审拒绝、另一制单者代改拒绝、独立审核成功，审计记录保持稳定 actor。

## 已实现但尚未 Windows 运行

四个 WPF 模态窗口：首次设置、登录、管理员管理、本人改密。错误保留窗口，取消不签发会话，关闭清空密码输入；UI 无日志、无默认生产凭据。窗口动态继承宿主 Window 样式和控件模板，精确类样式由宿主覆盖。Linux 交叉编译通过；实际窗口、原生输入、视觉和 DPI 均未实机验收。

`tests/Caiwu.Operators.Tests/Run-WindowsSmoke.ps1` 提供可复用、120秒超时的实际 WPF 探针；加载当前 Desktop Modern.xaml，生成纯合成截图与 JSON。源代码及交叉构建已经完成，Windows 执行是 pending，原因是本执行环境为 Linux，无 Windows 桌面；未被权限拒绝，也没有不确定的远端运行。

## 验证证据

- SDK `10.0.402`，`net10.0` / `net10.0-windows`；新增产品依赖 `Microsoft.Extensions.Identity.Core 10.0.13`，锁文件齐全。
- 首阶段 `dotnet test tests/Caiwu.Operators.Tests/Caiwu.Operators.Tests.csproj -c Release`：**41通过，0失败，0跳过**。涵盖正确/错误登录、停用、角色矩阵、退出、到期、节流、首次重复及并发初始化、版本冲突及并发发布、密码非明文与随机盐、改名/同名/审计身份、损坏拒绝、备份恢复保护和失败无写入/回调副作用。原始 TRX：`tests/Caiwu.Operators.Tests/evidence/operators-linux.trx`；后续累计100项见上文新证据。
- `dotnet build tests/Caiwu.Operators.Tests/WindowsSmoke/Caiwu.Operators.WindowsSmoke.csproj -c Release`：0警告/0错误，包含本模块 WPF 与当前 Desktop 的引用组合。这是可编译证据，不是 Windows 交互证据。
- `dotnet list src/Caiwu.Operators/Caiwu.Operators.csproj package --vulnerable --include-transitive`：当前 NuGet 源未报告已知漏洞；不代表合规认证。
- 初始环境没有 dotnet，官方 SDK 安装到本工作树 `.tools/dotnet`，未提交工具二进制。首次库构建出现 CA1416 的 UnixCreateMode 平台警告，已改成非 Windows 分支设置，最终构建无警告。

## 主集成待办（未假称完成）

1. 按 README 添加 WPF ProjectReference/solution 项目，移除姓名下拉认证替代，将启动、注销、换人和编辑器会话贯通。
2. 用 BindSession 将所有 ILedgerService 查询/变更/快捷键/保存回调统一接到集中装饰器，原始 Core 不出组合根；另接存储层备份/创建/恢复守卫。继续保留 v1.2 的原账套及修订令牌。不要对包装后服务再次 Execute。
3. 旧账套姓名身份需人工核实的映射/迁移，不能按显示名自动猜测；当前服务会拒绝未知历史身份的审核/草稿修改。
4. Windows 执行 smoke 并复核窗口、键盘、DPI、主题。该分支没有修改 CI workflow；主集成可添加命令。
5. 明确用户目录 ACL、身份库与账套成对备份策略及受控离线损坏恢复流程。安装/更新不得清空身份库或账套。

当前 Core 仅接字符串，不识别会话角色；全应用强制身份保障取决于组合根守卫覆盖，后续若需要 Core 强制认证，应由其 owner 增加可信 actor 上下文。当前模块没有财务合规、安全认证或生产就绪结论。管理者给同一自然人创建不同名字的不同账户属于账户治理，软件无法证明自然人身份。

## 文件用途与置信度

| 路径 | 作用 | 证据与限制 | 置信度 |
|---|---|---|---|
| `LocalOperatorService.cs` | 登录、会话、权限、管理、身份备份 API | 合成行为测试及真实 Core 接点测试通过 | high |
| `AuthorizedLedgerService.cs` | 固定会话的完整 ILedgerService 集中守卫及 factory | 九写三读、所有权、原令牌/CAS、注销失效与真实 Core 完整闭环测试通过 | high |
| `FileOperatorStore.cs` | 用户目录 JSON 身份持久化、锁、原子保存与恢复保护 | 并发、冲突、损坏、备份测试通过；Windows 文件系统待验 | high（Linux） |
| `Models.cs` / `OperatorRules.cs` | 身份/会话/角色/权限与输入规则 | 角色矩阵、身份稳定与拒绝测试 | high |
| `Wpf/*.xaml*` / `OperatorDialogs.cs` / `DialogSupport.cs` | 模态登录、首次设置、管理、改密与样式继承 | 交叉编译；Windows 交互未跑 | medium |
| `README.md` | 宿主接口、守卫、actor 映射、存储与恢复边界 | 按实际 MainWindow/Core/Contracts 内容编写 | high |
| `tests/Caiwu.Operators.Tests/*.cs` | 服务、集中适配与真实 Core 合成测试 | 100项当前执行通过；不代表全应用已接入 | high |
| `ADAPTER_INTEGRATION.md` / `WindowsSmoke/DesktopCompositionExample.cs` | Desktop owner 可直接消费的接线、流程和捕获点 | 示例真实项目引用编译通过，未运行 Windows | high（编译） |
| `tests/Caiwu.Operators.Tests/WindowsSmoke/*` / `Run-WindowsSmoke.ps1` | 有时限的 Windows WPF 合成探针 | 已编译，未在 Windows 执行 | medium |

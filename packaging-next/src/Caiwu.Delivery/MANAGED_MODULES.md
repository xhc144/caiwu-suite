# 受管账套模块数据接入（2026-10-25）

本阶段只改 Delivery 和它的 tests。生产可调用服务已实现，不自动改 Desktop/App/Contracts/Core/Storage，不改变已有 Windows hash/FileSha256Basis 或 Storage 的 PublishNew。所有测试为临时虚构账套/身份。

## 宿主实际接点

采用 Summary `dcda051a0c9ee364ccff4c2b4c7085f446fac39d`、Nonprofit.Reporting `cb71350b2b19067e7a8704b74985d8cf0f15e1aa`、Costing `af0d0e34ab9963fc91cabb8a58aed558b34390f0`、Operators `1957435365390756fd8267937fd0ec408b1e498f`、ReportDesigner `03ee6dac47a7cc1c61f303f3c5e214245f87017d` 后，Desktop owner 添加：

```xml
<ProjectReference Include="../../packaging-next/src/Caiwu.Delivery/Modules/Caiwu.Delivery.Modules.csproj" />
```

独立 Delivery 主项目无这些模块依赖，继续可编译；Modules 子项目必须与上述作者模块一起编译。验证脚本从不可变 SHA 组合真实作者源，不改任何生产 owner 文件。

组合根在第一次数据访问前取得并持有：

```csharp
using var managedData = ManagedDesktopLaunch.OpenSession(installRoot, explicitlyConfiguredUserDataRoot,
    Environment.ProcessPath ?? throw new InvalidDataException("缺少实际可执行文件路径"));
var moduleHost = new ManagedModuleHost(managedData);
// 安装回执必须与宿主明确指定的数据根相同；没有任意外部根的默认回退。
```

这个对象持有既有 `.delivery.lock` 与 `.delivery-data.lock`，验证 owner/current/data receipt/manifest，存活至所有窗口和 worker 结束。`AcquireOperationLease()` 返回同一真实租约的引用令牌，可在 worker 取得、UI 释放；会话关闭后拒绝新调用，最后一个令牌释放后才关闭 OS handles。令牌不代表用户授权，账务/身份权限继续由原 Operators 负责。

**启动模式须配套。** 旧 `Installation.Launch` 仍由 launcher 父进程持锁，子 Desktop 不能重复获取同一 OS 租约。新增 `ManagedDesktopLaunch.Launch` / CLI `launch-managed` 先验证 payload，释放验证租约再启动子进程，并传 `CAIWU_INSTALL_ROOT` 和 `CAIWU_DATA_ROOT`。只允许真实 `ManagedDataContract=true` 的 payload；子 Desktop 必须在任何数据访问前调用上述 OpenSession，重新核对回执、验证实际执行路径属于当前激活版本、校验 payload 并自己持锁。旧版本若在交接期间被升级，不会用新回执误开新数据。中间升级/卸载导致子进程核验失败时不得打开账套。不把环境变量当持锁证明。根只能在完成该 App 接线和 Windows 验收后切换启动命令/标志；本阶段未改安装器 shortcut 或默认模式，也没有启用该标志。Linux 已用临时复制的自研测试 apphost 独立真实子进程验证执行路径绑定、交接和在用阻断，Windows 尚未验证。

每次正式 Create/Open/Restore 由宿主在切换成功前调用：

```csharp
var book = managedData.RegisterBook(actualStore.DatabasePath, snapshot.Book.Id);
```

读取 SQLite 一致性副本验证实际 BookId；`FindBook(databasePath, bookId)` 同时绑定物理路径与身份，不能只按 BookId 查摘要。新账套推荐先取 `NewBookPath(Guid.NewGuid())`，确认新目标后由原 Storage 创建，再登记。稳定位置为 `Books/{InstanceId}/ledger.caiwu`；已有根内账套可以显式登记，模块仍在 `Books/{InstanceId}/Modules/...`。新恢复副本保留 BookId，分配新的 InstanceId。目标不接受根外、安装目录、Global、备份/scratch、链接、逃逸、已有文件或 SQLite sidecar。

`managed-modules.json` 记录 BookId/InstanceId/相对账套路径与附件 key/codec/相对路径。服务保留旧 `managed-books.json` 中每条记录并同步新账套；不通过扫描冒认旧外部账套。两份登记文件不是跨文件事务；若断电或同步失败，原件/已发布文件保留，`SynchronizeLedgerInventory()` 可在有效会话中显式重建旧账套清单，旧缺失项仍阻断，不能静默删除。重复 `RegisterBook` 会补做同步。不要在登记异常后重建/删除用户账套。

## FeatureWiring 的最小实际委托

对 `002eb07371b979b666e9f9834fe0b1d93a4af4d6` 的 options，主入口 owner 可以直接填入：

```csharp
var options = new DesktopFeatureOptions
{
    OpenSummaryCatalog = binding =>
    {
        binding.DemandCurrent();
        var registered = moduleHost.OpenSummary(binding.DatabasePath, binding.Shown.Book.Id);
        return new SummaryFeatureRegistration(registered.Catalog, registered.Attachment.Key,
            "ManagedBookBackup：账套和全部登记附件版本复核后一起备份；全局操作员另行管理员备份。");
    },
    BookCopy = new BookCopyFeatureOptions(
        AcquireDataLease: binding =>
        {
            binding.DemandCurrent();
            return managedData.AcquireOperationLease();
        },
        ValidateManagedDestination: (binding, path) =>
        {
            binding.DemandCurrent();
            managedData.ValidateNewBookDestination(path);
        },
        RegisterCreatedBook: (binding, result) =>
        {
            binding.DemandCurrent();
            managedData.RegisterBook(result.DestinationPath, result.Book.Id);
        })
};
```

这是具体 API 接法，不需要另造路径/租约策略。使用原被捕获的 OperatorSession 在各委托操作时重验相应权限；不能读取新的全局登录变量替代旧身份，不能把 `AcquireOperationLease` 当管理授权。原 FeatureWiring/BookTools 已明确账套复制仅复制 DTO，不复制契约外附件，新 BookId 不继承源摘要登记；不要宣称 BookCopy 是完整模块备份。需要完整附件的恢复使用下述 API。

摘要首次创建必须由明确初始化动作调用 `moduleHost.InitializeSummary(databasePath, bookId)`；该动作调用原 Create 并实际登记后返回。普通菜单只 `OpenSummary`，未登记/缺失/损坏时拒绝，不自动创建空库。已有摘要恢复后按新实例注册条目打开，不猜旧路径。

分类、工作表、模板：用 `ModulePath(book, "Nonprofit"/"Costing"/"Reports", explicitNewJsonName)` 取得路径；由原 `ClassificationJsonStore.SaveNew`、`CostWorksheetExport.SaveNewJson`、`TemplateStore.Save` 写入，再调用 `RegisterAttachment(book, stableKey, codec.Id, actualPath, codec)`。`moduleHost.Codecs` 提供四个原生适配器。只有明确保存并登记的模块文件纳入备份；未登记文件出现在该账套 Modules 目录时会阻断“完整”备份。Template 本身无 BookId，其 book 归属由受管登记确定，未给模块伪造内建归属。

## 完整账套备份/恢复

```csharp
var book = managedData.FindBook(databasePath, shownBookId);
var backup = moduleHost.BookBackups.Backup(book); // 默认最多3次，允许1–5次
// 宿主保留/展示 backup.Directory + backup.ManifestSha256；hash必须来自独立保存的可信回执。
var recovered = moduleHost.BookBackups.Restore(backup.Directory, backup.ManifestSha256);
// recovered.DatabasePath 是全新位置；正式切换仍由原 LedgerSession.Open/登记流程决定。
```

账套使用现有 SQLite Backup API，读取/hash 都基于关闭的一致性副本；不直接 hash live WAL 主文件、不修改严格 payload hash 的 FileShare。Summary 使用 Read/ExportBackup/RestoreBackup；分类用原 Load/SaveNew 并强制绑定备份中的精确账套版本；成本用原导入重算/导出；模板用原 Load/Save 及 Id/Version/SHA。保存完整 manifest：账套身份/revision/语义SHA、每个文件长度/SHA、附件 key/codec/相对目标/版本。来源之前/之后的 ledger 语义版本和所有附件 token 必须一致，变化时有界重试；持续变化、stale分类、未知 codec、未登记/缺失文件均明确失败，无混合成功。仅声明每本账套的可校验捕获，不声明多个账套、全局身份和文件系统间全局事务。

恢复先验证整个 manifest/hash/文件集合/模块内容，再恢复到自己新建的 scratch，逐项验证，最后原子移动为新的 Books 实例。已有目标和有效备份绝不覆盖；失败仅清理自己的未发布 scratch。文件已发布而登记失败时保留发布位置并明确抛出“登记未完成”的路径，不能删除重试。备份 manifest 的 hash 不是签名；宿主须保留可信来源回执，不能从陌生备份自算 hash 后当来源认证。

旧 `BookOperations.Backup` 对已模块登记的账套明确阻断，不能漏附件仍报完整。`Installation.Install(..., moduleCodecs: moduleHost.Codecs)` 升级前自动为所有登记账套保存完整 bundle，并在旧 backup-receipt 记录其清单和hash；无 codec 或缺附件时保留旧指针/源数据、阻断激活。调用 install 前先关闭 Desktop 的管理会话/窗口，不能让它自己的 OS lease 阻止安装。模块 codec 只持有数据根，不持有已关闭的会话。直接 `UpgradeSafety.Prepare` 遇 module registry 必须传入当前有效 `managedData` 和 codecs。当前 helper CLI 的 `install` 没有引入模块依赖，因而模块账套升级会保守阻断；由根在实际集成 helper/安装路径后调用该重载。没有开放迁移/安装全栈门控或生成分发包。

## 全局 Operators 独立边界

唯一稳定目录 `managedData.OperatorsDirectory` 为 `Global/Operators`。宿主在此创建原 `FileOperatorStore`/`LocalOperatorService`，正常初始化和登录仍走原模块。

```csharp
var identityBackup = new ManagedIdentityBackup(managedData, existingGlobalOperatorService);
var receipt = identityBackup.Backup(capturedAdministratorSession);
var separateRecoveredDirectory = identityBackup.RestoreToNewDirectory(capturedAdministratorSession, receipt);
```

原模块在身份锁内实时核验 `ManageOperators`；服务不自行读/复制正在写的身份 JSON，不绕原权限。身份备份包含密码哈希，位于 `.delivery-backups/identities`，宿主须保护目录访问，不能上传真实备份/回执。恢复只到全新的 `Global/IdentityRecovery/{id}`，不覆盖活动 Operators，不切换登录服务、密码、停启状态或恢复旧 session。单账套 manifest 显式 `IncludesGlobalIdentities=false`。这些边界不能由“账套恢复完成”消除。

## 证据与未验项

运行 `tests/Caiwu.Delivery.Tests/validate-modules.sh` 组合固定作者 SHA 的真实 API；执行 `CAIWU_DELIVERY_TEST_SCOPE=managed-modules ./tools/dotnet-local.sh run --project tests/Caiwu.Delivery.Tests -c Release -p:RestoreLockedMode=true -- report.json` 跑新增故障边界；全量可去掉 scope。输出仅有合成检查和平台信息，不保存账套或密码哈希。

本阶段 Linux 测试不证明 Windows 原生 WPF、NTFS junction/ACL/硬链接身份、原生新发布并发、安装快捷方式、断电耐久性或打印完成。仍保留现有交付暂停门槛。根须完成 App/FeatureWiring/安装调用接线与 Windows 测试后才启用受管模式；本模块没有擅改上述入口，也没有跨目录上传原软件派生资料。

# 复制为新账套与复制前预览

**并发发布 P1 已按 Storage 专责规则修复；Unix 已实测，Windows 待验。** 修前两个独立服务在最后目标预检后同步发布，30 轮有 10 轮双方均报告成功；现改为 Unix `link(2)` 原子不覆盖发布，失败只清理本次暂存名，无 rename/copy 回退。修后 tmpfs 和 overlayfs 各 30 轮全部只有一方成功，最终 BookId/文件哈希匹配成功者、失败者清理后目标及两源保持不变。原 40 项加并发回归共 41 项通过，系统调用跟踪记录 30 次成功 link 与 30 次 EEXIST。规则来源为 Storage 修复 `4e8664d5db711b6fe8543a1bf3c689f3f39c2a30` 的 CreateRace/README；没有改 Storage。回归、前后 TRX 和跟踪在 `tests/Caiwu.BookTools.Tests/evidence/`。

独立的 .NET 10 模块，基于已有 `Caiwu.Contracts` 和 `Caiwu.Persistence.Sqlite` 公共 API。代码只在 `src/Caiwu.BookTools/**`，测试只在 `tests/Caiwu.BookTools.Tests/**`。起点为 `codex/windows-mvp` 的 `a49d426d8513600dec0f624f56a35c9ad66e71d4`；读取过该分支 Storage、LedgerSession、契约，以及 `codex/windows-delivery` 的 `BookOperations`/说明和 `codex/storage-readback` 的 Write 核对改动。未修改这些 owner 的文件或根 solution，未处理参考安装包。

## 可用范围与身份规则

| 字段/内容 | 结构化全量 `FullLedger` | 科目及期初 `AccountsAndOpeningBalances` |
| --- | --- | --- |
| BookId、名称、CreatedAt | 预览生成新 Guid、用户明确输入的不同名称、预览时间 | 同左 |
| 制度、模板版本、会计年度、启用月份 | 原样保留 | 原样保留 |
| 科目顺序、父子、方向、启停、原始期初 | 原样保留，包括停用科目期初 | 原样保留 |
| 凭证、分录、凭证 ID/编号、状态、制单/审核人、附件数 | 全字段保留，不重编号、不变更审核/记账状态 | 不复制 |
| ClosedThroughMonth | 原样保留，不解锁历史 | StartMonth - 1 |
| 原审计事件 | 原顺序保留，包括已删除凭证的历史引用 | 不复制 |
| 复制来源审计 | 追加 `BookCopiedAsNew` | 唯一初始事件为 `BookCopiedAsNew` |
| Revision | 新库 Create=0，一次 Write 后为 1 | 同左 |

复制来源事件含源 BookId、名称、revision、完整有序 DTO 的 SHA256、范围及新 BookId，不含文件内容或 SQL。原 revision 不是新库的并发版本。凭证 ID 和旧审计 ID 的语义在当前单文件账套契约内，不重映射；若将来引入跨账套全局引用，需要新增经过审核的契约。

**恢复副本继续调用原来的 `SqliteLedgerStore.RestoreBackup(backup, newPath)`，保留源 BookId、名称、CreatedAt、revision 和全部快照。** 本模块不新增另一个恢复入口。只有显式执行经确认的复制计划，才创建新身份。

“结构化全量”限当前 schema-v1 DTO：账套信息、科目期初、凭证分录和审计。不复制数据库自定义对象、实际附件文件、外部报表、用户权限、成本数据或其他契约外信息；不导入原程序账套，不迁移制度、不滚年、不把期末余额转成期初。民非等原支持限制照旧适用，复制不是业务正确性或生产支持认证。

## 执行流程与安全边界

1. `Preview(persistedSnapshot, request)` 深冻结全部列表及分录，返回可核对计划：新身份、名称、路径、范围、源版本、目标版本、数量、字段规则和限制。它只检查路径并读取传入的已保存快照，不创建文件、不打开 SQLite、不调用宿主策略。
2. 宿主明确确认该计划。`BookCopyWorkflow` 在任何输入变动后撤销确认；没有预览/勾选确认不能执行，忙时拒绝重复提交和改输入，成功后不能再执行同一工作流。
3. `Execute` 复用 Storage 的只读源 `RestoreBackup`，在目标目录下的独占随机临时子目录取得一致快照，包含已提交 WAL，排除未提交数据。只打开这个临时副本。按完整有序 DTO 指纹与预览比较，源变化（即使 revision 被错误地保持不变）也拒绝执行。
4. 用 Storage.Create 创建另一份规范新库，通过公开 Write 一次保存目标快照。完整性检查、逐字段指纹回读后，再用已有 BackupTo 得到独立 DELETE-journal 文件，关闭并重新打开核对全部字段。没有写源库、重写 Core 约束或复用旧数据库 schema。
5. 最后重新检查目标及 `-wal/-shm/-journal` 和宿主策略，再通过 `NewBookPublication` 发布。Unix 用 `link(2)` 将已完整核对的同文件系统暂存 inode 发布到新名称，目标存在时原子失败；不支持硬链接的文件系统安全失败，不回退 rename/copy。Windows 使用不带 `MOVEFILE_REPLACE_EXISTING` 的 `File.Move(stage,destination,false)`，依据[固定 runtime 源码](https://github.com/dotnet/runtime/blob/v10.0.13/src/libraries/Common/src/Interop/Windows/Kernel32/Interop.MoveFileEx.cs)，不声称本轮已做 Windows 实测。取消在同步 Storage 操作之间及发布前处理；Storage 自身锁等待可达 10 秒。发布后才到达的取消按成功处理。
6. 清理只触及本次临时子目录内预留的 captured/candidate/ready 及其日志，不删源文件、备份或已有目标；Unix 成功后删除自己的 ready 硬链接不会删除已发布的目标，失败方也只清自身暂存。Windows 成功移动后 ready 名称已不存在。不递归删除未知文件。清理失败不掩盖原异常，错误的 `Data["BookCopyCleanupWarnings"]` 带提示；成功时在结果 `CleanupWarnings` 带提示。

本次复制对应**捕获时**与预览一致的版本。捕获完成后源仍可继续写入；这不会混入副本，也不会被本模块回退。没有跨两个数据库的分布式事务、断电恢复日志或抵抗同权限恶意进程更换目录的承诺。宿主应持有自己现有的数据租约/忙态。不要将本模块用作绕过 Delivery 安全门槛的入口。

## 最小无 UI 接法

```csharp
using Caiwu.BookTools;

var tools = new BookCopyService();
var plan = tools.Preview(persistedSnapshot, new BookCopyRequest(
    sourcePath, newPath, "合成新账套", BookCopyScope.FullLedger, operatorName));
// 展示 plan.NewBook / Request / SourceCounts / TargetCounts / Rules / Notices。
// 仅在用户明确确认这份 plan 后：
BookCopyResult result = tools.Execute(plan, cancellationToken);
// result 返回目标路径、新 BookInfo、revision、数量、两个指纹和清理提示。
```

宿主应展示源与目标数量差异。`OpeningDebit/Credit` 是全部科目行的原始金额合计，用于复制核对，不是自动去重的末级余额表总计。

## 独立 WPF 接入 / LedgerSession 最小接点

独立项目 `Wpf/Caiwu.BookTools.Wpf.csproj` 提供 `BookCopyWindow`，包含输入、路径选择、两种范围、字段规则预览、显式勾选确认、错误留窗、忙态、单次提交、取消及结果。宿主只需增加项目引用和菜单 handler；**本分支未改 Desktop 主入口、LedgerSession、Contracts 或 solution**。

建议由主集成加入两个项目：

```sh
dotnet sln Caiwu.slnx add src/Caiwu.BookTools/Caiwu.BookTools.csproj
dotnet sln Caiwu.slnx add src/Caiwu.BookTools/Wpf/Caiwu.BookTools.Wpf.csproj
dotnet sln Caiwu.slnx add tests/Caiwu.BookTools.Tests/Caiwu.BookTools.Tests.csproj
```

Desktop 的 ProjectReference 指向 WPF 项目即可。菜单 handler 的最小示意（沿用当前 `_session`）：

```csharp
// 先按宿主现有规则处理未保存编辑；取消编辑提示时直接 return。
if (!_session.IsOpen) return;
_session.Refresh();
var sourcePath = _session.DatabasePath!;
var tools = new BookCopyService(
    // 已集成 Delivery 时传：validateSource: LedgerFilePolicy.Validate,
    validateDestination: path => ValidateNewBookPathUnderManagedDataRoot(path));
// ValidateNewBookPathUnderManagedDataRoot 是宿主已有/待接入的路径策略，不是本模块 API。
// 它只验证新路径，不能预先建空文件；具体租约与数据根仍由宿主持有。
var window = new Caiwu.BookTools.Wpf.BookCopyWindow(
    tools, _session.Snapshot!, sourcePath, currentOperatorName,
    refreshSnapshot: () =>
    {
        if (_session.DatabasePath != sourcePath)
            throw new InvalidOperationException("当前账套已切换，请重新打开复制窗口。");
        _session.Refresh();
        return _session.Snapshot!;
    }) { Owner = this };
if (window.ShowDialog() == true)
{
    var created = window.Result!;
    // 显示成功路径；默认仍保留源会话。
    // 仅当产品明确选择自动打开新副本时再调用 _session.Open(created.DestinationPath)。
    // 打开应继续走现有 backend/Delivery 登记与安全策略。
}
```

必要参数是 `BookCopyService`、已保存的 `LedgerSnapshot`、当前 `DatabasePath`、操作人；可选刷新委托用于源变化后的重新预览。未传刷新委托时窗口固定初始快照，源变化后应关闭并重新打开。窗口不读取私有 `_store`、不释放源连接、不自动切换/登记账套，必须明确确认才执行。本轮只用合成账套验证。现有 `LedgerSession.RestoreTo` 继续作为同身份恢复接点，无需改其语义。

`validateSource` 可直接接 Delivery 公开只读布局门槛（同时检查源和捕获副本）；`validateDestination` 在创建临时文件前及发布前调用，可落实受管数据根限制。没有这两个委托时，模块仅提供 Storage 的 schema/完整性检查及自身不覆盖规则，不声称包含 Delivery 的完整来源/布局/租约门槛。

## 构建与验证

固定 SDK 10.0.402、Microsoft.Data.Sqlite 10.0.13，复用仓库依赖锁；没有新增运行时包。

```sh
dotnet restore tests/Caiwu.BookTools.Tests/Caiwu.BookTools.Tests.csproj --locked-mode
dotnet test tests/Caiwu.BookTools.Tests/Caiwu.BookTools.Tests.csproj -c Release --no-restore
dotnet restore src/Caiwu.BookTools/Wpf/Caiwu.BookTools.Wpf.csproj --locked-mode
dotnet build src/Caiwu.BookTools/Wpf/Caiwu.BookTools.Wpf.csproj -c Release --no-restore
```

Linux 环境可沿用根 `tools/dotnet-local.sh` 并设置 `CAIWU_DOTNET_ROOT`。所有测试在临时目录创建合成账套，含真实 SQLite/独立 raw SQL 核验与 Core 余额/新凭证闭环。具体执行结果、失败修正及未验项见同目录 `HANDOFF.md` 和测试目录 `validation.json`。

真实 Windows 窗口、键盘/辅助技术及宿主菜单集成尚待 Windows 验收；WPF 交叉构建不代表这些交互已通过。无需发布安装包即可集成此模块；项目原交付暂停门槛继续适用。

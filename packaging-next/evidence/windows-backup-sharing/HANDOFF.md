# Windows 备份共享修复与集成说明

代码补丁：`d6f92dcd9361260eb5a6eced7fc4909fa914311e`。私有分支 `codex/windows-backup-sharing`，草稿 PR https://github.com/xhc144/caiwu-suite/pull/18 。仅修改 Delivery 与其测试；本目录单独保存证据。不能把整个旧集成分支重新合入阶段 2。

**本模块 P1 已通过真实 Windows 复验。** 修前 126 通过、11 失败、4 跳过；修后 143 通过、0 失败、4 个原有平台跳过。11 个旧失败逐项转为通过，6 个新增原生/一致性条件全部通过；脚本已实际按名称比较，不以不同总数替代回归证明。`summary.json` 是索引，`windows-before.json` / `windows-after.json` 是原样报告，`windows-log-excerpts.txt` 保留关键原始日志。

| 运行 | 精确提交 | Delivery | 全次 CI |
|---|---|---|---|
| [修前 40180521070](https://github.com/xhc144/caiwu-suite/actions/runs/40180521070) | `6a155a5b2deec55bbf0fe8ac9fbc3e0903750ac5` | 126 / 11 / 4 | failure |
| [修后 40181053280](https://github.com/xhc144/caiwu-suite/actions/runs/40181053280) | `d6f92dcd9361260eb5a6eced7fc4909fa914311e` | 143 / 0 / 4 | failure，另有 Storage 测试夹具及 Mutation UI 问题 |

修后 job `121132011044`，Windows `10.0.26100`、.NET `10.0.13`，报告 sourceCommit 精确等于补丁 SHA；Delivery 在综合调度和独立步骤中各实际执行一次，均 143/0/4，不将它们重复算作 286 个条件。独立步骤结论 success。artifact `12594409190` 的 ZIP SHA256 `20f7adff54b601cef312efa922d318778793c157c61e90c973ccd6fdecfb854b` 已实际下载校验。`PayloadManifest.Hash` 对打开的 SQLite 写连接确实返回 Win32 error 32，dispose 后严格哈希成功；另实测未提交 WAL revision4 未进入已提交 revision3 的副本，余额1315.71、源 main/WAL 字节保持。

## 根因与修复边界

原 Windows CI https://github.com/xhc144/caiwu-suite/actions/runs/40177493350 在 `6a4683955267306f8eb9544635560d214b5921f9` 上实测 Delivery 117 通过、11 失败、4 跳过（132 项）。已直接读取 job `121121250377` 的原日志，摘要见 `original-windows-summary.json`。这些是多个用例被同一早期错误阻断，不能当成 11 种独立漏洞。

原运行的 Delivery tree 是 `12563875bf0f6057dec891dc57a9cfbb69f8e0f5`、Storage tree 是 `fa09da23acb4764e2d9006b59f988dbccbc04c70`，并不是后来指定的 ef17e64/ecc5225 组合。因此本轮先在指定新基线另跑 Windows 修前复现，再与只增加本补丁的运行比较。原运行与新基线之间的 UpgradeSafety、BookOperations、PayloadManifest 三个受影响文件完全相同；新基线另含 schema gate 与 Storage 深读回等改动，不能把这些旧/新版本混成同一个实测版本。

1. `UpgradeSafety.Prepare:70` 的 `using var completedBackup` 尚未退出，SQLite 仍持读写文件句柄，代码就调用 `PayloadManifest.Hash -> File.OpenRead`。Windows 会校验新打开句柄的共享模式与已有访问权限；`File.OpenRead` 的 `FileShare.Read` 不接受已有写访问。此处不是连接池泄漏：指定 Storage 的 `Connect` 明确 `Pooling=false`，`Dispose` 同步释放连接。
2. `BookOperations.InspectWritableCopy` 虽关闭了自己的 store，但 WAL 用例的外部写连接仍在作用域内。再哈希源主文件同样有共享冲突；即使放开共享，主文件也不代表包含 WAL 的一致数据库。

现在升级通过既有 `SqliteLedgerStore.RestoreBackup` 以只读方式捕获源库；该 API 调用 SQLite BackupDatabase、把目标归一到 DELETE journal 模式，并在无覆盖发布前关闭目标连接。Delivery 校验副本布局、完整性与身份，在 completedBackup 的作用域退出后再用原有严格哈希方法核对。回执仍绑定备份自身的 BookId、revision、SHA256；迁移仍只操作 staged 副本并检查身份和 revision 下界。

检查、备份、恢复三个入口均先在数据根 `.delivery-scratch` 创建唯一一致性副本。只读捕获与原件 schema gate 后，还校验副本 schema、完整性和语义内容；关闭连接后对副本核哈希。备份/恢复从这个同一副本生成目标，避免报告另一次源读取的内容。仅清理本次创建的临时文件；不扫描删除旧备份或其他 scratch 文件。原输入不经过 Storage.Open 的写能力探测。

`PayloadManifest.Hash`、安装租约、数据租约、升级前备份、迁移校验、暂停交付门槛均未放宽。没有 catch/忽略 IOException，没有跳过哈希，没有扩大生产 FileShare。

官方边界说明：[File.OpenRead 的等价共享参数](https://learn.microsoft.com/en-us/dotnet/api/system.io.file.openread?view=net-10.0#remarks)、[SQLite online backup 的一致性副本](https://www.sqlite.org/backup.html)。

## 接口语义

`BookInspection` 构造参数和公开方法签名保持；增加 JSON/C# 字段 `fileSha256Basis` / `FileSha256Basis`。集成方应读取它：

| 返回位置 | basis | FileSha256 对象 |
|---|---|---|
| Inspect 结果 | `sqlite-consistent-copy` | 已关闭、包含已提交 WAL 内容的检查副本；DatabasePath 仍是用户请求的输入路径 |
| Backup/Restore 的 Source | `sqlite-consistent-copy` | 本次用于复制的同一输入快照 |
| Backup/Restore 的 Copy | `database-file` | 已关闭的新建目标文件，可按 Copy.DatabasePath 直接复算 |

`sqlite-consistent-copy` 的文件哈希不能与输入路径当前主文件字节直接比较。跨副本内容比较继续使用 BookId、revision、SnapshotSha256（覆盖完整 DTO）及已知金额；文件级复核使用持久化 Copy 的哈希。检查副本在返回前清理，不把其临时路径返回给消费者。

检查现在需要数据根中的可写 scratch 和一份临时数据库空间；备份/恢复先捕获输入，再生成最终新文件，多一次 SQLite 复制。空间或访问不足应作为操作失败报告，不能退回直接复制主文件或省略一致性/哈希校验。

## 集成命令

```sh
git fetch origin codex/windows-backup-sharing
git cherry-pick d6f92dcd9361260eb5a6eced7fc4909fa914311e
```

独立合成测试（Windows、SDK 10.0.402）：

```powershell
dotnet restore tests/Caiwu.Delivery.Tests/Caiwu.Delivery.Tests.csproj --locked-mode
$env:CAIWU_DELIVERY_TEST_SCOPE = 'windows-backup-sharing'
dotnet run --project tests/Caiwu.Delivery.Tests/Caiwu.Delivery.Tests.csproj -c Release --no-restore -- artifacts/delivery-sharing-focused.json
if ($LASTEXITCODE -ne 0) { throw 'Windows sharing regression failed' }
Remove-Item Env:CAIWU_DELIVERY_TEST_SCOPE
dotnet run --project tests/Caiwu.Delivery.Tests/Caiwu.Delivery.Tests.csproj -c Release --no-restore -- artifacts/delivery-sharing-full.json
if ($LASTEXITCODE -ne 0) { throw 'Delivery regression failed' }
```

直接复用现有 Windows workflow，不改 workflow 文件：`gh workflow run windows-build.yml --repo xhc144/caiwu-suite --ref codex/windows-backup-sharing`。其 Delivery 专用步骤总会执行，即使其他组件失败。运行完成后必须分别核对 Delivery JSON、精确 head SHA 和整次 CI 的结论。

## 版本与已完成检查

- 修前复现基线：`6a155a5b2deec55bbf0fe8ac9fbc3e0903750ac5`。Delivery tree `ca481bc3672aad019b46c225939a1e0167615533` 与 `ef17e64d18f7bc85fd6cfe452d1d0418b018f568` 相同；Storage tree `8901b46316cd14fd1e70e3b01cbc3a3c535d074c` 与 `ecc5225f7aaf9e9d0fd79c13a8a14059dde6df4b` 相同。
- 已完成新的修前 Windows 复现：https://github.com/xhc144/caiwu-suite/actions/runs/40180521070 ，job `121130411587`。实际 141 项：126 通过、11 失败、4 跳过，仍是同一共享栈与未到迁移回调的连带失败；比原运行多 9 个 schema 约束测试。原样 `windows-before.json` 已回读核对。artifact `12594283229`，ZIP SHA256 `6ceb73ed27af7934996c4a1010e310b0fe54e4fdc87a8c2602fff4a53547ce42`。
- 补丁 Delivery tree：`2653f4e3727fbbfa075d00b59291c998170b2849`；补丁测试 tree：`6ee505a01b1cd50dcfa2898ac902e7aeafdb11ef`；Storage tree 不变。
- 阶段 2 分支于本轮读取时是 `e9c436803d287937d5314e6bd3f7360e71b219ff`。其 Delivery、Delivery.Tests、Storage、Contracts 与补丁父提交全部相同；Contracts tree `5282011ae8b5e38250e22310c3006a5a02dc373d`。使用独立临时 Git index 装载该提交并执行 `git apply --cached --check`，补丁完整通过（退出码 0）；未修改阶段 2 分支或其工作树。相同依赖树无需重复冒充一次新的运行证据。
- .NET SDK 10.0.402 官方 Linux SDK SHA512 经实际下载复核；locked restore 成功。Linux 组件回归 144 通过、0 失败、3 项明确 Windows 专属跳过（147 项）；见 `linux-after.json`。此报告采于提交前相同源码树，不把其 null sourceCommit 冒充 GitHub provenance，也不当作 Windows 通过。
- 六个新条件包括：Windows SQLite 原生共享错误 32 与释放后成功；备份回执精确 hash 和无侧车依赖；WAL 已提交 revision3 与仍打开的未提交 revision4 隔离；同一次输入快照/目标绑定及后续源更新后仍可恢复；失败不发布新目标且保留旧有效备份与不相关 scratch；程序 payload 哈希继续拒绝冲突写句柄。
- 新测试首次在 Linux 把 .NET FileShare.None 误当成 native SQLite 的 POSIX 访问门槛，实测该假设不成立。已把这个原生共享用例明确限定 Windows，未修改生产共享策略；修正后 Linux 全量 144/0/3。此差异必须保留，不能把 Linux 平台行为当 Windows 文件锁验证。
- 原生 `gh run download` 对新修前 artifact 的 Blob 重定向返回 403，已知未下载。使用仓库既有验收说明记录的、已连接 GitHub `download_workflow_artifact` 工具获取新下载引用后成功取得并核对 ZIP SHA256。没有重试旧签名 URL，没有保存或提交临时下载 URL/凭据；日志始终可经 GitHub job-log 工具直接读取。该传输问题已解决，不是自动审批拒绝。

## 验收限制

本补丁不验证 Windows 安装器/升级安装、签名信任链、断电恢复、恶意同权限并发替换目录或真实账务；不解除 delivery pause。仅使用自写组件和合成账套，不运行原安装器，不生成分发包，不修改 Desktop/Contracts/Core/Storage 或权限。正常升级保护、后续 schema 迁移和 UI 集成继续由对应 owner 验收。

## 根线程的两个独立后续项

1. 修后综合构建继续走到 `Caiwu.Persistence.Sqlite.Tests`，实测 45 失败、64 通过、0 跳过（109 项）。首个共同失败是 `ReadbackTests.RefusedAndUnchanged:72` 对仍打开的 store 路径 `File.ReadAllBytes(Database)`，发生在被测 `store.Write` 之前。这个测试项目仅引用 Storage，不引用 Delivery；本补丁也未修改其源码/测试。Storage 测试 owner 应把物理字节比较安排在相应 SQLite 连接关闭/重新打开的边界，保留语义状态、拒绝写入和输入不变断言，不能把共享错误当成写入保护已通过。具体失败总数与栈见日志摘录。未越权修改该目录。
2. 修前与修后 `tests/Caiwu.Acceptance/MutationWindows/run.ps1:15` 都触发 150000ms 超时；该运行缺完整成功 JSON，不能宣称此交互完成。Acceptance owner 需检查 native-dialogs 与进程日志并完成相应模态流程。本模块未修改 Desktop、Acceptance 或现有 workflow。

这些是已观察到的外部测试失败/未完成验收，不是权限拒绝；本模块代码、Windows Delivery 证据和可拣选提交已经完成。没有待审批写入或不确定的远端提交/PR 操作。

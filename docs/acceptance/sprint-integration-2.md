# 第二阶段主集成与 Windows 验证

更新时间：2026-10-25 09:36 UTC。工作树 `/workspace/caiwu`，分支 `codex/sprint-integration-2`，目标基线 `codex/windows-revalidation`，草稿 [PR16](https://github.com/xhc144/caiwu-suite/pull/16)。本阶段最迟 11:00 UTC 结束；交付暂停门槛保持。

## 当前可集成结果

- 基线已实际克隆：`6a155a5b2deec55bbf0fe8ac9fbc3e0903750ac5`，包含旧阶段 `fa463b716e1fea5b3e413dae412d1405457f95a0`；不是仅收到 SHA 后推定已拉取。
- 现代视觉源提交 `79f76654f414ae4c95cba0555574d27ba861609d`、`87b7773e095385823efc3897d89f25a614a69ce0`、`9b544ed1ea964215c8f36ed7cc67149a7cfd1285`、`33985eb75574b008df8dce320db2ddb3e4f3121b` 已顺序拣选。当前生产 `src` 树与视觉源 `33985eb` 相同，未改作者视觉文件。期初 `DebitText/CreditText` 的 `UpdateSourceTrigger=PropertyChanged` 和报表 `BackButton/Back_Click` 均保留。
- Contracts `bb76658`、Core `6662120`、Storage `ecc5225`、Delivery `ef17e64`、Controls `bf75d56` 的对应生产目录逐树比较一致，因此没有重复拣选。Controls 包含 `633cfb9` 前置。
- 导航探针源 `0f8fb850` 已在基线中；当前仅将合成夹具的写操作适配至 v1.2 原快照上下文，测试动作和结果断言保留。UI 原快照、Preview 转发、同身份恢复会话失效保护均在当前基线中。
- Delivery owner 的窄修复 `d6f92dcd9361260eb5a6eced7fc4909fa914311e` 已原样拣选为 `059cae6`：从已关闭的一致 SQLite 副本取 hash，备份报告与输出绑定同一提交快照，未放宽 payload 的严格共享 hash。新增 `BookInspection.FileSha256Basis`：输入检视是 `sqlite-consistent-copy`，新输出文件是 `database-file`；调用者不能把前者当作活跃主文件的原字节 hash。
- 没有集成下一阶段业务功能（包括 VoucherTools `dab8681`）；未改 Core/Contracts/SQLite 生产代码，Delivery 只采纳作者提交。未改书库、main、权限、原包或派生 catalog。

## 本轮已实际验证

环境为 Debian 13、官方 SDK 10.0.402 / .NET 10.0.13。SDK SHA512 与仓库 `docs/sdk-metadata.json` 一致。Linux 结果不能替代 Windows 交互。

| 检查 | 结果 | 证据/限制 |
| --- | --- | --- |
| `dotnet build Caiwu.slnx -c Release` | 通过，0 警告/0 错误 | 当前现代视觉组合 |
| 独立 v1.2 `RevalidationV12` | 22 项通过 | 链接真实 Session/Preview 代码，真实 SQLite；不是 WPF 执行 |
| Core 单测 | 149 通过 | TRX 在 `artifacts/sprint-integration-2/test-results/core.trx` |
| Desktop 逻辑可执行探针 | 28 断言通过 | 实际 `dotnet run` |
| 真实 SQLite/Core/session 可执行集成 | 12 断言通过 | 银行 108800；本期借贷各 31200；期末借贷各 120000；备份恢复保留 |
| SQLite 全量 | **108 通过 / 1 失败** | 并发创建两次均成功，详见下方；禁止用单项偶尔通过掩盖 |
| Delivery 含共享修复 | 144 通过 / 0 失败 / 3 跳过 | Linux 全量 147；3 项要求原生 Windows 共享语义，不能记为通过 |
| 当前 solution 和 Windows 探针交叉编译 | 全部通过，0 警告/0 错误 | NativeFocus、MutationWindows、VisualReview、HighResolution、导航、双进程均编译；不是 Windows 执行 |

## 尚未解决：并发创建保护

精确入口：

```sh
tools/dotnet-local.sh test tests/Caiwu.Persistence.Sqlite.Tests/Caiwu.Persistence.Sqlite.Tests.csproj -c Release --no-build --filter FullyQualifiedName~RacingCreatorsNeverOverwriteTheWinner
```

`StoreTests.cs:603` 的 `Assert.Single(results, e => e is null)` 实际获得 `[null, null]`，两个同路径创建均返回成功。首次全量失败，随后单项一次通过，再做 12 次隔离复跑，**10 失败 / 2 通过**。原始 TRX、逐次 SHA256 与结果在 `evidence-sprint-integration-2/`。生产发布点为 `SqliteLedgerStore.PublishNew` 中 `File.Move(stage, destination, overwrite: false)`。当前只证明本环境存在竞争问题，尚不能推断 Windows 结果或根因。根已分派 `codex/sqlite-create-race` 窄修复，尚未收到补丁；主集成不并发改其目录。建议保持真正排他发布、失败后赢家内容及清理语义，不删除账套保护。

## Windows 执行状态

- 旧阶段 run `40180346641`（`6a155a5`）已失败；未重复触发该组合。旧取消 run `40180215641` 不能作为现代视觉结果。
- 第一版现代视觉 run [40180397486](https://github.com/xhc144/caiwu-suite/actions/runs/40180397486)（`79f7665`）已失败。原生高清 4 页、WPF 8、Controls 38 断言、v1.2 独立 22、App Open/Restore gate 和双进程两场景通过；实际新建保存对话框取消保留也通过。Delivery 126 通过 / 11 失败 / 4 跳过，仍是未采纳共享修复的版本。旧窗口六项第一项超时，没有通过结论。
- 该 run 的 artifact **12594028382**，ZIP SHA256 `7a20297d506b97d19608e4490b1a384ded8faf62a04196071dd5a5eba19e9ecb`。已下载、核 hash 并亲看主界面/凭证/账簿/报表 4 张实际原生 1920×1080、96 DPI PNG，无拉伸。逐图 hash 在 `evidence-sprint-integration-2/windows-79f7665-screenshots.json`。**只对应 79f7665，不能称为后续 33985eb 的截图。**
- 报表导航原失败已由 JSON 精确定位到探针查找旧文字“生成”；第一版视觉改成“生成报表”。探针现在兼容两个精确文字并保留所有断言；作者后续也恢复了原操作文字。需新 Windows 实跑关闭，不能靠代码推断。
- run `40180883501` 对应本分支 `e9c4368`，验证导航文字适配和两个新增原生键盘焦点场景；当前执行中，不含后来 Delivery 修复与字体修正。现代视觉线程另有 `33985eb` 的 run `40180961028`，不重复触发它。
- 旧窗口六项现在各有独立 35 秒进程 watchdog，原生确认检查可见/启用按钮、激活原生对话框并同步发送有时限 BM_CLICK，记录关闭失败；一项阻塞不再吞掉另外五项结果。这是探针修复，尚未 Windows 运行。现代可选资源探针仅适配合成夹具至 v1.2 上下文，已接入独立 CI 步骤。
- 物理键盘/中文 IME、多 DPI 焦点和真实安装器升级仍未运行。新 NativeFocus 用真实 SendInput 验 F4 取消后焦点/输入、F4 选择后借方格继续键入；它不是物理设备/IME 认证。完整安装器验收需要被暂停门槛禁止的新分发包，因此本阶段只跑合成受管 CLI/文件保留测试，不能声称完整 Desktop 安装升级验收通过。

## 集成方式与保留门槛

本分支只供私库草稿 PR 审阅，不合 main。优先在当前目标基线之上采用本分支，避免重复拣选已按内容导入的旧修复。现代视觉只改 5 个 XAML/资源文件，所有既有绑定/事件名保留。后续接收 Delivery owner 的窄补丁并在真实 Windows 上重验后，才能考虑共享阻断是否关闭；`docs/acceptance/DELIVERY_PAUSED.md` 和 packaging 的暂停检查保持，不生成新 ZIP/安装器。

# 第二阶段主集成与 Windows 验证

更新时间：2026-10-25 09:28 UTC。工作树 `/workspace/caiwu`，分支 `codex/sprint-integration-2`，目标基线 `codex/windows-revalidation`。本阶段最迟 11:00 UTC 结束；交付暂停门槛保持。

## 当前可集成结果

- 基线已实际克隆：`6a155a5b2deec55bbf0fe8ac9fbc3e0903750ac5`，包含旧阶段 `fa463b716e1fea5b3e413dae412d1405457f95a0`；不是仅收到 SHA 后推定已拉取。
- 现代视觉源提交 `79f76654f414ae4c95cba0555574d27ba861609d` 已拣选为 `08f93a35bb2d20d944ef26aaae2ebc927a92b133`。生产 `src` 树与视觉源提交完全相同，未改作者视觉实现。期初 `DebitText/CreditText` 的 `UpdateSourceTrigger=PropertyChanged` 和报表 `BackButton/Back_Click` 均保留。
- Contracts `bb76658`、Core `6662120`、Storage `ecc5225`、Delivery `ef17e64`、Controls `bf75d56` 的对应生产目录逐树比较一致，因此没有重复拣选。Controls 包含 `633cfb9` 前置。
- 导航探针源 `0f8fb850` 已在基线中；当前仅将合成夹具的写操作适配至 v1.2 原快照上下文，测试动作和结果断言保留。UI 原快照、Preview 转发、同身份恢复会话失效保护均在当前基线中。
- 没有集成下一阶段业务功能；未改 Core/Contracts/SQLite/Delivery 生产代码，未改书库、main、权限、原包或派生 catalog。

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

## 尚未解决：并发创建保护

精确入口：

```sh
tools/dotnet-local.sh test tests/Caiwu.Persistence.Sqlite.Tests/Caiwu.Persistence.Sqlite.Tests.csproj -c Release --no-build --filter FullyQualifiedName~RacingCreatorsNeverOverwriteTheWinner
```

`StoreTests.cs:603` 的 `Assert.Single(results, e => e is null)` 实际获得 `[null, null]`，两个同路径创建均返回成功。首次全量失败，随后单项一次通过，接着 12 次隔离复跑正在保存逐次 TRX。生产发布点为 `SqliteLedgerStore.PublishNew` 中 `File.Move(stage, destination, overwrite: false)`。当前只证明本环境存在竞争问题，尚不能推断 Windows 结果或根因；由 Storage 所有者修复，主集成不擅改其目录。建议最小修复范围是发布阶段的真正排他占位/原子拒绝覆盖，并保留失败后已有赢家内容及清理语义，不删除账套保护。

## Windows 执行状态

- 继续监控旧阶段 run `40180346641`（`6a155a5`），未重复触发该组合。
- 现代视觉 run `40180397486`（`79f7665`）已由视觉线程启动，其生产 `src` 树与本分支相同；当前在执行。四页原生 PNG、WPF 8、导航 2、旧窗口 6、双进程、App gate、Delivery 和无分发包检查均待完整结果，不从编译推定通过。
- 旧 `fa463b7` run `40180215641` 的高清、WPF 8 和导航 2 步骤已成功，但整轮仍执行且已受取消信号影响；不能作为现代视觉结果。
- Windows 文件共享修复由独立 Delivery 线程负责，当前还没有收到可集成补丁。未并发改 Delivery。
- 物理键盘/中文 IME、多 DPI 焦点和真实安装升级保账套仍未运行。现有合成/脚本验证范围将单独记录，不扩大其结论。

## 集成方式与保留门槛

本分支只供私库草稿 PR 审阅，不合 main。优先在当前目标基线之上采用本分支，避免重复拣选已按内容导入的旧修复。现代视觉只改 5 个 XAML/资源文件，所有既有绑定/事件名保留。后续接收 Delivery owner 的窄补丁并在真实 Windows 上重验后，才能考虑共享阻断是否关闭；`docs/acceptance/DELIVERY_PAUSED.md` 和 packaging 的暂停检查保持，不生成新 ZIP/安装器。

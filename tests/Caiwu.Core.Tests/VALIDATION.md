# Core 验证记录（2026-10-25）

基线：`97d696a3ee7adf100e24b4924438468bd34dd80c`，`codex/windows-mvp`。实现分支：`codex/ledger-core`。仅提交 `src/Caiwu.Core/**` 和 `tests/Caiwu.Core.Tests/**`；未修改 Contracts、solution、UI 或 SQLite，无新增契约需求。

## 实际环境与依赖

- Debian 13、Linux x64；官方 .NET LTS SDK **10.0.402**，runtime **10.0.13**。
- 根 `global.json` 已指定10.0.402，保持原样；此次实际使用 `/tmp/caiwu-dotnet-10/dotnet`。
- 下载：[微软 SDK 官方包](https://builds.dotnet.microsoft.com/dotnet/Sdk/10.0.402/dotnet-sdk-10.0.402-linux-x64.tar.gz)。SHA-512 与[官方发布数据](https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/10.0/releases.json)一致：

```text
1904a98dda2db34ba78ba3c4fb1b224455329af91c341d83547843c1839e112b04ae699ee92fa2449a8f62249196a938723078c0c60b9f65c88539d5687729c2
```

直接 NuGet 版本均为官方源核实的稳定版，使用精确区间版本，所有传递依赖与内容哈希保存在两个 `packages.lock.json` 中。Core 本身无第三方包：

| 测试包 | 固定版本 |
|---|---|
| Microsoft.NET.Test.Sdk | 18.11.0 |
| xunit.v3.mtp-off | 4.0.2 |
| xunit.runner.visualstudio | 4.0.1 |

包来源仅为 `https://api.nuget.org/v3/index.json`。使用 xUnit 官方 `mtp-off` 变体配合现有 VSTest，避免更改其他 owner 的根测试配置；参见 [xUnit 官方测试平台选择说明](https://xunit.net/docs/getting-started/v3/microsoft-testing-platform)。

本容器用户目录只读。`NuGet-Migrations` 初次失败经 strace 确认尝试在 `/home/agent/.dotnet` 创建命名锁；为 .NET10.0.13 设置私有可写 `XDG_RUNTIME_DIR` 后成功。配置采用[官方 runtime 问题记录](https://github.com/dotnet/runtime/issues/135726)说明的运行时目录，不修改 HOME、宿主挂载或宿主权限；未遇到自动审批拒绝。

## 实际运行命令与结果

在仓库根目录执行。以下路径是此次容器配置，可替换为等价的可写目录和已安装SDK；runtime目录已按700创建：

```bash
export XDG_RUNTIME_DIR=/tmp/caiwu-dotnet-state/runtime
export DOTNET_CLI_HOME=/tmp/caiwu-dotnet-state/cli
export XDG_DATA_HOME=/tmp/caiwu-dotnet-state/xdg
export NUGET_PACKAGES=/tmp/caiwu-dotnet-state/packages
export NUGET_HTTP_CACHE_PATH=/tmp/caiwu-dotnet-state/nuget-http
export NUGET_SCRATCH=/tmp/caiwu-dotnet-state/scratch
export DOTNET_GENERATE_ASPNET_CERTIFICATE=false
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_ROOT=/tmp/caiwu-dotnet-10

/tmp/caiwu-dotnet-10/dotnet restore tests/Caiwu.Core.Tests/Caiwu.Core.Tests.csproj \
  --locked-mode --source https://api.nuget.org/v3/index.json

/tmp/caiwu-dotnet-10/dotnet test tests/Caiwu.Core.Tests/Caiwu.Core.Tests.csproj \
  --no-restore --configuration Release -p:TreatWarningsAsErrors=true \
  --logger 'trx;LogFileName=core.trx' --results-directory /tmp/caiwu-core-test-results
```

两条命令退出码均为 **0**。最后一次源码测试运行：

```text
Caiwu.Contracts -> .../bin/Release/net10.0/Caiwu.Contracts.dll
Caiwu.Core -> .../bin/Release/net10.0/Caiwu.Core.dll
Caiwu.Core.Tests -> .../bin/Release/net10.0/Caiwu.Core.Tests.dll
Passed! - Failed: 0, Passed: 53, Skipped: 0, Total: 53
```

TRX `/tmp/caiwu-core-test-results/core.trx` 已解析复核：executed=53、passed=53、failed/error/timeout/aborted/notExecuted/warning均为0。末次输出仅有“覆盖前一份同名TRX”的结果文件提示，无编译警告。`git diff --check` 退出码0。

## 测试证据边界

测试仅使用独立 `MemoryLedgerStore`，不引用 SQLite 或 UI。该 store 的 Read 故意直接返回保存的快照，可暴露 service 意外原地修改；Write 使用锁实现revision比较与一次性替换，可注入提交前异常。两线程 Barrier 确保读到相同revision，分别验证自动编号、重复记账、结账对新增草稿的竞争。

覆盖：decimal 0.1/0.2/0.3、两位小数与存储上限、非法金额/分录/科目、不平衡原子拒绝、年/月/日期边界、编号作用域与耗尽、草稿更新/删除、身份分离、审核取消和重新审核、已记账不可变、审核及记账时重新检查科目、逐月结账和未记账阻断、期间锁、期初整体替换和冻结、真实父子关系多层汇总及反向余额、科目引用保护、联查凭证、只读结果隔离、每条命令写入失败不改原快照、不吞系统异常、revision冲突不重试、审计字段及store生命周期。

独立手算样本在企业、小企业两种科目编码下运行：

| 检查项 | 预期且实际通过 |
|---|---:|
| 期初银行借 / 资本贷 | 各100000 |
| 材料借 / 银行贷 | 各10000 |
| 费用借 / 银行贷 | 各1200 |
| 银行借 / 收入贷 | 各20000 |
| 银行期末借 | 108800 |
| 材料期末借 | 10000 |
| 费用期末借 | 1200 |
| 收入期末贷 | 20000 |
| 本期末级借 / 贷合计 | 各31200 |
| 期末末级借 / 贷合计 | 各120000 |

上述预期为契约给定常数，未用被测代码生成预期。民非另测正式2026科目及限定捐赠100元的父子汇总，不套用企业资本/利润模型。

未运行或未验收：真实SQLite事务/备份/恢复/跨进程并发、WPF/Windows交互、完整民非或企业制度、自动结转、税务或法定报表、生产权限认证、电子凭证及档案。模板均标 `IsVerifiedForProduction=false`。本测试不能替代这些集成或合规验收。

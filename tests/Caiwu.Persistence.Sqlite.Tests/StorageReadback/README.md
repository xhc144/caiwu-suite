# 直接Storage写入的事务内语义读回

2026-10-25，独立分支 `codex/storage-readback`，基线 `a49d426d8513600dec0f624f56a35c9ad66e71d4`。本路新归属仅SQLite模块和其测试；没有修改Contracts/Core/Desktop/Delivery/solution。所有测试均新建临时合成账套，未读取真实用户账务或原安装包资源。

## 实证与修复

在已有一张完整两分录凭证的合成账套上，给voucher_lines追加 `UNIQUE(voucher_id,summary) ON CONFLICT IGNORE` 或 `REPLACE`。原两分录的摘要不同，原数据保持完整；下一张正常借贷凭证的两行共用同一业务摘要。基线直接Storage.Write两例都成功提交，目标分录 **2→1、revision1→2、integrity=ok**；新增拒绝断言 **0通过/2失败、exit1**，见[真实基线记录](before.json)。这是SQLite结构完整性通过但数据语义已改变的反例，单独改显式列名不能解决它。

生产修复：

- SELECT和INSERT均显式指定列名，避免物理列位置决定字段含义。
- Write先复制输入集合，继续使用BEGIN IMMEDIATE、原账套身份和revision CAS。插入全部数据后，**当前连接、当前未提交事务**调用同一ReadContents读取实际结果，完整比较revision、Book所有字段、科目及期初、每张凭证全部头字段和逐条分录、审计字段及列表顺序。时间还比较offset，避免DateTimeOffset普通相等忽略偏移。
- 任一不一致抛InvalidDataException，事务退出回滚；解码异常和原SQL/FK异常同样阻止提交，不吞异常、不自动重试。Create在发布新文件前也使用同一比较。
- 金额及整数只接受实际SQLite INTEGER，拒绝GetInt64可能强制转换的REAL/TEXT小数分；布尔/枚举正确解码。读回不能忽略未归属凭证的额外分录或第二条ledger主记录。

这里验证持久化输入输出相等，不把Core的借贷平衡/审核状态机复制到Storage；原有传输层可存储数据规则保持。没有修改、修复或升级未知schema，没有引用Delivery或复制其schema校验器。物理列重排正例验证显式列名能保持已知字段含义，并要求原DDL仍保持重排；**它不代表未知schema被生产入口批准支持**，Delivery现有拒绝未知schema的门控必须保留。

若后续要求Storage.Open也复用完整canonical schema入口检查，应由协调把Delivery现有实现单向下移到Storage（已有Schema定义所在层），Delivery调用这个唯一实现；不能让Storage反向引用Delivery或在两层复制校验规则。本轮为阻止已实证的静默写入差异，不需要另造入口校验器，故未实施该跨owner迁移。

## 真实验证

原63项Storage回归 + 新46项 = **109通过、0失败、0跳过、exit0**，Release、TreatWarningsAsErrors=true。[TRX提取记录及源码SHA256](after.json)。

新46项包括2种冲突约束；38种科目/账套/凭证/分录/审计字段、身份、顺序的静默触发器变更；10+20被改为9+21而行数、借贷总额不变；物理列重排正例；REAL/TEXT小数分；额外孤立分录；额外主记录。拒绝例比较整个持久DTO及审计/revision、原输入、**源文件全部字节**，随后用独立连接重开再比原快照。38种触发器例还在移除测试触发器后用相同expectedRevision正常提交，确认失败没有消耗版本或破坏连接。

原63项包含金额边界/精度、CAS陈旧和双实例竞争、SQL/外键失败回滚、两个账套隔离、并发读取一致性、备份恢复和WAL一致副本。它们保持通过；没有把旧Core测试当成本轮组合验收。本轮不执行UI或解除分发门槛，后续交Acceptance独立组合验证。

SDK10.0.402/runtime10.0.13，Microsoft.Data.Sqlite10.0.13和现有测试包/锁文件均未改；从官方NuGet源锁定restore成功，未安装额外工具、未修改HOME/宿主权限，无审批拒绝。

```bash
export DOTNET_ROOT=/tmp/caiwu-dotnet-10
export DOTNET_CLI_HOME=/tmp/caiwu-dotnet-state/cli
export XDG_RUNTIME_DIR=/tmp/caiwu-dotnet-state/runtime
export XDG_DATA_HOME=/tmp/caiwu-dotnet-state/xdg
export NUGET_PACKAGES=/tmp/caiwu-dotnet-state/packages
export NUGET_HTTP_CACHE_PATH=/tmp/caiwu-dotnet-state/nuget-http
export NUGET_SCRATCH=/tmp/caiwu-dotnet-state/scratch
export DOTNET_GENERATE_ASPNET_CERTIFICATE=false
export DOTNET_CLI_TELEMETRY_OPTOUT=1

/tmp/caiwu-dotnet-10/dotnet restore tests/Caiwu.Persistence.Sqlite.Tests/Caiwu.Persistence.Sqlite.Tests.csproj \
  --locked-mode --source https://api.nuget.org/v3/index.json --disable-parallel \
  -p:UseArtifactsOutput=true -p:ArtifactsPath=/tmp/caiwu-storage-readback-artifacts
/tmp/caiwu-dotnet-10/dotnet test tests/Caiwu.Persistence.Sqlite.Tests/Caiwu.Persistence.Sqlite.Tests.csproj \
  --no-restore -c Release -p:TreatWarningsAsErrors=true \
  -p:UseArtifactsOutput=true -p:ArtifactsPath=/tmp/caiwu-storage-readback-artifacts \
  --logger 'trx;LogFileName=readback-complete.trx' --results-directory /tmp/caiwu-storage-readback-results
```

最初复现使用相同test命令追加 `--filter FullyQualifiedName~ReadbackTests`，输出 `readback-before.trx`；当时只有两条新反例，生产文件仍是基线版本。修复源码SHA256：`aa3a0c3ea3b0ff77160d09700b85421317c448d317fc869a077ab080ff74cbf5`。

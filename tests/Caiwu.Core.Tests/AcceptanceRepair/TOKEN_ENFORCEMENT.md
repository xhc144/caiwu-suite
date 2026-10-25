# ACC-002 Core强制校验返修（2026-10-25）

本文件记录53fe的v1.1历史结果。后续v1.2已要求新建也提供双字段，并覆盖其余修改入口；旧兼容描述不再适用当前代码，见[当前修复验证](../MutationSafetyProbe/VALIDATION_V1_2.md)。

明确分工后，Core owner只修生产Core及本路测试，未编辑Desktop/Contracts/SQLite/打包配置，没有解除分发阻断。先核对最新集成 `34f065b6028ebd2102f0520263bae8bd3b7ec09f` 无同点补丁，再将上游已发布的v1.1契约合入开发分支；基线合并提交为 `eb81bb32f849d34abf326fa79c126931fc3d8a43`。合并冲突仅在本路两个测试文件，保留已有探针及更新后的说明；上游其他owner代码原样继承，实际返修diff只在Core/本路测试。

## 实现与测试约束

`LedgerService.SaveDraft`读取一次当前快照后：

1. 已有Id时两个token都必填，缺失立即StoreConcurrencyException。
2. 任何提供的ExpectedRevision须等于该读取快照的Revision，任何提供的ExpectedBookId须等于其Book.Id；负revision、错误账套及过期版本均拒绝。新建无token保持兼容，新建只提供正确BookId或Revision也可用，符合v1.1逐项匹配规则。
3. 匹配后执行原有日期/状态/分录校验及一次store.Write(expectedRevision=读取快照.Revision)。没有新增第二次Read、没有刷新输入token、没有冲突重试，原有CAS完整保留。

新增19个Core用例：已有编辑8类无效token、新建4类错误token、4类合法/兼容新建、双编辑旧值、同revision异账套及成功后的已接受版本再次保存。输入快照和写入次数/审计一起核对，失败不写、不改输入。

旧测试中的程序化合法修改也显式取得加载快照，再构造编辑DTO。`EditFrom` helper只接受LedgerSnapshot，不接受service/store，不能隐藏一次“保存时读新revision”。真正的旧窗口用例在另一方改20之前固定B的完整旧凭证分录及token，之后直接保存该原输入。已审核/已记账/期间锁的旧断言以匹配的token单独验证原领域限制，没有用缺token错误代替原状态检查。

## 新旧行为证据

修复前冻结34f的 [13项原始结果](../RevisionTokenProbe/result-34f.json) 为5通过/8失败，退出1；旧B窗口把20覆盖回10，revision3。相同仓库内探针针对修复源码再次构建并运行：[修复后结果](../RevisionTokenProbe/result-token-enforced.json) 为 **13通过/0失败，退出0**。8个失败全部转PASS，包括缺失/未来/负revision、缺BookId、同revision异账套、新建错token。Read之后由另一连接提交20的CAS间隙用例仍拒绝旧提交并保留20与两条审计，证明没有用token比较替代SQLite原子CAS。

Core全量单测：**77通过、0失败、0跳过**，Release且TreatWarningsAsErrors=true。真实SQLite建账、期初、三凭证、独立审核记账、月结、重开、备份恢复、故意SQL失败回滚和双连接竞争链路：**332条断言通过、退出0**；银行108800、本期借贷各31200、期末借贷各120000保留。[完整链路结果](lifecycle-token-enforced.json)。

## 实际命令和环境

官方SDK10.0.402/runtime10.0.13，Debian13 x64；使用既有可写XDG/NuGet配置，HOME不改。以下命令在仓库根运行，两个控制台restore均使用官方源和--locked-mode。其构建均0警告0错误：

```bash
dotnet test tests/Caiwu.Core.Tests/Caiwu.Core.Tests.csproj --no-restore -c Release \
  -p:TreatWarningsAsErrors=true --logger 'trx;LogFileName=core-token-enforced.trx' \
  --results-directory /tmp/caiwu-core-token-fix-results

dotnet build tests/Caiwu.Core.Tests/RevisionTokenProbe/TokenProbe.csproj --no-restore -c Release -m:1 \
  -p:CaiwuSourceRoot=/workspace/caiwu-suite-dev -p:UseArtifactsOutput=true \
  -p:ArtifactsPath=/tmp/caiwu-token-fixed-probe-artifacts -p:TreatWarningsAsErrors=true
CAIWU_TOKEN_TARGET_COMMIT=eb81bb32+core-token-enforcement-working-tree dotnet \
  /tmp/caiwu-token-fixed-probe-artifacts/bin/TokenProbe/release/TokenProbe.dll \
  /tmp/caiwu-core-token-fix-results/token-result-fixed.json

dotnet build tests/Caiwu.Core.Tests/SqliteIntegrationProbe/IntegrationProbe.csproj --no-restore -c Release -m:1 \
  -p:UseArtifactsOutput=true -p:ArtifactsPath=/tmp/caiwu-token-fixed-lifecycle-artifacts -p:TreatWarningsAsErrors=true
dotnet /tmp/caiwu-token-fixed-lifecycle-artifacts/bin/IntegrationProbe/release/IntegrationProbe.dll \
  /tmp/caiwu-core-token-fix-results/lifecycle-data
```

实际dotnet为 `/tmp/caiwu-dotnet-10/dotnet`。最后命令创建的目录必须是全新路径。结果中的targetCommit明确标为基于eb81的修复工作树，因为运行时修复提交尚未生成；提交内的生产代码对应本轮已测源码，不把工作树标签冒称为不可变SHA。Core单测TRX已解析核对77/77、无失败/未执行/警告。

该次已测 `LedgerService.cs` SHA-256：`5f4820438b1ea221bd0695b74f0b86a10c81f233d6043d5c9db8574c0c96da69`，可与最终修复提交的源码核对。

## 仍待主协调/独立验收

未执行Windows实际双窗口、真实编辑器按钮/输入保留或分发验收，不能解除分发阻断。上游 `tests/Caiwu.Acceptance/Regression/Program.cs` 的旧夹具仍以无token修改已有Id：ACC-002的A保存20须先改为携带A打开时token，B仍保留旧token；IMMUTABLE-01/STALE-POSTED-01需明确传匹配/旧token并期待对应领域/并发错误。该文件不在本owner范围，本轮只读提示，未为了使原夹具假绿而放宽生产强制规则。

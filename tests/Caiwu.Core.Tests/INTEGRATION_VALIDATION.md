# Core + SQLite 有限集成审查记录

2026-10-25，Debian13 x64、官方SDK10.0.402/runtime10.0.13。Core功能提交 `c499a4d54c3de86a4e320184541c10313b1c06c2`，SQLite提交 `d69a8b7c0c10b1435e45fe8bb275522cb3b49a44`，共享基线 `97d696a3ee7adf100e24b4924438468bd34dd80c`。工作分支 `codex/ledger-core`。

结论：本轮指定链路实际运行成功，**332条集成断言通过，进程退出0**。未发现阻断集成的契约不兼容或需要修改Core自身实现的缺陷。没有改动SQLite/Contracts/Core生产源码；可选控制台工程和结果仅保存于本owner的测试目录。主Core测试仍只引用Core/Contracts，新增Compile排除规则防止把独立集成程序混入单元测试程序集。

## 直接检查与数据安全边界

读取了SQLite项目、Schema.cs、SqliteLedgerStore.cs全部实现、说明和测试覆盖列表，并复核Core的当前实现。双方四个Contracts源文件逐个SHA-256完全一致，SQLite提交对共享契约、根props、global.json无改动。

| 接口/边界 | 检查及实际支持的结论 |
|---|---|
| 金额 | Core非负decimal、最多两位小数、最大Int64正数分；SQLite精确整数分。实际核对原表10000000分期初、发生借贷各3120000分。 |
| 原子性 | Core一个命令对应一次Write，业务和审计同批次；SQLite即时事务内比较revision、整表替换、一次提交。审计插入被真实SQLite触发器中断后，所有DTO及revision与失败前完全一致。 |
| 并发 | 两个真实SQLite句柄上的Core服务读取相同revision后竞争：一次成功、一次StoreConcurrencyException，revision仅+1，月份编号为1和2。这里是单进程双连接线程竞争，不声称跨进程已测。 |
| 状态和期间 | 重复记账、已记账取消审核/删除、已记账期初变更、锁月新增均被Core拒绝，持久化快照不变；备份恢复后仍受约束。 |
| 快照保留 | 关闭重开、备份和恢复后所有DTO序列化完全一致，含列表顺序、操作人、状态、附件数、时间offset/ticks、审计和revision。 |
| 生命周期和隔离 | Core不释放外部store；测试显式关闭/重开。恢复副本新增二月草稿后，原账和备份仍保持revision11及原有数据。 |
| 职责分工 | SQLite只保存快照，允许的signed金额范围比Core宽；业务身份/状态/锁期必须经过Core。直接store.Write是可信基础设施边界，不是安全的用户记账API。 |

未发现上述职责分工的调用不兼容。只读检查和这些用例不证明所有输入或故障路径均安全。

## 独立端到端算例

企业和小企业分别建立真实SQLite账套，使用各自的资本/收入/费用编码。两条流程各执行：建账→银行借100000/资本贷100000期初→三份草稿→独立审核→记账→余额表及凭证明细联查→一月结账→释放store并重开→在线备份→恢复到新路径→恢复副本继续保存二月草稿。

三个凭证为：材料借10000/银行贷10000；费用借1200/银行贷1200；银行借20000/收入贷20000。预期是契约给定手算常数，未用另一份实现计算预期。

| 数值检查 | 企业/小企业实际均通过 |
|---|---:|
| 银行期末借 | 108800 |
| 材料期末借 | 10000 |
| 费用期末借 | 1200 |
| 收入期末贷 | 20000 |
| 本期末级借/贷 | 各31200 |
| 期末末级借/贷 | 各120000 |
| 一月结账后revision/审计条数 | 11/11 |

另建小额层级账套验证0.1+0.2=0.3、银行父级和明细余额均0.7，重开后联查与末级总计不重复。恢复副本的真实SQL触发器故意使审计插入失败，在revision12完整回滚；删除测试触发器后真实双连接竞争一次提交至revision13。原生SQLite引擎实际报告3.53.3。

## 可复用命令和实际结果

可选工程：[SqliteIntegrationProbe/IntegrationProbe.csproj](SqliteIntegrationProbe/IntegrationProbe.csproj)，源码 [Program.cs](SqliteIntegrationProbe/Program.cs)，实际JSON结果 [result.json](SqliteIntegrationProbe/result.json)。NuGet lockfile随工程保存，无额外直接包依赖。完整集成检出中的简化命令见其 [README](SqliteIntegrationProbe/README.md)。

本轮SQLite采用detached worktree `/workspace/caiwu-sqlite-review`，Core仍为 `/workspace/caiwu-suite-dev`。下列命令在Core仓库根运行；使用现有 `VALIDATION.md` 中的可写XDG/runtime/NuGet和SDK配置，未修改HOME、宿主挂载或权限：

```bash
/tmp/caiwu-dotnet-10/dotnet restore \
  tests/Caiwu.Core.Tests/SqliteIntegrationProbe/IntegrationProbe.csproj \
  --locked-mode --source https://api.nuget.org/v3/index.json \
  -p:SqliteProject=/workspace/caiwu-sqlite-review/src/Caiwu.Persistence.Sqlite/Caiwu.Persistence.Sqlite.csproj \
  -p:UseArtifactsOutput=true -p:ArtifactsPath=/tmp/caiwu-combined-artifacts --disable-parallel

/tmp/caiwu-dotnet-10/dotnet build \
  tests/Caiwu.Core.Tests/SqliteIntegrationProbe/IntegrationProbe.csproj \
  --no-restore --configuration Release -p:TreatWarningsAsErrors=true -m:1 \
  -p:SqliteProject=/workspace/caiwu-sqlite-review/src/Caiwu.Persistence.Sqlite/Caiwu.Persistence.Sqlite.csproj \
  -p:UseArtifactsOutput=true -p:ArtifactsPath=/tmp/caiwu-combined-artifacts

/tmp/caiwu-dotnet-10/dotnet \
  /tmp/caiwu-combined-artifacts/bin/IntegrationProbe/release/IntegrationProbe.dll \
  /tmp/caiwu-combined-data/run2
```

三条命令实际退出码均0。构建0警告、0错误；最后输出 `result=PASS, assertions=332`。账套等合成数据留在 `/tmp/caiwu-combined-data/run2`，未纳入提交。临时原型首次运行run1也是332通过；上述仓库内可复用工程重新编译及run2再次通过，未将临时原型结果冒充最终文件运行结果。

新增独立工程的排除规则后，实际回归命令：

```bash
/tmp/caiwu-dotnet-10/dotnet test tests/Caiwu.Core.Tests/Caiwu.Core.Tests.csproj \
  --no-restore --configuration Release -p:TreatWarningsAsErrors=true \
  --logger 'trx;LogFileName=core-after-integration-probe.trx' \
  --results-directory /tmp/caiwu-core-test-results
```

退出0：**53通过、0失败、0跳过**。SQLiteworktree的git status为空，Core与Contracts源码对c499a4d的diff为空。没有审批拒绝或剩余执行阻断。

## 未验与交接

没有运行WPF/Windows交互、断电或文件系统故障、跨进程并发、全量SQLite回归/压力测试、完整制度/自动结转/税务及法定报表。未把月结锁定等同于制度要求的损益结转。主集成可在整合SQLite后运行可选探针，并继续组合UI验收；本任务没有合并main或其他分支。

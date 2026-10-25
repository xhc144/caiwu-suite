# 来源快照 v1.2 修复验证

2026-10-25，已授权由本路修改本次Contracts+Core。契约提交 **bb76658c19df94ab79e257db076d2ac8a39b7997**，生产与测试提交 **66621203066488c7e7a4115ede508e88ec58e3fa**；指定私有repo的 `codex/ledger-core`，现有草稿PR3。后者基于已验SaveDraft修复53fe及相邻反例71f815，按该顺序集成；若测试探针71f815尚未拣选，应先补齐它，再拣选bb76658及6662120。无Storage/SQLite/schema/Desktop/solution改动，不解除分发阻断。

## 生产行为

8个非SaveDraft修改入口均追加 `LedgerMutationContext? context = null`，null仅保留旧调用源码可编译并给出明确拒绝，**不允许无token写入**。新建/修改凭证均须填写VoucherDraft已有的两个字段。每个修改入口只读一次账套，核对相同来源快照的非空BookId及非负revision；缺失、失效或跨账套抛StoreConcurrencyException，不写数据/审计。检查通过后保留原状态/金额/期间规则及 `store.Write(next, before.Revision)` CAS，没有自动刷新token、合并旧字段或重试。

源快照来自用户实际所见的表单/选择/确认；不能在提交时读取新版本来配旧内容。账套级revision会拒绝另一笔合法业务之后的旧表单，UI须保留输入、提示重新加载并核对。具体[调用迁移表](../../../src/Caiwu.Contracts/MUTATION_CONTEXT_V1_2.md)。生产UI由Acceptance接线，本轮没有运行或修改WPF。

## 真实执行

| 验证 | 实际结果 | 证据 |
|---|---|---|
| 内存Core测试，含原有财务算例/不可逆记账/期间锁 | 149/149通过，0失败，exit0 | [TRX提取记录](unit-v12-summary.json) |
| 真实SQLite相邻入口回归 | 95/95场景通过：5个原风险PROTECTED、90项PASS，0风险、0失败，exit0 | [6662120原始JSON](result-v12-6662120.json) |
| 真实Core+SQLite完整生命周期 | 332个断言，PASS，exit0 | [原始JSON](lifecycle-v12.json) |

95项组成：原5个精确旧输入反例；原20项CAS/最新状态/普通异账套Id防护；8个修改入口各8类（旧API、显式null、旧版本、同revision另一真实账套、空BookId、负版本、未来版本、当前合法提交，共64）；新建凭证6类（缺双字段、缺BookId、缺revision、旧版本、同revision另一真实账套、当前合法，共6）。当前合法命令还用同一已消费token再提交，要求明确冲突且全量持久数据不变。

5个反例均保留原输入和原snapshot的token，没有保存时换新revision：

- 旧期初100被拒绝，新200保留，revision2不增加。
- 旧科目表单改名被拒绝，另一实例停用状态仍为false。
- 按旧10选择删除被拒绝，新20草稿保留。
- 按旧10审核被拒绝，新20仍是Draft。
- 按旧10确认记账被拒绝，新20仍是Reviewed，有reviewer2的独立审核且没有Post审计。

8项CAS用真实第二连接在目标Read之后提交。目标仍携带Read之前的正确上下文，通过Core的上下文检查后确实调用store.Write一次，由真实SQLite CAS拒绝；完整快照比较基准为竞争者已成功提交后的状态，确保不抹掉合法竞争者，也不新增失败命令的审计。不是靠提交时换新token或假的StoreConcurrencyException通过。

332断言包含Enterprise/SmallBusiness各自建账→期初→三凭证→审核记账→查询→关月→关闭重开→备份恢复；手算期末银行108800、借贷余额各120000、本期借贷各31200，原literal预期未改。另含0.1+0.2精度/父子汇总、真实SQLite审计插入失败回滚、双连接同号竞争。正常算例迁移时显式提供快照，仅用于让原业务规则继续被检查，不把当前版本补给任何旧输入风险反例。

旧13项编辑token程序本轮仅迁移创建fixture及v1.2“无token新建须拒绝”的预期，并锁定还原/Release构建；**未重复执行该13项**。现有编辑保护由Core原token单测继续覆盖。

## 复用命令

SDK10.0.402/runtime10.0.13、Microsoft.Data.Sqlite10.0.13/SQLite3.53.3，包版本与锁文件未改变；还原使用官方NuGet源。先采用[可写XDG/NuGet环境](../VALIDATION.md)，本容器dotnet为 `/tmp/caiwu-dotnet-10/dotnet`。

```bash
dotnet test tests/Caiwu.Core.Tests/Caiwu.Core.Tests.csproj --no-restore -c Release \
  -p:TreatWarningsAsErrors=true --logger 'trx;LogFileName=context-v12-unit.trx' \
  --results-directory /tmp/caiwu-core-v12-results

dotnet restore tests/Caiwu.Core.Tests/MutationSafetyProbe/MutationSafetyProbe.csproj --locked-mode \
  --source https://api.nuget.org/v3/index.json -p:UseArtifactsOutput=true \
  -p:ArtifactsPath=/tmp/caiwu-adjacent-mutation-artifacts
dotnet build tests/Caiwu.Core.Tests/MutationSafetyProbe/MutationSafetyProbe.csproj --no-restore -c Release \
  -p:UseArtifactsOutput=true -p:ArtifactsPath=/tmp/caiwu-adjacent-mutation-artifacts \
  -p:TreatWarningsAsErrors=true -m:1
CAIWU_MUTATION_TARGET_COMMIT=66621203066488c7e7a4115ede508e88ec58e3fa dotnet \
  /tmp/caiwu-adjacent-mutation-artifacts/bin/MutationSafetyProbe/release/MutationSafetyProbe.dll \
  /tmp/caiwu-core-v12-results/mutations-6662120.json

dotnet restore tests/Caiwu.Core.Tests/SqliteIntegrationProbe/IntegrationProbe.csproj --locked-mode \
  --source https://api.nuget.org/v3/index.json -p:UseArtifactsOutput=true \
  -p:ArtifactsPath=/tmp/caiwu-v12-lifecycle-artifacts
dotnet build tests/Caiwu.Core.Tests/SqliteIntegrationProbe/IntegrationProbe.csproj --no-restore -c Release \
  -p:UseArtifactsOutput=true -p:ArtifactsPath=/tmp/caiwu-v12-lifecycle-artifacts \
  -p:TreatWarningsAsErrors=true -m:1
dotnet /tmp/caiwu-v12-lifecycle-artifacts/bin/IntegrationProbe/release/IntegrationProbe.dll \
  /tmp/caiwu-core-v12-lifecycle-fresh
```

生命周期目录请使用不存在的新路径；旧目录保留SQLite文件，重复传原路径应拒绝覆盖。单测和332在提交前执行；6662120与其运行时Core的唯一后续区别是类XML注释一行，本轮在冻结6662120后重新构建并执行95项以标识准确commit。没有把环境变量中的SHA作为通过条件。

LedgerService.cs SHA256：`f0c204df0c0b9f8c427bd0e7d64e9ba500b7d89ea1439037493084abb3b14a96`。

待Acceptance完成：所有生产UI路径按迁移表捕获同一显示快照，验证冲突保留输入和换账套清空上下文。旧无token调用会明确失败，不能据此宣称UI已可用。未执行Windows真实窗口、多进程压力、完整财务制度或发包验收；没有权限拒绝或运行阻塞。

## PR48 收尾：期初/分录联合身份边界修复（2026-10-26）

静审基线 `2ac121b3c1f07a9b32fa065c978b2360293ad27d`，已测修复源码 `78f37ab957f2ab1d8f29bce5b89d2f3108f290d0`。仅修复现有接纳草稿与确认期初两个提交入口，不新增任务或功能。

实跑复现：合法零期初ID与平衡草稿的借方或贷方行ID重复，先期初后草稿、先草稿后期初两个方向均未在旧实现写入前拒绝。新增4个边界用例在旧生产代码下全部失败（未抛异常），另1个既有冲突状态的完整读取拒绝用例通过。修复后两个入口共用 `ValidateCombinedLineIds` 联合校验本次期初、全部已接纳分录（保留已删来源的ID认领）和本次新增分录；重复/空ID在调用宿主写入前报 `NP_LINE_ID`。

Release完整Parity适配器回归：**12通过、0失败、0跳过**，包含原7项与新5项。新回归在两个方向各覆盖借/贷行冲突，比较整个ModuleLedgerSnapshot序列化结果（含账簿版本、凭证、审计、模块文档、收据）和宿主文档/提案调用计数，确认拒绝无写入；换用独立ID后使用同一未消费的来源/提案重试可成功，重新构造适配器能读取完整状态。生产 `NonprofitLedgerValidation.Validate` 与 `ReadWritableSnapshot` 完整读取校验均未修改，已存冲突仍报 `NP_LINE_ID`。

- 修复前TRX：`/tmp/caiwu-regimes-identity-fix/before/identity-before.trx`；SHA256 `2b51e855d04800e62326d5da44459d5070d3358d0b686dbcaa17c695914b6cbf`；5项中1过4失败。
- 修复后TRX：`/tmp/caiwu-regimes-identity-fix/after/identity-after.trx`；SHA256 `3f7bd865fff9d0f038b12cb5c557bf5ba5f7fd9065d12a29b0035273d159e27e`；12项全部通过。

```bash
CAIWU_DOTNET_ROOT=/workspace/caiwu-dotnet bash tools/dotnet-local.sh test tests/Caiwu.Nonprofit.Tests/Parity/Caiwu.Nonprofit.Parity.Tests.csproj -c Release -p:ParityContractsProject=/tmp/caiwu-regimes-contracts/src/Caiwu.Contracts/Caiwu.Contracts.csproj -p:RestoreLockedMode=true -p:TreatWarningsAsErrors=true --nologo --logger 'trx;LogFileName=identity-after.trx' --results-directory /tmp/caiwu-regimes-identity-fix/after
```

本轮使用原PR52冻结契约与合成宿主。原91项领域/60项报表/WPF记录属于此前验证，本轮未重复运行；没有改变这些生产项目。此处是输入边界可修复缺口，不据此推断发生过高频资金事故。真实Core/SQLite组合、Windows验收和原账套/完整模板的既有未完成状态保持。

---

# regimes：本轮可写切片验证（2026-10-26）

实际验证源码提交 `983be15d1d4375c4e5b742ff70c06a84ac5da81f`，基线 `3b0c59b02d8941c32ac176309555c03c94bb4213`。独立checkout `/workspace/caiwu-regimes`；Linux / .NET SDK10.0.403（global.json允许latestPatch）。下列为本轮Release、锁文件恢复、TreatWarningsAsErrors=true的实际结果；后面的旧77项证据仅保留历史，不能覆盖新能力或新边界。

| 项目 | total / passed / failed | TRX SHA256 |
|---|---|---|
| nonprofit | 91 / 91 / 0 | `54f72331d9c6809c132911c7764f590efb71c687101ec2222bdf917d86264840` |
| parity | 7 / 7 / 0 | `3fd4728420c4fb0c432218fb90ff3d020bc3357e01dc891eef09e3daca98fa43` |
| reporting | 60 / 60 / 0 | `07c68d130d98f414b23ba71bc986740bf2bce68aef422505022cc15006261502` |

三个TRX均0跳过，路径位于 `/tmp/caiwu-regimes-validation/{nonprofit,reporting,parity}/`。Nonprofit从旧77项增加到91项；Reporting原55项加5项原模板变体回归；Parity7项是冻结契约的合成宿主适配测试。数量仅描述有限回归范围，不能作为原软件全功能完成或原账套兼容证据。

实际命令（本地使用仓库现有wrapper，未改默认book-project）：

```bash
CAIWU_DOTNET_ROOT=/workspace/caiwu-dotnet bash tools/dotnet-local.sh test tests/Caiwu.Nonprofit.Tests/Caiwu.Nonprofit.Tests.csproj -c Release -p:RestoreLockedMode=true -p:TreatWarningsAsErrors=true --logger 'trx;LogFileName=nonprofit.trx' --results-directory /tmp/caiwu-regimes-validation/nonprofit
CAIWU_DOTNET_ROOT=/workspace/caiwu-dotnet bash tools/dotnet-local.sh test tests/Caiwu.Reporting.Tests/Caiwu.Reporting.Tests.csproj -c Release -p:RestoreLockedMode=true -p:TreatWarningsAsErrors=true --logger 'trx;LogFileName=reporting.trx' --results-directory /tmp/caiwu-regimes-validation/reporting
CAIWU_DOTNET_ROOT=/workspace/caiwu-dotnet bash tools/dotnet-local.sh test tests/Caiwu.Nonprofit.Tests/Parity/Caiwu.Nonprofit.Parity.Tests.csproj -c Release -p:ParityContractsProject=/tmp/caiwu-regimes-contracts/src/Caiwu.Contracts/Caiwu.Contracts.csproj -p:RestoreLockedMode=true -p:TreatWarningsAsErrors=true --logger 'trx;LogFileName=parity-adapter.trx' --results-directory /tmp/caiwu-regimes-validation/parity
CAIWU_DOTNET_ROOT=/workspace/caiwu-dotnet bash tools/dotnet-local.sh build src/Caiwu.Nonprofit/Wpf/Caiwu.Nonprofit.Wpf.csproj -c Release -p:RestoreLockedMode=true -p:TreatWarningsAsErrors=true
```

最后WPF命令实际0警告0错误；仅交叉编译，未运行Windows。临时契约checkout固定PR52 `5bb60d24b9c60c9eecfcc5adc37bced4688adf85`，没有改本分支共享Contracts。直接使用系统默认CLI目录会触及只读用户目录，已改用现有tools/dotnet-local.sh隔离缓存解决；不存在未解决权限拒绝。

业务证据：`WritableLedgerTests.SavedReviewedPostedClosedReopenedAndReversedRoundTripIsReal` 实际写参考文件并新建store回读，不把ProjectedState当已记账。期初1000，U/R收入100/200、费用20/50，经真实保存/异人审核/过账/结转/月结，银行1230、U/R净资产1080/150，累计变动80/150，原计算器两表完整勾稽；反结/反过/反审核/删除结转后回读有效。其他测试覆盖错误账套/旧版本/授权、并发CAS和文件锁、精度/溢出原子回滚、原始未知列/高精度外币数量辅助维度回读、断号明确重排、删除后来源认领保留、负收入与分类相抵不假称已结转。

`NonprofitParityAdapterTests` 的ContractHost仅是合成契约宿主，验证一次AcceptVoucherProposal包含基础投影与完整文档、来源与身份防重、状态授权调用保留同一确认token，以及凭证被改/期初变动/缺审计时明确失败。**尚未实际运行PR52后续Core/SQLite实现**，不冒称主总账已经接通。原始安装资源、原程序、真实账套均未读写或运行。公共增强编辑、模板原内容、原SQL Anywhere兼容与Windows实机仍待集成；见 [模块交接](../../docs/parity-handoffs/regimes.md)。

---

# 民非建议服务实际测试

2026-10-25，在 Linux、.NET SDK **10.0.402** 上实际执行 Release 测试，警告视为错误：**77 通过，0 失败，0 跳过**。原65项均保留并通过，新增12项金额边界回归。项目仅引用 `Caiwu.Nonprofit`，不引用 Core、Contracts、SQLite 或桌面项目；不修改根 solution。

```bash
source /tmp/caiwu-dotnet-env.sh
dotnet restore tests/Caiwu.Nonprofit.Tests/Caiwu.Nonprofit.Tests.csproj --locked-mode
dotnet test tests/Caiwu.Nonprofit.Tests/Caiwu.Nonprofit.Tests.csproj \
  -c Release --no-restore -p:TreatWarningsAsErrors=true \
  --logger 'trx;LogFileName=nonprofit-boundary-after.trx' \
  --results-directory /tmp/caiwu-nonprofit-boundary-after
```

本次 TRX：`/tmp/caiwu-nonprofit-boundary-after/nonprofit-boundary-after.trx`。测试包固定并随附 `packages.lock.json`：`Microsoft.NET.Test.Sdk 18.11.0`、`xunit.v3.mtp-off 4.0.2`、`xunit.runner.visualstudio 4.0.1`。

最终TRX独立回读计数：total/executed/passed均77，failed/error/timeout/aborted/notExecuted均0；SHA256 `9a5c7630c3a5d22d1ac457ec0ef73236400e74b884756cb39ceed2926734fbc0`。与首轮65项TRX逐测试名称比较，原65项通过集合全部保留，新增12项通过。首轮TRX `/tmp/caiwu-nonprofit-tests/nonprofit-release.trx` 的SHA256仍为 `892491534acd4a37ffba4eea3e384274d5019488fd515320e25e187463426327`，该历史结果不替代本次运行。SDK10.0.402与根global.json一致且经官方SHA512核验，遥测及ASP.NET证书生成关闭，工具/包缓存均隔离在/tmp；SDK和缓存不随项目提交。已有.NET10.0.402环境可直接执行上面的restore/test命令，无需本次临时环境脚本。

## 独立复核返修：金额边界与投影一致性

来源为Reporting独立证据提交 `3362f3b84125cbdadeabde3683caebbc4bc727ac` 的 `tests/Caiwu.Reporting.Tests/ReviewNonprofit/REVIEW.md` 及C#反例，对象为Nonprofit提交 `38533de209000ee57afb46f7dc907e6f591c774f`。本次只读取该证据，未修改Reporting文件。

旧版本对余额累计的每个中间和限幅：银行+M、其他货币资金+M、非限定净资产-M、应付款-M（M=92233720368547758.07），交错排列通过，正余额先出现则误报 `NP_TOTAL_OVERFLOW`；已接受状态的1分费用投影经排序后也会在下一次结转时误报。同样发现单张凭证内同分类余额的相抵借贷逐行更新，在正/负M附近因行顺序误拒。

先添加 `AmountBoundaryTests.cs`、保持旧生产代码不变，实际执行新增12项：**7通过、5失败**，失败分别覆盖上述两处排列问题、费用后结转、1分不平衡的错误拒绝代码。命令为上方test增加 `--filter FullyQualifiedName~AmountBoundaryTests`，使用TRX名 `boundary-before.trx`、目录 `/tmp/caiwu-nonprofit-boundary-before`；修复前未启用警告视为错误。TRX回读12/7/5，SHA256 `1c6d32f819b55cdb29cfbf59cdb15d0dc9ff69c89641165d0e6f4c6b4531f4a7`。

修复以BigInteger整数分累计账套带符号净和；单凭证逐行验证后按完整分类键累计净变化，对最终分类余额限幅；返回前执行完整 `ValidateState`。金额精度和对称Int64分字段上限、单张凭证借/贷合计上限仍保留，不设置依赖排列的账套总额上限。新增12项实际覆盖：

- 同一合法极值集合的全部24种排列；每种均能生成1分费用、继续分类结转，并经独立公开入口再次校验两个投影的状态、receipt、借贷平衡和待审核状态。
- 同一1分不平衡集合全部24种排列均为 `NP_UNBALANCED`；正负真实单字段越界、投影余额越界、结转净资产越界、凭证合计越界仍为 `NP_TOTAL_OVERFLOW`，输入不变。
- 同一凭证相抵借贷两种排列在正负边界结果相同；最大合法总额M按相等大权重精确分为46116860184273879.04和46116860184273879.03，费用支付与分类结转均守恒。

本次返修验证金额计算与状态一致性，不新增财务制度覆盖或真实记账能力。

## 原有证据与覆盖

`OfficialScenarioTests` 将既有27个独立手算 JSON 案例转换为真实服务调用：首笔 Opening 建立期初快照，其余凭证逐笔调用 `Propose`；独立分配案例调用 `ComputeAllocation`。6个正例比较预先写定的收入费用、现金、两类净资产和分配结果；21个反例比较拒绝代码。没有把 JSON Schema 通过当作服务已实现。

固定样例为：限定和非限定捐赠各1000、支出200后相应净资产800；共同费用1000按经人工批准的3:2依据分配600/400，期末限定/非限定净资产3600/2400；101分等分为34/34/33；解除A300但保留B700；可靠凭据的非现金服务捐赠收入与费用各1000而现金和净资产变动为零。

原有其余38个实际用例覆盖所有生成入口、限定性费用结转、完整与部分结转阶段、解除权限、可靠服务捐赠前提、整数分及大权重分配、0.1+0.2、金额精度和范围、稳定ID、重复请求及ID冲突、过期版本、期间锁/跨期、规则绑定、限制版本/项目/外部证据、输入不变与待人工复核状态、未支持的前期调整、规划版本耗尽、9999年12月月末日期边界，以及以下审查修复：

- 1分分给两个受益行时，零份额留在两行分配底稿中，但凭证仅保留正金额费用行及银行行；拒绝插入零金额凭证行。
- 原始服务捐赠分录按实际现金科目判断非现金性质，不能通过清除显示标记绕过计量可靠性检查。
- 捐赠与费用混合业务不能靠添加互相抵销的银行或固定资产分录绕过人工复核；混合现金业务明确拒绝，非现金业务仍要求可靠计量。这是本建议服务的保守支持边界，不是断言所有捐赠与费用组合依法都属于服务捐赠。
- 已有月底投影不能生成月初解除建议；`LastPlannedDate` 保留时间先后关系。
- 含 `|` 的限制ID与项目组合不会碰撞生成相同结转凭证或分录ID。
- 建议保留可序列化的服务/解除类型化评估及可读证据引用；纯分配可暂不绑定凭证，生成费用建议必须有凭证ID。

本次引用文件 SHA256：

- `rules/scenarios/nonprofit-v2.json`：`1463f94edd5ad6c6017f162085aa190805c475f66770ecb6ad0717e7e7e2ff47`
- `rules/packages/nonprofit.json`：`0730548fdc4cd1db74f587ba050c2fd8849b32804e50c9eefa1394c561d3a4df`

## 限制

测试验证的是独立建议服务和假想状态投影。所有资料与金额均为合成；测试不生成真实凭证，不进行持久化、审核、记账或期间关闭，也未验证桌面交互、完整报表或旧账迁移。实际捐赠确认、限制事实、分配合理性及计量可靠性仍需专业人员判断；通过这些测试不构成真实财务合规保证。

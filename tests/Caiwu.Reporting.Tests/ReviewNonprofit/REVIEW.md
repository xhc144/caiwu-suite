# Nonprofit / Reporting 独立边界复核

## 修复复核：7b8e8b7 通过，本项关闭

2026-10-25，独立检出并核验准确提交 `7b8e8b74dfa4b704b439722573687ee1044ac424`，生产工作树无修改；Reporting生产代码仍为初审所用版本。本次仅更新本记录，不改生产代码、原始五个证据用例或其38533de复现脚本，不运行作者的65/77项测试套件。

先把 `3362f3b` 的五个用例**原样**指向修复提交运行：3通过、2失败。两项失败分别在旧源第29、45行的 `Assert.Throws`，均为“No exception was thrown”。这两个用例原本断言旧缺陷存在，因此该结果符合修复预期，不能把它写成五个原始断言全通过，也不能把它当作新的产品失败。

随后在 `/tmp/caiwu-reporting-tools/nonprofit-fix-recheck/` 复制证据源码，仅将这两项改为正确期望，原三项业务/Reporting边界代码保留原样，再加入三个超限守卫检查。**8通过、0失败、0跳过**，Release、`TreatWarningsAsErrors=true`，SDK10.0.402。

| 原五个场景 | 按修后正确期望的独立结果 |
| --- | --- |
| 同组平衡期初的顺序一致性 | 扩展为四余额的24种排列，全部接受，分类余额规范排序后逐项一致，净和为0 |
| 1分费用后继续结转 | 投影仍平衡；结转成功，5301=0、3101=`-M+0.01`，保持PendingReview |
| 分配—结转—解除及统计符号 | 原场景不变：银行0.06、解除后3102=0、3101=-0.06；Activity收入0.11/费用0.05、全部凭证借方周转0.37；原状态不变 |
| 分类余额与v1 Reporting边界 | 原场景不变：同码双类直接输入仍被重复保护拒绝，合并总账借贷各300但不具备100/200分类分列能力 |
| 新支付与已有费用重分类区别 | 原场景不变：第二次支付得到银行800/费用200；显式非现金重分类保持银行900/费用100；仍待审核 |

三个新增检查确认没有把真正超限一起放开：

1. 期初单项字段 `+(M+0.01)`、`-(M+0.01)` 均拒绝 `NP_TOTAL_OVERFLOW`。
2. 合法银行余额 `+M` 再收入0.01、合法余额 `-M` 再支出0.01，最终字段真实越界，均拒绝该错误；原输入JSON保持不变。
3. 单张凭证各行60000000000000000.00、各账户最终余额均在范围内，但借/贷侧合计120000000000000000.00超限，仍拒绝该错误。分别使用1002/1009与4101/4201，避免把“单个分类余额超限”误当作“凭证总额超限”的证据。

这里 `M=92233720368547758.07`。源码核对与结果一致：[修后第89行](https://github.com/xhc144/caiwu-suite/blob/7b8e8b74dfa4b704b439722573687ee1044ac424/src/Caiwu.Nonprofit/NonprofitPlanningService.cs#L89)用BigInteger分值累计净和；[第212行](https://github.com/xhc144/caiwu-suite/blob/7b8e8b74dfa4b704b439722573687ee1044ac424/src/Caiwu.Nonprofit/NonprofitPlanningService.cs#L212)返回前复验完整投影；[第294行](https://github.com/xhc144/caiwu-suite/blob/7b8e8b74dfa4b704b439722573687ee1044ac424/src/Caiwu.Nonprofit/NonprofitPlanningService.cs#L294)先按分类余额桶归并分录再检查最终字段范围。单项与凭证侧总额上限保持有效。

实际证据：

- 原样五用例TRX：`/tmp/caiwu-reporting-tools/test-results/nonprofit-fixed-original-five.trx`，total5/passed3/failed2；SHA256 `65f4e86aca8b83f8cb5fd64ff7381a64410d5512d287112afaa43ab8bdc6f240`。
- 修后正确期望及守卫TRX：`/tmp/caiwu-reporting-tools/test-results/nonprofit-fixed-correctness-and-guards.trx`，total8/passed8/failed0；SHA256 `a432d9ea1014ac22b6cfd9d7c0b34b67a3e1ea6383a7b39ae7e29a7fc8594848`。
- 临时普通C#源码 `BoundaryCases.cs` SHA256：`8d2556c1250cb632a63f18fb3fad2264ada28c625400de9cf26370b4227c09f2`。临时项目引用准确修复工作树及本仓库Reporting，测试依赖与原项目固定版本相同，官方NuGet还原；未把临时源替换或提交为原始证据用例。

原样五场景运行使用原项目，仅覆盖 `NonprofitProject` 指向修复工作树：

```sh
dotnet restore tests/Caiwu.Reporting.Tests/ReviewNonprofit/Caiwu.Reporting.ReviewNonprofit.csproj --locked-mode --configfile tests/Caiwu.Reporting.Tests/NuGet.Config -p:NonprofitProject=/path/to/nonprofit-7b8e8b7/src/Caiwu.Nonprofit/Caiwu.Nonprofit.csproj
dotnet test tests/Caiwu.Reporting.Tests/ReviewNonprofit/Caiwu.Reporting.ReviewNonprofit.csproj --no-restore -c Release -p:TreatWarningsAsErrors=true -p:NonprofitProject=/path/to/nonprofit-7b8e8b7/src/Caiwu.Nonprofit/Caiwu.Nonprofit.csproj
```

临时副本把原第一个反例的“分组顺序应抛错”改成24排列均应得到同组余额；第二个反例的“结转应抛错”改成应返回平衡、损益结零的待审投影。新增超限输入如上表述；原三边界场景未变。保留原38533de脚本与断言是为了保存历史复现，不应将它们直接用作修后通过门槛。

**结论：此前顺序相关校验/不可继续投影缺陷在此次独立范围内关闭，未发现正常分配、分类结转和解除链回归。** 下列双维报表、累计历史事实及审核记账适配限制仍然存在，不能据本次通过扩展为完整民非或法规合规认证。本项复核结束。

## 初审历史：38533de

审查对象固定为 `38533de209000ee57afb46f7dc907e6f591c774f` 的 Nonprofit，Reporting 使用本分支 `b4e299604394b79d23936d1bc8f28e44ffbc5dc1`。本轮仅增加本目录文件，生产代码、原有测试、Controls、Contracts 均未修改。没有重跑 Nonprofit 既有65项测试，没有使用原软件或进行新的法规合规判断。

独立运行5个定向证据用例，Release、警告视为错误，**5通过、0失败、0跳过**。其中两个 `Counterexample_*` 断言指定提交的错误行为以固定复现证据；它们的“通过”表示缺陷已复现，不表示产品正确。另三项区分当前支持行为与接口限制。

## 确认缺陷：余额排列顺序影响校验，且可返回无法继续使用的投影

**归属：Nonprofit owner，`NonprofitPlanningService.ValidateState` 与投影返回前的一致性校验。**

[第82—91行](https://github.com/xhc144/caiwu-suite/blob/38533de209000ee57afb46f7dc907e6f591c774f/src/Caiwu.Nonprofit/NonprofitPlanningService.cs#L82)逐项做 `total=Add(total,balance.NetDebit)`；[Add/Money第19—28行](https://github.com/xhc144/caiwu-suite/blob/38533de209000ee57afb46f7dc907e6f591c774f/src/Caiwu.Nonprofit/NonprofitPlanningService.cs#L19)把**每个运行中间和**也限制在对称Int64分范围。以下每个余额都在该范围，最终借贷和均为0：

```text
M = 92233720368547758.07
1002 银行 +M；1009 其他货币资金 +M；3101 非限定净资产 -M；2202 应付款 -M

输入顺序 [1002, 3101, 1009, 2202]：CreateState 接受。
输入顺序 [1002, 1009, 3101, 2202]：CreateState 抛 NP_TOTAL_OVERFLOW。
```

这不是尾差或小数不精确，普通 decimal 足以表示这里的总和；问题是同一集合因瞬时和与排列顺序不同产生不同结论。若设计要限制整个账套总额，交错顺序也不该接受；若只限各余额字段，则分组顺序不该被拒绝。两种范围定义都不应依赖枚举顺序。

第二个用例不只直接构造排列：从服务已接受的交错期初执行1分 `SuggestExpense(5301, Unrestricted)`，得到 PendingReview、借贷平衡、各字段在范围内的投影；银行 `M-0.01`、费用 `0.01`、变化合计0。投影余额在[第285—293行](https://github.com/xhc144/caiwu-suite/blob/38533de209000ee57afb46f7dc907e6f591c774f/src/Caiwu.Nonprofit/NonprofitPlanningService.cs#L285)按键排序，变成两个正资产先出现；接着 `SuggestClosing` 在 `Context→ValidateState` 便抛 `NP_TOTAL_OVERFLOW`。`Plan` [第203—215行](https://github.com/xhc144/caiwu-suite/blob/38533de209000ee57afb46f7dc907e6f591c774f/src/Caiwu.Nonprofit/NonprofitPlanningService.cs#L203)未在返回前检验这一完整投影不变量。

建议 owner 先明确单项/凭证总额/账套总额的上界语义，用与输入顺序无关的精确累计校验净和，并保证返回投影在下一次合法操作前仍能通过状态校验。本任务未跨模块修改。

## 已验证的符号与累计边界

1. **正常分配—结转—解除链保持平衡，没有自动记账。** 限定收入0.07、非限定收入0.04，共同费用0.05按2:3分配到限定成本0.02/非限定管理费0.03。分类结转后3102=-0.05、3101=-0.01；解除A0.05后3102=0、3101=-0.06、银行仍为0.06。各建议和各凭证均平衡，原状态未改变，来源真实账簿revision始终73，状态始终PendingReview。解除的 `BalanceDelta.Change` 为3102 **+0.05**、3101 **-0.05**；它是借正贷负的账簿差异，正向展示净资产增加时应取相反号，不可直接把Change当“净资产增加”。
2. **结转/解除不能混作收入费用或现金流。** 仅Activity累计收入0.11、费用0.05；把分类结转也放进同一科目的借贷净发生额后，两项都变为0。解除仅含3102/3101，不含银行或收入费用。完整建议凭证的借方周转合计是0.37；`ReportBuilder.VoucherList` 正确显示“凭证清单/所列状态合计”，这个数字既不是费用也不是收入。这是统计口径与后续适配层责任，非现有凭证清单的计算缺陷。
3. **单月PlanningState不能独自还原本年累计活动。** [Models中的State/Receipt](https://github.com/xhc144/caiwu-suite/blob/38533de209000ee57afb46f7dc907e6f591c774f/src/Caiwu.Nonprofit/Models.cs#L17)保存余额和凭证ID/hash，不保存完整已记账全年分录；结转后损益余额已零。后续民非活动表应消费完整、经批准/记账且保留Kind/分类/范围的历史事实，不能用期末余额冒充本月或本年累计，也不能把规划Revision当SourceLedgerRevision。

## 当前功能/接入限制，不误报为领域计算缺陷

- **分类不能无损塞入v1 Reporting。** 同一4101科目下限定100、非限定200是两个不同分类余额。直接映射成两行同编码 `TrialBalanceRow`，会被[Reporting第60行](https://github.com/xhc144/caiwu-suite/blob/b4e299604394b79d23936d1bc8f28e44ffbc5dc1/src/Caiwu.Reporting/ReportBuilder.cs#L60)的重复科目保护拒绝；先合成总账可正确得到借贷各300，但丢失100/200分列。[Contracts.VoucherLine](https://github.com/xhc144/caiwu-suite/blob/b4e299604394b79d23936d1bc8f28e44ffbc5dc1/src/Caiwu.Contracts/Models.cs#L15)没有分类/限制ID/版本/项目/Kind，不能据总账导出宣称已有民非双维报表。归属为主协调后续Contracts/Reporting适配设计，现阶段属于明确未实现。
- **PendingReview没有Posting语义。** Nonprofit仅依赖BCL，无Store/审核/记账调用，Status只有PendingReview。用例中的临时、有损GL展示转换显式采用Contracts.Draft，筛选Posted为空；它仅用来检查统计边界，不是建议生产桥接。后续持久化owner须保留全部分类/证据/Kind并走审核记账，不能把ProjectedState替换真实账簿。
- **`SuggestAllocatedExpense` 是新支付建议，不是对已入账费用的再分配。** [第321—329行](https://github.com/xhc144/caiwu-suite/blob/38533de209000ee57afb46f7dc907e6f591c774f/src/Caiwu.Nonprofit/NonprofitPlanningService.cs#L321)生成正费用借方和银行贷方。已确认费用100后，若把它当“已有费用重新分配”再调用，银行会再减100、总费用变200。相同证据引用不会替代稳定request/voucher ID的幂等控制。这是该入口的业务含义，不是其凭证不平衡。独立用例同时验证：使用明确的非现金 `Propose` 草案，冲回原费用100、按批准底稿重分类为限定/非限定各50，可保持银行900、总费用100；仍为PendingReview，分配依据/事实与后续审批必须由对应owner承担。本任务没有新增生产重分类入口。
- 负损益结转、部分范围解除、跨月/全年累计、前期调整、5601、真实持久化与双维法定报表是README已声明的支持限制；本轮未拿它们作为新缺陷或重复65用例。

## 复现

先准备**只读生产源码**的指定提交工作树，然后运行：

```sh
bash tests/Caiwu.Reporting.Tests/ReviewNonprofit/run-review.sh /path/to/nonprofit-38533de
```

脚本校验Git HEAD与生产/规则文件未修改，仅运行本目录5个用例；使用官方NuGet及新增锁文件。可用 `DOTNET_COMMAND=/path/to/dotnet` 指定现有SDK命令，本次实际用已校验官方SHA512的10.0.402及隔离可写缓存。TRX位于本目录 `.build/results/nonprofit-independent-boundaries.trx`。既有Reporting测试项目仅做编译确认，未运行其全部测试，亦未重新运行Nonprofit的65用例。

本目录C#证据以 `.csx` 后缀由独立项目显式按普通C#编译，使不改原测试csproj即可避免父项目自动包含；生成文件隔离在隐藏 `.build/`，父项目编译也已确认无污染。不能把这些针对旧提交错误行为的证据直接当作生产验收门槛；owner修复后应把反例期望更新为一致的正确行为。未宣称整体法规合规或民非系统生产可用。

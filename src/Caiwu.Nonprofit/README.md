# 民非2026领域与可写账务适配

本轮新增可写适配、真实状态操作与参考持久化；API、精确验证和公共总账接线缺口见 [regimes交接](../../docs/parity-handoffs/regimes.md)。`Writable/` 不只是规划建议：草稿、异人审核、过账、结转和月结均落盘；独立 JSON 适配尚未与共享总账接通，不能把它作为正式第二套账簿或原格式驱动。

以下保留原规划模块的说明与范围。

# 民非2026独立领域规划服务

分支 `codex/nonprofit-core` 从规则v2提交 `9956ec2d023a44ad13ac8af5424420beef2f612d` 创建。本项目只依赖.NET10 BCL，嵌入已核的 `rules/packages/nonprofit.json`；不引用Contracts、Core、Desktop或SQLite，不修改根solution。

这次实现的是可执行的领域规划服务，所有输出始终为 `PendingReview`。它不保存、审核或记账，不修改调用方对象，不执行支付、税务申报或对外报送；`ProjectedState`和`BalanceDelta`是**建议若获批准后的假设结果**，不能覆盖真实账簿。

## 实际入口

命名空间 `Caiwu.Nonprofit`，主要类型及字段见 `Models.cs`。

| 入口 | 已实现行为 |
|---|---|
| `NonprofitRules.Official2026` | 读取随程序集嵌入的正式56项一级快照，固定包ID/版本/hash；生产验证标志false |
| `CreateState` | 从冻结期初/期间起点余额和证据创建单月规划状态，核对借贷、分类、限制版本、项目及来源；不接受旧损益带入或3201处理 |
| `SuggestDonation` | 现金捐赠生成银行/4101建议；服务捐赠在确认和可靠计量证据成立时生成费用/4101非现金建议；两者都保留限定类别 |
| `SuggestExpense` | 费用/银行建议，保存功能科目、限定类别、项目、协议ID/版本；5601阻断 |
| `ComputeAllocation` | 验证人工审定的共同费用依据，按权重与固定尾差政策计算；返回依据、权重、整数分底数、余分归属及行ID，不改变状态 |
| `SuggestAllocatedExpense` | 将分配底稿桥接到待审核分录，核对总额、类别、协议、项目及逐行金额，拒绝同费用行重复分配 |
| `SuggestClosing` | 按科目＋类别＋限制ID/版本＋项目的未结余额生成结转建议；收入和费用分别进入3101或3102，输出假设状态差异 |
| `SuggestRelease` | 校验解除范围、证据、全部条件、来源权限、逐协议可用净资产后生成3102→3101建议；不改变现金或收入 |
| `Propose` | 对外部已分类草案做相同领域校验并返回建议，供主协调的编辑器接入；不能用Activity、Closing或Opening绕过重分类约束 |

```csharp
var service = new NonprofitPlanningService();
var evidence = new RestrictionEvidence("grant-A", 1, "project-A",
    RestrictionSourceKind.ExternalProvider, "synthetic-agreement-A",
    [new(RestrictionConditionKind.Purpose, "仅用于A项目")]);
var state = service.CreateState(Guid.NewGuid(), new(2026, 6, 1), new(2026, 6, 30),
    [evidence], []);
var tag = new Classification(RestrictionClass.Restricted, "grant-A", 1, "project-A");
var proposal = service.SuggestDonation(state, new(Guid.NewGuid(), state.Revision,
    new(2026, 6, 30), 1000.00m, tag, DonationKind.Cash,
    "synthetic-reviewed-recognition", true));
// proposal.Vouchers：待审核银行借1000、限定捐赠收入贷1000。
// state仍为空；proposal.ProjectedState为计算结果，尚未写入账簿。
```

## 计算与拒绝规则

- 金额为decimal，最多两位，单个金额字段（分录借/贷、分类余额、分配总额、返回的余额差异）和单张凭证的借方/贷方合计采用对称Int64分范围，拒绝超精度、溢出和零/负的新增捐赠或费用，不静默舍入。账套可由多个在界限内的余额构成，未另设整个账套借/贷余额合计上限；平衡校验用BigInteger整数分累计正负净和，中间和不冒充金额字段。同一凭证内逐行验证后按完整分类键合并净变化，再校验最终余额界限，避免相抵分录排列影响结论。返回前重新验证完整投影；实际越界余额及凭证合计仍拒绝。分配中间乘积也用BigInteger，避免大权重乘法溢出。
- 分配方法为“最大余数，余数相同按稳定share.Id排序”。这是明确选择的工程政策，不是法定唯一分配法；分配依据合理性及人工审批是必要输入，计算器不替代判断。金额分配为0的受益行保留在底稿，但不生成零金额会计分录；纯计算可暂不绑定凭证ID，生成凭证建议前必须绑定非空ID。
- 收入、费用两者都必须分类。限定行关联外部提供者或法律/行政法规的具体证据、版本和项目；内部预算不够。资产/负债行不冒充收入费用限定类别。
- 结转逐明细校验，不能用科目总额零掩盖错类别、错协议或错项目。负收入/负费用的结转方式未审定，明确拒绝自动处理。部分结转时状态为 `ClosingInProgress`，阻断新增普通活动；损益各明细结零后为 `ClassifiedClosingComputed`。
- 解除要求该限制下损益先结清，评估与3102来源为同一限制ID/版本，金额等于该完整证据范围的相关剩余净额，不能借用B协议余额、重复释放或凭空只解除一部分。独立可解除部分应有独立且经审核的范围记录。外部提供者撤销自己所设限制可按有据事实处理；提供者不能撤销法律或行政法规限制。
- 同一活动月内才能规划；请求日期跨月/跨年、2026以前、早于 `LastPlannedDate`、新增活动跨过结转阶段、锁期、过期规划revision或错误规则hash均明确抛 `NonprofitValidationException`，`Code`为稳定的 `NP_*`。不能在月底结转后借用其余额生成月初解除建议。
- 服务捐赠审核前提按实际分录性质检查，不能通过清除 `IsNoncash`显示标志跳过可靠计量评估。输出 `Evidence`保留本次收入确认/服务计量和解除评估及可读证据引用，不只留下无法还原原文的hash。
- 同一普通草案同时含4101捐赠收入和费用时，本次只支持明确非现金且已可靠计量复核的服务捐赠路径；添加相抵银行/资产行不能消除复核要求。混合现金捐赠与现金费用应拆成各自可解释的建议，本服务不猜测其背后业务。
- 请求需要稳定ID。相同已保存receipt与payload抛 `NP_DUPLICATE_REQUEST`，同ID换payload抛 `NP_REQUEST_ID_CONFLICT`。同一未改变输入重算得到相同凭证/行ID，不产生随机第二组建议；服务没有进程级全局存储。

## 主协调API与持久化接入要求

1. 本DTO命名空间独立，不能通过摘要字符串丢弃分类。主协调扩Contracts时应保留稳定行ID、分类、限制ID/版本、项目、来源证据、分配底稿、动作类型和规则绑定。冻结v1构造器未被修改。
2. `PlanningState.Revision`是规划序列，`SourceLedgerRevision`是来源真实账簿版本，两者不可混用。开始时从已验证真实快照建状态；持久化待审建议时，将request ID、payload hash、凭证ID、规则hash、完整typed request、`Evidence`评估、分配底稿、`LastPlannedDate`和来源revision一起存储，保证唯一约束和事务。hash不能替代原始业务证据。
3. 审核/记账仍由后续授权流程处理。批准前核对实际账簿revision、期间锁、身份分离和证据仍有效，重新计算差异；不能把 `ProjectedState`替换给v1 `ILedgerStore.Write`。并发、跨进程幂等及持久化回滚由对应owner实现，本服务只验证调用方提供的状态。
4. 保存原始规则快照、证据及版本，历史已用版本不可覆盖。当前一次状态只接受每个限制ID的一个明确版本，不支持同月替换协议后重写已用分类；复杂版本迁移需单独设计。
5. 期间开启/关闭、更正、备份恢复、权限和原始凭证验证仍是主系统职责。此处 `ClassifiedClosingComputed`表示建议已算出，不表示真实月结或入账。

## 依据、测试与边界

正式依据复用财会〔2024〕25号第18、67—70、74—79条及3101/3102说明；页码与hash已在规则包。没有重新访问2006企业指南RAR403源，也没有下载/运行原商业软件。

27个固定JSON场景现真实调用C#服务；另有专门测试覆盖生成入口、0.1/0.2、大权重、尾差、状态、重复请求、锁期、跨期、版本/项目、输入不变和待审状态。独立Reporting复核发现的Int64分边界排列/投影问题已有12项新增回归，原65项加新12项实际77项通过；包含同一余额集合全部24种排列、1分费用后继续结转，以及真实超范围拒绝。执行方法及修复前后证据见 `tests/Caiwu.Nonprofit.Tests/VALIDATION.md`。不能把规则JSON或编译通过当作业务测试完成。

未实现：全套报表/现金流分类、全部捐赠确认计量和退款、注册资金、增设限制、部分或多层条件复杂解除、5601、负损益结转、重大前期调整/3201、完整迁移、真实持久化与桌面流程。捐赠确认、可靠计量、限制事实、解除事实和分配合理性是显式人工判断输入。未宣称整体民非软件已可用，也不保证真实财务合规或生产认证。

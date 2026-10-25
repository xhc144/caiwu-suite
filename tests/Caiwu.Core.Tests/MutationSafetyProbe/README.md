# SaveDraft之外的修改入口：相邻风险核查

**v1.2已实作并验证**：生产Core `66621203066488c7e7a4115ede508e88ec58e3fa` 配合契约 `bb76658c19df94ab79e257db076d2ac8a39b7997`，原5项均被拒绝且数据不变。当前程序有95个场景，退出0，详见[修复结果与复用命令](VALIDATION_V1_2.md)。以下保留53fe基线的历史反例记录，其“待接口决定/未关闭”和25场景/退出1只描述当时状态。

## 53fe基线历史记录

2026-10-25，核查生产Core为已修ACC-002的 **53fe0f2d2744e557dab98bf2652ffa5fce644c25**。本轮没有再改该SaveDraft补丁，也没有重复13条token用例；新代码只在本路测试目录。读取时远端7a70978的其他修改入口/Contracts没有新增版本上下文；本次刻意使用53fe中已修的SaveDraft建立后续状态。

真实SQLite、多个LedgerService/独立连接，25个定点场景：**5个用户意图版本风险实证，20项现有防护通过，0个探针异常/防护失败，退出1**。[原始结果](result-53fe.json)。没有执行WPF，下面“展示金额”指实际取得并保留的旧snapshot/行，另静态核对MainWindow的对应调用路径。

## 五个可复现风险，需要Contracts/Desktop协调

这些调用在当前签名下仍是有效命令，Core只能看到当前对象及用户提交的目标值，不能知道表单/确认框开始时的版本。**不是宣称五个现有状态机或金额校验都违反原契约**；问题是用户以旧界面作出的编辑/批准意图无法绑定到同一版本。

| 场景 | 两个真实服务的精确顺序与实际结果 |
|---|---|
| STALE-OPENING-BALANCES | 期初借贷各100，B保留全部旧行；A改成各200；B提交原100集合成功，银行200被覆盖为100，revision2→3。 |
| STALE-ACCOUNT-REACTIVATION | B读取启用现金科目；A停用；B只改旧记录的显示名称，其未改动的IsActive=true被整体写回，科目重新启用。不能从完整Account DTO区分这是有意重新启用还是旧字段。 |
| STALE-DELETE-UPDATED-DRAFT | B读取10元草稿；A用正确v1.1编辑token改20；B按旧选择的Id删除，20元新版本被删除。 |
| STALE-REVIEW-UNSEEN-AMOUNT | B取得10元草稿；A改20；B按旧行Id审核，实际标记20为已审核，B原snapshot仍为10。制单/审核姓名分离正常，但确认版本未绑定。 |
| POST-CONFIRMATION-AMOUNT-MISMATCH | B保留已审核10；A取消审核、用正确token改20、另一个独立审核员审核20；B基于旧行确认10后Post(id)，实际记账20。**20本身有合法独立审核，状态机并未错误记账未审核凭证**；问题是静态核对的UI确认金额来自旧行，与实际提交版本不一致。 |

失败/冲突若已发生，探针会要求整个持久快照（含审计/revision）保持不变；本次这五次操作没有拒绝，而是成功作出了上表变化。没有为了得到反例伪造GUID碰撞、修改存储快照或绕过业务API。创建/编辑草稿只是各风险的合法前置步骤，使用53fe的正确token，未重跑原13条。

### 最小协调建议，不在本目录自行改契约

建议Contracts owner统一决定例如 `LedgerMutationContext(ExpectedBookId, ExpectedRevision)` 的明确上下文，优先用于期初整体保存、科目编辑、草稿删除和审核/记账确认。上下文必须与**用户开始编辑或实际看到的确认数据**来自同一snapshot；Core在自己的同一次Read后核对，随后仍由store CAS提交。不能在保存/点击确认后临时读取新revision来补齐，也不能刷新token自动重试。

科目/期初需保留旧表单的加载版本；删除、审核和记账需绑定实际显示对象/金额的版本。若选择按每凭证/科目版本减少无关冲突，需另行定义，当前全账套revision可作保守首版。返回已接受版本应明确，批处理不可盲用旧版本。新增重载却让用户路径仍可走无token入口，不能解决风险；旧方法的可信调用兼容及fail-closed策略需主协调统一审定。

当前非SaveDraft签名没有上述输入，Core无法从相同的100元集合或完整Account记录判断用户是主动改回还是过期表单；用服务缓存、禁止一切合法期初修改、永远不许重新启用科目、或按字段静默合并都会改变既有合法行为，故本轮不作这些不安全“修复”。**五项风险待接口/接线决定，未关闭。**

## 已有防护：20项实际通过

- **8个真实SQLite CAS间隙**：SaveAccount、DeleteAccount、SetOpeningBalances、DeleteDraft、Review、CancelReview、Post、CloseMonth。ReadHookStore仅在目标真实Read完成后让另一个真实连接成功提交新凭证，再将旧快照交回Core；8个命令都收到StoreConcurrencyException。比较的是**竞争者提交后的完整快照**，确保失败不抹掉竞争者，也不增加本命令审计或改动其他字段；每例再运行CheckIntegrity。
- **8个最新状态检查**：已记账后不能再改期初；单个旧科目余额改回会导致不平衡并被拒；有新增引用的科目不能删除；已记账凭证不能重新审核/取消审核/删除；已取消审核的凭证不能记账；新出现的未记账凭证阻断结账。拒绝前后数据全等。
- **4个普通异账套凭证Id**：Review、CancelReview、Post、DeleteDraft拿另一本自然生成的Id操作目标账套，都因不存在而拒绝，目标完整快照不变。未伪造共享Id。本轮没有实证这些Guid入口能用普通另一账套Id误写。

CloseMonth未复现非法状态提交：当前未记账检查及CAS能阻断新草稿。Post若当前已取消审核也会拒绝。它们与上面的“当前状态合法、但用户确认的是旧金额”是不同证据，不把所有旧选择都笼统报成状态机缺陷。

科目编码/月份/期初行本身没有来源BookId，接口以所调用的service为目标。若调用方把它们送进另一账套service，Core无法还原调用方意图；这属于上下文设计边界，本轮不以人为选择错误service的正常执行结果冒称为跨账套漏洞。统一上下文可同时改善此边界。

## 实际命令与复用

官方SDK10.0.402/runtime10.0.13、Microsoft.Data.Sqlite10.0.13；沿用本项目[VALIDATION.md](../VALIDATION.md)的可写XDG/NuGet环境。锁定restore成功；Release构建0警告0错误：

```bash
dotnet restore tests/Caiwu.Core.Tests/MutationSafetyProbe/MutationSafetyProbe.csproj --locked-mode \
  --source https://api.nuget.org/v3/index.json -p:UseArtifactsOutput=true \
  -p:ArtifactsPath=/tmp/caiwu-adjacent-mutation-artifacts
dotnet build tests/Caiwu.Core.Tests/MutationSafetyProbe/MutationSafetyProbe.csproj --no-restore -c Release \
  -p:TreatWarningsAsErrors=true -m:1 -p:UseArtifactsOutput=true \
  -p:ArtifactsPath=/tmp/caiwu-adjacent-mutation-artifacts
CAIWU_MUTATION_TARGET_COMMIT=53fe0f2d2744e557dab98bf2652ffa5fce644c25 dotnet \
  /tmp/caiwu-adjacent-mutation-artifacts/bin/MutationSafetyProbe/release/MutationSafetyProbe.dll \
  /tmp/caiwu-adjacent-mutation-results.json
```

实际dotnet为 `/tmp/caiwu-dotnet-10/dotnet`；输出路径可不传，省略时写随机临时JSON。环境中的SHA只作来源记录，不影响判定。合成账套自动在临时目录创建并清理。返回1代表存在实证风险或防护测试异常，JSON分别计数，不能把风险接受标成测试全绿。

新增探针的编译隔离也已实际验证，原Core单测 **77/77通过，0失败**；TRX记录完成时间为2026-10-25T08:27:18Z：

```bash
dotnet test tests/Caiwu.Core.Tests/Caiwu.Core.Tests.csproj --no-restore -c Release \
  -p:TreatWarningsAsErrors=true --logger 'trx;LogFileName=core-adjacent-probe-isolation.trx' \
  --results-directory /tmp/caiwu-core-token-fix-results
```

后续修复应原样复跑这些旧输入；若旧输入被拒且持久快照不变，将记录PROTECTED。此独立控制台程序排除在原Core单元测试编译之外，不改生产代码、Contracts、UI或SQLite。未执行多进程压力、Windows真实窗口或发包验收；保持既有分发阻断。

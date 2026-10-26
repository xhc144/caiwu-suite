# 会计扩展：ledger 原版保真第一切片

本项目针对原 `w_zw_fgz`、`w_zw_qxfz`、`w_zw_ydjz` 的业务缺口提供独立适配。底层使用仓库现有单年度 `ILedgerStore`/Core，原 SQL Anywhere 兼容、跨年年初数、全部结转配置及原派生表联动仍未完成；这里没有把旧 0.1.0.4 视为完成基线。

## 可执行接口

`AccountingExtensionService(store, operators, fixedSession)` 由可信组合根创建，不把原 store/Core 暴露给 UI。调用者拥有 store 生命周期，模块不会关闭它。

| 方法 | 实际行为 | 权限与版本 |
|---|---|---|
| `GetSnapshot()` | 返回冻结的当前凭证/科目快照 | 活会话 ReadLedger |
| `ReversePosting(request)` | 所选月份内 Posted → Reviewed，保留凭证、分录、制单人及审核人；每张凭证追加审计；存在范围之后的关联科目凭证时拒绝仅撤销前期 | 活会话 PostVoucher **且** Administrator；原账套 ID/revision |
| `ReopenPeriod(request)` | 撤销同年最近一期或本年所有已结期，止于 StartMonth−1；保留现有开账余额 | 活会话 ClosePeriod **且** Administrator；原账套 ID/revision |
| `PreviewMonthlyTransfer(request)` | 从明确配置的转出末级科目余额计算平衡计划，包含开账余额及截至月末已过账余额；后期有相关科目凭证时拒绝倒序生成 | 活会话 PrepareVoucher；原账套 ID/revision |
| `GenerateMonthlyTransfer(request)` | 重新计算计划并调用真实 Core.SaveDraft；生成月底草稿，分配真实凭证号与审计 | 同上；Core 再验证同一 token，并执行一次 CAS Write |

反操作各只读一次快照、执行一次事务 Write，同时提交状态、revision 和审计；失败不重试。结转计算和 Core 保存有两次读取，两次都使用原 token：期间的竞争写入被拒绝，不刷新 token、不自动覆盖。草稿没有自动审核/过账。当前月或更早有未过账凭证会拒绝生成；已生成未过账草稿因此阻止重复生成，已过账后余额清零则拒绝空凭证。无后期依赖时，新增交易产生的剩余余额可重新计划增量。没有声称这些规则替代原版结转批次及重新生成策略。

倒序结转采用保守策略：转出或转入科目在目标月之后有任何凭证（包括普通凭证、Draft、Reviewed、Posted），均拒绝生成前期结转；不能只凭“转”字或摘要猜哪些凭证会再次过账。未来仅涉及无关科目的凭证仍允许。反过账也检查范围之后的关联科目凭证，避免保留后期结转而只撤销其前期来源。没有自动作废或改写后期凭证；基础合成测试通过有权限的反过账→反审核→删除旧后期结转，再按月重算，确认新后期只转剩余余额。原版完整的受控失效/重算协议仍待集成。

上述 legacy 变更只适用于没有 `ParityModuleCommit.*` 共享模块事件的现有基础账套。出现这类事件后会明确拒绝逆操作及 legacy 结转，不能把模块来源状态或维度余额留在旧状态。共享逆操作 API 尚未提供，见下节缺口。

结转设置必须明确给出代码、版本、摘要、凭证字、转出科目清单及转入科目；不猜制度科目号。仅支持全额余额结转。比例、转出类型编码、多规则顺序、来源凭证标记及重生成仍需集成。

```csharp
// shown 来自打开窗口时用户所见的同一个 GetSnapshot()。
var shown = extensions.GetSnapshot();
var context = new LedgerMutationContext(shown.Book.Id, shown.Revision);
extensions.ReversePosting(new(shown.Book.FiscalYear, fromMonth, throughMonth, false, context));
```

遇到 `StoreConcurrencyException` 应保留输入、提示重新加载并核对。不能只刷新 context 后重试。操作员服务在整个同步命令内持有身份锁；注销、到期、停用、角色变化使旧会话失效。审计身份来自活会话 ActorKey，没有 UI 姓名参数。暂行管理员加现有权限是保守守卫，**不是原 b_rights 菜单授权已还原**；独立权限需求见交接。

## 辅助、外币、数量数据契约

`ExtendedAccountingData.cs` 定义分录、科目标志、辅助维度、原币/汇率、数量/单价/单位、结算/票号、年初/账前发生额和自动年初数来源。数值采用 nullable decimal 区分未录与零；`OriginalFieldValue` 另保留 SQL 类型和原数值文本，容纳 decimal 无法表示的原 double、精度和未知列。它是数据传输模型，**不是原表读取器、DDL 或已接通的扩展持久化**。

`LegacyLineAdapter` 只接受无稳定 LineId、无任何扩展字段、连续原行序的明确基础分录。有扩展即拒绝，甚至显式空维度/零数量也不默默丢掉。完整导入必须由原表适配器检验各模板变体，并把扩展与账务一起事务保存；禁止旁文件两阶段写入。

## 模块窗口与宿主对接

独立项目 `Wpf/Caiwu.AccountingExtensions.Wpf.csproj` 提供 `AccountingDialogs.ShowReversePosting(owner, extensions)` 与 `ShowReopenPeriod(owner, extensions)`。宿主应接到原系统管理菜单相应位置；本任务没有改 Desktop/MainWindow 或主菜单。对话框确定调用真实业务，成功才关闭；取消不写入；冲突/权限/存储错误保持输入和旧 token。没有月度结转假界面或未实现按钮。

两个窗口用原 JSON 的 PBU 数值作为抽象 Canvas 坐标，再由 Viewbox 缩放，保留已知位置比例、按钮文字及左右关系；没有声称固定 PBU→DIP 倍率、字体或物理窗口尺寸等价。原提示占位改为简短说明；反结账显示真实所撤销月份。三产品的这两个窗口几何一致已静态核对，原字体、DPI、键盘行为和模态交互须 Windows 原生验收。

## 验证与交接

```sh
tools/dotnet-local.sh test tests/Caiwu.AccountingExtensions.Tests/Caiwu.AccountingExtensions.Tests.csproj -c Release
tools/dotnet-local.sh build src/Caiwu.AccountingExtensions/Wpf/Caiwu.AccountingExtensions.Wpf.csproj -c Release
python -m unittest discover -s tests/Caiwu.AccountingExtensions.Tests -p 'test_*.py' -v
```

测试只创建随机临时目录的合成账套及身份。SQLite 集成包含独立重开回读和审计触发器故障回滚；不访问真实账套、不运行原程序。合成测试、静态布局比较、交叉编译和 Windows 验收分别记录。

精确持久化扩展、原窗口证据、文件所有权、SHA、验证及全部未实现项见 [ledger 交接](../../docs/parity-handoffs/ledger.md)。

## PR52 公共接口适配（独立项目）

`Parity/Caiwu.AccountingExtensions.Parity.csproj` 需要 PR52 契约 `5bb60d24b9c60c9eecfcc5adc37bced4688adf85` 或集成后的兼容版本；没有更改本分支的共享 Contracts。基础项目与测试排除此目录，在原基线上仍可编译。适配器已在该固定契约的独立组合工作树中编译和以契约替身测试，**不是公共 Core/SQLite 已接通的证明**。

`ParityAccountingAdapter` 使用真实会话守卫：

- `GetSnapshot` 返回公共 `ModuleLedgerSnapshot`；计算与提交使用原 context，不从预览对象直接接受可篡改分录。
- `AcceptMonthlyTransfer` 将月底损益分录和规则/来源版本文档一起放入 `VoucherProposal`，调用一次公共 `AcceptVoucherProposal`。来源键按账套/年月/规则代码稳定，规则版本变化不换来源键。后期来源认领即使凭证删除也阻断前期生成，且不按规则代码过滤；已有前期认领对应凭证缺失、未过账、反过账或改期时，禁止继续生成后期凭证。未知来源格式明确拒绝。没有静默失效或自动重新认领；需受控 API 撤销/重算，不能另换月份、规则代码或来源键绕过。
- `SaveRawReferenceDocument` 只保存 `reference/` 前缀的未关联参考数据，PayloadJson 逐字转交 `SaveModuleDocuments`，保留未知列、极小数和 null；需要 Accountant 的 EditAccounts 权限。它不生成或更新凭证，不声称参考数据已经入账。
- 在公共快照没有维度余额能力时，只允许无其他扩展文档的明确基础金额账套结转；发现参考/其他模块文档即拒绝，等待核心提供可验证的维度能力与原子结转。保守拒绝不会把辅助、外币、数量压掉。
- 注册仅包含三产品两个已有真实 WPF handler 的反操作原窗口；注册本身不授权或激活菜单，宿主只能在基础账套能力匹配时绑定。月度结转原选择/设置窗口未完成，未注册假入口。

公共接口仍缺：按凭证/期间的原子反过账、反结账和来源模块状态回滚；维度余额能力与生成分录扩展的同事务验证；原菜单独立权限；结转撤销/重新生成；已接入扩展数据的凭证编辑/删除生命周期守卫。共享 Core 的直接回溯 SaveDraft/Post 等入口也须统一检查后期结转依赖，模块不能拦截绕开本 adapter 的原始 Core 调用。精确建议已反馈在交接文件。

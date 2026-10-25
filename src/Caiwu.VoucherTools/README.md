# 整张凭证复制为新草稿

`net10.0` 独立模块。生产模块只引用现有 `Caiwu.Contracts`；合成集成测试引用现有 `Caiwu.Core`。没有数据库、WPF、外部应用、默认账务值或自动保存依赖。

## 已有能力核对及复用

核对了最新 `codex/windows-revalidation` 的 `6a4683955267306f8eb9544635560d214b5921f9`。现有 F7 是上一行摘要复制及配平，现有 `VoucherEditorWindow` 没有整张凭证复制入口。本模块复用 `VoucherDraft` 与 `LedgerService.SaveDraft` 的新建能力，不另建凭证状态机、编号器或持久化实现。

契约为 v1.2：`bb76658c19df94ab79e257db076d2ac8a39b7997`，Core 实现为 `66621203066488c7e7a4115ede508e88ec58e3fa`。开发基线 `b2f59e3c93c7b97e64c17feb9b77d0b71da2b964` 的 Contracts/Core 与该实现提交无差异。旧 Core README 中“新建可无 token”的 v1.1 描述已过时，本模块始终带上两个原快照字段。

## 调用契约

```csharp
IVoucherCopyPlanner planner = new VoucherCopyPlanner();
VoucherCopyResult result = planner.Plan(displayedSnapshot, selectedVoucherId,
    new VoucherCopyOptions(explicitDate, explicitKind, explicitNumber,
        explicitAttachmentCount, explicitPreparedBy));
```

- `displayedSnapshot` 必须是绑定当前列表、供用户选择源凭证的同一份 `LedgerSnapshot`，不在点击复制时重新取快照。仅传选中 ID，模块在此快照内查找源数据，不能传入另一本账的凭证对象。
- 日期、凭证字、正整数编号、非负附件张数、本次制单人全部由用户明确确认；可明确选择与源相同的值，但日期/字/号组合必须可用。不推断当前日期、下一编号、旧制单人或附件数量。
- 成功时 `result.Plan.Draft.Id == null`，`ExpectedBookId/ExpectedRevision` 原样来自选择快照。Core 在宿主保存时产生全新 ID、状态 `Draft`、`ReviewedBy=null`。计划没有审核/记账身份字段；`SourceVoucherId` 仅用于来源显示。
- 所有行保持原顺序、重复次数、科目代码、摘要和 decimal 值，逐行创建独立记录和只读集合。既不合并重复行，也不舍入、配平、替换科目或跳过全零行。金额的另一侧为零是正常的；借贷都为零会明确报错。
- `Issues` 提供稳定错误码、中文消息和从 1 开始的 `LineNumber`。任何问题都使 `Plan=null`。不存在/停用/非末级科目按源行反馈；无效/已结账目标期间直接反馈，不自动改日期。已结账的源期间可以复制到用户指定的开放期间。
- 为保证摘要原文，空摘要、控制字符、首尾空格会阻断而不自动修剪。制单人按 Core 的 Unicode FormKC 规则在保存时标准化；身份认证与权限由宿主负责。
- 这是基于用户所见快照的预检。Core 保存时仍是最终权威：跨账套、过期快照、并发竞争、当时无效的科目/期间/编号均由 Core/store 拒绝。保留旧输入供核对，不能临保存补读/刷新 token 后自动重试。
- 取消意味着宿主丢弃计划，不调用 `SaveDraft`；计划器没有 store/service 引用，无写入或审计副作用。

## WPF 宿主接入示例

以下是宿主事件处理的调用结构；`ShowExplicitCopyOptionsDialog`、`ShowCopyPreview`、`ShowCopyError` 和 `RenderLedger` 为 UI owner 实现的显示函数。选项对话框应有空的必填字段与明确确认动作；字段解析失败时停留原窗。预览显示 `plan.Draft` 的全部行及 `plan.PreparedBy`，状态标为“新草稿（未保存）”，只在独立保存按钮中写入。

```csharp
using Caiwu.Contracts;
using Caiwu.VoucherTools;

private readonly IVoucherCopyPlanner _copyPlanner = new VoucherCopyPlanner();
private LedgerSnapshot? _displayedSnapshot; // RenderLedger 时与列表同时赋值
private VoucherCopyPlan? _pendingCopy;
private bool _copySaving;

private void CopySelected_Click(object sender, RoutedEventArgs e)
{
    if (_copySaving || _pendingCopy is not null) return;
    if (_displayedSnapshot is not { } shown || VoucherGrid.SelectedItem is not Voucher selected) return;
    // shown 是该列表已显示的快照；此处不调用 GetSnapshot。
    VoucherCopyOptions? explicitOptions = ShowExplicitCopyOptionsDialog();
    if (explicitOptions is null) return; // 取消：没有计划或保存
    var result = _copyPlanner.Plan(shown, selected.Id, explicitOptions);
    if (result.Plan is not { } plan)
    {
        ShowCopyError(string.Join(Environment.NewLine, result.Issues.Select(i => i.Message)));
        return;
    }
    _pendingCopy = plan;
    ShowCopyPreview(plan); // 只读预览；用户可返回明确修改选项，再对同一 shown 生成计划
}

private void SaveCopy_Click(object sender, RoutedEventArgs e)
{
    if (_copySaving || _pendingCopy is not { } plan) return;
    _copySaving = true;
    try
    {
        // _ledger 是当前宿主的 ILedgerService。账套若已切换，由 Core 拒绝。
        var saved = _ledger.SaveDraft(plan.Draft, plan.PreparedBy);
        _pendingCopy = null; // 成功后立即消费，防止双击重复保存
        _displayedSnapshot = _ledger.GetSnapshot(); // 仅成功后刷新显示
        RenderLedger(_displayedSnapshot, saved.Id);
    }
    catch (StoreConcurrencyException ex)
    {
        ShowCopyError(ex.Message); // 保留 plan/input；重新加载核对后重新选择和确认
    }
    catch (LedgerValidationException ex)
    {
        ShowCopyError(ex.Message); // 保存失败时保持预览窗和用户输入
    }
    finally { _copySaving = false; }
}

private void CancelCopy_Click(object sender, RoutedEventArgs e)
{
    if (!_copySaving) _pendingCopy = null; // 关闭预览；无数据调用
}
```

宿主应沿用既有 `SaveError.Message` 处理 SQLite busy 和意外系统异常，并记录故障；上例只展开本模块相关的业务/并发反馈。保存成功后的显示刷新若失败，应提示“已保存，显示刷新失败”，不能重新消费旧计划。

## 给 Acceptance/UI owner 的最小接入建议

1. 在 `codex/windows-revalidation` 先集成上述 Contracts/Core v1.2，再 cherry-pick 本模块提交。新建项目未擅自加入根 solution；给 Desktop 加本项目的 `ProjectReference`，并把测试项目加入既有 CI/solution。
2. 列表显示时持有同一 `LedgerSnapshot`，从其中选中源 ID；添加“复制为新草稿”命令、明确选项窗和只读确认预览，按上例调用计划器。
3. 现有 `VoucherEditorWindow` 的原构造器以 `_original?.Id` 保存且号码来自原凭证，不能把复制内容伪装成原 `Voucher` 填入。可增加接收 `VoucherCopyPlan` 的新建草稿入口，或使用独立确认预览；新入口明确使用 `plan.Draft` 的空 ID、显式编号和原 token。若允许编辑分录，编辑器应只编辑分离副本，并保留两个原 token。
4. 取消、窗口关闭、账套切换和保存错误均保持账套不被意外写入；用户重新选择/确认后才生成新计划。Windows 上实际点击、键盘、双击和取消交互由 Acceptance owner 验证，本模块没有声称完成实机验收。

以上跨目录改动只列建议。本次仅新增 `src/Caiwu.VoucherTools/**` 与 `tests/Caiwu.VoucherTools.Tests/**`。

# WPF 整张凭证复制对话框

实际窗口为 `VoucherCopyWindow.xaml/.xaml.cs`，独立 `net10.0-windows` + WPF 项目，只引用纯 `Caiwu.VoucherTools`。纯 net10.0 工具项目没有引入 WPF，窗口没有 LedgerService、store 或保存回调。

## 可直接调用的入口

```csharp
var dialog = new VoucherCopyWindow(
    displayedSnapshot,        // 当前列表已显示的同一份 LedgerSnapshot
    selectedVoucher.Id,        // 从该快照列表选中的源凭证 ID
    currentPreparedBy)         // 宿主明确传入的当前制单人，绝不从源凭证取值
{ Owner = this };

VoucherCopyPlan? plan = dialog.ShowDialog() == true ? dialog.Plan : null;
if (plan is null) return;      // 取消按钮、Esc 或关闭窗口，没有保存
// 把 plan 交给宿主的未保存草稿工作区；窗口本身不保存。
```

日期、类型、编号、附件数初始为空，需要明确输入。日期使用完整 `yyyy-MM-dd`，不推断省略的年/月/日；整数不接受小数、千位分隔、负数或溢出。本次制单人为宿主传入身份的只读显示。原凭证身份和状态与新草稿标识分别显示，不继承审核人或记账身份。

确认通过实际纯计划器预检后关闭并返回 Plan；所有字段解析、重号、期间及源分录错误都显示在窗口内，保留全部输入，焦点移到首个错误字段。修正后可在同一窗口再次确认。失效科目等分录问题显示准确行号；不会自动删除、替换或配平分录。分录表只读且禁止排序，保留重复行的原序；摘要与金额提供完整工具提示，金额列可横向滚动查看。

`Plan.Draft.Id=null`，两个 token 从构造时的显示快照保留。窗口打开后其他页面若更改账套，确认仍不会刷新 token；宿主保存时收到 Core 的 `StoreConcurrencyException` 后保留输入并重新加载核对。窗口通过 `Ctrl+Enter` 确认，`Esc` 取消，确认后忽略第二次确认事件。

## 最小菜单接入示例（由 Desktop owner 执行）

给 Desktop 项目添加对 `Caiwu.VoucherTools.Wpf.csproj` 的 ProjectReference。现有列表项实际为 `VoucherListRow`，操作员入口为 `OperatorName()`；下例使用它们，不能把列表项直接强转成 Voucher。

Desktop owner 在现有 `QueryVouchers` 中用同一局部 `shown` 建立列表并保留它，不在复制事件里调用 GetSnapshot：

```csharp
private LedgerSnapshot? _voucherDisplayedSnapshot;
private VoucherCopyPlan? _pendingCopy;
private bool _copySaving;
// QueryVouchers 的列表来源：
var shown = Snapshot;
// 原有筛选改为 shown.Vouchers，随后赋值 VoucherGrid.ItemsSource；
_voucherDisplayedSnapshot = shown;
```

在既有“实务操作”菜单加一项，沿用宿主 WriteOperation 门控：

```xml
<MenuItem Header="复制为新草稿…" Click="CopyVoucher_Click" Tag="WriteOperation" />
```

```csharp
private void CopyVoucher_Click(object sender, RoutedEventArgs e) => Run(() =>
{
    if (!CanWriteBook) throw new LedgerValidationException("当前账套不允许新增草稿。");
    var shown = _voucherDisplayedSnapshot ?? throw new LedgerValidationException("请先显示凭证列表。");
    if (VoucherGrid.SelectedItem is not VoucherListRow row)
        throw new LedgerValidationException("请选择源凭证。");
    var dialog = new VoucherCopyWindow(shown, row.Value.Id, OperatorName()) { Owner = this };
    if (dialog.ShowDialog() != true || dialog.Plan is not { } plan) return;
    _pendingCopy = plan;
    // 在宿主已有工作区显示 plan.Draft，等待用户点击该工作区的“保存”。
    // 不把 Draft 包装成有原 Id 的 Voucher 传给旧编辑构造器。
}, discardOpening: true);
```

宿主保存按钮的唯一写入点：

```csharp
if (_pendingCopy is not { } plan || _copySaving) return;
_copySaving = true;
try
{
    var saved = Service.SaveDraft(plan.Draft, plan.PreparedBy);
    _pendingCopy = null; // 保存成功先消费，随后再刷新显示；防重复保存
    // 刷新失败应明确提示“已保存，显示刷新失败”，不能再次保存旧计划。
}
catch (StoreConcurrencyException ex) { NotificationText.Text = ex.Message; } // 保留计划，核对后重新选择
catch (LedgerValidationException ex) { NotificationText.Text = ex.Message; } // 保留计划和输入
finally { _copySaving = false; }
```

SQLite busy、意外系统错误和保存后刷新失败继续沿用宿主现有错误处理。本模块没有修改 MainWindow、现有编辑器、Contracts、Core、SQLite、solution 或 CI。真正的未保存草稿工作区接入由 Acceptance owner 完成。

## 主题与 fallback

控件继承 Application 的隐式样式，不设置 DataGrid 全局样式或重写控件模板。Application 没有隐式 Button 样式时，窗口局部加载 .NET 10 的内置 Fluent 资源，独立调用也有现代控件外观。

视觉任务可在创建窗口前提供以下全局 Brush 资源；已存在资源优先，没有时使用轻量浅色 fallback。命名均限本窗口，不覆盖现有全局主题：

| 资源键 | 用途 |
| --- | --- |
| `Caiwu.Copy.Background` | 页面背景 |
| `Caiwu.Copy.Foreground` | 主要文字 |
| `Caiwu.Copy.Surface` | 源凭证卡片及制单人底色 |
| `Caiwu.Copy.Border` | 卡片和表格边线 |
| `Caiwu.Copy.Muted` | 次要文字 |
| `Caiwu.Copy.Error` | 留窗错误提示 |

## 构建与验证

```sh
dotnet build src/Caiwu.VoucherTools.Wpf/Caiwu.VoucherTools.Wpf.csproj -c Release -warnaserror
dotnet test tests/Caiwu.VoucherTools.Wpf.Tests/Logic/Caiwu.VoucherTools.Wpf.Logic.Tests.csproj -c Release
```

Linux 执行窗口实际使用的字段解析源码测试；不能运行 WPF 控件。Windows 实际控件脚本：

```powershell
pwsh -File tests/Caiwu.VoucherTools.Wpf.Tests/Windows/run.ps1
```

脚本运行 12 个实际模态窗口探针，输出带 checkout SHA 的 JSON、日志和 PNG。包括留窗、纠错后确认、取消/关闭、Esc 路由、主题继承、预览列宽、计划返回、宿主唯一保存和过期 token。Click/Key 是发给实际 WPF 窗口的路由事件，不宣称验证了原生鼠标、IME 或物理快捷键输入。当前容器仅交叉编译该脚本所属项目，Windows 实际运行尚未执行，交 Acceptance 在 Windows 上运行并检查 PNG。

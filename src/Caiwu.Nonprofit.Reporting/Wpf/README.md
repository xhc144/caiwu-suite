# 独立民非分类校验面板

`Caiwu.Nonprofit.Reporting.Wpf.csproj`是独立 `net10.0-windows` WPF类库，入口 `NonprofitClassificationPanel : UserControl`。它没有App/MainWindow，不设置主题、全局样式或框架，继承宿主资源。未修改Desktop、Contracts、Core或SQLite。

根只需引用此WPF子项目，在既有菜单/对话框入口放入控件：

```csharp
using Caiwu.Nonprofit.Reporting;
using Caiwu.Nonprofit.Reporting.Wpf;

var snapshot = ledgerService.GetSnapshot();
var period = new ReportingPeriod(new(snapshot.Book.FiscalYear, 6, 1),
    new(snapshot.Book.FiscalYear, 6, 30), ReportingPeriodKind.Monthly);
var panel = new NonprofitClassificationPanel(
    ledgerService.GetSnapshot, period, hostChosenUserDataDirectory);
var window = new Window {
    Title = "民非报表分类与校验", Content = panel,
    Width = 1400, Height = 900, Owner = hostWindow
};
window.ShowDialog();
```

宿主负责账套生命周期和数据目录；`readSnapshot`应每次返回已保存快照，不能返回过期缓存。控件不拥有或释放传入账套，也不执行账务写入。若宿主需要无窗口使用，可直接操作基础库的 `ClassificationEditorSession`及数据源API。

操作页依次为：科目语义、分录分类、余额事实、组成明细、复核声明、已知未覆盖事项、校验清单和两表预览。科目/凭证身份、原摘要、借贷金额只读；用户明确选择科目语义、业务角色、类别及依据，程序不依据名称或摘要猜测。界面枚举和余额事实使用中文说明。

- 余额对方行与普通非限定损益支持对所选分录明确批量设置；不会自动补限制或业务事实。
- 所选余额事实可由用户明确确认为零，须先填写复核依据；真实未归属余额仍会阻断。
- 有据分析金额只用于受托货币子集、到期及对应到期减值；可推导的基础余额必须按末级科目取数。
- “校验并预览”显示逐项missing并保留空值，可展示有用部分；两表完整计算和勾稽通过仍标为预览。
- “另存新分类JSON”仅写宿主用户目录的新文件，不覆盖旧文件；导入检查来源绑定和内容。
- 选中相应预览页后导出当前表CSV/HTML。分类编辑后必须重算；来源变更后禁用保存/导出并要求重新读取和分类。
- JSON保存目录和“不在主账套备份中”的提示一直可见。HTML由宿主打开后打印，控件不自动导航或打印。

公共 `Editor`用于读取编辑缓冲；`Calculate()`、`SaveClassification(fileName)`、`ImportClassification(fileName)`供宿主接入或Windows探针调用。控件按钮会把数据/IO校验异常显示在状态和问题列表；公共方法则抛给调用方处理。程序化填充Editor后应重新Calculate或通过导入触发重新绑定；用户单元格编辑直接双向更新缓冲。

Linux交叉构建：

```sh
dotnet build src/Caiwu.Nonprofit.Reporting/Wpf/Caiwu.Nonprofit.Reporting.Wpf.csproj \
  -c Release -p:TreatWarningsAsErrors=true
```

专用Windows探针位于 `tests/Caiwu.Nonprofit.Reporting.Tests/WpfProbe/`，包含实际WPF窗口、真实DataGrid枚举单元格编辑、分类→预览→JSON往返、来源改变后界面提示和禁用导出、绑定错误检查，并可保存合成窗口PNG。根可在现有授权Windows验证中运行：

```powershell
dotnet run --project tests/Caiwu.Nonprofit.Reporting.Tests/WpfProbe/Caiwu.Nonprofit.Reporting.WpfProbe.csproj `
  -c Release -- "$env:TEMP\caiwu-nonprofit-wpf-$(Get-Date -Format yyyyMMddHHmmss)"
```

当前Linux环境已交叉构建控件和探针，未执行Windows探针或真实打印；不能把构建成功当作UI实机通过。root只需把上面命令加入自己的Windows验证，不需要本模块抢改workflow或Desktop入口。

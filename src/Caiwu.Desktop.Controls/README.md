# 可注入的 WPF 科目/摘要选择器

基于 `codex/windows-mvp@34f065b` 新增独立工程，所有变更仅在本控件与对应测试目录，不改 Desktop、Contracts、Core、solution 或安装包。主协调添加项目引用并绑定入口即可。

工程双目标：`net10.0` 提供纯选择逻辑和自有 DTO；`net10.0-windows` 另外提供真实 WPF 模态窗口。生产工程仅引用 Contracts，无第三方包。使用宿主 .NET10 SDK、框架和系统字体，测试固定官方 NuGet 版本及锁文件。

## 证据与设计边界

已读取 `docs/reference-ui/README.md`、`pages.json`，对应稳定页面：

| page-id | 手册证据 | 本控件入口 |
| --- | --- | --- |
| `reference.account-picker` | 轻松2006手册文字：科目栏 F4、双击选择、代码/名称查找；弹窗图未目视 | `AccountPickerDialog` / `SelectionDialogs.PickAccount` |
| `reference.summaries` | 轻松2006手册图：摘要分类、预设摘要、双击摘要 | `SummaryPickerDialog` / `SelectionDialogs.PickSummary` |

原软件运行状态为 `not_observed_wine32_load_failure`；这些证据不是2026实际外观。此实现保留已知操作约定，采用自有紧凑 DataGrid、代码/名称列、蓝色选择态、现代字体与圆角按钮，不声称逐像素复刻。未下载截图包、原软件或安装器；未使用商用图片，不重试 Chromium。

窗口使用 DIP 尺寸、`UseLayoutRounding`、`SnapsToDevicePixels`、可调整大小、Microsoft YaHei UI/Segoe UI 字体及滚动布局。科目列表行高32、摘要列表行高36，支持键盘与鼠标；高DPI/字体替换的实际视觉验收仍须 Windows 执行。控件继承宿主进程的 DPI 感知；smoke 清单启用 PerMonitorV2。

## 宿主接入

在主协调拥有的 Desktop 项目中增加引用（本任务没有修改其 csproj）：

```xml
<ProjectReference Include="../Caiwu.Desktop.Controls/Caiwu.Desktop.Controls.csproj" />
```

命名空间 `Caiwu.Desktop.Controls`。helper 必须在 Owner 的 UI 线程调用，并传已显示的 Owner。它设置模态 Owner、返回只读选择结果，并恢复传入或原来的键盘焦点：

```csharp
using Caiwu.Desktop.Controls;

// availableAccounts 为宿主注入的 IReadOnlyList<Caiwu.Contracts.Account>。
// 仅在“科目输入框/科目列”响应 F4，不能抢走凭证列表 F4 审核快捷键。
var picked = SelectionDialogs.PickAccount(this, availableAccounts,
    initialAccountCode: accountCodeBox.Text, focusAfterClose: accountCodeBox);
if (picked.Accepted)
{
    accountCodeBox.Text = picked.Value!.Code;
    accountNameBox.Text = picked.Value.Name;
}

// 宿主在摘要框 MouseDoubleClick 处理器中调用；不预先清空现有手写摘要。
// summaryItems 是宿主提供的完整条目列表，不是本库内置持久化服务。
var summary = SelectionDialogs.PickSummary(this, summaryItems,
    focusAfterClose: summaryBox);
if (summary.Accepted) summaryBox.Text = summary.Value!.Text;
```

取消/Esc/窗口关闭返回 `Accepted=false, Value=null`，不会修改输入 Account、条目集合、编辑行或现有文字。高亮和搜索也不会提交，宿主只在 Accepted 时写入。可选 `initialItemId` 是摘要条目标识，不是当前手写文字，不要猜测它们相等。

也可直接实例化模态窗口：

```csharp
var dialog = new AccountPickerDialog(availableAccounts, currentCode) { Owner = this };
if (dialog.ShowDialog() == true && dialog.SelectedAccount is { } account)
    ApplyAccount(account);
// 直接构造窗口时，由宿主恢复原编辑框焦点；helper 已包含此步骤。

var summaries = new SummaryPickerDialog(summaryItems, initialItemId) { Owner = this };
if (summaries.ShowDialog() == true && summaries.SelectedSummary is { } selected)
    ApplySummary(selected.Text);
```

helper 在关闭后用 Dispatcher 的 Input 优先级恢复同一 Owner 中仍加载、可见、启用、可聚焦的 UIElement。若宿主在返回时重建/虚拟化回收了原编辑器，本库跳过失效目标，宿主应定位新单元格后自行聚焦。没有自动保存、提交整行、移动账务焦点或创建 LedgerService 的行为。

## 选择规则、错误与输入法

科目源按完整父子关系取快照，只允许启用的末级科目，且所有上级也必须启用；父科目、停用项显示原因，可高亮查看而不能确认。代码/名称搜索支持空格 AND 条件、Unicode 兼容归一化及不区分大小写，返回值始终是原代码/原名称。树保留匹配项的祖先；列表和树是同一选择状态。“仅可选明细”过滤时仍保留树上的导航父节点。

↑/↓ 跳过不可选行并在边界停住；Enter 仅确认当前有效选择；Esc 取消。双击只对真实数据行/树项生效，不接受列头或空白区的双击。中文输入组合期间不把 Enter、Esc、↑/↓ 当窗口命令；组合完成事件即使已被文本框处理，也会解除保护。Windows smoke 包含组合事件路由检查；这不代替真实中文 IME 候选词人工测试。

空科目源显示“暂无可选科目”；无匹配显示搜索提示。重复代码、空代码/名称、缺上级、循环、超过64层等无效目录显示错误并禁止确认。即使注入数据错误地标记了“启用子科目/停用父科目”，也不会选中。金额、期间与账务状态不由选择器修改或校验。

摘要支持独立分类与内容搜索、完整预览、↑/↓/Enter/Esc；分类列表有焦点时 ↑/↓ 保持原生分类导航。实际类别叫“全部分类”也不会与“全部”过滤器冲突。来源为空、标识重复或内容/分类缺失都有明确状态。选中摘要返回完整原文（含Unicode/换行），不截断为列表预览。

`SummaryLibraryItem(Id, Category, Text)` 是自有注入 DTO。可选 `ISummaryLibrarySource.GetItems()` 只定义宿主读源接口，本库不提供其持久化实现、编辑/删除、假数据或数据库。读源失败应由宿主先显示错误；控件不执行 I/O 或吞掉宿主异常。

纯 `AccountPickerState` / `SummaryPickerState` 的 `VisibleItems`、`TreeItems`、`SelectedItem`、`CanAccept`、`StatusText`、`LoadError` 可供测试或其他视图复用。`SetQuery`、`Select`、`MoveSelection`、`AcceptSelection`、`CancelSelection` 不依赖 WPF，基础测试只编译 net10.0 目标，不依赖 Core/SQLite/Desktop。

## 已运行验证及 Windows CI

已在 Linux 使用官方 .NET SDK10.0.402、官方 NuGet 固定版本/锁文件运行：纯逻辑14项通过，0失败/跳过；控件双目标与 Windows smoke Release 交叉编译通过，警告视为错误，0警告/错误。覆盖 active 末级、父/子停用、树祖先、Unicode/全角搜索、组合条件、键盘方向边界、取消不改原值、错误目录、摘要分类/原文返回及10000科目检索。

```sh
dotnet restore tests/Caiwu.Desktop.Controls.Tests/Caiwu.Desktop.Controls.Tests.csproj --configfile tests/Caiwu.Desktop.Controls.Tests/NuGet.Config --locked-mode
dotnet test tests/Caiwu.Desktop.Controls.Tests/Caiwu.Desktop.Controls.Tests.csproj --no-restore -c Release -p:TreatWarningsAsErrors=true
dotnet build src/Caiwu.Desktop.Controls/Caiwu.Desktop.Controls.csproj --no-restore -c Release -p:TreatWarningsAsErrors=true
```

Windows CI 用 `pwsh` 运行（由主协调加入其 workflow，本任务没有改 workflow）：

```powershell
./tests/Caiwu.Desktop.Controls.Tests/Run-WindowsSmoke.ps1 -Artifacts "$PWD/artifacts/reference-dialogs"
```

smoke 是真实 STA WPF 程序：显示 Owner 和两个实际 ShowDialog 窗口，检查搜索/列表/树选择、停用项不可确认、键盘路由、组合输入保护、摘要分类/完整预览、取消保持原值、空源/错误源及 helper 焦点恢复，失败退出非零；每窗保存 RenderTargetBitmap PNG 与 `smoke.json`（检查数、渲染尺寸和DPI）。数据全部为合成，不调用原软件、浏览器、后台服务或账务模块。它使用 WPF 路由输入事件，不能冒称真实硬件键盘/IME、原软件相似度或打印验收。

当前容器是 Linux，**尚未实际运行 Windows smoke、取得其渲染图或人工验收高DPI/真实IME**；交叉编译成功只证明编译，不证明这些运行结果。无其他阻塞。

# 按账套隔离的摘要库

`Caiwu.Summaries` 是 .NET 10 独立库，提供真实 JSON 持久化、分类与摘要管理、搜索、选择状态、备份校验与恢复。没有 Core、Contracts、Controls、SQLite、账号或权限依赖。只处理自写或用户录入的摘要，不含原软件资产或示例生产数据。

## 宿主创建与打开

宿主显式提供用户数据根、账套 ID 和该账套唯一的绝对 JSON 路径。例如使用 Delivery 注入的 `CAIWU_DATA_ROOT`，或由宿主配置的用户数据目录。不要使用当前工作目录、安装目录或可执行文件目录。库检查路径边界，拒绝应用程序目录和路径上的符号链接/重解析点；用户数据根必须由宿主管理，不能是文件系统根。此库不创建或更改目录 ACL。

```csharp
using Caiwu.Summaries;

// dataRoot 来自宿主的用户数据设置；book.Id 来自当前打开的账套。
var location = new SummaryCatalogLocation(dataRoot,
    Path.Combine(dataRoot, "summaries", book.Id.ToString("D"), "catalog.json"), book.Id);

// 仅在用户明确新建摘要库时调用；即使原文件损坏，Create 也拒绝覆盖。
ISummaryCatalog catalog = JsonSummaryCatalog.Create(location);

// 已登记的库：缺文件、坏文件、未知 schema、账套不符均报错，不能自动 Create 空库。
catalog = JsonSummaryCatalog.Open(location);
var snapshot = catalog.Read();
snapshot = catalog.AddCategory("日常费用", snapshot.Version);
var category = snapshot.Categories.Single();
snapshot = catalog.AddSummary(category.Id, "支付办公用品费", snapshot.Version);
var entry = snapshot.Entries.Single();
snapshot = catalog.UpdateSummary(entry.Id, category.Id, "支付本月办公用品费", snapshot.Version);
var found = snapshot.Search("费用 办公", category.Id);
```

宿主应登记 `(BookId, CatalogPath)`，打开时比对 ID，切换账套后重新建立服务/状态实例。不同账套不共享同一文件。服务不缓存可写快照；每次修改都重新读取磁盘。读出的集合只读、DTO 不可变；`ISummaryCatalog` 可用于宿主注入。

分类名称去首尾空白，长度 1–100；摘要去首尾空白，长度 1–4000，保留内部换行和制表符。纯空白及其他控制字符被拒绝。名称比较使用 Unicode FormKC 与不区分大小写的规范键：分类全库唯一，摘要文本同分类内唯一，不同分类可有同文摘要。显示仍保留原输入文字。搜索按空白分词，所有词都要在分类名称或正文中匹配，支持中文、全角与大小写；无结果返回空集合，不回退到旧选择。

分类与条目均有稳定 Guid；改名、改文或移动分类保留条目 ID。删除分类要求分类为空；没有级联删除。先显式移动或删除摘要，再删除分类。删除库本身、账套复制/迁移与跨账套合并不在此 API 内。

## 并发、原子保存与错误

JSON schema 为 `1`，修订号从 `0` 开始，每次成功修改递增。`CatalogVersion(CatalogId, Revision, Sha256)` 必须来自该窗口加载的快照，原样传回；版本在跨进程独占 `.lock` 之内比较，不相符抛 `SummaryConflictException`，不可自动重试覆盖。文件即使只改内容而不改修订号，SHA256 也能识别。刷新后让用户核对自己的修改，再尝试保存。

同目录临时文件使用 `CreateNew`，完整写入并 `Flush(true)` 后单次重命名替换。写入或发布失败时不提交半个 JSON；已存在文件不会被截断。读句柄允许重命名，因此读者看到完整旧快照或新快照。`.lock` 文件持久保留，锁随句柄释放；不要删除它来解除冲突。进程崩溃遗留的 `.summary-*.tmp` 不参与读取或恢复。备份只复制验证过的正式 JSON，不复制临时文件或锁。

本机制面向本机文件系统及全部通过本服务写入的窗口/进程；不提供网络盘并发保证，也不把账务 SQLite 和摘要 JSON 声称为单一事务。文件刷盘与原子重命名不等同于所有设备的断电持久性保证。

- `SummaryValidationException`：空白、重复、分类非空、账套不符、校验失败等。
- `SummaryCorruptException`：无效 JSON、缺字段、重复字段、未知版本、重复 ID、悬空引用等；保留坏文件并引导检查备份。
- `SummaryConflictException`：加载后的内容/版本已变，刷新并核对。
- `SummaryBusyException`：锁被占用或锁文件不可用，稍后重试；内部异常保留诊断原因。
- `IOException` / `UnauthorizedAccessException`：实际文件系统错误，不伪装成功。

每文件最大 16 MiB、10000 分类、50000 摘要；未知字段与版本均拒绝写入，避免新版本数据被旧代码丢弃。

## 可直接调用的 WPF 管理窗口

可选项目 `Wpf/Caiwu.Summaries.Wpf.csproj` 提供真正调用上述持久服务的 `SummaryManagerWindow` 和 `SummaryManagementDialogs.ShowManager`，无需 Controls。标准 WPF 控件继承宿主全局主题；库不引入自带控件模板或覆盖宿主主题。窗口包含分类新增/改名/删除、摘要新增/编辑/移动分类/删除、搜索、完整预览与选择返回，显示当前账套名称及 ID。

```xml
<!-- 由 Desktop owner 加到其项目，不是本分支擅改宿主。 -->
<ProjectReference Include="../Caiwu.Summaries/Wpf/Caiwu.Summaries.Wpf.csproj" />
```

```csharp
using Caiwu.Summaries.Wpf;

// 工具菜单“摘要库管理与选择…”的宿主 Click 处理器。
// catalog 已明确绑定当前 book.Id 与用户数据路径。
var picked = SummaryManagementDialogs.ShowManager(this, catalog, book.Name,
    initialSummaryId: currentSummaryId, focusAfterClose: summaryBox);
if (picked.Accepted)
{
    summaryBox.Text = picked.Value!.Text;
    currentSummaryId = picked.Value.Id; // 此入口使用 Guid?；旧 Controls DTO 的 ID 为规范字符串。
}
```

新增/编辑先进入草稿面板，只有点击“保存更改”才落盘；删除先展示目标，再点击“确认删除并保存”。取消编辑、取消选择或标题栏关闭都不写未保存草稿；此前已经明确保存的更改仍保留。存在待保存编辑时禁止选择和重新载入，防止把草稿误认为已经选择/保存。取消选择不修改宿主原分录，窗口也不会替宿主保存凭证。

`SummaryManagerState` 是独立于 WPF 的可测编辑状态：每次开始编辑捕获当时的 `CatalogVersion`，`Save()` 不读取新版本来替换它。验证失败、锁冲突、写失败与版本冲突均保留正文、目标分类、编辑 ID 和捕获版本；不偷偷刷新再覆盖。版本冲突后可先复制仍保留的输入，显式取消编辑、重新载入并核对，再开始新编辑。损坏文件错误不会被取消操作隐藏或重建为空库。

窗口的服务与 BookId 在构造后固定，不能在窗口内切账套。宿主切账时应关闭旧窗口，并用新账套对应的 `JsonSummaryCatalog` 重新调用。菜单挂接与账套生命周期仍由主 UI owner 负责。

独立可运行宿主在 `tests/Caiwu.Summaries.Tests/WindowsHost`：包含标准工具菜单、摘要框与调用按钮，首次在 `%LOCALAPPDATA%/Caiwu/SummaryManagerDemo` 创建固定合成账套的独立摘要库，以后打开真实 JSON；坏文件会报错，绝不重建。这个宿主不依赖 Desktop、Controls、Contracts 或账务数据库，不把界面中的文字当作已保存凭证。

```powershell
# Windows，安装 SDK 10.0.402；在仓库根运行。
dotnet restore tests/Caiwu.Summaries.Tests/WindowsHost/Caiwu.Summaries.WindowsHost.csproj --locked-mode
dotnet run --project tests/Caiwu.Summaries.Tests/WindowsHost/Caiwu.Summaries.WindowsHost.csproj --no-restore -c Release

# 实际启动 WPF 窗口的回归：失败退出非零，输出 smoke.json 与真实渲染 PNG。
./tests/Caiwu.Summaries.Tests/Run-WindowsSmoke.ps1 -Artifacts "$PWD/artifacts/summary-manager"
```

回归驱动实际模态窗口及控件事件，检查真实持久调用、未确认编辑关闭/取消、搜索无结果、稳定 ID、非空分类删除拒绝、删除确认、两窗口版本冲突保留输入、Windows 目标文件持锁导致实际重命名失败及重试、损坏输入错误、选择返回、宿主文本/焦点与新账套重新绑定。所有内容为合成。当前 Linux 环境仅完成交叉编译，**未运行该 Windows 回归或查看其 PNG**；脚本不是实际 Windows 验收结果。

## 兼容现有 Controls 选择器与自建视图

已核对 `codex/reference-dialogs` 的 `bf75d563a325fa257c9097740dbcd0caa2e0b000`：`SelectionDialogs.PickSummary` 输入为 `IEnumerable<SummaryLibraryItem>`，DTO 为 `(string Id, string Category, string Text)`。显式 adapter 不引入反向依赖：

```csharp
using Caiwu.Desktop.Controls;
using Caiwu.Summaries;

// 在 Owner 的 UI 线程调用。先成功读库，失败时显示错误，不能以空列表替代错误。
var items = catalog.Read().ToPickerItems(
    (id, category, text) => new SummaryLibraryItem(id, category, text));
var result = SelectionDialogs.PickSummary(this, items,
    initialItemId: currentSummaryId, focusAfterClose: summaryBox);
if (result.Accepted)
{
    summaryBox.Text = result.Value!.Text;
    currentSummaryId = result.Value.Id;
}
```

调用前不清空原摘要；取消、Esc、关闭、搜索、高亮都不会修改原分录或保存凭证。只有确认分支赋值，凭证持久化仍由宿主原有保存流程负责。手写摘要没有库 ID 时传 `null`，不要按文本猜 ID。可编译的完整桥接示例在 `tests/Caiwu.Summaries.Tests/ControlsAdapterSmoke/SummaryPickerIntegration.cs`，它不替宿主注册事件。

自建管理视图可绑定 `SummaryCatalogState : INotifyPropertyChanged`：

```csharp
var state = new SummaryCatalogState(catalog); // 在 UI 线程使用。
if (!state.Refresh()) ShowError(state.ErrorMessage);
DataContext = state;
// ItemsSource: Categories / VisibleEntries
// TextBox.Text: Query（UpdateSourceTrigger=PropertyChanged）
// SelectedValue: CategoryId / SelectedId（列表 SelectedValuePath=Id）
// 按钮 IsEnabled: CanAccept；状态栏: StatusText。
// 管理按钮调用 AddCategory / RenameCategory / DeleteCategory /
// AddSummary / UpdateSummary / DeleteSummary，返回 bool 表示成功。
```

状态公开 `Snapshot`、`Status`、`ErrorMessage`、`CanAccept`、`SelectedEntry` 等。首次为 `NotLoaded`；错误保留上次快照供核对，禁用确认和修改，直到 `Refresh()` 成功；不会显示“已保存”。查询改变后不再可见的选择会清除，恢复查询也不会自动确认。`AcceptSelection()` 返回选择，`CancelSelection()` 返回空取消结果，均无 I/O、不修改分录。

API 为同步，16 MiB 是上限而非 UI 延迟承诺。库状态必须在 WPF Dispatcher 线程操作；宿主若把大文件服务调用放到后台，应自行管理忙状态，并把结果/新状态派回 UI 线程。现成管理窗口使用同步的小型摘要库操作；没有改 Desktop 组合根。

## 导出、备份、恢复与 Delivery 登记

```csharp
// 路径仍需在 dataRoot 内。已存在的导出目标也拒绝覆盖。
var receipt = catalog.ExportBackup(Path.Combine(dataRoot, ".delivery-backups", runId, "summaries.json"));
// 宿主把 receipt 的 BookId / CatalogId / Revision / Sha256 / Path 登记到自己的备份清单。
catalog.ValidateBackup(receipt.Path, receipt.Sha256);

// 明确的新路径；账套 ID 必须一致。保留原分类/条目 ID、库 ID、修订号和精确字节。
var newLocation = new SummaryCatalogLocation(dataRoot,
    Path.Combine(dataRoot, "recovered", book.Id.ToString("D"), "catalog.json"), book.Id);
var restored = JsonSummaryCatalog.RestoreBackup(receipt.Path, receipt.Sha256, newLocation);
// 再由宿主核验并登记/切换 CatalogPath；库不会自动切换或覆盖原目标。
```

恢复必须传入原备份登记的 SHA256，先校验结构、账套、摘要关系和哈希，再创建新目标；任何已存在目标一律拒绝。`ValidateBackup(path)` 不带哈希可作结构检查，不能据此证明来源可信；恢复仍须提供独立登记哈希。备份选择单次完整快照，不承诺与另一个账务文件同时点一致。跨用户数据根迁移需由宿主明确复制备份与登记，再从目标数据根恢复。

已读取 Delivery `ef17e64` 的 `Installation` 与 `UpgradeSafety`。当前 `managed-books.json` / `ManagedBooks.DatabasePaths` **只接受 `.caiwu` SQLite 文件**，不得把 JSON 塞进该字段或伪装成 `.caiwu`。宿主/Delivery owner 的最小接入建议：

1. 在其拥有的数据登记中增加独立摘要附件清单，记录 `BookId`、相对用户数据根的 `CatalogPath`、schema `1`；不改变账套 SQLite schema。若尚无文件，登记“未创建”，打开失败不能自动标为空库。
2. 取得现有安装/数据租约、暂停宿主编辑后，对每个已登记库调用 `ExportBackup`，把返回的库 ID、修订和 SHA256 写入整体备份收据；账务与摘要全部成功后才标整体备份完成。
3. 恢复时保持租约、调用本 API 恢复到新的摘要路径，结合账套恢复结果核验同一 BookId；全部成功后由宿主显式更新登记。任一失败不覆盖原库，不把半份恢复标为完成。
4. 升级/卸载继续保留整个用户数据根与摘要 JSON/备份；不能把它们列为安装 payload、清理项或用缺省空文件覆盖。新增 JSON schema 迁移需在副本上显式验证，不能解除现有 managed-data 升级门控。

这些是接口与接入说明，本分支未修改 Delivery、Controls、Desktop、Contracts 或其权限、SQLite schema；整体备份登记与宿主菜单接线仍由对应 owner 完成。

## 构建与验证

```sh
tools/dotnet-local.sh restore tests/Caiwu.Summaries.Tests/Caiwu.Summaries.Tests.csproj --locked-mode
tools/dotnet-local.sh test tests/Caiwu.Summaries.Tests/Caiwu.Summaries.Tests.csproj --no-restore -c Release -p:TreatWarningsAsErrors=true
tools/dotnet-local.sh build src/Caiwu.Summaries/Wpf/Caiwu.Summaries.Wpf.csproj -c Release -p:TreatWarningsAsErrors=true
tools/dotnet-local.sh build tests/Caiwu.Summaries.Tests/WindowsSmoke/Caiwu.Summaries.WindowsSmoke.csproj -c Release -p:TreatWarningsAsErrors=true

# 合入 Controls bf75d563 后，可使用默认相邻项目路径编译真实 API 桥接：
tools/dotnet-local.sh build tests/Caiwu.Summaries.Tests/ControlsAdapterSmoke/ControlsAdapterSmoke.csproj -c Release -p:TreatWarningsAsErrors=true
```

主集成需在自己拥有的 Desktop csproj 增加 `../Caiwu.Summaries/Caiwu.Summaries.csproj` 引用，在 solution/CI 加入摘要项目及测试；本任务没有越界修改这些文件。精确验证证据与剩余项见 [VALIDATION.md](VALIDATION.md)。

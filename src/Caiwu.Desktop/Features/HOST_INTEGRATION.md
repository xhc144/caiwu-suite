# 新功能桌面接入交接

本改动只新增 `Features/**`、`MainWindow.Features.cs` 和 `tests/Caiwu.Desktop.FeatureTests/**`。主窗口行为及视觉 owner 仍独占原 `.xaml/.xaml.cs`、App、Theme、项目引用和 workflow。未接触书库、原安装包、真实账套或新派生 catalog。

## 根需要应用的最小接线

基线实际读取的是 `codex/sprint-integration-2` 的 `5e21ac3`，10:00 UTC 再取到 `b3b85eb` 并核对主窗口/会话接口未变。字段为 `_session`、`_displayOrigin`、`_voucherOrigin`、`Snapshot`、`VoucherGrid`、`OperatorName()`；列表项为 `VoucherListRow.Value`。没有假定新的宿主接口。partial 与当前 MainWindow 已实际组合编译。

先采用作者生产模块：

| 模块 | 本轮实际验证的源码版本 | 说明 |
| --- | --- | --- |
| VoucherTools / WPF | `54871a004a836d76824b2c29959e5b22139f4e86` | 含 `dab8681` 及真实复制对话框 |
| Summaries | `dcda051a0c9ee364ccff4c2b4c7085f446fac39d` | 含 `649df9e`、管理状态机、query 修复 |
| BookTools / WPF | `8bbf8428ccd0b656fec83c7a1ede828cd5691442` | 包含 `86a10e6`、失败回归 `eb8f150` 和 P1 修复；不可回退旧发布代码 |
| Costing / WPF | `af0d0e34ab9963fc91cabb8a58aed558b34390f0` | 若已有 `398ed4a`，只补 `1d0ff00`、`af0d0e3` |

Desktop owner 在现有 `Caiwu.Desktop.csproj` 加四个引用（本分支没有越权改它）：

```xml
<ProjectReference Include="../Caiwu.VoucherTools.Wpf/Caiwu.VoucherTools.Wpf.csproj" />
<ProjectReference Include="../Caiwu.Summaries/Caiwu.Summaries.csproj" />
<ProjectReference Include="../Caiwu.Costing/Wpf/Caiwu.Costing.Wpf.csproj" />
<ProjectReference Include="../Caiwu.BookTools/Wpf/Caiwu.BookTools.Wpf.csproj" />
```

在 MainWindow 构造函数 `_session` 赋值之后，加一处明确的初始化调用；不需改 XAML 菜单或 App：

```csharp
InitializeDesktopFeatures(new Caiwu.Desktop.Features.DesktopFeatureOptions());
```

这会在“实务操作”追加复制凭证、成本工作表，在“会计档案”追加摘要管理、复制账套。凭证选中且账套可写才启用复制。默认摘要/账套复制保留明确的 disabled reason，不把缺配置伪装成可用操作。不能仅拣选此 partial 而不收作者模块/补引用；验证脚本会在临时 checkout 应用上述引用，不触碰本分支的 owner 文件。

## 复制凭证

从列表原 `_voucherOrigin` 和同一 `Snapshot` 捕获 `FeatureSessionBinding`，不调用 Refresh/GetSnapshot 来更新待提交 token。作者的 `VoucherCopyWindow` 只返回 `VoucherCopyPlan`；宿主 `CopiedDraftWindow` 显示可编辑的新 Draft，日期/类别/编号/附件数及所有原分录可核对。只有“保存新草稿”调用捕获的 `ILedgerService.SaveDraft`，后台执行，传原 `ExpectedBookId/ExpectedRevision`，`Id=null`、当前制单身份，不能继承原审核/记账身份。

取消/关闭没有隐含写入。验证错误、SQLite 错误和冲突保留当前字段。原计划成功后先消费再刷新；刷新失败明确提示“已保存，显示刷新失败”，不会再次保存该计划。保存期间禁止关闭，避免用户取消时仍有未知后台提交。未实现自动审核或自动记账。

## 摘要路径、版本与备份附件

宿主只有在**已经完成独立附件登记**后，才提供 `OpenSummaryCatalog`。回调在 worker 执行，返回 `SummaryFeatureRegistration`：已经打开的 `ISummaryCatalog`、宿主清单中的附件 key、实际备份策略说明。不能用随便填一个 key 代替真正登记；当前 Delivery 的 `managed-books.json` 只接收 `.caiwu`，不得塞入 JSON 或放宽升级保护。

```csharp
// ownerCatalogLocation 与 registeredAttachmentKey 必须来自宿主自己的登记。
// 工厂按 binding.DatabasePath + binding.Shown.Book.Id 查找该物理账套的映射；
// 恢复同 BookId 到新文件时，不能仅按 BookId 猜用旧副本的摘要路径。
OpenSummaryCatalog = binding => new SummaryFeatureRegistration(
    JsonSummaryCatalog.Open(ownerCatalogLocation),
    registeredAttachmentKey,
    "说明宿主真实的独立摘要备份/恢复登记策略")
```

用户数据根和 catalog 绝对路径由宿主明确决定，禁止安装目录。工厂只读打开既有库；打开失败不能自动重建为空库。新建摘要库应由宿主单独的明确初始化操作调用 `JsonSummaryCatalog.Create`，并登记后再开放菜单。备份应在宿主现有租约/忙态中调用 `ExportBackup`，登记 `Path/BookId/CatalogId/Revision/Sha256`；恢复到新的明确路径，核验登记哈希和同一 BookId 后才更新映射。账套备份成功不能冒称摘要附件也已备份。

界面复用作者 `SummaryManagerState`，不是另一套摘要规则。`AsyncSummaryStateAdapter` 只把 catalog I/O 放到 worker，原状态机的开始编辑、版本保留、保存结果及属性通知都回 UI context；不在后台直接修改 WPF 状态。保存保留开始编辑时的条目/分类 ID 与 CatalogVersion，搜索改变当前选择也不会改写编辑对象。取消只丢弃未保存编辑；已经显式保存的分类/摘要保留。窗口提供管理，不把选择隐式填入凭证；F7 选择器接入仍归原 Controls/编辑器 owner。

**剩余宿主工作：**真实的摘要附件清单、整体备份/恢复登记尚在本任务目录之外，因此默认禁用。这是明确的集成门槛，没有权限拒绝或不确定的远端操作。

## 复制账套的三项强制宿主配置

仅在根认可的 `8bbf842` 上配置 `BookCopyFeatureOptions`，三个委托缺一不可：

```csharp
BookCopy = new BookCopyFeatureOptions(
    AcquireDataLease: binding => /* 取得并返回宿主真实 Delivery 数据租约 */,
    ValidateManagedDestination: (binding, path) => /* 验证受管数据根与全新目标 */,
    RegisterCreatedBook: (binding, result) => /* 在仍持租约时登记新账套 */)
```

这些注释是 owner 必须实现的接点，不是可提交的假委托或默认绕过。三个委托在 worker 运行，不能操作 WPF 对象；接入 Operators 后还须捕获并重验原 OperatorSession 的宿主复制/登记权限，不用新的全局登录对象替换它。租约贯穿窗口预览、明确确认、执行、结果登记；源和捕获副本固定调用现有 `LedgerFilePolicy.Validate`，目标策略在实际服务规定的两处复验。窗口固定原显示快照，所谓重新预览也只返回原快照，不临时刷新 token；来源变化应关闭重开。会话更换时窗口失效，服务策略回调也再次拒绝旧会话。宿主把 BookTools 原有的操作人文本框锁成只读，始终使用打开窗口时的 actor。

复制成功默认仍停在源账套，不调用 `_session.Open(newPath)`。文件已发布但登记失败时保留新文件并明确报告其路径，不能删除副本或提示用户盲目重复复制。**Windows 并发发布和真实数据租约尚未运行验证**，默认门控保持；不能以 Unix P1 闭合替代 Windows 验收。

## 成本工作表

直接承载作者真实的 `CostWorksheetPage(bookId, date)`，bookId 和期间来自宿主已显示快照。只计算、导入/导出人工审核工作表和凭证建议，没有 `ILedgerService` 保存/记账回调。会话切换、关闭、同 BookId 副本恢复或宿主刷新至不同来源修订时，窗口整体失效，原输入仍可见。作者页面现有计算和本地导入/导出实现保持原样，超大工作表的 UI 延迟没有测量；本任务不能宣称所有规模下均无卡顿。

## Operators 生命周期预留

已读取 `7a1e67318194c14ebad865e5d412fbdd72f9f734` 的实际 README。集中授权 `ILedgerService` adapter 尚待作者交付，当前测试是合成业务调用，不是全应用身份验收。不要把旧 `OperatorName()` 的自由文本视为认证。

最小组合根顺序：宿主在安装目录之外创建一个稳定 `LocalOperatorService`；首次设置后仍须显式 `OperatorDialogs.Login`；取消不创建可写账务会话。登录成功后由作者授权 adapter 包装原 ledger service，backend 仅向 UI 暴露该受守卫服务，捕获本次 `OperatorSession`；`OperatorName()` 改由可信授权上下文返回 ActorKey，顶栏仅显示 DisplayName 并禁用任意姓名输入。旧自由姓名不自动映射为新 actor。

注销/换人时先 `Logout(oldOperatorSession)`，然后 `_session.Close()` 并清理宿主当前显示 origin，再开始新登录；新身份若重新打开原账套，必须走 `_session.Open` 生成新 generation。这样本 partial 已捕获的旧服务/原 OperatorSession 不能被新身份替换，旧复制草稿、摘要、账套复制、成本窗口立即失效并保留输入。取消新登录保持未登录，不回退旧身份。若根希望注销后保持账套只读，应由主入口 owner 另建明确的只读路径，不能复用旧可写会话。不要在保存时从全局变量临取新 OperatorSession。

作者的同步 `Execute*` 持身份锁；先完成窗口采集，再在 worker 内同步调用集中授权 ledger adapter，不传 async 授权回调，不在身份锁内弹窗。本任务不抢改 App、OperatorInput 或原 Core；集中 adapter 到达后根只需在现有组合根接线，四功能不需要各自复制权限判断。

## 验证与限制

`tests/Caiwu.Desktop.FeatureTests/validate-combination.sh` 从当前提交和四个固定作者 SHA 建临时组合，补上四个引用，实际编译 Desktop、运行真实 SQLite 的合成服务探针、交叉编译 Windows 窗口探针。临时 checkout 保留证据，不改另一个 owner 的源文件。SDK 为官方 10.0.402，已核对仓库 SDK SHA512。

在 owner 已合并引用的真实 Windows checkout：

```powershell
pwsh -File tests/Caiwu.Desktop.FeatureTests/Windows/run.ps1
```

脚本有 90 秒进程 watchdog，真实显示 WPF 模态窗口、走实际 Routed Button.Click、真实 Core/SQLite/摘要文件并产出带 checkout SHA 的 JSON 和 WPF PNG。覆盖菜单位置/禁用原因、取消无写入、复制错误留窗及更正保存、同身份重开/恢复旧窗口失效、摘要后台 I/O 与 Dispatcher 状态通知、摘要冲突/无效 Unicode、成本建议不记账，以及 BookTools 真窗口取消/明确确认复制后保持源会话。它不声称物理鼠标、键盘、中文 IME、多 DPI 或原生屏幕截图验收。本轮仅 Linux 交叉编译，**Windows 窗口未执行**。

初次同时启动两个共享输出目录的 build/run 导致 `GenerateDepsFile` 文件占用失败；已改为顺序执行并成功。不是生产源码失败，也没有删测试或放宽错误。

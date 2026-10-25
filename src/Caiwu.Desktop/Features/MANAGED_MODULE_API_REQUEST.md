# 给受管数据 owner 的最小接点

Desktop 当前实际入口位于 `MainWindow.Features.cs`；`DesktopFeatureOptions` 是唯一配置点。根新分派的 `codex/managed-module-data` 负责真实 Delivery 数据锁、路径、账套/附件登记和整体备份恢复；Desktop 不另造登记文件，也不复制 internal `WithExclusiveData`。

## 账套复制：当前三个精确委托

```csharp
new BookCopyFeatureOptions(
    Func<FeatureSessionBinding, IDisposable> AcquireDataLease,
    Action<FeatureSessionBinding, string> ValidateManagedDestination,
    Action<FeatureSessionBinding, Caiwu.BookTools.BookCopyResult> RegisterCreatedBook)
```

三个委托均在 worker 运行。Acquire 在显示 BookCopyWindow 之前调用，必须失败关闭：核对受管安装与 data owner/manifest/current 收据、源 physical path 确实登记且 BookId 对应，并同时持有真实安装/数据租约；返回 IDisposable 在整个预览、明确确认、复制、登记结束后才释放。不要只返回 public `Installation.AcquireLease` 的安装锁。

Validate 在执行开始和最终发布前由真实 BookTools 调用，目标必须是同一已验证 data root 下的新 `.caiwu`，不在备份/安装/未知链接目录，不能预建、覆盖或删除目标。Register 在文件已完成发布后、仍持租约时登记 `result.DestinationPath / result.Book.Id / result.Revision`；失败时 Desktop 明确报告“副本已创建、登记失败”，保留路径且不自动重试，不切换当前账套。

最小的 Delivery 公共对象可以是一个受管 scope：`DataRoot`、`ValidateNewBookDestination(path)`、`RegisterCreatedBook(path, bookId)` 和 `Dispose`；Acquire 必须验证 `binding.DatabasePath` 与 `binding.Shown.Book.Id`，不能从新快照替换 UI 原 revision。具体类/方法名由 Delivery owner 决定，只要能落实上述三个委托即可。若 scope 不能在 worker 与 UI 模态生命周期间安全持有，需明确约束；不能依赖线程归属的未说明锁。

Desktop 保证同一窗口仅有一个 featureOpening；root 应为每个 MainWindow 创建独立配置闭包，不能让两个主窗口共享可变“当前 lease”。若需要把当前 scope 显式作为后两委托参数，可通知根做一个窄签名调整，不增加全局注册器。

## 摘要：目录与附件登记

```csharp
Func<FeatureSessionBinding, SummaryFeatureRegistration> OpenSummaryCatalog
// 返回：已有 ISummaryCatalog、真实 BackupAttachmentKey、BackupPolicyDescription、ManagementPermission
```

工厂先按 **physical source path + BookId** 解析已登记的 catalog 绝对路径及用户数据根，再 `JsonSummaryCatalog.Open`；不能仅按 BookId 共用同身份恢复副本的目录。注册必须包含独立 attachment kind/schema=1，相对受管根路径、所属 BookId、physical book path。没有文件/登记时明确报未初始化，不能在取消打开时默建空库；新建需要独立的明确确认操作。

整体备份在同一受管租约里对账套和登记附件都成功后才写 complete 收据。摘要调用 `ExportBackup`，收据保留 `BookId/CatalogId/Revision/Sha256/Path`；恢复核验独立登记 hash，调用 RestoreBackup 到全新的 catalog 路径，全部成功后更新新 physical book path 的映射。失败保留原账套、原附件和已产生的可恢复副本，不能把半套结果标完成。

App 全局身份库在 `LocalApplicationData/CaiwuSuite/Operators`。它不是某一本账套附件；恢复单本账套不得覆盖、回滚或重建 operators.json。全局身份备份与书本附件备份须分开处理。

## 其他 JSON

民非 `cb71350` 分类面板现已接入“报表”菜单，仅民非制度启用；App 显式提供用户预览目录，窗口持续标记“仅本地预览，未纳入受管附件/备份”。它保存带源绑定/哈希的 classification JSON，不能改标为“已保护”，除非 Delivery owner 实际登记并备份。后续 Designer 也是独立 kind/schema，不得把 JSON 塞进仅收 `.caiwu` 的 managed-books 清单。

当前 App 的摘要管理和账套复制仍因上述真实配置缺失而禁用；这不是权限拒绝，也没有不确定的后台发布。该 owner 预计晚于本阶段 11:00 交接，Desktop 不等待它无限续长。

using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Caiwu.Costing;
using Caiwu.Costing.Wpf;
using Caiwu.Desktop.Features;
using Caiwu.Delivery;
using Caiwu.Operators;
using Microsoft.Win32;

namespace Caiwu.Desktop;

public partial class MainWindow
{
    private string CaptureReportContext() => JsonSerializer.Serialize(new { Page = Pages.SelectedIndex,
        VoucherFrom = VoucherFrom.SelectedDate, VoucherTo = VoucherTo.SelectedDate, TrialFrom = TrialFrom.SelectedDate, TrialTo = TrialTo.SelectedDate,
        LedgerFrom = LedgerFrom.SelectedDate, LedgerTo = LedgerTo.SelectedDate, Account = LedgerAccountInput.SelectedValue as string,
        Search = VoucherSearch.Text, Status = VoucherStatusInput.SelectedIndex });

    private void AddManagedCostSave(SessionFeatureWindow window, CostWorksheetPage page, FeatureSessionBinding binding, ManagedFeatureContext managed)
    {
        var toolbar = new WrapPanel(); DockPanel.SetDock(toolbar, Dock.Top); window.BodyForFeature().Children.Add(toolbar);
        var save = new Button { Content = "保存并登记受管审核工作表" }; toolbar.Children.Add(save);
        window.StatusForFeature().Text = "此按钮保存并登记 JSON 后才纳入完整备份；页面普通导出是本地输出，不能自动记账。";
        var busy = false;
        window.Closing += (_, e) => { if (busy) e.Cancel = true; };
        save.Click += async (_, _) =>
        {
            if (busy) return;
            try
            {
                foreach (var grid in ManagedVisuals(page).OfType<DataGrid>())
                    if (!grid.CommitEdit(DataGridEditingUnit.Cell, true) || !grid.CommitEdit(DataGridEditingUnit.Row, true)) throw new InvalidOperationException("请先修正工作表当前单元格。");
                if (!page.Editor.CanExport) throw new InvalidOperationException("请先计算或重新计算工作表。");
                var input = page.Editor.GetCalculatedInput();
                busy = true; window.BodyForFeature().IsEnabled = false;
                await binding.DemandPermissionAsync(OperatorPermission.PrepareVoucher);
                var path = await Task.Run(() =>
                {
                    using var lease = managed.Data.AcquireOperationLease();
                    var directory = managed.ModuleDirectory(binding, "Costing");
                    var target = Path.Combine(directory, "worksheet-" + Guid.NewGuid().ToString("N") + ".json");
                    CostWorksheetExport.SaveNewJson(target, input);
                    try { managed.RegisterModuleFiles(binding, "Costing", "cost-worksheet-v1"); }
                    catch (Exception ex) { throw new IOException("工作表已保存并保留，但登记失败：" + target, ex); }
                    return target;
                });
                window.StatusForFeature().Text = "已保存并登记，纳入完整备份：" + path + "；未写账或记账。";
            }
            catch (Exception ex) { window.StatusForFeature().Text = "操作未完成，输入/已保存文件保留：" + ex.Message; }
            finally { busy = false; window.BodyForFeature().IsEnabled = binding.IsCurrent; }
        };
    }
    private static IEnumerable<DependencyObject> ManagedVisuals(DependencyObject root)
    { yield return root; for (var i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++) foreach (var child in ManagedVisuals(VisualTreeHelper.GetChild(root, i))) yield return child; }

    private async Task ManagedBackupAsync()
    {
        if (featureOpening || managedFeatureContext is not { } managed) return;
        try
        {
            var binding = CaptureDisplayedFeature(_displayOrigin);
            if (MessageBox.Show(this, "建立包含当前账套与全部登记模块附件的完整备份？全局操作员另行管理员备份。", "受管完整备份",
                MessageBoxButton.YesNo, MessageBoxImage.Question, MessageBoxResult.No) != MessageBoxResult.Yes) return;
            featureOpening = true; await binding.DemandPermissionAsync(OperatorPermission.BackupLedger);
            var receipt = await Task.Run(() => binding.Authentication.Operators.Execute(binding.Authentication.Session, OperatorPermission.BackupLedger, _ =>
            {
                binding.DemandCurrent(); using var lease = managed.Data.AcquireOperationLease();
                var book = managed.Data.FindBook(binding.DatabasePath, binding.Shown.Book.Id);
                var backup = managed.Modules.BookBackups.Backup(book);
                if (backup.Manifest.IncludesGlobalIdentities) throw new InvalidDataException("单本账套备份不能包含全局身份。");
                var directory = SafePaths.Child(managed.Data.DataRoot, "Global/BackupReceipts"); Directory.CreateDirectory(directory);
                var target = SafePaths.Child(directory, Guid.NewGuid().ToString("N") + ".json");
                using var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                JsonSerializer.Serialize(output, new TrustedBookBackupReceipt(1, backup.Directory, backup.ManifestSha256, backup.Manifest.BookId)); output.Flush(true);
                return target;
            }));
            NotificationText.Text = "完整备份及独立可信哈希收据已保存：" + receipt + "；未包含全局操作员。";
        }
        catch (Exception ex) { NotificationText.Text = "完整备份未完成，源账套和已有附件保留：" + ex.Message; }
        finally { featureOpening = false; }
    }

    private async Task ManagedRestoreAsync()
    {
        if (featureOpening || managedFeatureContext is not { } managed) return;
        try
        {
            if (!ConfirmDiscardOpening()) return;
            var auth = featureAuthentication ?? throw new InvalidOperationException("请先登录。");
            var directory = SafePaths.Child(managed.Data.DataRoot, "Global/BackupReceipts");
            var dialog = new OpenFileDialog { Title = "选择本机受管完整备份的可信哈希收据", InitialDirectory = directory, Filter = "备份收据 JSON|*.json", CheckFileExists = true };
            if (dialog.ShowDialog(this) != true) return;
            var selected = SafePaths.Full(dialog.FileName);
            if (!string.Equals(Path.GetDirectoryName(selected), directory, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("仅接受本机受管收据目录；陌生备份不能自算哈希当作可信来源。");
            if (MessageBox.Show(this, "恢复到新的物理账套实例并打开？原账套、附件、活动全局账号均保持不变。", "完整恢复",
                MessageBoxButton.YesNo, MessageBoxImage.Question, MessageBoxResult.No) != MessageBoxResult.Yes) return;
            featureOpening = true;
            var result = await Task.Run(() => auth.Operators.Execute(auth.Session, OperatorPermission.RestoreLedger, _ =>
            {
                using var lease = managed.Data.AcquireOperationLease();
                if (new FileInfo(selected).Length > 32768) throw new InvalidDataException("备份收据过大。");
                var options = new JsonSerializerOptions { UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow, AllowDuplicateProperties = false, RespectRequiredConstructorParameters = true };
                var receipt = JsonSerializer.Deserialize<TrustedBookBackupReceipt>(File.ReadAllText(selected), options) ?? throw new InvalidDataException("收据为空。");
                if (receipt.Version != 1 || receipt.BookId == Guid.Empty || receipt.ManifestSha256.Length != 64 || !receipt.ManifestSha256.All(Uri.IsHexDigit) ||
                    !SafePaths.Contains(SafePaths.Child(managed.Data.DataRoot, ".delivery-backups"), SafePaths.Full(receipt.Directory))) throw new InvalidDataException("受管备份收据无效。");
                var restored = managed.Modules.BookBackups.Restore(receipt.Directory, receipt.ManifestSha256);
                if (restored.Book.BookId != receipt.BookId) throw new InvalidDataException("恢复结果与可信收据的 BookId 不符。");
                return restored;
            }));
            _session!.Open(result.DatabasePath); _openingDirty = false; BookOpened();
            NotificationText.Text = "账套与登记附件已恢复到新实例并打开；全局操作员未恢复或覆盖。";
        }
        catch (Exception ex) { NotificationText.Text = "完整恢复未完成；原件及已发布副本保留，请核对：" + ex.Message; }
        finally { featureOpening = false; }
    }
    private sealed record TrustedBookBackupReceipt(int Version, string Directory, string ManifestSha256, Guid BookId);
}

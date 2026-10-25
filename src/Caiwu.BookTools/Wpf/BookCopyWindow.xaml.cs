using System.ComponentModel;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using Caiwu.Contracts;
using Microsoft.Win32;

namespace Caiwu.BookTools.Wpf;

/// <summary>Standalone dialog; does not switch or dispose LedgerSession.</summary>
public partial class BookCopyWindow : Window
{
    private readonly BookCopyWorkflow workflow;
    private readonly CancellationTokenSource cancellation = new();

    public BookCopyWindow(BookCopyService service, LedgerSnapshot persistedSnapshot,
        string sourcePath, string operatorName, Func<LedgerSnapshot>? refreshSnapshot = null)
    {
        workflow = new(service, persistedSnapshot, sourcePath, refreshSnapshot) { OperatorName = operatorName };
        InitializeComponent();
        DataContext = workflow;
        SourceText.Text = $"{persistedSnapshot.Book.Name} / {persistedSnapshot.Book.Id:D} / revision {persistedSnapshot.Revision}\n{sourcePath}";
        workflow.PropertyChanged += Workflow_Changed;
        Closed += (_, _) => { workflow.PropertyChanged -= Workflow_Changed; cancellation.Dispose(); };
    }

    public BookCopyResult? Result => workflow.Result;

    private void Workflow_Changed(object? sender, PropertyChangedEventArgs e)
    {
        Confirmation.IsEnabled = workflow.Plan is not null && !workflow.IsBusy;
        ExecuteButton.IsEnabled = workflow.Plan is not null && workflow.Confirmed && !workflow.IsBusy;
        if (workflow.Plan is null && !workflow.IsBusy && !workflow.IsCompleted) PreviewText.Text = "输入改变后，请重新生成预览。";
    }

    private void Browse_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new SaveFileDialog { Filter = "财务账套|*.caiwu", DefaultExt = ".caiwu", AddExtension = true, OverwritePrompt = false };
        if (dialog.ShowDialog(this) == true) workflow.DestinationPath = dialog.FileName;
    }

    private void Scope_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (workflow is not null) workflow.Scope = ScopeBox.SelectedIndex == 1
            ? BookCopyScope.AccountsAndOpeningBalances : BookCopyScope.FullLedger;
    }

    private void Preview_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var p = workflow.Preview();
            SourceText.Text = $"{p.SourceBook.Name} / {p.SourceBook.Id:D} / revision {p.SourceRevision}\n{p.Request.SourcePath}";
            var text = new StringBuilder($"新名称：{p.NewBook.Name}\n新 BookId：{p.NewBook.Id:D}\n新建时间：{p.NewBook.CreatedAt:O}\n目标：{p.Request.DestinationPath}\n源 revision {p.SourceRevision} → 新账套 revision {p.NewRevision}\n");
            text.AppendLine($"科目 {p.TargetCounts.Accounts}；凭证 {p.TargetCounts.Vouchers}（草稿 {p.TargetCounts.Drafts}、审核 {p.TargetCounts.Reviewed}、记账 {p.TargetCounts.Posted}）；审计 {p.TargetCounts.AuditEvents}");
            text.AppendLine($"原始期初借方 {p.TargetCounts.OpeningDebit:N2} / 贷方 {p.TargetCounts.OpeningCredit:N2}（包含全部科目行，不作末级汇总）");
            foreach (var rule in p.Rules) text.AppendLine($"\n{rule.Field}：{rule.Behavior}");
            foreach (var notice in p.Notices) text.AppendLine($"\n• {notice}");
            PreviewText.Text = text.ToString(); StatusText.Text = "请核对预览并勾选确认。";
        }
        catch (Exception error) { StatusText.Text = error.Message; }
    }

    private async void Execute_Click(object sender, RoutedEventArgs e)
    {
        if (workflow.IsBusy || workflow.IsCompleted) return;
        Inputs.IsEnabled = false; Confirmation.IsEnabled = false; ExecuteButton.IsEnabled = false;
        CancelButton.Content = "请求取消";
        try
        {
            StatusText.Text = "正在取得一致快照并复制…";
            var result = await workflow.ExecuteConfirmedAsync(cancellation.Token);
            StatusText.Text = $"已创建：{result.DestinationPath}";
            if (result.CleanupWarnings.Count > 0)
                MessageBox.Show(this, string.Join(Environment.NewLine, result.CleanupWarnings), "复制成功，临时清理提示");
            DialogResult = true;
        }
        catch (OperationCanceledException) { StatusText.Text = "已取消，目标未发布。"; }
        catch (Exception error)
        {
            StatusText.Text = error.Message;
            if (error.Data["BookCopyCleanupWarnings"] is string cleanup) StatusText.Text += "\n" + cleanup;
        }
        finally
        {
            if (!workflow.IsCompleted)
            {
                Inputs.IsEnabled = !cancellation.IsCancellationRequested;
                CancelButton.Content = "关闭";
                if (cancellation.IsCancellationRequested) StatusText.Text += " 如需重试，请重新打开窗口。";
            }
        }
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        if (workflow.IsBusy) { cancellation.Cancel(); StatusText.Text = "已请求取消，等待当前 Storage 操作安全结束…"; }
        else { workflow.CancelPreview(); DialogResult = false; }
    }

    private void Window_Closing(object? sender, CancelEventArgs e)
    {
        if (!workflow.IsBusy) return;
        cancellation.Cancel(); e.Cancel = true;
        StatusText.Text = "已请求取消，待当前 Storage 操作安全结束后可关闭。";
    }
}

using System.ComponentModel;
using System.Runtime.CompilerServices;
using Caiwu.Contracts;

namespace Caiwu.BookTools;

/// <summary>UI-neutral state for the independent WPF window. Input changes invalidate approval.</summary>
public sealed class BookCopyWorkflow : INotifyPropertyChanged
{
    private readonly BookCopyService service;
    private readonly LedgerSnapshot source;
    private readonly Func<LedgerSnapshot>? refreshSnapshot;
    private readonly string sourcePath;
    private string destinationPath = "", newBookName = "", operatorName = "";
    private BookCopyScope scope;
    private BookCopyPlan? plan;
    private bool confirmed, busy, completed;

    public BookCopyWorkflow(BookCopyService service, LedgerSnapshot persistedSnapshot, string sourcePath,
        Func<LedgerSnapshot>? refreshSnapshot = null)
    {
        this.service = service ?? throw new ArgumentNullException(nameof(service));
        source = SnapshotData.Freeze(persistedSnapshot ?? throw new ArgumentNullException(nameof(persistedSnapshot)));
        this.sourcePath = sourcePath;
        this.refreshSnapshot = refreshSnapshot;
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    public string DestinationPath { get => destinationPath; set => SetInput(ref destinationPath, value); }
    public string NewBookName { get => newBookName; set => SetInput(ref newBookName, value); }
    public string OperatorName { get => operatorName; set => SetInput(ref operatorName, value); }
    public BookCopyScope Scope { get => scope; set => SetInput(ref scope, value); }
    public BookCopyPlan? Plan => plan;
    public BookCopyResult? Result { get; private set; }
    public bool IsBusy => busy;
    public bool IsCompleted => completed;
    public bool Confirmed
    {
        get => confirmed;
        set
        {
            if (busy || completed) throw new InvalidOperationException("复制期间或完成后不能修改确认状态。");
            confirmed = value && plan is not null;
            Changed();
        }
    }

    public BookCopyPlan Preview()
    {
        RequireEditable();
        Invalidate();
        plan = service.Preview(refreshSnapshot?.Invoke() ?? source,
            new(sourcePath, DestinationPath, NewBookName, Scope, OperatorName));
        Changed(nameof(Plan));
        return plan;
    }

    public async Task<BookCopyResult> ExecuteConfirmedAsync(CancellationToken cancellationToken = default,
        IProgress<BookCopyStage>? progress = null)
    {
        RequireEditable();
        if (plan is null || !confirmed) throw new InvalidOperationException("必须先预览并明确确认当前复制计划。");
        var approved = plan;
        busy = true;
        Changed(nameof(IsBusy));
        try
        {
            Result = await Task.Run(() => service.Execute(approved, cancellationToken, progress), cancellationToken);
            completed = true;
            Changed(nameof(Result)); Changed(nameof(IsCompleted));
            return Result;
        }
        finally
        {
            busy = false;
            Invalidate(); // A retry always requires a fresh plan and explicit confirmation.
            Changed(nameof(IsBusy));
        }
    }

    public void CancelPreview()
    {
        RequireEditable();
        Invalidate();
    }

    private void RequireEditable()
    {
        if (busy) throw new InvalidOperationException("复制正在执行，请等待或请求取消。");
        if (completed) throw new InvalidOperationException("本次复制已完成，请新开窗口执行另一项复制。");
    }

    private void SetInput<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        RequireEditable();
        if (EqualityComparer<T>.Default.Equals(field, value)) return;
        field = value;
        Invalidate(); Changed(name);
    }

    private void Invalidate()
    {
        plan = null; confirmed = false;
        Changed(nameof(Plan)); Changed(nameof(Confirmed));
    }

    private void Changed([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

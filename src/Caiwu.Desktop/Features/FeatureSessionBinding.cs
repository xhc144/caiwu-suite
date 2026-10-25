using Caiwu.Contracts;
using Caiwu.Desktop.Presentation;

namespace Caiwu.Desktop.Features;

/// <summary>Captures displayed data once. Neither validation nor saving obtains replacement tokens.</summary>
public sealed class FeatureSessionBinding
{
    private readonly LedgerSession session;
    private readonly ILedgerService service;
    private readonly long generation;
    public LedgerSnapshot Shown { get; }
    public string DatabasePath { get; }
    public bool IsCurrent => session.IsOpen && session.Generation == generation &&
        ReferenceEquals(session.Service, service) && session.Snapshot?.Book.Id == Shown.Book.Id &&
        session.Snapshot.Revision == Shown.Revision;

    public FeatureSessionBinding(LedgerSession session, LedgerSnapshot shown)
    {
        this.session = session;
        service = session.Service ?? throw new StoreConcurrencyException("账套会话已关闭。");
        generation = session.Generation;
        Shown = shown;
        DatabasePath = session.DatabasePath ?? throw new StoreConcurrencyException("账套会话已关闭。");
        DemandCurrent();
    }

    public ILedgerService DemandCurrent()
    {
        if (!IsCurrent) throw new StoreConcurrencyException("账套已切换、恢复或重新载入。旧窗口已失效；输入保留，请重新打开核对。");
        return service;
    }
}

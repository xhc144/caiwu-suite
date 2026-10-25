using Caiwu.Contracts;

namespace Caiwu.Desktop.Presentation;

/// <summary>Bind displayed data to both its snapshot and the exact opened local session.</summary>
public sealed class SessionBoundMutation
{
    private readonly LedgerSession session;
    private readonly ILedgerService service;
    private readonly long generation;
    public LedgerMutationContext Context { get; }

    // Call only while loading/displaying this snapshot, never to refresh a pending submission.
    public SessionBoundMutation(LedgerSession session, LedgerSnapshot shownSnapshot)
    {
        this.session = session;
        service = session.Service ?? throw new StoreConcurrencyException("账套会话已关闭，请重新打开并核对。");
        generation = session.Generation;
        Context = new(shownSnapshot.Book.Id, shownSnapshot.Revision);
    }
    public ILedgerService GetService()
    {
        if (!session.IsOpen || generation != session.Generation || !ReferenceEquals(service, session.Service))
            throw new StoreConcurrencyException("账套会话已切换或恢复，旧窗口不能向当前文件保存。输入已保留，请重新打开并核对。");
        return service;
    }
}

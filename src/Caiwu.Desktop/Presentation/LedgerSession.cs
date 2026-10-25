using Caiwu.Contracts;

namespace Caiwu.Desktop.Presentation;

public sealed record DesktopBackend(
    Func<string, ILedgerStore> Open,
    Func<string, BookInfo, IReadOnlyList<Account>, ILedgerStore> Create,
    Action<string, string> Restore,
    Func<ILedgerStore, ILedgerService> CreateService,
    IReadOnlyList<TemplateDefinition> Templates);

/// <summary>Switches books only after the replacement has opened and validated.</summary>
public sealed class LedgerSession : IDisposable
{
    private readonly DesktopBackend _backend;
    private ILedgerStore? _store;
    public ILedgerService? Service { get; private set; }
    public LedgerSnapshot? Snapshot { get; private set; }
    public string? DatabasePath => _store?.DatabasePath;
    public bool IsOpen => _store is not null;

    public LedgerSession(DesktopBackend backend) => _backend = backend;

    public void Open(string path) => Replace(() => _backend.Open(path));

    public void Create(string path, BookInfo book, IReadOnlyList<Account> accounts) =>
        Replace(() => _backend.Create(path, book, accounts));

    private void Replace(Func<ILedgerStore> open)
    {
        var next = open();
        try
        {
            next.CheckIntegrity();
            var service = _backend.CreateService(next);
            var snapshot = service.GetSnapshot();
            var previous = _store;
            _store = next;
            Service = service;
            Snapshot = snapshot;
            previous?.Dispose();
        }
        catch
        {
            if (!ReferenceEquals(_store, next)) next.Dispose();
            throw;
        }
    }

    public void Refresh() => Snapshot = Service?.GetSnapshot();
    public void BackupTo(string path) => (_store ?? throw new InvalidOperationException("请先打开账套。"))
        .BackupTo(path);

    public void RestoreTo(string backup, string destination) => _backend.Restore(backup, destination);

    public void Close()
    {
        _store?.Dispose();
        _store = null;
        Service = null;
        Snapshot = null;
    }

    public void Dispose() => Close();
}

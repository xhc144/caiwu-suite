using Caiwu.Contracts;

namespace Caiwu.Core.Tests;

// Independent test double for the storage contract. Read intentionally returns the
// actual stored snapshot so that accidental service mutations cannot be hidden by cloning here.
internal sealed class MemoryLedgerStore : ILedgerStore
{
    private readonly object gate = new();
    private LedgerSnapshot state;
    public string DatabasePath => "memory://ledger";
    public int WriteAttempts { get; private set; }
    public int SuccessfulWrites { get; private set; }
    public bool IsDisposed { get; private set; }
    public Action? AfterRead { get; set; }
    public Exception? WriteFailure { get; set; }

    public MemoryLedgerStore(LedgerSnapshot initial) => state = initial;

    public LedgerSnapshot Read()
    {
        LedgerSnapshot captured;
        lock (gate) { ObjectDisposedException.ThrowIf(IsDisposed, this); captured = state; }
        AfterRead?.Invoke();
        return captured;
    }

    public void Write(LedgerSnapshot next, long expectedRevision)
    {
        lock (gate)
        {
            ObjectDisposedException.ThrowIf(IsDisposed, this);
            WriteAttempts++;
            if (state.Revision != expectedRevision || next.Revision != checked(expectedRevision + 1))
                throw new StoreConcurrencyException("测试仓库版本冲突。");
            if (WriteFailure is not null) throw WriteFailure;
            state = next;
            SuccessfulWrites++;
        }
    }

    public void BackupTo(string destinationPath) => throw new NotSupportedException("Core测试不模拟备份。");
    public void CheckIntegrity() { ObjectDisposedException.ThrowIf(IsDisposed, this); }
    public void Dispose() => IsDisposed = true;
}

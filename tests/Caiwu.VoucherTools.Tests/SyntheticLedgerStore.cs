using Caiwu.Contracts;

namespace Caiwu.VoucherTools.Tests;

/// <summary>Only synthetic state. Enforces the same revision CAS contract as ILedgerStore.</summary>
internal sealed class SyntheticLedgerStore(LedgerSnapshot initial) : ILedgerStore
{
    private LedgerSnapshot snapshot = initial;
    public string DatabasePath => "synthetic-memory-only";
    public int ReadCount { get; private set; }
    public int WriteCount { get; private set; }
    public LedgerSnapshot Read() { ReadCount++; return snapshot; }
    public void Write(LedgerSnapshot next, long expectedRevision)
    {
        if (snapshot.Revision != expectedRevision || next.Revision != expectedRevision + 1 || next.Book.Id != snapshot.Book.Id)
            throw new StoreConcurrencyException("Synthetic revision/book conflict.");
        snapshot = next;
        WriteCount++;
    }
    public void BackupTo(string destinationPath) => throw new NotSupportedException();
    public void CheckIntegrity() { }
    public void Dispose() { }
}

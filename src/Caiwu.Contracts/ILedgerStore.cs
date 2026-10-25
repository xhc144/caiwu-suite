namespace Caiwu.Contracts;

/// <summary>Owns one local account-book database. Writes are atomic and revision-checked.</summary>
public interface ILedgerStore : IDisposable
{
    string DatabasePath { get; }
    LedgerSnapshot Read();
    void Write(LedgerSnapshot next, long expectedRevision);
    void BackupTo(string destinationPath);
    void CheckIntegrity();
}

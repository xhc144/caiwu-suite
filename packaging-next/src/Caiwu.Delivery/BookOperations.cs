using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Persistence.Sqlite;

namespace Caiwu.Delivery;

public sealed record BookInspection(string DatabasePath, Guid BookId, long Revision, int VoucherCount,
    int PostedVoucherCount, decimal? BankBalance, string SnapshotSha256, string FileSha256);
public sealed record BookCopyResult(BookInspection Source, BookInspection Copy);

/// <summary>Explicit single-book operations. They do not certify a complete Desktop inventory or enable upgrades.</summary>
public static class BookOperations
{
    public static BookInspection Inspect(string installRoot, string relativeBook) =>
        Installation.WithExclusiveData(installRoot, current => InspectPath(BookPath(current.DataRoot, relativeBook)));

    public static BookCopyResult Backup(string installRoot, string relativeSource, string relativeBackup) =>
        Installation.WithExclusiveData(installRoot, current =>
        {
            var source = BookPath(current.DataRoot, relativeSource);
            var backup = BookPath(current.DataRoot, relativeBackup);
            if (IsBackup(current.DataRoot, source) || !IsBackup(current.DataRoot, backup))
                throw new InvalidDataException("Backup must read a managed book and create a new file in .delivery-backups.");
            Directory.CreateDirectory(Path.GetDirectoryName(backup)!);
            using (var store = SqliteLedgerStore.Open(source)) store.BackupTo(backup);
            return new BookCopyResult(InspectPath(source), InspectPath(backup));
        });

    public static BookCopyResult Restore(string installRoot, string relativeBackup, string relativeNewBook) =>
        Installation.WithExclusiveData(installRoot, current =>
        {
            var backup = BookPath(current.DataRoot, relativeBackup);
            var destination = BookPath(current.DataRoot, relativeNewBook);
            if (!IsBackup(current.DataRoot, backup) || IsBackup(current.DataRoot, destination))
                throw new InvalidDataException("Restore must read .delivery-backups and create a new book outside that directory.");
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            SqliteLedgerStore.RestoreBackup(backup, destination);
            return new BookCopyResult(InspectPath(backup), InspectPath(destination));
        });

    private static bool IsBackup(string dataRoot, string path) =>
        SafePaths.Contains(SafePaths.Child(dataRoot, ".delivery-backups"), path);

    private static string BookPath(string dataRoot, string relative)
    {
        var path = SafePaths.Child(dataRoot, relative);
        if (!path.EndsWith(".caiwu", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("A .caiwu book path is required.");
        return path;
    }

    private static BookInspection InspectPath(string path)
    {
        LedgerSnapshot snapshot;
        using (var store = SqliteLedgerStore.Open(path))
        {
            store.CheckIntegrity(); snapshot = store.Read();
        }
        var matches = snapshot.Accounts.Where(a => a.Name == "银行存款").Take(2).ToArray();
        var bank = matches.Length == 1 ? matches[0] : null;
        decimal? bankBalance = bank == null ? null : bank.OpeningDebit - bank.OpeningCredit +
            snapshot.Vouchers.Where(v => v.Status == VoucherStatus.Posted).SelectMany(v => v.Lines)
                .Where(l => l.AccountCode == bank.Code).Sum(l => l.Debit - l.Credit);
        var fingerprint = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(snapshot, PayloadManifest.Json))));
        return new(path, snapshot.Book.Id, snapshot.Revision, snapshot.Vouchers.Count,
            snapshot.Vouchers.Count(v => v.Status == VoucherStatus.Posted), bankBalance, fingerprint, PayloadManifest.Hash(path));
    }
}

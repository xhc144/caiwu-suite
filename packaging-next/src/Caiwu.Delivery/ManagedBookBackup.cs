using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Persistence.Sqlite;

namespace Caiwu.Delivery;
/// <summary>A trusted module adapter must use its module's validated export/restore API.</summary>
public interface IManagedAttachmentCodec
{
    string Id { get; }

    string ReadVersion(string path, LedgerSnapshot snapshot);
    void Export(string source, string newDestination, LedgerSnapshot snapshot);
    void Restore(string backup, string newDestination, LedgerSnapshot snapshot);
}

public sealed record AttachmentBackupEntry(string Key, string Codec, string ModulePath, string BackupPath, string Version, long Length, string Sha256);
public sealed record ManagedBookBackupManifest(int FormatVersion, Guid SourceInstanceId, Guid BookId, long LedgerRevision, string LedgerSnapshotSha256, long LedgerLength, string LedgerSha256, AttachmentBackupEntry[] Attachments, bool IncludesGlobalIdentities = false, string IdentityRecoveryBoundary = "Global Operators are excluded; use separately authorized identity backup/recovery.");
public sealed record ManagedBookBackupResult(string Directory, string ManifestSha256, ManagedBookBackupManifest Manifest);
public sealed record ManagedBookRestoreResult(ManagedBook Book, string DatabasePath, string BackupManifestSha256);
public sealed class ManagedCaptureConflictException(string message) : IOException(message);
/// <summary>All operations run inside the session's real leases. No cross-file transaction is claimed.</summary>
public sealed class ManagedBookBackup(ManagedDataSession session, IEnumerable<IManagedAttachmentCodec> codecs)
{
    private readonly Dictionary<string, IManagedAttachmentCodec> codecs = codecs.ToDictionary(c => c.Id, StringComparer.Ordinal);
    public ManagedBookBackupResult Backup(ManagedBook book, int maximumAttempts = 3) => session.Execute(() =>
    {
        if (maximumAttempts is < 1 or > 5)
            throw new ArgumentOutOfRangeException(nameof(maximumAttempts));
        session.RequireBook(book);
        session.SynchronizeLedgerInventory();
        var inventory = session.ReadInventory();
        var attachments = inventory.Attachments.Where(a => a.InstanceId == book.InstanceId).OrderBy(a => a.Key, StringComparer.Ordinal).ToArray();
        foreach (var entry in attachments)
            _ = Codec(entry.Codec);
        RequireCompleteModuleDirectory(book, attachments);
        for (var attempt = 0; attempt < maximumAttempts; attempt++)
        {
            var stage = NewScratch();
            try
            {
                var ledger = SafePaths.Child(stage, "ledger.caiwu");
                LedgerFilePolicy.Validate(session.DatabasePath(book));
                SqliteLedgerStore.RestoreBackup(session.DatabasePath(book), ledger);
                var snapshot = session.ReadSnapshot(ledger);
                if (snapshot.Book.Id != book.BookId)
                    throw new InvalidDataException("BookId changed during backup.");
                var versions = attachments.Select(a => Codec(a.Codec).ReadVersion(Source(a), snapshot)).ToArray();
                var entries = new List<AttachmentBackupEntry>();
                for (var i = 0; i < attachments.Length; i++)
                {
                    var entry = attachments[i];
                    var relative = $"attachments/{i:D6}.json";
                    var destination = SafePaths.Child(stage, relative);
                    Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                    Codec(entry.Codec).Export(Source(entry), destination, snapshot);
                    var version = Codec(entry.Codec).ReadVersion(destination, snapshot);
                    if (version != versions[i])
                        throw new ManagedCaptureConflictException("Attachment changed while capturing: " + entry.Key);
                    var moduleRoot = SafePaths.Child(session.DataRoot, $"Books/{book.InstanceId:N}/Modules");
                    entries.Add(new(entry.Key, entry.Codec, Path.GetRelativePath(moduleRoot, Source(entry)).Replace('\\', '/'), relative, version, new FileInfo(destination).Length, PayloadManifest.Hash(destination)));
                }

                for (var i = 0; i < attachments.Length; i++)
                    if (Codec(attachments[i].Codec).ReadVersion(Source(attachments[i]), snapshot) != versions[i])
                        throw new ManagedCaptureConflictException("Attachment changed after capture: " + attachments[i].Key);
                var end = SafePaths.Child(stage, "end.tmp");
                SqliteLedgerStore.RestoreBackup(session.DatabasePath(book), end);
                var unchanged = Fingerprint(session.ReadSnapshot(end)) == Fingerprint(snapshot);
                DeleteOwnLedger(end);
                if (!unchanged)
                    throw new ManagedCaptureConflictException("Ledger changed while capturing modules.");
                RequireCompleteModuleDirectory(book, attachments);
                if (JsonSerializer.Serialize(inventory, ManagedDataSession.Json) != JsonSerializer.Serialize(session.ReadInventory(), ManagedDataSession.Json))
                    throw new ManagedCaptureConflictException("Registration changed while capturing modules.");
                var manifest = new ManagedBookBackupManifest(1, book.InstanceId, book.BookId, snapshot.Revision, Fingerprint(snapshot), new FileInfo(ledger).Length, PayloadManifest.Hash(ledger), entries.ToArray());
                var manifestPath = SafePaths.Child(stage, "manifest.json");
                ManagedDataSession.AtomicJson(manifestPath, manifest);
                var manifestHash = PayloadManifest.Hash(manifestPath);
                ValidateBundle(stage, manifestHash);
                var root = SafePaths.Child(session.DataRoot, ".delivery-backups/managed");
                Directory.CreateDirectory(root);
                var published = SafePaths.Child(root, Guid.NewGuid().ToString("N"));
                Directory.Move(stage, published);
                return new ManagedBookBackupResult(published, manifestHash, manifest);
            }
            catch (ManagedCaptureConflictException)when (attempt + 1 < maximumAttempts)
            {
            }
            finally
            {
                DeleteOwnDirectory(stage);
            }
        }

        throw new ManagedCaptureConflictException("Could not capture one stable ledger/module version within the retry limit.");
    });
    /// <summary>Caller supplies the independently retained manifest hash. Always publishes a new physical instance.</summary>
    public ManagedBookRestoreResult Restore(string backupDirectory, string expectedManifestSha256) => session.Execute(() =>
    {
        var backup = session.RequireDataPath(backupDirectory);
        if (!SafePaths.Contains(SafePaths.Child(session.DataRoot, ".delivery-backups/managed"), backup))
            throw new InvalidDataException("Not a managed module backup directory.");
        var manifest = ValidateBundle(backup, expectedManifestSha256);
        var instance = Guid.NewGuid();
        var final = SafePaths.Child(session.DataRoot, $"Books/{instance:N}");
        var stage = NewScratch();
        var published = false;
        try
        {
            var ledger = SafePaths.Child(stage, "ledger.caiwu");
            SqliteLedgerStore.RestoreBackup(SafePaths.Child(backup, "ledger.caiwu"), ledger);
            var snapshot = session.ReadSnapshot(ledger);
            if (snapshot.Book.Id != manifest.BookId || snapshot.Revision != manifest.LedgerRevision || Fingerprint(snapshot) != manifest.LedgerSnapshotSha256)
                throw new InvalidDataException("Restored ledger differs from the recorded snapshot.");
            var restored = new List<ManagedAttachment>();
            foreach (var entry in manifest.Attachments)
            {
                var destination = SafePaths.Child(stage, "Modules/" + entry.ModulePath);
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                Codec(entry.Codec).Restore(SafePaths.Child(backup, entry.BackupPath), destination, snapshot);
                if (Codec(entry.Codec).ReadVersion(destination, snapshot) != entry.Version || PayloadManifest.Hash(destination) != entry.Sha256)
                    throw new InvalidDataException("Restored attachment differs from the recorded version.");
                restored.Add(new(instance, manifest.BookId, entry.Key, entry.Codec, $"Books/{instance:N}/Modules/{entry.ModulePath}"));
            }

            // A second whole-bundle check detects changes during restore before any publication.
            ValidateBundle(backup, expectedManifestSha256);
            var inventory = session.ReadInventory();
            var book = new ManagedBook(instance, manifest.BookId, $"Books/{instance:N}/ledger.caiwu");
            Directory.CreateDirectory(Path.GetDirectoryName(final)!);
            Directory.Move(stage, final);
            published = true;
            try
            {
                session.SaveInventory(inventory with { Books = [..inventory.Books, book], Attachments = [..inventory.Attachments, ..restored] });
                session.SynchronizeLedgerInventory();
            }
            catch (Exception ex)
            {
                throw new IOException("Restored files were published and preserved at " + final + "; registration did not finish. Reconcile registration before retrying.", ex);
            }

            return new ManagedBookRestoreResult(book, session.DatabasePath(book), expectedManifestSha256);
        }
        finally
        {
            if (!published)
                DeleteOwnDirectory(stage);
        }
    });
    private ManagedBookBackupManifest ValidateBundle(string directory, string expectedHash)
    {
        if (expectedHash.Length != 64 || !expectedHash.All(Uri.IsHexDigit))
            throw new InvalidDataException("An independently recorded SHA256 is required.");
        SafePaths.RejectLinks(directory);
        var path = SafePaths.Child(directory, "manifest.json");
        if (!PayloadManifest.Hash(path).Equals(expectedHash, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Backup manifest checksum mismatch.");
        var manifest = ManagedDataSession.ReadJson<ManagedBookBackupManifest>(path);
        if (manifest.FormatVersion != 1 || manifest.BookId == Guid.Empty || manifest.SourceInstanceId == Guid.Empty || manifest.IncludesGlobalIdentities || manifest.Attachments == null || manifest.Attachments.Length > 100000)
            throw new InvalidDataException("Invalid backup manifest or unsupported identity scope.");
        var files = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "manifest.json",
            "ledger.caiwu"
        };
        var keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var targets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        CheckFile(SafePaths.Child(directory, "ledger.caiwu"), manifest.LedgerLength, manifest.LedgerSha256);
        var snapshot = session.ReadSnapshot(SafePaths.Child(directory, "ledger.caiwu"));
        if (snapshot.Book.Id != manifest.BookId || snapshot.Revision != manifest.LedgerRevision || Fingerprint(snapshot) != manifest.LedgerSnapshotSha256)
            throw new InvalidDataException("Ledger semantic checksum/identity mismatch.");
        foreach (var entry in manifest.Attachments)
        {
            ManagedDataSession.RequireSegment(entry.Key);
            ManagedDataSession.RequireSegment(entry.Codec);
            if (!keys.Add(entry.Key) || !targets.Add(entry.ModulePath) || !files.Add(entry.BackupPath) || entry.BackupPath != $"attachments/{keys.Count - 1:D6}.json")
                throw new InvalidDataException("Duplicate or unexpected attachment path.");
            _ = SafePaths.Child(directory, "Modules/" + entry.ModulePath);
            var file = SafePaths.Child(directory, entry.BackupPath);
            CheckFile(file, entry.Length, entry.Sha256);
            if (Codec(entry.Codec).ReadVersion(file, snapshot) != entry.Version)
                throw new InvalidDataException("Attachment version/ownership mismatch.");
        }

        // SQLite reads may leave only their known WAL/shared-memory sidecars. They carry no independent data in this closed backup.
        var actual = SafePaths.Files(directory).Select(f => Path.GetRelativePath(directory, f).Replace('\\', '/')).Where(p => p is not "ledger.caiwu-wal" and not "ledger.caiwu-shm").ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (!files.SetEquals(actual))
            throw new InvalidDataException("Backup contains unknown or missing files.");
        return manifest;
    }

    private void RequireCompleteModuleDirectory(ManagedBook book, ManagedAttachment[] entries)
    {
        var root = SafePaths.Child(session.DataRoot, $"Books/{book.InstanceId:N}/Modules");
        foreach (var entry in entries)
            if (!File.Exists(Source(entry)))
                throw new InvalidDataException("Registered attachment is missing: " + entry.Key);
        if (!Directory.Exists(root))
            return;
        var known = entries.Select(Source).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var file in SafePaths.Files(root))
            if (!known.Contains(file) && !entries.Any(e => (e.Codec is "summary-v1" or "report-template-v1") && file.Equals(Source(e) + ".lock", StringComparison.OrdinalIgnoreCase)))
                throw new InvalidDataException("Unregistered module file prevents a complete backup: " + Path.GetFileName(file));
    }

    private IManagedAttachmentCodec Codec(string id) => codecs.TryGetValue(id, out var value) ? value : throw new InvalidDataException("No validated module codec registered for " + id);
    private string Source(ManagedAttachment entry) => SafePaths.Child(session.DataRoot, entry.RelativePath);
    private string NewScratch()
    {
        var root = SafePaths.Child(session.DataRoot, ".delivery-scratch");
        Directory.CreateDirectory(root);
        var path = SafePaths.Child(root, Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }

    private static void CheckFile(string path, long length, string hash)
    {
        if (length < 0 || !File.Exists(path) || new FileInfo(path).Length != length || PayloadManifest.Hash(path) != hash)
            throw new InvalidDataException("Backup file missing or checksum mismatch: " + Path.GetFileName(path));
    }

    private static string Fingerprint(LedgerSnapshot snapshot) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(snapshot, PayloadManifest.Json))));
    private static void DeleteOwnLedger(string path)
    {
        foreach (var suffix in new[]
        {
            "",
            "-wal",
            "-shm",
            "-journal"
        }

        )
            File.Delete(path + suffix);
    }

    private static void DeleteOwnDirectory(string path)
    {
        if (!Directory.Exists(path))
            return;
        SafePaths.RejectLinks(path);
        foreach (var file in SafePaths.Files(path))
            File.Delete(file);
        foreach (var dir in Directory.EnumerateDirectories(path, "*", SearchOption.AllDirectories).OrderByDescending(p => p.Length))
            Directory.Delete(dir);
        Directory.Delete(path);
    }
}

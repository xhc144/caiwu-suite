using System.Security.Cryptography;
using System.Text.Json;
using System.Net;
using Caiwu.Contracts;
using Caiwu.Delivery;
using Caiwu.Persistence.Sqlite;
using Microsoft.Data.Sqlite;

// Every case owns a fresh synthetic directory. The harness never discovers or opens user books.
var results = new List<object>();
var failed = 0;
var skipped = 0;
var cases = DeliveryCases.All.ToArray();
foreach (var (name, action) in cases)
{
    using var fixture = new Fixture();
    try
    {
        action(fixture);
        results.Add(new { name, status = "passed" });
        Console.WriteLine($"PASS {name}");
    }
    catch (TestSkipped ex)
    {
        skipped++;
        results.Add(new { name, status = "skipped", detail = ex.Message });
        Console.WriteLine($"SKIP {name}: {ex.Message}");
    }
    catch (Exception ex)
    {
        failed++;
        results.Add(new { name, status = "failed", detail = ex.ToString() });
        Console.Error.WriteLine($"FAIL {name}: {ex}");
    }
}
var report = new
{
    success = failed == 0, total = cases.Length, passed = cases.Length - failed - skipped,
    failed, skipped, runtime = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
    os = System.Runtime.InteropServices.RuntimeInformation.OSDescription,
    scope = "Synthetic self-authored delivery components only. No reference installer or real accounting data.",
    results
};
if (args.Length == 1)
{
    var reportPath = Path.GetFullPath(args[0]);
    Directory.CreateDirectory(Path.GetDirectoryName(reportPath)!);
    File.WriteAllText(reportPath, JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
}
Console.WriteLine($"{cases.Length - failed - skipped} passed; {failed} failed; {skipped} skipped.");
return failed == 0 ? 0 : 1;

internal static class DeliveryCases
{
    public static IEnumerable<(string Name, Action<Fixture> Action)> All
    {
        get
        {
            yield return ("install and data roots cannot overlap in either direction", f =>
            {
                Check.Reject(() => SafePaths.RequireSeparateRoots(f.Install, f.Install));
                Check.Reject(() => SafePaths.RequireSeparateRoots(f.Install, Path.Combine(f.Install, "books")));
                Check.Reject(() => SafePaths.RequireSeparateRoots(Path.Combine(f.Data, "program"), f.Data));
                SafePaths.RequireSeparateRoots(f.Install, f.Data);
            });
            foreach (var path in new[] { "../escape", "nested/../../escape", "..\\escape", "/absolute", "C:\\absolute", "\\\\server\\share", "a:stream", "nested/../escape", "CON.txt", "folder./file", "trailing " })
            {
                var unsafePath = path;
                yield return ($"payload path rejected: {unsafePath}", f => Check.Reject(() => SafePaths.Child(f.Install, unsafePath)));
            }
            yield return ("symlinked ancestor cannot redirect a managed child", f =>
            {
                var outside = Directory.CreateDirectory(Path.Combine(f.Root, "outside")).FullName;
                f.DirectoryLink(Path.Combine(f.Install, "redirect"), outside);
                Check.Reject(() => SafePaths.Child(f.Install, "redirect/important.txt"));
            });
            yield return ("manifest hashes actual payload and round-trips its identity", f =>
            {
                var payload = f.Payload("0.1.0.1");
                var manifest = PayloadManifest.Read(Path.Combine(payload, Fixture.ManifestName));
                Check.Equal("0.1.0.1", manifest.Version);
                Check.Equal(Fixture.Commit, manifest.Commit);
                Check.True(manifest.Files.Any(x => x.Path == "Caiwu.Desktop.exe"), "Missing application entry.");
                manifest.Verify(payload);
            });
            yield return ("manifest rejects byte tampering with unchanged file length", f =>
            {
                var payload = f.Payload("0.1.0.1");
                var app = Path.Combine(payload, "Caiwu.Desktop.exe");
                var bytes = File.ReadAllBytes(app); bytes[0] ^= 0x01; File.WriteAllBytes(app, bytes);
                Check.Reject(() => PayloadManifest.Read(Path.Combine(payload, Fixture.ManifestName)).Verify(payload));
            });
            yield return ("manifest rejects missing files", f =>
            {
                var payload = f.Payload("0.1.0.1");
                File.Delete(Path.Combine(payload, "support.dll"));
                Check.Reject(() => PayloadManifest.Read(Path.Combine(payload, Fixture.ManifestName)).Verify(payload));
            });
            yield return ("manifest rejects files added after sealing", f =>
            {
                var payload = f.Payload("0.1.0.1");
                File.WriteAllText(Path.Combine(payload, "unlisted.dll"), "untrusted extra code");
                Check.Reject(() => PayloadManifest.Read(Path.Combine(payload, Fixture.ManifestName)).Verify(payload));
            });
            yield return ("manifest rejects Windows case-insensitive path collisions", f =>
            {
                var payload = Directory.CreateDirectory(Path.Combine(f.Root, "collision-payload")).FullName;
                File.WriteAllText(Path.Combine(payload, "Caiwu.Desktop.exe"), "synthetic app");
                File.WriteAllText(Path.Combine(payload, "Support.dll"), "one");
                File.WriteAllText(Path.Combine(payload, "support.dll"), "two");
                if (Directory.GetFiles(payload).Length != 3)
                    throw new TestSkipped("Host filesystem cannot represent two paths differing only by case.");
                Check.Reject(() => PayloadManifest.Create(payload, "0.1.0.1", Fixture.Commit));
            });
            yield return ("manifest rejects a payload file symlink", f =>
            {
                var payload = f.Payload("0.1.0.1");
                var outside = Path.Combine(f.Root, "outside.dll"); File.WriteAllText(outside, "outside");
                File.Delete(Path.Combine(payload, "support.dll"));
                f.FileLink(Path.Combine(payload, "support.dll"), outside);
                Check.Reject(() => PayloadManifest.Read(Path.Combine(payload, Fixture.ManifestName)).Verify(payload));
            });
            yield return ("program payload cannot accidentally contain an accounting book", f =>
            {
                var payload = f.Payload("0.1.0.1");
                File.WriteAllText(Path.Combine(payload, "accidentally-included.caiwu"), "synthetic accounting data");
                Check.Reject(() => PayloadManifest.Create(payload, "0.1.0.1", Fixture.Commit));
            });
            yield return ("first install activates verified program without moving a book", f =>
            {
                var book = f.Book(); var hash = Fixture.Hash(book);
                Installation.Install(f.Payload("0.1.0.1"), f.Install, f.Data);
                var current = Installation.ReadCurrent(f.Install);
                Check.Equal("0.1.0.1", current.Version);
                Check.Equal(Path.GetFullPath(f.Data), Path.GetFullPath(current.DataRoot));
                Check.Equal(hash, Fixture.Hash(book));
            });
            yield return ("a temporary payload cannot contain the chosen persistent data root", f =>
            {
                var payload = f.Payload("0.1.0.1");
                var temporaryData = Directory.CreateDirectory(Path.Combine(payload, "data")).FullName;
                Check.Reject(() => Installation.Install(payload, f.Install, temporaryData));
                Check.True(!File.Exists(Path.Combine(f.Install, "current.json")), "A temporary data root was activated.");
            });
            yield return ("upgrade is blocked for Desktop without the managed-data contract", f =>
            {
                var book = f.Book(); var hash = Fixture.Hash(book);
                Installation.Install(f.Payload("0.1.0.1"), f.Install, f.Data);
                Check.Reject(() => Installation.Install(f.Payload("0.1.0.2"), f.Install, f.Data));
                Check.Equal("0.1.0.1", Installation.ReadCurrent(f.Install).Version);
                Check.Equal(hash, Fixture.Hash(book));
            });
            yield return ("a missing activation pointer cannot turn an existing installation into an unchecked first install", f =>
            {
                var book = f.Book(); var hash = Fixture.Hash(book);
                Installation.Install(f.Payload("0.1.0.1"), f.Install, f.Data);
                File.Delete(Path.Combine(f.Install, "current.json"));
                Check.Reject(() => Installation.Install(f.Payload("0.1.0.2"), f.Install, f.Data));
                Check.True(!File.Exists(Path.Combine(f.Install, "current.json")), "An ambiguous damaged installation was silently activated.");
                Check.Equal(hash, Fixture.Hash(book));
            });
            yield return ("another installation directory cannot bypass the active data-root upgrade gate", f =>
            {
                var book = f.Book(); var hash = Fixture.Hash(book);
                Installation.Install(f.Payload("0.1.0.1"), f.Install, f.Data);
                var otherRoot = Path.Combine(f.Root, "another-program");
                Check.Reject(() => Installation.Install(f.Payload("0.1.0.2"), otherRoot, f.Data));
                Check.Equal("0.1.0.1", Installation.ReadCurrent(f.Install).Version);
                Check.True(!File.Exists(Path.Combine(otherRoot, "current.json")), "A second program directory took over protected books.");
                Check.Equal(hash, Fixture.Hash(book));
            });
            yield return ("upgrade rejects a missing managed-book inventory", f =>
            {
                f.Book();
                Installation.Install(f.Payload("0.1.0.1", managed: true), f.Install, f.Data);
                Check.Reject(() => Installation.Install(f.Payload("0.1.0.2", managed: true), f.Install, f.Data));
                Check.Equal("0.1.0.1", Installation.ReadCurrent(f.Install).Version);
            });
            yield return ("upgrade cannot omit a real managed book from the inventory", f =>
            {
                var included = f.Book("included.caiwu"); var omitted = f.Book("omitted.caiwu");
                var hash = Fixture.Hash(omitted);
                f.Inventory(included);
                Installation.Install(f.Payload("0.1.0.1", managed: true), f.Install, f.Data);
                Check.Reject(() => Installation.Install(f.Payload("0.1.0.2", managed: true), f.Install, f.Data));
                Check.Equal("0.1.0.1", Installation.ReadCurrent(f.Install).Version);
                Check.Equal(hash, Fixture.Hash(omitted));
            });
            yield return ("upgrade cannot redirect its inventory to another data root", f =>
            {
                var outside = Directory.CreateDirectory(Path.Combine(f.Root, "other-data")).FullName;
                var book = f.BookAt(Path.Combine(outside, "outside.caiwu")); var hash = Fixture.Hash(book);
                f.Inventory(book);
                Installation.Install(f.Payload("0.1.0.1", managed: true), f.Install, f.Data);
                Check.Reject(() => Installation.Install(f.Payload("0.1.0.2", managed: true), f.Install, f.Data));
                Check.Equal(hash, Fixture.Hash(book));
            });
            yield return ("active application lease prevents uninstall", f =>
            {
                Installation.Install(f.Payload("0.1.0.1"), f.Install, f.Data);
                using (Installation.AcquireLease(f.Install))
                {
                    Check.Reject(() => Installation.Uninstall(f.Install));
                    Check.Equal("0.1.0.1", Installation.ReadCurrent(f.Install).Version);
                }
            });
            yield return ("active application lease prevents upgrade before mutation", f =>
            {
                var book = f.Book(); var hash = Fixture.Hash(book); f.Inventory(book);
                Installation.Install(f.Payload("0.1.0.1", managed: true), f.Install, f.Data);
                using (Installation.AcquireLease(f.Install))
                    Check.Reject(() => Installation.Install(f.Payload("0.1.0.2", managed: true), f.Install, f.Data));
                Check.Equal("0.1.0.1", Installation.ReadCurrent(f.Install).Version);
                Check.Equal(hash, Fixture.Hash(book));
            });
            yield return ("the shared data-root lease prevents an upgrade through another installation coordinator", f =>
            {
                var book = f.Book(); var hash = Fixture.Hash(book); f.Inventory(book);
                Installation.Install(f.Payload("0.1.0.1", managed: true), f.Install, f.Data);
                // This filename is the Desktop/launcher cooperation contract, independent of install-root leases.
                using (var externalSession = new FileStream(Path.Combine(f.Data, ".delivery-data.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
                    Check.Reject(() => Installation.Install(f.Payload("0.1.0.2", managed: true), f.Install, f.Data));
                Check.Equal("0.1.0.1", Installation.ReadCurrent(f.Install).Version);
                Check.Equal(hash, Fixture.Hash(book));
            });
            yield return ("uninstall preserves external books backups and unowned installation files", f =>
            {
                var book = f.Book(); var hash = Fixture.Hash(book);
                var backup = Path.Combine(f.Data, "manual-backup.bin"); File.WriteAllText(backup, "manual backup content");
                Installation.Install(f.Payload("0.1.0.1"), f.Install, f.Data);
                var unowned = Path.Combine(f.Install, "用户说明.txt"); File.WriteAllText(unowned, "user-owned notes");
                Installation.Uninstall(f.Install);
                Check.Equal(hash, Fixture.Hash(book));
                Check.Equal("manual backup content", File.ReadAllText(backup));
                Check.Equal("user-owned notes", File.ReadAllText(unowned));
            });
            yield return ("uninstall preserves a modified file at an owned payload path", f =>
            {
                Installation.Install(f.Payload("0.1.0.1"), f.Install, f.Data);
                var modified = Path.Combine(f.Install, "versions", "0.1.0.1", "support.dll");
                File.WriteAllText(modified, "user modified this file");
                Installation.Uninstall(f.Install);
                Check.Equal("user modified this file", File.ReadAllText(modified));
            });
            yield return ("uninstall refuses an arbitrary directory without an ownership marker", f =>
            {
                var owned = Path.Combine(f.Install, "valuable.txt"); File.WriteAllText(owned, "do not delete");
                Check.Reject(() => Installation.Uninstall(f.Install));
                Check.Equal("do not delete", File.ReadAllText(owned));
            });
            yield return ("uninstall followed by a newer install cannot bypass pre-upgrade backup gates", f =>
            {
                var book = f.Book(); var hash = Fixture.Hash(book);
                Installation.Install(f.Payload("0.1.0.1"), f.Install, f.Data);
                Installation.Uninstall(f.Install);
                Check.Reject(() => Installation.Install(f.Payload("0.1.0.2"), f.Install, f.Data));
                Check.True(!File.Exists(Path.Combine(f.Install, "current.json")), "Uninstall/reinstall bypassed upgrade safety.");
                Check.Equal(hash, Fixture.Hash(book));
            });
            yield return ("uninstall permits reinstalling the identical payload at its original program root", f =>
            {
                var book = f.Book(); var hash = Fixture.Hash(book);
                var payload = f.Payload("0.1.0.1");
                Installation.Install(payload, f.Install, f.Data);
                Installation.Uninstall(f.Install);
                Installation.Install(payload, f.Install, f.Data);
                Check.Equal("0.1.0.1", Installation.ReadCurrent(f.Install).Version);
                Check.Equal(hash, Fixture.Hash(book));
            });
            yield return ("uninstall cannot permit a different payload merely by reusing its version number", f =>
            {
                var book = f.Book(); var hash = Fixture.Hash(book);
                var payload = f.Payload("0.1.0.1");
                Installation.Install(payload, f.Install, f.Data);
                Installation.Uninstall(f.Install);
                File.WriteAllText(Path.Combine(payload, "support.dll"), "different replacement bytes using the same version");
                PayloadManifest.Create(payload, "0.1.0.1", Fixture.Commit).Write(Path.Combine(payload, Fixture.ManifestName));
                Check.Reject(() => Installation.Install(payload, f.Install, f.Data));
                Check.True(!File.Exists(Path.Combine(f.Install, "current.json")), "Changed payload bypassed persistent data-root protection.");
                Check.Equal(hash, Fixture.Hash(book));
            });
            yield return ("uninstall does not release a data root for another installation directory", f =>
            {
                var book = f.Book(); var hash = Fixture.Hash(book);
                var payload = f.Payload("0.1.0.1");
                Installation.Install(payload, f.Install, f.Data);
                Installation.Uninstall(f.Install);
                var otherRoot = Path.Combine(f.Root, "another-program");
                Check.Reject(() => Installation.Install(payload, otherRoot, f.Data));
                Check.True(!File.Exists(Path.Combine(otherRoot, "current.json")), "Another directory took over preserved books after uninstall.");
                Check.Equal(hash, Fixture.Hash(book));
            });
            yield return ("verified upgrade backups preserve independent SQLite balances", f =>
            {
                var book = f.Book(); var hash = Fixture.Hash(book);
                using var preparation = UpgradeSafety.Prepare(f.Data, [book]);
                Check.True(Directory.Exists(preparation.BackupDirectory), "No durable backup directory.");
                var stage = preparation.StagedDatabases.Single();
                Check.True(!Path.GetFullPath(stage).Equals(Path.GetFullPath(book), StringComparison.OrdinalIgnoreCase), "Migration stage aliases the source.");
                using var restored = SqliteLedgerStore.Open(stage);
                restored.CheckIntegrity();
                var snapshot = restored.Read();
                Check.Equal(1L, snapshot.Revision);
                Check.Equal(1234.56m, snapshot.Accounts.Single(x => x.Code == "1002").OpeningDebit);
                Check.Equal(1234.56m, snapshot.Accounts.Single(x => x.Code == "4001").OpeningCredit);
                Check.Equal(hash, Fixture.Hash(book));
            });
            yield return ("backup captures committed SQLite WAL records without copying only the main file", f =>
            {
                var book = f.Book();
                using var writer = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = book, Pooling = false }.ToString());
                writer.Open();
                using (var command = writer.CreateCommand())
                {
                    command.CommandText = "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;";
                    command.ExecuteNonQuery();
                    command.CommandText = "BEGIN IMMEDIATE; UPDATE ledger SET revision=2; UPDATE accounts SET opening_debit_cents=98765 WHERE code='1002'; UPDATE accounts SET opening_credit_cents=98765 WHERE code='4001'; COMMIT;";
                    command.ExecuteNonQuery();
                }
                Check.True(File.Exists(book + "-wal"), "The test did not establish a WAL-backed source.");
                using var preparation = UpgradeSafety.Prepare(f.Data, [book]);
                using var restored = SqliteLedgerStore.Open(preparation.StagedDatabases.Single());
                restored.CheckIntegrity();
                var snapshot = restored.Read();
                Check.Equal(2L, snapshot.Revision);
                Check.Equal(987.65m, snapshot.Accounts.Single(x => x.Code == "1002").OpeningDebit);
                Check.Equal(987.65m, snapshot.Accounts.Single(x => x.Code == "4001").OpeningCredit);
            });
            yield return ("successful staged migration does not mutate the live book", f =>
            {
                var book = f.Book(); var hash = Fixture.Hash(book);
                using var preparation = UpgradeSafety.Prepare(f.Data, [book], stage =>
                {
                    using var stagedStore = SqliteLedgerStore.Open(stage);
                    var before = stagedStore.Read();
                    stagedStore.Write(before with { Revision = before.Revision + 1, Book = before.Book with { Name = "已迁移的副本" } }, before.Revision);
                });
                using var migrated = SqliteLedgerStore.Open(preparation.StagedDatabases.Single());
                Check.Equal(2L, migrated.Read().Revision);
                Check.Equal("已迁移的副本", migrated.Read().Book.Name);
                Check.Equal(hash, Fixture.Hash(book));
            });
            yield return ("migration failure leaves every source unchanged and retains backup evidence", f =>
            {
                var a = f.Book("甲.caiwu"); var b = f.Book("乙.caiwu");
                var hashes = new[] { Fixture.Hash(a), Fixture.Hash(b) };
                Check.Reject(() => UpgradeSafety.Prepare(f.Data, [a, b], stage =>
                {
                    File.WriteAllText(stage, "deliberately corrupt only this staging copy");
                    throw new InvalidOperationException("Synthetic migration failure.");
                }));
                Check.Equal(hashes[0], Fixture.Hash(a)); Check.Equal(hashes[1], Fixture.Hash(b));
                var candidates = Directory.EnumerateFiles(f.Data, "*", SearchOption.AllDirectories)
                    .Where(x => !new[] { a, b }.Contains(x)).ToArray();
                Check.True(candidates.Any(x => new FileInfo(x).Length >= 4096), "Migration failure lost all backup evidence.");
                using var source = SqliteLedgerStore.Open(a); source.CheckIntegrity();
            });
            yield return ("a migration returning a corrupt stage is rejected", f =>
            {
                var book = f.Book(); var hash = Fixture.Hash(book);
                Check.Reject(() => UpgradeSafety.Prepare(f.Data, [book], stage => File.WriteAllText(stage, "not a SQLite database")));
                Check.Equal(hash, Fixture.Hash(book));
            });
            yield return ("backup preparation rejects corrupt source before migration", f =>
            {
                var book = Path.Combine(f.Data, "corrupt.caiwu"); File.WriteAllText(book, "bad database");
                var invoked = false;
                Check.Reject(() => UpgradeSafety.Prepare(f.Data, [book], _ => invoked = true));
                Check.True(!invoked, "Migration ran on an invalid source.");
                Check.Equal("bad database", File.ReadAllText(book));
            });
            yield return ("backup preparation rejects source outside its data root", f =>
            {
                var outside = f.BookAt(Path.Combine(f.Root, "outside.caiwu")); var hash = Fixture.Hash(outside);
                Check.Reject(() => UpgradeSafety.Prepare(f.Data, [outside]));
                Check.Equal(hash, Fixture.Hash(outside));
            });
            yield return ("backup preparation rejects duplicate source identities", f =>
            {
                var book = f.Book();
                Check.Reject(() => UpgradeSafety.Prepare(f.Data, [book, book]));
            });
            yield return ("same-schema managed upgrade activates only after backup validation", f =>
            {
                var book = f.Book(); var hash = Fixture.Hash(book); f.Inventory(book);
                Installation.Install(f.Payload("0.1.0.1", managed: true), f.Install, f.Data);
                Installation.Install(f.Payload("0.1.0.2", managed: true), f.Install, f.Data);
                Check.Equal("0.1.0.2", Installation.ReadCurrent(f.Install).Version);
                Check.Equal(hash, Fixture.Hash(book));
                Check.True(Directory.EnumerateFiles(f.Data, "*", SearchOption.AllDirectories)
                    .Any(x => x != book && new FileInfo(x).Length >= 4096), "Upgrade activated without a durable book backup.");
            });
            yield return ("a subsequent upgrade does not mistake protected backups for unregistered books", f =>
            {
                var book = f.Book(); var hash = Fixture.Hash(book); f.Inventory(book);
                Installation.Install(f.Payload("0.1.0.1", managed: true), f.Install, f.Data);
                Installation.Install(f.Payload("0.1.0.2", managed: true), f.Install, f.Data);
                Installation.Install(f.Payload("0.1.0.3", managed: true), f.Install, f.Data);
                Check.Equal("0.1.0.3", Installation.ReadCurrent(f.Install).Version);
                Check.Equal(hash, Fixture.Hash(book));
            });
            yield return ("invalid upgrade payload cannot replace an active version", f =>
            {
                var book = f.Book(); var hash = Fixture.Hash(book); f.Inventory(book);
                Installation.Install(f.Payload("0.1.0.1", managed: true), f.Install, f.Data);
                var next = f.Payload("0.1.0.2", managed: true);
                File.WriteAllText(Path.Combine(next, "support.dll"), "unexpected change");
                Check.Reject(() => Installation.Install(next, f.Install, f.Data));
                Check.Equal("0.1.0.1", Installation.ReadCurrent(f.Install).Version);
                Check.Equal(hash, Fixture.Hash(book));
            });
            yield return ("installation cannot downgrade an existing version", f =>
            {
                var book = f.Book(); f.Inventory(book);
                Installation.Install(f.Payload("0.1.0.2", managed: true), f.Install, f.Data);
                Check.Reject(() => Installation.Install(f.Payload("0.1.0.1", managed: true), f.Install, f.Data));
                Check.Equal("0.1.0.2", Installation.ReadCurrent(f.Install).Version);
            });
            foreach (var (name, policy, candidate, current) in RejectedUpdates())
                yield return (name, _ => Check.Reject(() => UpdateRules.Validate(policy, candidate, current)));
            yield return ("update policy permits a newer pinned-host candidate for later signature verification", _ =>
                UpdateRules.Validate(Policy(), Candidate(), "0.1.0.1"));
            foreach (var test in NetworkCases()) yield return test;
        }
    }

    private static UpdatePolicy Policy() => new(true, "https://updates.example.test/stable.json", ["updates.example.test"], [new string('A', 40)]);
    private static UpdateCandidate Candidate() => new("0.1.0.2", "https://updates.example.test/releases/caiwu-0.1.0.2.exe", new string('b', 64), 1024);
    private static IEnumerable<(string, UpdatePolicy, UpdateCandidate, string)> RejectedUpdates()
    {
        yield return ("updates disabled by default cannot stage a candidate", Policy() with { Enabled = false }, Candidate(), "0.1.0.1");
        yield return ("update feed must use HTTPS", Policy() with { FeedUrl = "http://updates.example.test/stable.json" }, Candidate(), "0.1.0.1");
        yield return ("update candidate cannot use HTTP", Policy(), Candidate() with { Url = "http://updates.example.test/caiwu.exe" }, "0.1.0.1");
        yield return ("update candidate cannot execute a local file URI", Policy(), Candidate() with { Url = "file:///C:/temp/caiwu.exe" }, "0.1.0.1");
        yield return ("update candidate must use an explicitly trusted host", Policy(), Candidate() with { Url = "https://evil.example.test/caiwu.exe" }, "0.1.0.1");
        yield return ("update host suffix does not satisfy an exact host pin", Policy(), Candidate() with { Url = "https://updates.example.test.evil.test/caiwu.exe" }, "0.1.0.1");
        yield return ("update URL cannot carry userinfo", Policy(), Candidate() with { Url = "https://attacker@updates.example.test/caiwu.exe" }, "0.1.0.1");
        yield return ("update host allowlist cannot be empty", Policy() with { AllowedHosts = [] }, Candidate(), "0.1.0.1");
        yield return ("update publisher pins cannot be empty", Policy() with { PublisherThumbprints = [] }, Candidate(), "0.1.0.1");
        yield return ("update publisher pins must identify a certificate", Policy() with { PublisherThumbprints = ["not-a-certificate-thumbprint"] }, Candidate(), "0.1.0.1");
        yield return ("update feed must also use a trusted host", Policy() with { FeedUrl = "https://evil.example.test/stable.json" }, Candidate(), "0.1.0.1");
        yield return ("update checksum must be a full SHA256", Policy(), Candidate() with { Sha256 = "1234" }, "0.1.0.1");
        yield return ("update checksum cannot contain nonhex characters", Policy(), Candidate() with { Sha256 = new string('z', 64) }, "0.1.0.1");
        yield return ("update size must be positive", Policy(), Candidate() with { Size = 0 }, "0.1.0.1");
        yield return ("update version cannot move backward", Policy(), Candidate() with { Version = "0.1.0.0" }, "0.1.0.1");
        yield return ("update version cannot replay current version", Policy(), Candidate() with { Version = "0.1.0.1" }, "0.1.0.1");
        yield return ("update version cannot contain a path", Policy(), Candidate() with { Version = "../0.1.0.2" }, "0.1.0.1");
    }

    private static IEnumerable<(string Name, Action<Fixture> Action)> NetworkCases()
    {
        yield return ("disabled update checks make no HTTP request", _ =>
        {
            var handler = new StubHttpHandler(_ => throw new InvalidOperationException("Unexpected HTTP request."));
            using var client = new UpdateClient(handler);
            Check.Reject(() => client.CheckAsync(Policy() with { Enabled = false }, "0.1.0.1").GetAwaiter().GetResult());
            Check.Equal(0, handler.Calls);
        });
        yield return ("update checks reject a redirect without requesting its destination", _ =>
        {
            var handler = new StubHttpHandler(_ => new HttpResponseMessage(HttpStatusCode.Found)
            { Headers = { Location = new Uri("https://evil.example.test/update.json") } });
            using var client = new UpdateClient(handler);
            Check.Reject(() => client.CheckAsync(Policy(), "0.1.0.1").GetAwaiter().GetResult());
            Check.Equal(1, handler.Calls);
            Check.Equal("updates.example.test", handler.LastUri!.Host);
        });
        yield return ("update checks return a safe newer candidate from the configured feed", _ =>
        {
            var expected = Candidate();
            var handler = new StubHttpHandler(_ => Feed(expected));
            using var client = new UpdateClient(handler);
            Check.Equal(expected, client.CheckAsync(Policy(), "0.1.0.1").GetAwaiter().GetResult());
            Check.Equal(new Uri(Policy().FeedUrl), handler.LastUri);
        });
        yield return ("valid current-version feed returns no available update", _ =>
        {
            var handler = new StubHttpHandler(_ => Feed(Candidate() with { Version = "0.1.0.1" }));
            using var client = new UpdateClient(handler);
            Check.True(client.CheckAsync(Policy(), "0.1.0.1").GetAwaiter().GetResult() == null, "A replayed version was offered as an update.");
        });
        yield return ("current-version feed still must provide a valid checksum", _ =>
        {
            var handler = new StubHttpHandler(_ => Feed(Candidate() with { Version = "0.1.0.1", Sha256 = "bad" }));
            using var client = new UpdateClient(handler);
            Check.Reject(() => client.CheckAsync(Policy(), "0.1.0.1").GetAwaiter().GetResult());
        });
        yield return ("update feed is bounded when Content-Length is absent", _ =>
        {
            var candidate = Candidate();
            var content = JsonSerializer.SerializeToUtf8Bytes(new
            { version = candidate.Version, url = candidate.Url, sha256 = candidate.Sha256, size = candidate.Size, padding = new string('x', 65537) });
            var handler = new StubHttpHandler(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new UnknownLengthContent(content) });
            using var client = new UpdateClient(handler);
            Check.Reject(() => client.CheckAsync(Policy(), "0.1.0.1").GetAwaiter().GetResult());
        });
        yield return ("download produces only a hash-verified untrusted staging file", f =>
        {
            var bytes = System.Text.Encoding.UTF8.GetBytes("synthetic bytes, intentionally not an executable");
            var candidate = Candidate() with { Size = bytes.Length, Sha256 = Convert.ToHexStringLower(SHA256.HashData(bytes)) };
            var handler = new StubHttpHandler(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) });
            using var client = new UpdateClient(handler);
            var staged = client.DownloadAsync(Policy(), candidate, "0.1.0.1", Path.Combine(f.Root, "download")).GetAwaiter().GetResult();
            Check.Equal(".untrusted", Path.GetExtension(staged));
            Check.Equal(candidate.Sha256, Fixture.Hash(staged).ToLowerInvariant());
            Check.Equal(candidate.Size, new FileInfo(staged).Length);
        });
        yield return ("download refuses a redirect and leaves no executable staging artifact", f =>
        {
            var handler = new StubHttpHandler(_ => new HttpResponseMessage(HttpStatusCode.Found)
            { Headers = { Location = new Uri("https://evil.example.test/installer.exe") } });
            using var client = new UpdateClient(handler);
            var stage = Path.Combine(f.Root, "download");
            Check.Reject(() => client.DownloadAsync(Policy(), Candidate(), "0.1.0.1", stage).GetAwaiter().GetResult());
            Check.Equal(1, handler.Calls);
            Check.True(!Directory.EnumerateFiles(stage).Any(), "Redirect left a staged artifact.");
        });
        yield return ("bad download SHA256 removes only its incomplete candidate", f =>
        {
            var bytes = System.Text.Encoding.UTF8.GetBytes("tampered bytes");
            var handler = new StubHttpHandler(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) });
            using var client = new UpdateClient(handler);
            var stage = Directory.CreateDirectory(Path.Combine(f.Root, "download")).FullName;
            var keep = Path.Combine(stage, "keep.txt"); File.WriteAllText(keep, "unrelated staged note");
            Check.Reject(() => client.DownloadAsync(Policy(), Candidate() with { Size = bytes.Length }, "0.1.0.1", stage).GetAwaiter().GetResult());
            Check.Equal("unrelated staged note", File.ReadAllText(keep));
            Check.Equal(1, Directory.EnumerateFiles(stage).Count());
        });
        foreach (var streamedSize in new[] { 127, 129 })
        {
            var actualSize = streamedSize;
            yield return ($"streamed download with {actualSize} bytes cannot satisfy 128-byte declaration", f =>
            {
                var bytes = new byte[actualSize];
                var handler = new StubHttpHandler(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new UnknownLengthContent(bytes) });
                using var client = new UpdateClient(handler);
                var stage = Path.Combine(f.Root, "download");
                Check.Reject(() => client.DownloadAsync(Policy(), Candidate() with { Size = 128 }, "0.1.0.1", stage).GetAwaiter().GetResult());
                Check.True(!Directory.EnumerateFiles(stage).Any(), "Invalid-sized download left a staged artifact.");
            });
        }
        yield return ("cancelled download leaves no staging artifact", f =>
        {
            var bytes = new byte[128];
            var handler = new StubHttpHandler(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) });
            using var client = new UpdateClient(handler);
            var stage = Path.Combine(f.Root, "download");
            Check.Reject(() => client.DownloadAsync(Policy(), Candidate() with { Size = bytes.Length }, "0.1.0.1", stage, new CancellationToken(true)).GetAwaiter().GetResult());
            Check.True(!Directory.EnumerateFiles(stage).Any(), "Cancelled download left a staged artifact.");
        });
    }

    private static HttpResponseMessage Feed(UpdateCandidate candidate) => new(HttpStatusCode.OK)
    {
        Content = new ByteArrayContent(JsonSerializer.SerializeToUtf8Bytes(new
        { version = candidate.Version, url = candidate.Url, sha256 = candidate.Sha256, size = candidate.Size }))
    };
}

internal sealed class Fixture : IDisposable
{
    public const string Commit = "97d696a3ee7adf100e24b4924438468bd34dd80c";
    public const string ManifestName = "payload-manifest.json";
    public string Root { get; } = Path.Combine(Path.GetTempPath(), "caiwu-delivery-tests-" + Guid.NewGuid().ToString("N"));
    public string Install { get; }
    public string Data { get; }
    public Fixture()
    {
        Install = Directory.CreateDirectory(Path.Combine(Root, "program")).FullName;
        Data = Directory.CreateDirectory(Path.Combine(Root, "books")).FullName;
    }

    public string Payload(string version, bool managed = false)
    {
        var payload = Directory.CreateDirectory(Path.Combine(Root, "payload-" + version)).FullName;
        File.WriteAllText(Path.Combine(payload, "Caiwu.Desktop.exe"), "synthetic application bytes " + version);
        File.WriteAllText(Path.Combine(payload, "support.dll"), "synthetic support module " + version);
        var manifest = PayloadManifest.Create(payload, version, Commit, managed);
        manifest.Write(Path.Combine(payload, ManifestName));
        return payload;
    }

    public string Book(string name = "synthetic.caiwu") => BookAt(Path.Combine(Data, name));
    public string BookAt(string path)
    {
        var book = new BookInfo(Guid.NewGuid(), "仅用于交付自动测试的合成账套", AccountingRegime.Enterprise,
            "synthetic-delivery-v1", 2026, 1, 0, new DateTimeOffset(2026, 10, 25, 0, 0, 0, TimeSpan.Zero));
        Account[] accounts =
        [
            new("1002", "测试银行", null, BalanceDirection.Debit, true, 1234.56m, 0m),
            new("4001", "测试资本", null, BalanceDirection.Credit, true, 0m, 1234.56m)
        ];
        using var store = SqliteLedgerStore.Create(path, book, accounts);
        var snapshot = store.Read();
        store.Write(snapshot with { Revision = 1, AuditEvents = [new(Guid.NewGuid(), book.CreatedAt, "交付测试", "合成样本", null, "没有真实财务数据")] }, 0);
        return path;
    }

    public void Inventory(params string[] databasePaths) => File.WriteAllText(Path.Combine(Data, "managed-books.json"),
        JsonSerializer.Serialize(new { contractVersion = 1, databasePaths }));

    public void DirectoryLink(string link, string target) => CreateLink(() => Directory.CreateSymbolicLink(link, target));
    public void FileLink(string link, string target) => CreateLink(() => File.CreateSymbolicLink(link, target));
    private static void CreateLink(Action action)
    {
        try { action(); }
        catch (UnauthorizedAccessException) when (OperatingSystem.IsWindows())
        { throw new TestSkipped("Windows host does not permit symlink creation; no system security setting was changed."); }
        catch (IOException ex) when (OperatingSystem.IsWindows() && (ex.HResult & 0xffff) == 1314)
        { throw new TestSkipped("Windows symlink privilege is unavailable; run this case on Linux or a preconfigured test runner."); }
    }

    public static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)));
    public void Dispose()
    {
        try { Directory.Delete(Root, recursive: true); }
        catch (IOException ex) { Console.Error.WriteLine($"Temporary fixture cleanup failed: {ex.Message}"); }
        catch (UnauthorizedAccessException ex) { Console.Error.WriteLine($"Temporary fixture cleanup failed: {ex.Message}"); }
    }
}

internal static class Check
{
    public static void True(bool value, string message)
    { if (!value) throw new InvalidOperationException(message); }
    public static void Equal<T>(T expected, T actual)
    { if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new InvalidOperationException($"Expected {expected}; actual {actual}."); }
    public static void Reject(Action action)
    {
        try { action(); }
        catch (Exception) { return; }
        throw new InvalidOperationException("Unsafe operation was accepted.");
    }
}

internal sealed class TestSkipped(string message) : Exception(message);

internal sealed class StubHttpHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
{
    public int Calls { get; private set; }
    public Uri? LastUri { get; private set; }
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Calls++; LastUri = request.RequestUri;
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(respond(request));
    }
}

internal sealed class UnknownLengthContent(byte[] bytes) : HttpContent
{
    protected override bool TryComputeLength(out long length) { length = 0; return false; }
    protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) => stream.WriteAsync(bytes).AsTask();
}

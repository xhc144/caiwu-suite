using Caiwu.Contracts;
using Caiwu.Delivery;
using Caiwu.Persistence.Sqlite;

internal static class ManagedModuleCases
{
    public static IEnumerable<(string Name, Action<Fixture> Action)> All
    {
        get
        {
            yield return ("managed: real session excludes installation, backup tools and competing data-root sessions", f =>
            {
                Setup(f);
                using var data = Installation.OpenManagedData(f.Install);
                Check.Reject(() => Installation.OpenManagedData(f.Install));
                Check.Reject(() => BookOperations.Inspect(f.Install, "synthetic.caiwu"));
                Check.Reject(() => Installation.Uninstall(f.Install));
                using var operation = data.AcquireOperationLease();
                Check.Equal(f.Data, data.DataRoot);
            });
            yield return ("managed: managed launcher hands real lease ownership to its child process", f =>
            {
                f.Book();
                var payload = f.Payload("0.1.0.1", managed: true);
                // Copy only this self-authored test host and its runtime dependencies. The copied
                // apphost still loads Caiwu.Delivery.Tests.dll, so its child entrypoint is exact.
                foreach (var source in Directory.EnumerateFiles(AppContext.BaseDirectory, "*", SearchOption.AllDirectories))
                {
                    var destination = Path.Combine(payload, Path.GetRelativePath(AppContext.BaseDirectory, source));
                    Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                    File.Copy(source, destination, true);
                }

                var app = Path.Combine(payload, "Caiwu.Desktop.exe");
                File.Copy(Path.Combine(AppContext.BaseDirectory, OperatingSystem.IsWindows() ? "Caiwu.Delivery.Tests.exe" : "Caiwu.Delivery.Tests"), app, true);
                if (!OperatingSystem.IsWindows())
                    File.SetUnixFileMode(app, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
                PayloadManifest.Create(payload, "0.1.0.1", Fixture.Commit, true).Write(Path.Combine(payload, PayloadManifest.FileName));
                Installation.Install(payload, f.Install, f.Data);
                var ready = Path.Combine(f.Root, "ready");
                var launched = Task.Run(() => ManagedDesktopLaunch.Launch(f.Install, ["--managed-lease-child", ready]));
                try
                {
                    var deadline = DateTime.UtcNow.AddSeconds(10);
                    while (!File.Exists(ready) && DateTime.UtcNow < deadline && !launched.IsCompleted)
                        Thread.Sleep(25);
                    Check.True(File.Exists(ready), "Child did not acquire the real leases.");
                    Check.Reject(() => Installation.OpenManagedData(f.Install));
                    Check.Reject(() => Installation.Uninstall(f.Install));
                }
                finally
                {
                    File.WriteAllText(ready + ".release", "release");
                    Check.Equal(0, launched.GetAwaiter().GetResult());
                }

                using var reopened = Installation.OpenManagedData(f.Install);
                Check.Equal(f.Data, reopened.DataRoot);
            });
            yield return ("managed: explicit host root must match receipt and unintegrated launch cannot enable ownership", f =>
            {
                f.Book();
                Installation.Install(f.Payload("0.1.0.1"), f.Install, f.Data);
                Check.Reject(() => Installation.OpenManagedData(f.Install, Path.Combine(f.Root, "wrong-data")));
                Check.Reject(() => ManagedDesktopLaunch.Launch(f.Install, []));
                Check.Reject(() => ManagedDesktopLaunch.OpenSession(f.Install, f.Data, Path.Combine(f.Install, "versions/0.0.0.0/Caiwu.Desktop.exe")));
                using var data = Installation.OpenManagedData(f.Install, f.Data);
                Check.Equal(f.Data, data.DataRoot);
            });
            yield return ("managed: destination and module paths reject external, reserved and escaping targets", f =>
            {
                var path = Setup(f);
                using var data = Installation.OpenManagedData(f.Install);
                var b = data.RegisterBook(path, Id(path));
                foreach (var p in new[]
                {
                    Path.Combine(f.Install, "bad.caiwu"),
                    Path.Combine(f.Root, "outside.caiwu"),
                    Path.Combine(f.Data, ".delivery-backups/bad.caiwu"),
                    Path.Combine(f.Data, "Global/bad.caiwu"),
                    path
                }

                )
                    Check.Reject(() => data.ValidateNewBookDestination(p));
                Check.Reject(() => data.ModulePath(b, "../escape", "bad.json"));
                Check.Reject(() => data.ModulePath(b, "summary", "../bad.json"));
                Check.Reject(() => data.RegisterBook(path, Guid.NewGuid()));
            });
            yield return ("managed: missing registered attachment blocks backup and preserves old data", f =>
            {
                var path = Setup(f);
                using var data = Installation.OpenManagedData(f.Install);
                var b = data.RegisterBook(path, Id(path));
                var codec = new SyntheticCodec();
                var file = Attach(data, b, codec);
                var backup = new ManagedBookBackup(data, [codec]).Backup(b);
                var before = Fixture.Hash(path);
                var valid = Fixture.Hash(Path.Combine(backup.Directory, "manifest.json"));
                File.Delete(file);
                Check.Reject(() => new ManagedBookBackup(data, [codec]).Backup(b));
                Check.Equal(before, Fixture.Hash(path));
                Check.Equal(valid, Fixture.Hash(Path.Combine(backup.Directory, "manifest.json")));
            });
            yield return ("managed: unregistered module and unknown codec cannot be called complete", f =>
            {
                var path = Setup(f);
                using var data = Installation.OpenManagedData(f.Install);
                var b = data.RegisterBook(path, Id(path));
                var codec = new SyntheticCodec();
                var file = Attach(data, b, codec);
                Check.Reject(() => new ManagedBookBackup(data, []).Backup(b));
                var unknown = Path.Combine(Path.GetDirectoryName(file)!, "unknown.json");
                File.WriteAllText(unknown, "unknown");
                Check.Reject(() => new ManagedBookBackup(data, [codec]).Backup(b));
            });
            yield return ("managed: attachment conflicts retry only to configured bound and never publish mixed data", f =>
            {
                var path = Setup(f);
                using var data = Installation.OpenManagedData(f.Install);
                var b = data.RegisterBook(path, Id(path));
                var codec = new SyntheticCodec();
                var file = Attach(data, b, codec);
                var calls = 0;
                codec.OnExport = () =>
                {
                    calls++;
                    File.AppendAllText(file, "changed");
                };
                Check.Reject(() => new ManagedBookBackup(data, [codec]).Backup(b, 2));
                Check.Equal(2, calls);
                Check.True(!Directory.Exists(Path.Combine(f.Data, ".delivery-backups/managed")), "Published mixed backup.");
                Check.True(!Directory.EnumerateFileSystemEntries(Path.Combine(f.Data, ".delivery-scratch")).Any(), "Failed capture left scratch data.");
            });
            yield return ("managed: ledger revision change forces recapture and captures a stable revision", f =>
            {
                var path = Setup(f);
                using var data = Installation.OpenManagedData(f.Install);
                var b = data.RegisterBook(path, Id(path));
                var codec = new SyntheticCodec();
                Attach(data, b, codec);
                var calls = 0;
                codec.OnExport = () =>
                {
                    if (calls++ != 0)
                        return;
                    using var store = SqliteLedgerStore.Open(path);
                    var s = store.Read();
                    store.Write(s with { Revision = s.Revision + 1, Book = s.Book with { Name = "after change" } }, s.Revision);
                };
                var result = new ManagedBookBackup(data, [codec]).Backup(b, 2);
                Check.Equal(2, calls);
                Check.Equal(2L, result.Manifest.LedgerRevision);
            });
            yield return ("managed: corruption and wrong receipt reject restore without changing source or valid backup", f =>
            {
                var path = Setup(f);
                using var data = Installation.OpenManagedData(f.Install);
                var b = data.RegisterBook(path, Id(path));
                var codec = new SyntheticCodec();
                Attach(data, b, codec);
                var service = new ManagedBookBackup(data, [codec]);
                var backup = service.Backup(b);
                var before = Fixture.Hash(path);
                Check.Reject(() => service.Restore(backup.Directory, new string ('0', 64)));
                File.AppendAllText(Path.Combine(backup.Directory, "attachments/000000.json"), "corrupt");
                Check.Reject(() => service.Restore(backup.Directory, backup.ManifestSha256));
                Check.Equal(before, Fixture.Hash(path));
                Check.Equal(1, data.ReadInventory().Books.Length);
            });
            yield return ("managed: even a rehashed manifest cannot escape restore paths or invoke an unknown codec", f =>
            {
                var path = Setup(f);
                using var data = Installation.OpenManagedData(f.Install);
                var b = data.RegisterBook(path, Id(path));
                var codec = new SyntheticCodec();
                Attach(data, b, codec);
                var service = new ManagedBookBackup(data, [codec]);
                var backup = service.Backup(b);
                var manifestPath = Path.Combine(backup.Directory, "manifest.json");
                foreach (var altered in new[]
                {
                    backup.Manifest.Attachments[0] with
                    {
                        ModulePath = "../escaped.json"
                    },
                    backup.Manifest.Attachments[0] with
                    {
                        Codec = "unknown-codec"
                    },
                    backup.Manifest.Attachments[0] with
                    {
                        BackupPath = "../outside.json"
                    }
                }

                )
                {
                    var changed = backup.Manifest with
                    {
                        Attachments = [altered]
                    };
                    File.WriteAllText(manifestPath, System.Text.Json.JsonSerializer.Serialize(changed, PayloadManifest.Json));
                    Check.Reject(() => service.Restore(backup.Directory, PayloadManifest.Hash(manifestPath)));
                }

                Check.Equal(1, data.ReadInventory().Books.Length);
                Check.True(!File.Exists(Path.Combine(f.Data, "escaped.json")), "Restore wrote an escaped target.");
            });
            yield return ("managed: restore codec failure cleans only its own unpublished stage", f =>
            {
                var path = Setup(f);
                using var data = Installation.OpenManagedData(f.Install);
                var b = data.RegisterBook(path, Id(path));
                var codec = new SyntheticCodec();
                Attach(data, b, codec);
                var service = new ManagedBookBackup(data, [codec]);
                var backup = service.Backup(b);
                var hash = Fixture.Hash(path);
                var backupHash = Fixture.Hash(Path.Combine(backup.Directory, "manifest.json"));
                var sentinel = Path.Combine(f.Data, ".delivery-scratch", "keep");
                File.WriteAllText(sentinel, "keep");
                codec.FailRestore = true;
                Check.Reject(() => service.Restore(backup.Directory, backup.ManifestSha256));
                Check.Equal(hash, Fixture.Hash(path));
                Check.Equal(backupHash, Fixture.Hash(Path.Combine(backup.Directory, "manifest.json")));
                Check.Equal("keep", File.ReadAllText(sentinel));
                Check.Equal(1, data.ReadInventory().Books.Length);
            });
            yield return ("managed: restored physical copy has independent attachment ownership and survives uninstall", f =>
            {
                var path = Setup(f);
                ManagedBookRestoreResult restored;
                string backupPath;
                string attachmentPath;
                using (var data = Installation.OpenManagedData(f.Install))
                {
                    var b = data.RegisterBook(path, Id(path));
                    var codec = new SyntheticCodec();
                    var file = Attach(data, b, codec);
                    var service = new ManagedBookBackup(data, [codec]);
                    var backup = service.Backup(b);
                    backupPath = backup.Directory;
                    File.WriteAllText(file, "source later");
                    restored = service.Restore(backup.Directory, backup.ManifestSha256);
                    Check.True(restored.Book.InstanceId != b.InstanceId, "Aliased restored instance.");
                    Check.Equal(b.BookId, restored.Book.BookId);
                    using (var original = SqliteLedgerStore.Open(path))
                    using (var copy = SqliteLedgerStore.Open(restored.DatabasePath))
                        Check.Equal(original.Read().Revision, copy.Read().Revision);
                    Check.Equal("source later", File.ReadAllText(file));
                    var a = data.ReadInventory().Attachments.Single(x => x.InstanceId == restored.Book.InstanceId);
                    attachmentPath = Path.Combine(f.Data, a.RelativePath);
                    Check.Equal("synthetic-v1", File.ReadAllText(attachmentPath));
                    Check.True(!attachmentPath.Equals(file, StringComparison.OrdinalIgnoreCase), "Restored attachment aliased the active book's file.");
                    File.WriteAllText(attachmentPath, "edited restored copy");
                    Check.Equal("source later", File.ReadAllText(file));
                    Check.Equal(2, UpgradeSafety.ReadInventory(f.Data).Length);
                }

                var before = Fixture.Hash(restored.DatabasePath);
                Installation.Uninstall(f.Install);
                Check.Equal(before, Fixture.Hash(restored.DatabasePath));
                Check.True(File.Exists(attachmentPath) && Directory.Exists(backupPath), "Uninstall removed module data.");
            });
            yield return ("managed: legacy book-only backup cannot silently omit registered modules", f =>
            {
                var path = Setup(f);
                using (var data = Installation.OpenManagedData(f.Install))
                {
                    var b = data.RegisterBook(path, Id(path));
                    Attach(data, b, new SyntheticCodec());
                }

                Check.Reject(() => BookOperations.Backup(f.Install, "synthetic.caiwu", ".delivery-backups/incomplete.caiwu"));
                Check.True(!File.Exists(Path.Combine(f.Data, ".delivery-backups/incomplete.caiwu")), "Incomplete legacy backup was published.");
                Check.Reject(() => UpgradeSafety.Prepare(f.Data, [path]));
            });
            yield return ("managed: upgrade without validated module codecs preserves original activation and all data", f =>
            {
                var path = Setup(f);
                string attachment;
                using (var data = Installation.OpenManagedData(f.Install))
                {
                    var b = data.RegisterBook(path, Id(path));
                    attachment = Attach(data, b, new SyntheticCodec());
                }

                var hash = Fixture.Hash(path);
                var moduleHash = Fixture.Hash(attachment);
                var next = f.Payload("0.1.0.2", managed: true);
                Check.Reject(() => Installation.Install(next, f.Install, f.Data));
                Check.Equal("0.1.0.1", Installation.ReadCurrent(f.Install).Version);
                Check.Equal(hash, Fixture.Hash(path));
                Check.Equal(moduleHash, Fixture.Hash(attachment));
            });
            yield return ("managed: successful upgrade captures complete module bundle before activation and uninstall preserves it", f =>
            {
                var path = Setup(f);
                string attachment;
                using (var data = Installation.OpenManagedData(f.Install))
                {
                    var b = data.RegisterBook(path, Id(path));
                    attachment = Attach(data, b, new SyntheticCodec());
                }

                var hash = Fixture.Hash(path);
                var moduleHash = Fixture.Hash(attachment);
                Installation.Install(f.Payload("0.1.0.2", managed: true), f.Install, f.Data, [new SyntheticCodec()]);
                Check.Equal("0.1.0.2", Installation.ReadCurrent(f.Install).Version);
                Check.Equal(hash, Fixture.Hash(path));
                Check.Equal(moduleHash, Fixture.Hash(attachment));
                var bundles = Directory.EnumerateFiles(Path.Combine(f.Data, ".delivery-backups/managed"), "manifest.json", SearchOption.AllDirectories).ToArray();
                Check.Equal(1, bundles.Length);
                var receipt = Directory.EnumerateFiles(Path.Combine(f.Data, ".delivery-backups"), "backup-receipt.json", SearchOption.AllDirectories).Single();
                using (var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(receipt)))
                    Check.Equal(1, doc.RootElement.GetProperty("moduleBackups").GetArrayLength());
                Installation.Uninstall(f.Install);
                Check.Equal(hash, Fixture.Hash(path));
                Check.Equal(moduleHash, Fixture.Hash(attachment));
                Check.True(File.Exists(bundles[0]), "Uninstall removed complete backup.");
            });
            yield return ("managed: upgrade rejects missing attachment before changing activation", f =>
            {
                var path = Setup(f);
                using (var data = Installation.OpenManagedData(f.Install))
                {
                    var b = data.RegisterBook(path, Id(path));
                    var file = Attach(data, b, new SyntheticCodec());
                    File.Delete(file);
                }

                var hash = Fixture.Hash(path);
                Check.Reject(() => Installation.Install(f.Payload("0.1.0.2", managed: true), f.Install, f.Data, [new SyntheticCodec()]));
                Check.Equal("0.1.0.1", Installation.ReadCurrent(f.Install).Version);
                Check.Equal(hash, Fixture.Hash(path));
            });
            yield return ("managed: cross-thread operation token retains real leases through session shutdown", f =>
            {
                Setup(f);
                var data = Installation.OpenManagedData(f.Install);
                var token = Task.Run(data.AcquireOperationLease).GetAwaiter().GetResult();
                data.Dispose();
                Check.Reject(() => Installation.OpenManagedData(f.Install));
                Task.Run(token.Dispose).GetAwaiter().GetResult();
                using var reopened = Installation.OpenManagedData(f.Install);
                Check.Equal(f.Data, reopened.DataRoot);
            });
            yield return ("managed: upgrade refuses orphaned module directories and async lease escape", f =>
            {
                var path = Setup(f);
                using (var data = Installation.OpenManagedData(f.Install))
                {
                    data.RegisterBook(path, Id(path));
                    var called = false;
                    Check.Reject(() => data.Execute(() =>
                    {
                        called = true;
                        return Task.CompletedTask;
                    }));
                    Check.True(!called, "Async operation started outside the synchronous lease contract.");
                }

                var orphan = Path.Combine(f.Data, "Books", Guid.NewGuid().ToString("N"), "Modules", "unknown");
                Directory.CreateDirectory(orphan);
                File.WriteAllText(Path.Combine(orphan, "lost.json"), "preserve orphan");
                Check.Reject(() => Installation.Install(f.Payload("0.1.0.2", managed: true), f.Install, f.Data, [new SyntheticCodec()]));
                Check.Equal("0.1.0.1", Installation.ReadCurrent(f.Install).Version);
                Check.Equal("preserve orphan", File.ReadAllText(Path.Combine(orphan, "lost.json")));
            });
            yield return ("managed: module symlinks reject backup without reading external file", f =>
            {
                var path = Setup(f);
                using var data = Installation.OpenManagedData(f.Install);
                var b = data.RegisterBook(path, Id(path));
                var codec = new SyntheticCodec();
                var file = Attach(data, b, codec);
                File.Delete(file);
                var outside = Path.Combine(f.Root, "outside.json");
                File.WriteAllText(outside, "outside");
                f.FileLink(file, outside);
                Check.Reject(() => new ManagedBookBackup(data, [codec]).Backup(b));
                Check.Equal("outside", File.ReadAllText(outside));
            });
        }
    }

    private static string Setup(Fixture f)
    {
        var path = f.Book();
        Installation.Install(f.Payload("0.1.0.1", managed: true), f.Install, f.Data);
        return path;
    }

    private static Guid Id(string path)
    {
        using var store = SqliteLedgerStore.Open(path);
        return store.Read().Book.Id;
    }

    private static string Attach(ManagedDataSession data, ManagedBook book, SyntheticCodec codec)
    {
        var path = data.ModulePath(book, "synthetic", "test.json");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, "synthetic-v1");
        data.RegisterAttachment(book, "synthetic", codec.Id, path, codec);
        return path;
    }

    private sealed class SyntheticCodec : IManagedAttachmentCodec
    {
        public string Id => "synthetic-test-only";

        public Action? OnExport;
        public bool FailRestore;
        public string ReadVersion(string path, LedgerSnapshot snapshot) => PayloadManifest.Hash(path);
        public void Export(string source, string destination, LedgerSnapshot snapshot)
        {
            File.Copy(source, destination, false);
            OnExport?.Invoke();
        }

        public void Restore(string source, string destination, LedgerSnapshot snapshot)
        {
            File.Copy(source, destination, false);
            if (FailRestore)
                throw new IOException("Synthetic partial restore failure");
        }
    }
}

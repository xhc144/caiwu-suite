using System.Text.Json;
using Caiwu.Delivery;
using Caiwu.Persistence.Sqlite;
using Microsoft.Data.Sqlite;

/// <summary>
/// Independent counterexamples. Select only these cases with
/// CAIWU_DELIVERY_TEST_SCOPE=security-boundaries. No published Windows executable is run.
/// </summary>
internal static class SecurityBoundaryCases
{
    public static IEnumerable<(string Name, Action<Fixture> Action)> All
    {
        get
        {
            yield return ("security: a forged active manifest cannot turn a user book into uninstall-owned content", f =>
            {
                var state = Setup(f);
                var userBook = f.BookAt(Path.Combine(state.VersionRoot, "user-book.caiwu"));
                var userHash = Fixture.Hash(userBook);
                var original = PayloadManifest.Read(state.ManifestPath);
                var entry = new PayloadFile("user-book.caiwu", new FileInfo(userBook).Length, userHash.ToLowerInvariant());
                (original with { Files = [.. original.Files, entry] }).Write(state.ManifestPath);
                // The counterexample uses valid record JSON, a valid path, a real database and its exact checksum.
                var reread = PayloadManifest.Read(state.ManifestPath);
                Check.Equal(entry, reread.Files.Single(x => x.Path == entry.Path));
                using (var validBook = SqliteLedgerStore.Open(userBook)) validBook.CheckIntegrity();
                Check.Equal(entry.Sha256, PayloadManifest.Hash(userBook));
                var manifestHash = Fixture.Hash(state.ManifestPath);

                var error = Capture(() => Installation.Uninstall(f.Install));
                var facts = new
                {
                    userBookPresent = File.Exists(userBook), userBookUnchanged = HashOrNull(userBook) == userHash,
                    pointerPresent = File.Exists(state.PointerPath), pointerUnchanged = HashOrNull(state.PointerPath) == state.PointerHash,
                    programPresent = File.Exists(state.ApplicationPath), programUnchanged = HashOrNull(state.ApplicationPath) == state.ApplicationHash,
                    tamperedManifestUnchanged = HashOrNull(state.ManifestPath) == manifestHash
                };
                Require(error != null && facts.userBookUnchanged && facts.pointerUnchanged && facts.programUnchanged && facts.tamperedManifestUnchanged,
                    "Tampered active ownership must be rejected before deleting any user/program file or pointer.", error, facts);
            });
            yield return ("security: an unknown version directory with a valid forged manifest stays user-owned", f =>
            {
                var state = Setup(f);
                var unknown = Directory.CreateDirectory(Path.Combine(f.Install, "versions", "9.9.9.9")).FullName;
                var userFile = Path.Combine(unknown, "user-owned-records.txt");
                File.WriteAllText(userFile, "Synthetic user records; this directory was never installed by the product.");
                var fakeManifestPath = Path.Combine(unknown, PayloadManifest.FileName);
                PayloadManifest.Create(unknown, "9.9.9.9", Fixture.Commit).Write(fakeManifestPath);
                PayloadManifest.Read(fakeManifestPath).Verify(unknown); // A structural/schema failure cannot make this case pass.
                var userHash = Fixture.Hash(userFile); var fakeHash = Fixture.Hash(fakeManifestPath);

                var error = Capture(() => Installation.Uninstall(f.Install));
                var facts = new
                {
                    unknownUserFilePresent = File.Exists(userFile), unknownUserFileUnchanged = HashOrNull(userFile) == userHash,
                    unknownManifestPresent = File.Exists(fakeManifestPath), unknownManifestUnchanged = HashOrNull(fakeManifestPath) == fakeHash,
                    pointerPresent = File.Exists(state.PointerPath), programPresent = File.Exists(state.ApplicationPath)
                };
                Require(facts.unknownUserFileUnchanged && facts.unknownManifestUnchanged,
                    "An on-disk manifest is not proof that an unknown version directory belongs to the installer.", error, facts);
            });
            yield return ("security: an unknown directory link cannot leave an active pointer after program deletion", f =>
            {
                var state = Setup(f);
                var outside = Directory.CreateDirectory(Path.Combine(f.Root, "outside-user-content")).FullName;
                var externalFile = Path.Combine(outside, "preserve.txt"); File.WriteAllText(externalFile, "external synthetic user file");
                var externalHash = Fixture.Hash(externalFile);
                var unknown = Directory.CreateDirectory(Path.Combine(state.VersionRoot, "user-documents")).FullName;
                var link = Path.Combine(unknown, "external-link"); f.DirectoryLink(link, outside);

                var error = Capture(() => Installation.Uninstall(f.Install));
                var pointerPresent = File.Exists(state.PointerPath); var programPresent = File.Exists(state.ApplicationPath);
                var facts = new
                {
                    pointerPresent, programPresent, tornActiveInstallation = pointerPresent && !programPresent,
                    pointerUnchanged = HashOrNull(state.PointerPath) == state.PointerHash,
                    programUnchanged = HashOrNull(state.ApplicationPath) == state.ApplicationHash,
                    manifestUnchanged = HashOrNull(state.ManifestPath) == state.ManifestHash,
                    externalFileUnchanged = HashOrNull(externalFile) == externalHash,
                    unknownLinkStillPresent = new DirectoryInfo(link).LinkTarget != null
                };
                // Either preflight rejects without changing managed content, or uninstall cleanly deactivates
                // while retaining the unknown link. Deleting first and then failing is never acceptable.
                var coherent = error == null ? !pointerPresent && !programPresent :
                    facts.pointerUnchanged && facts.programUnchanged && facts.manifestUnchanged;
                Require(coherent && !facts.tornActiveInstallation && facts.externalFileUnchanged && facts.unknownLinkStillPresent,
                    "Unknown content must not trigger an exception after managed files have already been deleted.", error, facts);
            });
            yield return ("security: a data-only session lease prevents uninstall before any mutation", f =>
            {
                var state = Setup(f);
                Exception? error;
                using (var lease = new FileStream(Path.Combine(f.Data, ".delivery-data.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
                    error = Capture(() => Installation.Uninstall(f.Install));
                var facts = StateFacts(state);
                Require(error != null && facts.PointerUnchanged && facts.ProgramUnchanged && facts.OwnerUnchanged && facts.BookUnchanged,
                    "Uninstall must honor the shared ledger-session lease, even when the install-root lease is free.", error, facts);
            });
            yield return ("security: interrupted data receipt advancement cannot launch an older active program", f =>
            {
                if (!OperatingSystem.IsLinux())
                    throw new TestSkipped("This execution sentinel is a self-authored POSIX script; no Windows executable is substituted or run.");
                var payload = f.Payload("0.1.0.1");
                var script = Path.Combine(payload, "Caiwu.Desktop.exe");
                File.WriteAllText(script, "#!/bin/sh\nprintf 'self-authored sentinel executed\\n' > \"$1\"\nexit 0\n");
                File.SetUnixFileMode(script, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
                PayloadManifest.Create(payload, "0.1.0.1", Fixture.Commit).Write(Path.Combine(payload, PayloadManifest.FileName));
                var state = Setup(f, payload);
                File.SetUnixFileMode(state.ApplicationPath, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
                var positiveMarker = Path.Combine(f.Root, "positive-control.txt");
                Check.Equal(0, Installation.Launch(f.Install, [positiveMarker]));
                Check.True(File.Exists(positiveMarker), "Sentinel positive control could not execute; this is not proof of a safety rejection.");
                AdvanceDataReceipt(f);
                var changedReceiptHash = Fixture.Hash(Path.Combine(f.Data, Installation.DataOwnerFile));
                var forbiddenMarker = Path.Combine(f.Root, "must-not-execute.txt");

                var error = Capture(() => Installation.Launch(f.Install, [forbiddenMarker]));
                var facts = new
                {
                    positiveControlExecuted = File.Exists(positiveMarker), forbiddenProgramExecuted = File.Exists(forbiddenMarker),
                    pointerUnchanged = HashOrNull(state.PointerPath) == state.PointerHash,
                    programUnchanged = HashOrNull(state.ApplicationPath) == state.ApplicationHash,
                    advancedReceiptUnchanged = HashOrNull(Path.Combine(f.Data, Installation.DataOwnerFile)) == changedReceiptHash,
                    externalBookUnchanged = HashOrNull(state.BookPath) == state.BookHash
                };
                Require(error != null && !facts.forbiddenProgramExecuted && facts.pointerUnchanged && facts.programUnchanged &&
                    facts.advancedReceiptUnchanged && facts.externalBookUnchanged,
                    "Receipt/current disagreement must be detected before starting the executable.", error, facts);
            });
            yield return ("security: interrupted data receipt advancement cannot uninstall the older active program", f =>
            {
                var state = Setup(f); AdvanceDataReceipt(f);
                var changedReceiptHash = Fixture.Hash(Path.Combine(f.Data, Installation.DataOwnerFile));
                var error = Capture(() => Installation.Uninstall(f.Install));
                var facts = StateFacts(state);
                var receiptUnchanged = HashOrNull(Path.Combine(f.Data, Installation.DataOwnerFile)) == changedReceiptHash;
                Require(error != null && facts.PointerUnchanged && facts.ProgramUnchanged && facts.OwnerUnchanged && facts.BookUnchanged && receiptUnchanged,
                    "Receipt/current disagreement requires recovery before uninstall can alter managed content.", error,
                    new { state = facts, advancedReceiptUnchanged = receiptUnchanged });
            });
            yield return ("security: a valid migrated stage for a different book must not be marked upgrade-ready", f =>
            {
                var state = Setup(f);
                Guid sourceId;
                using (var source = SqliteLedgerStore.Open(state.BookPath)) sourceId = source.Read().Book.Id;
                var otherId = Guid.Parse("5a901736-2bef-4ee9-b01f-7129c83c57cb");
                string? migratedPath = null; var callbackRan = false;
                UpgradePreparation? preparation = null;
                Exception? error;
                using (Installation.AcquireLease(f.Install))
                using (var dataLease = new FileStream(Path.Combine(f.Data, ".delivery-data.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
                    error = Capture(() => preparation = UpgradeSafety.Prepare(f.Data, [state.BookPath], stage =>
                    {
                        migratedPath = stage; callbackRan = true;
                        using var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = stage, Pooling = false }.ToString());
                        db.Open(); using var command = db.CreateCommand();
                        command.CommandText = "UPDATE ledger SET book_id=$other";
                        command.Parameters.AddWithValue("$other", otherId.ToString("D")); command.ExecuteNonQuery();
                    }));
                try
                {
                    Check.True(callbackRan && migratedPath != null, "Identity counterexample did not reach its migration callback.");
                    using var validStage = SqliteLedgerStore.Open(migratedPath!); validStage.CheckIntegrity();
                    var stageHasDifferentValidIdentity = validStage.Read().Book.Id == otherId && sourceId != otherId;
                    var receiptPath = Directory.EnumerateFiles(Path.Combine(f.Data, ".delivery-backups"), "backup-receipt.json", SearchOption.AllDirectories).Single();
                    using var receipt = JsonDocument.Parse(File.ReadAllText(receiptPath));
                    var status = receipt.RootElement.GetProperty("status").GetString();
                    var backupPath = receipt.RootElement.GetProperty("entries")[0].GetProperty("backup").GetString()!;
                    using var originalBackup = SqliteLedgerStore.Open(backupPath); originalBackup.CheckIntegrity();
                    var facts = new
                    {
                        callbackRan, stageHasDifferentValidIdentity, preparationReturned = preparation != null, receiptStatus = status,
                        liveBookUnchanged = HashOrNull(state.BookPath) == state.BookHash,
                        originalBackupRetained = originalBackup.Read().Book.Id == sourceId
                    };
                    Require(error != null && preparation == null && stageHasDifferentValidIdentity && status == "blocked" &&
                        facts.liveBookUnchanged && facts.originalBackupRetained,
                        "SQLite integrity alone does not bind a migrated copy to the original ledger identity.", error, facts);
                }
                finally { preparation?.Dispose(); }
            });
            yield return ("security: an inactive owned manifest is preflighted before deleting the newer current program", f =>
            {
                var book = f.Book(); f.Inventory(book);
                // Ordinal ordering puts 0.1.0.10 BEFORE 0.1.0.9. A per-version delete-then-check
                // implementation would destroy the current program before inspecting this older entry.
                Installation.Install(f.Payload("0.1.0.9", managed: true), f.Install, f.Data);
                Installation.Install(f.Payload("0.1.0.10", managed: true), f.Install, f.Data);
                var pointerPath = Path.Combine(f.Install, Installation.CurrentFile); var pointerHash = Fixture.Hash(pointerPath);
                var ownerPath = Path.Combine(f.Install, Installation.OwnerFile); var ownerHash = Fixture.Hash(ownerPath);
                var owner = JsonSerializer.Deserialize<InstallationOwner>(File.ReadAllText(ownerPath), PayloadManifest.Json)!;
                Check.True(owner.VersionManifests?.ContainsKey("0.1.0.9") == true && owner.VersionManifests.ContainsKey("0.1.0.10"),
                    "The fixture did not register both genuinely installed versions.");
                var oldRoot = Path.Combine(f.Install, "versions", "0.1.0.9");
                var currentApp = Path.Combine(f.Install, "versions", "0.1.0.10", "Caiwu.Desktop.exe");
                var oldApp = Path.Combine(oldRoot, "Caiwu.Desktop.exe");
                var currentHash = Fixture.Hash(currentApp); var oldHash = Fixture.Hash(oldApp);
                var userFile = Path.Combine(oldRoot, "user-owned-note.txt"); File.WriteAllText(userFile, "synthetic user note in a genuinely old version");
                var userHash = Fixture.Hash(userFile);
                var manifestPath = Path.Combine(oldRoot, PayloadManifest.FileName);
                var manifest = PayloadManifest.Read(manifestPath);
                (manifest with { Files = [.. manifest.Files, new PayloadFile("user-owned-note.txt", new FileInfo(userFile).Length, userHash.ToLowerInvariant())] }).Write(manifestPath);
                PayloadManifest.Read(manifestPath).Verify(oldRoot); // Valid bytes/paths; only the ownership digest disagrees.
                var tamperedHash = Fixture.Hash(manifestPath);

                var error = Capture(() => Installation.Uninstall(f.Install));
                var facts = new
                {
                    currentProgramUnchanged = HashOrNull(currentApp) == currentHash,
                    inactiveProgramUnchanged = HashOrNull(oldApp) == oldHash,
                    pointerUnchanged = HashOrNull(pointerPath) == pointerHash,
                    ownerUnchanged = HashOrNull(ownerPath) == ownerHash,
                    userFileUnchanged = HashOrNull(userFile) == userHash,
                    tamperedInactiveManifestUnchanged = HashOrNull(manifestPath) == tamperedHash,
                    uninstallMarkerCreated = Path.Exists(Path.Combine(f.Install, Installation.UninstallPendingFile))
                };
                Require(error != null && facts.currentProgramUnchanged && facts.inactiveProgramUnchanged && facts.pointerUnchanged &&
                    facts.ownerUnchanged && facts.userFileUnchanged && facts.tamperedInactiveManifestUnchanged && !facts.uninstallMarkerCreated,
                    "Every owned manifest must pass preflight before any version is deleted or deactivated.", error, facts);
            });
            yield return ("security: a same-identity migration cannot move the ledger revision backward", f =>
            {
                var state = Setup(f); Guid sourceId;
                using (var source = SqliteLedgerStore.Open(state.BookPath)) sourceId = source.Read().Book.Id;
                string? stagedPath = null; var callbackRan = false; UpgradePreparation? preparation = null;
                Exception? error;
                using (Installation.AcquireLease(f.Install))
                using (var lease = new FileStream(Path.Combine(f.Data, ".delivery-data.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
                    error = Capture(() => preparation = UpgradeSafety.Prepare(f.Data, [state.BookPath], stage =>
                    {
                        callbackRan = true; stagedPath = stage;
                        using var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = stage, Pooling = false }.ToString());
                        db.Open(); using var command = db.CreateCommand(); command.CommandText = "UPDATE ledger SET revision=0"; command.ExecuteNonQuery();
                    }));
                try
                {
                    Check.True(callbackRan && stagedPath != null, "Revision counterexample did not reach migration.");
                    using var staged = SqliteLedgerStore.Open(stagedPath!); staged.CheckIntegrity(); var snapshot = staged.Read();
                    var receiptPath = Directory.EnumerateFiles(Path.Combine(f.Data, ".delivery-backups"), "backup-receipt.json", SearchOption.AllDirectories).Single();
                    using var receipt = JsonDocument.Parse(File.ReadAllText(receiptPath));
                    var backupPath = receipt.RootElement.GetProperty("entries")[0].GetProperty("backup").GetString()!;
                    using var backup = SqliteLedgerStore.Open(backupPath); backup.CheckIntegrity();
                    var facts = new
                    {
                        callbackRan, stageStillHasSourceIdentity = snapshot.Book.Id == sourceId, stagedRevision = snapshot.Revision,
                        originalBackupRevision = backup.Read().Revision, originalBackupIdentity = backup.Read().Book.Id == sourceId,
                        receiptStatus = receipt.RootElement.GetProperty("status").GetString(), preparationReturned = preparation != null,
                        liveBookUnchanged = HashOrNull(state.BookPath) == state.BookHash
                    };
                    Require(error != null && preparation == null && facts.stageStillHasSourceIdentity && facts.stagedRevision == 0 &&
                        facts.originalBackupRevision == 1 && facts.originalBackupIdentity && facts.receiptStatus == "blocked" && facts.liveBookUnchanged,
                        "A lower revision is not a valid upgrade even when SQLite integrity and BookId remain valid.", error, facts);
                }
                finally { preparation?.Dispose(); }
            });
            yield return ("security: caiwubak and rollback-journal files cannot enter a program payload", f =>
            {
                var positive = f.Payload("0.1.0.1"); PayloadManifest.Read(Path.Combine(positive, PayloadManifest.FileName)).Verify(positive);
                foreach (var name in new[] { "ledger.caiwubak", "ledger.caiwu-journal" })
                {
                    var payload = Directory.CreateDirectory(Path.Combine(f.Root, "payload-" + name)).FullName;
                    File.WriteAllText(Path.Combine(payload, "Caiwu.Desktop.exe"), "synthetic application bytes");
                    var dataFile = Path.Combine(payload, name); File.WriteAllText(dataFile, "synthetic ledger backup/journal bytes");
                    var originalHash = Fixture.Hash(dataFile); PayloadManifest? manifest = null;
                    var error = Capture(() => manifest = PayloadManifest.Create(payload, "0.1.0.1", Fixture.Commit));
                    var facts = new
                    {
                        filename = name, sourceFileUnchanged = HashOrNull(dataFile) == originalHash,
                        manifestReturned = manifest != null, manifestWritten = File.Exists(Path.Combine(payload, PayloadManifest.FileName))
                    };
                    Require(error is InvalidDataException && manifest == null && facts.sourceFileUnchanged && !facts.manifestWritten,
                        "Accounting backup and rollback-journal names are data, never owned program payload.", error, facts);
                }
            });
            yield return ("security: a pending uninstall blocks launch install and book operations without side effects", f =>
            {
                if (!OperatingSystem.IsLinux())
                    throw new TestSkipped("The positive launch control uses a self-authored POSIX script; no Windows artifact is run.");
                var payload = f.Payload("0.1.0.1", managed: true);
                var script = Path.Combine(payload, "Caiwu.Desktop.exe");
                File.WriteAllText(script, "#!/bin/sh\nprintf 'self-authored pending control\\n' > \"$1\"\nexit 0\n");
                File.SetUnixFileMode(script, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
                PayloadManifest.Create(payload, "0.1.0.1", Fixture.Commit, managedDataContract: true).Write(Path.Combine(payload, PayloadManifest.FileName));
                var state = Setup(f, payload); f.Inventory(state.BookPath);
                File.SetUnixFileMode(state.ApplicationPath, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
                var positive = Path.Combine(f.Root, "pending-positive.txt");
                Check.Equal(0, Installation.Launch(f.Install, [positive])); Check.True(File.Exists(positive), "Pending sentinel positive control failed.");
                const string backupName = ".delivery-backups/pending-source.caiwu";
                var backup = BookOperations.Backup(f.Install, "synthetic.caiwu", backupName);
                var backupHash = Fixture.Hash(backup.Copy.DatabasePath);
                var nextPayload = f.Payload("0.1.0.2", managed: true);
                var marker = Path.Combine(f.Install, Installation.UninstallPendingFile);
                File.WriteAllText(marker, JsonSerializer.Serialize(Installation.ReadCurrent(f.Install), PayloadManifest.Json)); var markerHash = Fixture.Hash(marker);
                var forbidden = Path.Combine(f.Root, "pending-must-not-execute.txt");
                var errors = new Dictionary<string, Exception?>
                {
                    ["launch"] = Capture(() => Installation.Launch(f.Install, [forbidden])),
                    ["install"] = Capture(() => Installation.Install(nextPayload, f.Install, f.Data)),
                    ["inspect"] = Capture(() => BookOperations.Inspect(f.Install, "synthetic.caiwu")),
                    ["backup"] = Capture(() => BookOperations.Backup(f.Install, "synthetic.caiwu", ".delivery-backups/pending-blocked.caiwu")),
                    ["restore"] = Capture(() => BookOperations.Restore(f.Install, backupName, "pending-restored.caiwu"))
                };
                var facts = new
                {
                    state = StateFacts(state), positiveControlExecuted = File.Exists(positive), forbiddenProgramExecuted = File.Exists(forbidden),
                    pendingMarkerUnchanged = HashOrNull(marker) == markerHash, originalBackupUnchanged = HashOrNull(backup.Copy.DatabasePath) == backupHash,
                    nextVersionCreated = Directory.Exists(Path.Combine(f.Install, "versions", "0.1.0.2")),
                    blockedBackupCreated = File.Exists(Path.Combine(f.Data, ".delivery-backups", "pending-blocked.caiwu")),
                    blockedRestoreCreated = File.Exists(Path.Combine(f.Data, "pending-restored.caiwu")),
                    operationErrors = errors.ToDictionary(x => x.Key, x => x.Value?.GetType().Name + ": " + x.Value?.Message)
                };
                var allBlockedByMarker = errors.Values.All(error => error is InvalidDataException && error.Message.Contains("uninstall", StringComparison.OrdinalIgnoreCase));
                Require(allBlockedByMarker && !facts.forbiddenProgramExecuted && facts.pendingMarkerUnchanged && facts.originalBackupUnchanged &&
                    !facts.nextVersionCreated && !facts.blockedBackupCreated && !facts.blockedRestoreCreated &&
                    facts.state.PointerUnchanged && facts.state.ProgramUnchanged && facts.state.OwnerUnchanged && facts.state.BookUnchanged,
                    "A recovery marker must block every entry point before process start, data access, activation or copying.", null, facts);
            });
            yield return ("security: cross-platform lexical guard rejects Windows device namespace roots", f =>
            {
                Check.Equal(Path.GetFullPath(f.Install), SafePaths.Full(f.Install));
                var aliases = new[] { @"\\?\C:\Caiwu", @"\\.\C:\Caiwu", @"\??\C:\Caiwu", "//?/C:/Caiwu", "//./C:/Caiwu", "/??/C:/Caiwu" };
                foreach (var alias in aliases)
                {
                    string? accepted = null;
                    var error = Capture(() => accepted = SafePaths.Full(alias));
                    Require(error is InvalidDataException && accepted == null,
                        "Device/extended namespace aliases must be rejected before platform-specific normalization.", error,
                        new { alias, accepted, verification = "Lexical unit check only; this does not claim Windows NTFS execution." });
                }
            });
        }
    }

    private static InstalledState Setup(Fixture fixture, string? payload = null)
    {
        var book = fixture.Book();
        Installation.Install(payload ?? fixture.Payload("0.1.0.1"), fixture.Install, fixture.Data);
        var current = Installation.ReadCurrent(fixture.Install);
        var versionRoot = Path.Combine(fixture.Install, "versions", current.Version);
        var application = Path.Combine(versionRoot, "Caiwu.Desktop.exe");
        var pointer = Path.Combine(fixture.Install, Installation.CurrentFile);
        var owner = Path.Combine(fixture.Install, Installation.OwnerFile);
        var manifest = Path.Combine(versionRoot, PayloadManifest.FileName);
        PayloadManifest.Read(manifest).Verify(versionRoot);
        return new(versionRoot, application, pointer, owner, manifest, book,
            Fixture.Hash(application), Fixture.Hash(pointer), Fixture.Hash(owner), Fixture.Hash(manifest), Fixture.Hash(book));
    }
    private static void AdvanceDataReceipt(Fixture fixture)
    {
        var path = Path.Combine(fixture.Data, Installation.DataOwnerFile);
        var receipt = JsonSerializer.Deserialize<DataRootOwner>(File.ReadAllText(path), PayloadManifest.Json)
            ?? throw new InvalidOperationException("Valid fixture receipt is missing.");
        Check.Equal("0.1.0.1", receipt.Version);
        File.WriteAllText(path, JsonSerializer.Serialize(receipt with { Version = "0.1.0.2" }, PayloadManifest.Json));
        Check.Equal("0.1.0.2", JsonSerializer.Deserialize<DataRootOwner>(File.ReadAllText(path), PayloadManifest.Json)!.Version);
    }
    private static Exception? Capture(Action action)
    {
        try { action(); return null; }
        catch (Exception error) { return error; }
    }
    private static string? HashOrNull(string path) => File.Exists(path) ? Fixture.Hash(path) : null;
    private static StateEvidence StateFacts(InstalledState state) => new(
        File.Exists(state.PointerPath), HashOrNull(state.PointerPath) == state.PointerHash,
        File.Exists(state.ApplicationPath), HashOrNull(state.ApplicationPath) == state.ApplicationHash,
        HashOrNull(state.OwnerPath) == state.OwnerHash, HashOrNull(state.BookPath) == state.BookHash);
    private static void Require(bool safe, string explanation, Exception? error, object facts)
    {
        var evidence = JsonSerializer.Serialize(new { error = error?.GetType().Name, errorMessage = error?.Message, facts });
        Console.WriteLine("SECURITY-BOUNDARY " + evidence);
        Check.True(safe, explanation + " Observed: " + evidence);
    }
    private sealed record InstalledState(string VersionRoot, string ApplicationPath, string PointerPath,
        string OwnerPath, string ManifestPath, string BookPath, string ApplicationHash, string PointerHash,
        string OwnerHash, string ManifestHash, string BookHash);
    private sealed record StateEvidence(bool PointerPresent, bool PointerUnchanged, bool ProgramPresent,
        bool ProgramUnchanged, bool OwnerUnchanged, bool BookUnchanged);
}

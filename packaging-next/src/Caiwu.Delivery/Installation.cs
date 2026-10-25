using System.Diagnostics;
using System.Text.Json;

namespace Caiwu.Delivery;

public sealed record CurrentInstallation(string Version, string DataRoot, string[] ManagedFiles);
public sealed record InstallationOwner(string Product, string DataRoot, Dictionary<string, string>? VersionManifests = null);
public sealed record DataRootOwner(string Product, string InstallRoot, string Version, string ManifestSha256);

public static class Installation
{
    public const string Product = "xhc144.caiwu-suite.delivery.v1";
    public const string CurrentFile = "current.json";
    public const string OwnerFile = "delivery-owner.json";
    public const string DataOwnerFile = ".delivery-data-owner.json";
    public const string UninstallPendingFile = ".delivery-uninstall-pending.json";

    public static IDisposable AcquireLease(string installRoot)
    {
        installRoot = SafePaths.Full(installRoot);
        Directory.CreateDirectory(installRoot);
        return new FileStream(SafePaths.Child(installRoot, ".delivery.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
    }
    private static IDisposable AcquireDataLease(string dataRoot)
    {
        dataRoot = SafePaths.Full(dataRoot); Directory.CreateDirectory(dataRoot);
        return new FileStream(SafePaths.Child(dataRoot, ".delivery-data.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
    }
    public static CurrentInstallation ReadCurrent(string installRoot)
    {
        var current = JsonSerializer.Deserialize<CurrentInstallation>(File.ReadAllText(SafePaths.Child(installRoot, CurrentFile)), PayloadManifest.Json)
            ?? throw new InvalidDataException("No active application.");
        PayloadManifest.ParseVersion(current.Version);
        SafePaths.RequireSeparateRoots(installRoot, current.DataRoot);
        return current;
    }
    private static InstallationOwner ReadOwner(string installRoot)
    {
        var owner = JsonSerializer.Deserialize<InstallationOwner>(File.ReadAllText(SafePaths.Child(installRoot, OwnerFile)), PayloadManifest.Json);
        if (owner?.Product != Product) throw new InvalidDataException("Directory is not owned by Caiwu delivery.");
        SafePaths.RequireSeparateRoots(installRoot, owner.DataRoot);
        return owner;
    }
    internal static T WithExclusiveData<T>(string installRoot, Func<CurrentInstallation, T> action)
    {
        installRoot = SafePaths.Full(installRoot);
        using var installLease = AcquireLease(installRoot);
        RequireNoPendingUninstall(installRoot);
        var owner = ReadOwner(installRoot);
        var current = ReadCurrent(installRoot);
        if (!SafePaths.Full(owner.DataRoot).Equals(SafePaths.Full(current.DataRoot), StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Installation and data receipts disagree; recovery is required.");
        using var dataLease = AcquireDataLease(current.DataRoot);
        var receipt = JsonSerializer.Deserialize<DataRootOwner>(File.ReadAllText(SafePaths.Child(current.DataRoot, DataOwnerFile)), PayloadManifest.Json)
            ?? throw new InvalidDataException("Invalid data ownership receipt.");
        var manifest = PayloadManifest.Read(SafePaths.Child(installRoot, $"versions/{current.Version}/{PayloadManifest.FileName}"));
        if (receipt.Product != Product || !SafePaths.Full(receipt.InstallRoot).Equals(installRoot, StringComparison.OrdinalIgnoreCase) ||
            receipt.Version != current.Version || receipt.ManifestSha256 != manifest.Digest())
            throw new InvalidDataException("Installation and data receipts disagree; recovery is required.");
        RequireOwnedManifest(owner, current.Version, manifest);
        return action(current);
    }

    private static void RequireNoPendingUninstall(string installRoot)
    {
        if (Path.Exists(SafePaths.Child(installRoot, UninstallPendingFile)))
            throw new InvalidDataException("A previous uninstall is incomplete. Recovery is required before launch, install or data operations.");
    }
    private static void RequireOwnedManifest(InstallationOwner owner, string version, PayloadManifest manifest)
    {
        if (manifest.Version != version || owner.VersionManifests == null ||
            !owner.VersionManifests.TryGetValue(version, out var expected) || expected != manifest.Digest())
            throw new InvalidDataException("Version ownership receipt is missing or does not match its manifest; recovery is required.");
    }

    private static void AtomicJson(string path, object value)
    {
        var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(value, PayloadManifest.Json) + "\n");
        try { File.Move(temp, path, overwrite: true); }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }

    public static void Install(string payload, string installRoot, string dataRoot)
    {
        installRoot = SafePaths.Full(installRoot); dataRoot = SafePaths.Full(dataRoot); payload = SafePaths.Full(payload);
        SafePaths.RequireSeparateRoots(installRoot, dataRoot);
        if (SafePaths.Contains(installRoot, payload) || SafePaths.Contains(payload, installRoot) || SafePaths.Contains(dataRoot, payload) || SafePaths.Contains(payload, dataRoot))
            throw new InvalidDataException("Staged payload must be outside installation and data directories.");
        var manifest = PayloadManifest.Read(SafePaths.Child(payload, PayloadManifest.FileName)); manifest.Verify(payload);
        using var lease = AcquireLease(installRoot);
        RequireNoPendingUninstall(installRoot);
        using var dataLease = AcquireDataLease(dataRoot);
        var dataOwnerPath = SafePaths.Child(dataRoot, DataOwnerFile);
        DataRootOwner? dataOwner = null;
        if (File.Exists(dataOwnerPath))
        {
            dataOwner = JsonSerializer.Deserialize<DataRootOwner>(File.ReadAllText(dataOwnerPath), PayloadManifest.Json)
                ?? throw new InvalidDataException("Invalid data ownership receipt.");
            if (dataOwner.Product != Product || !SafePaths.Full(dataOwner.InstallRoot).Equals(installRoot, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Ledger data is bound to another installation root; an explicit recovery procedure is required.");
        }
        CurrentInstallation? old = null;
        InstallationOwner? previousOwner = null;
        if (File.Exists(SafePaths.Child(installRoot, OwnerFile)))
        {
            var owner = previousOwner = ReadOwner(installRoot);
            if (!SafePaths.Full(owner.DataRoot).Equals(dataRoot, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Upgrade cannot change the ledger data root.");
            if (!File.Exists(SafePaths.Child(installRoot, CurrentFile)))
                throw new InvalidDataException("Existing installation has no active pointer; an explicit recovery procedure is required.");
            old = ReadCurrent(installRoot);
            if (!SafePaths.Full(old.DataRoot).Equals(dataRoot, StringComparison.OrdinalIgnoreCase) || dataOwner == null || dataOwner.Version != old.Version)
                throw new InvalidDataException("Installation and data receipts disagree; recovery is required.");
        }
        else if (Directory.EnumerateFileSystemEntries(installRoot).Any(p => Path.GetFileName(p) != ".delivery.lock"))
            throw new InvalidDataException("Refusing a nonempty directory without an ownership receipt.");

        if (old == null && dataOwner != null && (dataOwner.Version != manifest.Version || dataOwner.ManifestSha256 != manifest.Digest()))
            throw new InvalidDataException("Retained ledger data permits only the same immutable payload to be reinstalled; another version requires recovery.");
        UpgradePreparation? safety = null;
        if (old != null)
        {
            if (PayloadManifest.ParseVersion(manifest.Version) <= PayloadManifest.ParseVersion(old.Version))
                throw new InvalidDataException("Downgrade/reinstall is blocked; use an explicit recovery procedure.");
            var oldManifest = PayloadManifest.Read(SafePaths.Child(installRoot, $"versions/{old.Version}/{PayloadManifest.FileName}"));
            oldManifest.ValidateStructure(SafePaths.Child(installRoot, $"versions/{old.Version}"));
            RequireOwnedManifest(previousOwner!, old.Version, oldManifest);
            if (dataOwner!.ManifestSha256 != oldManifest.Digest()) throw new InvalidDataException("Data receipt does not match the active payload.");
            if (!manifest.ManagedDataContract || !oldManifest.ManagedDataContract)
                throw new InvalidOperationException("Desktop data inventory and launch lease are not integrated. Upgrade is blocked before activation.");
            safety = UpgradeSafety.Prepare(dataRoot, UpgradeSafety.ReadInventory(dataRoot));
        }
        using (safety)
        {
            var versions = SafePaths.Child(installRoot, "versions"); Directory.CreateDirectory(versions);
            var destination = SafePaths.Child(versions, manifest.Version);
            if (Directory.Exists(destination)) throw new IOException("Version directory already exists; refusing overwrite.");
            var stage = SafePaths.Child(installRoot, ".stage-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(stage);
            foreach (var file in manifest.Files)
            {
                var target = SafePaths.Child(stage, file.Path); Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                File.Copy(SafePaths.Child(payload, file.Path), target, overwrite: false);
            }
            manifest.Write(SafePaths.Child(stage, PayloadManifest.FileName)); manifest.Verify(stage);
            Directory.CreateDirectory(dataRoot);
            Directory.Move(stage, destination);
            var versionManifests = previousOwner?.VersionManifests == null
                ? new Dictionary<string, string>(StringComparer.Ordinal)
                : new Dictionary<string, string>(previousOwner.VersionManifests, StringComparer.Ordinal);
            versionManifests.Add(manifest.Version, manifest.Digest());
            try
            {
                AtomicJson(SafePaths.Child(installRoot, OwnerFile), new InstallationOwner(Product, dataRoot, versionManifests));
                AtomicJson(dataOwnerPath, new DataRootOwner(Product, installRoot, manifest.Version, manifest.Digest()));
                // The activation point: the old pointer is retained until both ownership receipts are ready.
                AtomicJson(SafePaths.Child(installRoot, CurrentFile), new CurrentInstallation(manifest.Version, dataRoot, manifest.Files.Select(x => x.Path).ToArray()));
            }
            catch (Exception activationError)
            {
                var recoveryErrors = new List<Exception>();
                try
                {
                    if (previousOwner == null) File.Delete(SafePaths.Child(installRoot, OwnerFile));
                    else AtomicJson(SafePaths.Child(installRoot, OwnerFile), previousOwner);
                }
                catch (Exception error) { recoveryErrors.Add(error); }
                try
                {
                    if (dataOwner == null) File.Delete(dataOwnerPath); else AtomicJson(dataOwnerPath, dataOwner);
                }
                catch (Exception error) { recoveryErrors.Add(error); }
                if (recoveryErrors.Count != 0)
                    throw new AggregateException("Activation failed and receipt recovery is incomplete; preserve the inactive version and recover explicitly.", new[] { activationError }.Concat(recoveryErrors));
                throw;
            }
        }
    }

    public static int Launch(string installRoot, string[] arguments) =>
        WithExclusiveData(installRoot, current =>
        {
            var versionRoot = SafePaths.Child(installRoot, $"versions/{current.Version}");
            PayloadManifest.Read(SafePaths.Child(versionRoot, PayloadManifest.FileName)).Verify(versionRoot);
            var start = new ProcessStartInfo(SafePaths.Child(versionRoot, "Caiwu.Desktop.exe")) { UseShellExecute = false, WorkingDirectory = current.DataRoot };
            start.Environment["CAIWU_DATA_ROOT"] = current.DataRoot;
            foreach (var argument in arguments) start.ArgumentList.Add(argument);
            using var process = Process.Start(start) ?? throw new IOException("Application did not start.");
            process.WaitForExit(); return process.ExitCode;
        });

    public static void Uninstall(string installRoot) => WithExclusiveData(installRoot, current =>
    {
        var owner = ReadOwner(installRoot);
        var versions = SafePaths.Child(installRoot, "versions");
        var deletions = new List<string>();
        var manifests = new List<string>();
        var knownDirectories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        // Validate ALL owned versions and build a deletion plan before the first destructive action.
        // An on-disk directory/manifest alone never establishes installer ownership.
        foreach (var (version, _) in owner.VersionManifests!.OrderBy(x => x.Key, StringComparer.Ordinal))
        {
            PayloadManifest.ParseVersion(version);
            var versionRoot = SafePaths.Child(versions, version);
            var manifestPath = SafePaths.Child(versionRoot, PayloadManifest.FileName);
            var manifest = PayloadManifest.Read(manifestPath);
            manifest.ValidateStructure(versionRoot);
            RequireOwnedManifest(owner, version, manifest);
            manifests.Add(manifestPath); knownDirectories.Add(versionRoot);
            foreach (var file in manifest.Files)
            {
                var path = SafePaths.Child(versionRoot, file.Path);
                for (var directory = Path.GetDirectoryName(path); directory != null && SafePaths.Contains(versionRoot, directory); directory = Path.GetDirectoryName(directory))
                    knownDirectories.Add(directory);
                // User-modified files are retained. Preflight read errors occur before deactivation/deletion.
                if (File.Exists(path) && new FileInfo(path).Length == file.Bytes && PayloadManifest.Hash(path) == file.Sha256)
                {
                    if ((File.GetAttributes(path) & FileAttributes.ReadOnly) != 0) throw new UnauthorizedAccessException("An owned program file is read-only; uninstall has made no changes.");
                    deletions.Add(path);
                }
            }
        }
        var pendingPath = SafePaths.Child(installRoot, UninstallPendingFile);
        AtomicJson(pendingPath, current);
        File.Delete(SafePaths.Child(installRoot, CurrentFile));
        // If deletion is interrupted, retain the ownership plan and pending marker. Launch stays blocked.
        foreach (var path in deletions) File.Delete(path);
        foreach (var path in manifests) File.Delete(path);
        foreach (var directory in knownDirectories.OrderByDescending(x => x.Length))
        {
            SafePaths.RejectLinks(directory);
            if (Directory.Exists(directory) && !Directory.EnumerateFileSystemEntries(directory).Any()) Directory.Delete(directory);
        }
        if (Directory.Exists(versions) && !Directory.EnumerateFileSystemEntries(versions).Any()) Directory.Delete(versions);
        File.Delete(SafePaths.Child(installRoot, OwnerFile));
        File.Delete(pendingPath);
        // Never recurse into unknown directories or remove retained data/backup receipts.
        return 0;
    });
}

using System.Diagnostics;
using System.Text.Json;

namespace Caiwu.Delivery;

public sealed record CurrentInstallation(string Version, string DataRoot, string[] ManagedFiles);
public sealed record InstallationOwner(string Product, string DataRoot);
public sealed record DataRootOwner(string Product, string InstallRoot, string Version, string ManifestSha256);

public static class Installation
{
    public const string Product = "xhc144.caiwu-suite.delivery.v1";
    public const string CurrentFile = "current.json";
    public const string OwnerFile = "delivery-owner.json";
    public const string DataOwnerFile = ".delivery-data-owner.json";

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
        return action(current);
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
        if (File.Exists(SafePaths.Child(installRoot, OwnerFile)))
        {
            var owner = ReadOwner(installRoot);
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
            AtomicJson(SafePaths.Child(installRoot, OwnerFile), new InstallationOwner(Product, dataRoot));
            Directory.Move(stage, destination);
            var previousDataReceipt = dataOwner;
            AtomicJson(dataOwnerPath, new DataRootOwner(Product, installRoot, manifest.Version, manifest.Digest()));
            // The single activation point. A failure before this leaves the old pointer and live ledgers unchanged.
            try { AtomicJson(SafePaths.Child(installRoot, CurrentFile), new CurrentInstallation(manifest.Version, dataRoot, manifest.Files.Select(x => x.Path).ToArray())); }
            catch
            {
                if (previousDataReceipt == null) File.Delete(dataOwnerPath); else AtomicJson(dataOwnerPath, previousDataReceipt);
                throw;
            }
        }
    }

    public static int Launch(string installRoot, string[] arguments)
    {
        using var lease = AcquireLease(installRoot);
        _ = ReadOwner(installRoot);
        var current = ReadCurrent(installRoot);
        using var dataLease = AcquireDataLease(current.DataRoot);
        var versionRoot = SafePaths.Child(installRoot, $"versions/{current.Version}");
        PayloadManifest.Read(SafePaths.Child(versionRoot, PayloadManifest.FileName)).Verify(versionRoot);
        var start = new ProcessStartInfo(SafePaths.Child(versionRoot, "Caiwu.Desktop.exe")) { UseShellExecute = false, WorkingDirectory = current.DataRoot };
        start.Environment["CAIWU_DATA_ROOT"] = current.DataRoot;
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        using var process = Process.Start(start) ?? throw new IOException("Application did not start.");
        process.WaitForExit(); return process.ExitCode;
    }

    public static void Uninstall(string installRoot)
    {
        using var lease = AcquireLease(installRoot);
        _ = ReadOwner(installRoot);
        var versions = SafePaths.Child(installRoot, "versions");
        if (Directory.Exists(versions)) foreach (var version in Directory.EnumerateDirectories(versions))
        {
            SafePaths.RejectLinks(version); PayloadManifest.ParseVersion(Path.GetFileName(version));
            var manifestPath = SafePaths.Child(version, PayloadManifest.FileName);
            var manifest = PayloadManifest.Read(manifestPath);
            // Validate every path before deleting the first one. Changed or unknown files are preserved.
            foreach (var file in manifest.Files) _ = SafePaths.Child(version, file.Path);
            foreach (var file in manifest.Files)
            {
                var path = SafePaths.Child(version, file.Path);
                if (File.Exists(path) && new FileInfo(path).Length == file.Bytes && PayloadManifest.Hash(path) == file.Sha256) File.Delete(path);
            }
            File.Delete(manifestPath);
            RemoveEmptyDirectories(version);
        }
        if (Directory.Exists(versions)) RemoveEmptyDirectories(versions);
        File.Delete(SafePaths.Child(installRoot, CurrentFile));
        File.Delete(SafePaths.Child(installRoot, OwnerFile));
        // No recursive deletion, data deletion, backup deletion, or process termination.
    }
    private static void RemoveEmptyDirectories(string root)
    {
        foreach (var directory in Directory.EnumerateDirectories(root)) { SafePaths.RejectLinks(directory); RemoveEmptyDirectories(directory); }
        if (!Directory.EnumerateFileSystemEntries(root).Any()) Directory.Delete(root);
    }
}

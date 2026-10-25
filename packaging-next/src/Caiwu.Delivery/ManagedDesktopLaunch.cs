using System.Diagnostics;

namespace Caiwu.Delivery;
public static class ManagedDesktopLaunch
{
    /// <summary>Installed Desktop startup: bind the running executable to the current version while holding real leases.</summary>
    public static ManagedDataSession OpenSession(string installRoot, string explicitlyConfiguredUserDataRoot, string actualExecutablePath)
    {
        installRoot = SafePaths.Full(installRoot);
        var data = Installation.OpenManagedData(installRoot, explicitlyConfiguredUserDataRoot);
        try
        {
            var versionRoot = SafePaths.Child(installRoot, $"versions/{data.Current.Version}");
            var expectedExecutable = SafePaths.Child(versionRoot, "Caiwu.Desktop.exe");
            if (!SafePaths.Full(actualExecutablePath).Equals(expectedExecutable, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Running Desktop is not the currently active installed executable; restart after upgrade/recovery.");
            var manifest = PayloadManifest.Read(SafePaths.Child(versionRoot, PayloadManifest.FileName));
            if (!manifest.ManagedDataContract)
                throw new InvalidOperationException("This payload has no integrated managed Desktop contract.");
            manifest.Verify(versionRoot);
            return data;
        }
        catch
        {
            data.Dispose();
            throw;
        }
    }

    /// <summary>
    /// Only for a Desktop host whose startup immediately calls OpenSession before any user data access.
    /// Releases the launcher's validation lease before starting that host, so the child can own the real
    /// lease itself. The child must revalidate receipts; an intervening upgrade/uninstall fails closed.
    /// Legacy Installation.Launch continues to keep its own lease for hosts without this integration.
    /// </summary>
    public static int Launch(string installRoot, string[] arguments)
    {
        installRoot = SafePaths.Full(installRoot);
        var start = Installation.WithExclusiveData(installRoot, current =>
        {
            var versionRoot = SafePaths.Child(installRoot, $"versions/{current.Version}");
            var manifest = PayloadManifest.Read(SafePaths.Child(versionRoot, PayloadManifest.FileName));
            manifest.Verify(versionRoot);
            if (!manifest.ManagedDataContract)
                throw new InvalidOperationException("Managed Desktop lease ownership is not integrated in this payload.");
            var info = new ProcessStartInfo(SafePaths.Child(versionRoot, "Caiwu.Desktop.exe"))
            {
                UseShellExecute = false,
                WorkingDirectory = current.DataRoot
            };
            info.Environment["CAIWU_INSTALL_ROOT"] = installRoot;
            info.Environment["CAIWU_DATA_ROOT"] = current.DataRoot;
            foreach (var argument in arguments)
                info.ArgumentList.Add(argument);
            return info;
        });
        using var process = Process.Start(start) ?? throw new IOException("Could not start the managed Desktop host.");
        process.WaitForExit();
        return process.ExitCode;
    }
}

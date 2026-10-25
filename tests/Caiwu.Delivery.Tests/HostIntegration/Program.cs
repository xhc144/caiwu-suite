using System.Diagnostics;
using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Delivery;
using Caiwu.Delivery.Modules;
using Caiwu.Persistence.Sqlite;

if (args.Length != 2) throw new ArgumentException("host executable/dll and report path required");
var root = Path.Combine(Path.GetTempPath(), "财务 候选宿主-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
var checks = new List<string>();
try
{
    var install = Path.Combine(root, "程序 目录"); var dataRoot = Path.Combine(root, "合成 账套");
    var payload = Path.Combine(root, "payload-one"); Directory.CreateDirectory(payload);
    File.WriteAllText(Path.Combine(payload, "Caiwu.Desktop.exe"), "synthetic component fixture, never executed");
    var desktopHash = PayloadManifest.Hash(Path.Combine(payload, "Caiwu.Desktop.exe"));
    Run(0, "manifest", payload, "0.1.0.1", new string('a', 40));
    Assert(!PayloadManifest.Read(Path.Combine(payload, PayloadManifest.FileName)).ManagedDataContract,
        "ordinary host manifest remains conservative by default");
    Run(0, "manifest-managed", payload, "0.1.0.1", new string('a', 40));
    var adopted = PayloadManifest.Read(Path.Combine(payload, PayloadManifest.FileName));
    Assert(adopted.ManagedDataContract && adopted.Commit == new string('a', 40) && adopted.Version == "0.1.0.1",
        "explicit composed-host manifest adopts managed capability with exact source and version");
    Run(0, "verify", payload);
    Assert(PayloadManifest.Hash(Path.Combine(payload, "Caiwu.Desktop.exe")) == desktopHash,
        "manifest selection preserves the payload bytes and passes actual host verification");
    Run(0, "install", payload, install, dataRoot);
    string bookPath, summaryPath, identityPath;
    using (var data = Installation.OpenManagedData(install))
    {
        bookPath = data.NewBookPath(Guid.NewGuid()); Directory.CreateDirectory(Path.GetDirectoryName(bookPath)!);
        var info = new BookInfo(Guid.NewGuid(), "虚构升级账套", AccountingRegime.SmallBusiness, "synthetic", 2026, 1, 0, DateTimeOffset.UtcNow);
        using (var store = SqliteLedgerStore.Create(bookPath, info, [new("1002", "银行存款", null, BalanceDirection.Debit, true, 100, 0), new("3001", "实收资本", null, BalanceDirection.Credit, true, 0, 100)])) { }
        data.RegisterBook(bookPath, info.Id);
        var registered = new ManagedModuleHost(data).InitializeSummary(bookPath, info.Id);
        var state = registered.Catalog.AddCategory("合成升级分类", registered.Catalog.Read().Version);
        registered.Catalog.AddSummary(state.Categories.Single().Id, "升级前必须保留", state.Version);
        summaryPath = registered.Catalog.Location.CatalogPath;
        identityPath = Path.Combine(data.OperatorsDirectory, "synthetic-retention-sentinel.txt");
        Directory.CreateDirectory(data.OperatorsDirectory); File.WriteAllText(identityPath, "Synthetic identity-directory retention only; no real credentials.");
    }
    var bookHash = PayloadManifest.Hash(bookPath); var summaryHash = PayloadManifest.Hash(summaryPath); var identityHash = PayloadManifest.Hash(identityPath);
    var pointer = Path.Combine(install, Installation.CurrentFile); var pointerHash = PayloadManifest.Hash(pointer);
    var next = Path.Combine(root, "payload-two"); Directory.CreateDirectory(next);
    File.WriteAllText(Path.Combine(next, "Caiwu.Desktop.exe"), "synthetic component fixture version two, never executed");
    PayloadManifest.Create(next, "0.1.0.2", new string('b', 40), true).Write(Path.Combine(next, PayloadManifest.FileName));
    using (var busy = Installation.OpenManagedData(install))
    {
        Run(1, "install", next, install, dataRoot);
        Assert(PayloadManifest.Hash(pointer) == pointerHash, "real cross-process data lease rejects upgrade before pointer activation");
    }
    Run(0, "install", next, install, dataRoot);
    Assert(Installation.ReadCurrent(install).Version == "0.1.0.2", "CLI host activates next version with native module codecs");
    Assert(PayloadManifest.Hash(bookPath) == bookHash && PayloadManifest.Hash(summaryPath) == summaryHash, "upgrade preserves source SQLite and registered summary bytes");
    Assert(PayloadManifest.Hash(identityPath) == identityHash, "upgrade leaves the separate global identity directory unchanged");
    var manifests = Directory.GetFiles(Path.Combine(dataRoot, ".delivery-backups"), "*manifest*.json", SearchOption.AllDirectories);
    Assert(manifests.Any(path => File.ReadAllText(path).Contains("summary-v1", StringComparison.Ordinal)), "upgrade creates a native summary bundle before activation");
    Run(0, "uninstall", install);
    Assert(File.Exists(bookPath) && File.Exists(summaryPath) && File.Exists(identityPath), "CLI uninstall retains ledger, registered attachment and global directory");
    var report = Path.GetFullPath(args[1]); Directory.CreateDirectory(Path.GetDirectoryName(report)!);
    File.WriteAllText(report, JsonSerializer.Serialize(new { success = true, sourceCommit = Environment.GetEnvironmentVariable("GITHUB_SHA"), windowsExecuted = OperatingSystem.IsWindows(), nativeInstallerExecuted = false, checks }, PayloadManifest.Json));
    Console.WriteLine($"Host process integration: {checks.Count} behavior checks passed.");
    return 0;
}
finally { Directory.Delete(root, true); }

void Assert(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
    checks.Add(message);
}
void Run(int expected, params string[] command)
{
    var executable = Path.GetFullPath(args[0]);
    var start = new ProcessStartInfo(executable.EndsWith(".dll", StringComparison.OrdinalIgnoreCase) ? Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet" : executable) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
    if (executable.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)) start.ArgumentList.Add(executable);
    foreach (var argument in command) start.ArgumentList.Add(argument);
    using var process = Process.Start(start) ?? throw new IOException("Host did not start.");
    var stdout = process.StandardOutput.ReadToEndAsync(); var stderr = process.StandardError.ReadToEndAsync();
    if (!process.WaitForExit(30000)) { process.Kill(true); throw new TimeoutException("Host command exceeded 30 seconds."); }
    if (process.ExitCode != expected) throw new IOException($"Host {command[0]} exit {process.ExitCode}; expected {expected}: {stderr.GetAwaiter().GetResult()}");
    _ = stdout.GetAwaiter().GetResult(); _ = stderr.GetAwaiter().GetResult();
}

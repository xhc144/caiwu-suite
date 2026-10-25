using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows.Automation;
using Caiwu.Contracts;
using Caiwu.Costing;
using Caiwu.Delivery;
using Caiwu.Delivery.Modules;
using Caiwu.Nonprofit.Reporting;
using Caiwu.Operators;
using Caiwu.Persistence.Sqlite;
using Caiwu.ReportDesigner;

internal static partial class Program
{
    private static readonly List<string> Checks = [];
    private static readonly Dictionary<string, string> Cases = new() { ["costing"] = "not-run", ["nonprofit"] = "not-run", ["designer"] = "not-run", ["fourCodecRestore"] = "not-run" };
    private static string evidence = "", install = "", data = "", sourceCommit = "", currentCase = "setup";
    private static Process? launcher, desktop;
    private static AutomationElement? main;
    private static bool normalLoginCompleted;
    private static readonly string Password = "Synthetic!" + Guid.NewGuid().ToString("N");
    private static string bookPath = "", moduleRoot = "", sourceBookHash = "", identityPath = "", identityHash = "";
    private static readonly DateTimeOffset Clock = new(2026, 10, 25, 12, 0, 0, TimeSpan.Zero);
    private static readonly Guid BookId = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 4 && args[0] == "--internal-qa-manifest")
        {
            PayloadManifest.Create(args[1], args[2], args[3], true).Write(Path.Combine(args[1], PayloadManifest.FileName)); return 0;
        }
        if (!OperatingSystem.IsWindows() || args.Length != 3 || Environment.GetEnvironmentVariable("GITHUB_ACTIONS") != "true")
            throw new ArgumentException("Only isolated Windows CI: installRoot dataRoot evidence.");
        install = Path.GetFullPath(args[0]); data = Path.GetFullPath(args[1]); evidence = Path.GetFullPath(args[2]); Directory.CreateDirectory(evidence);
        using var watchdog = new Timer(_ => { Save(false, "External controller exceeded seven minutes."); Environment.FailFast("Financial installed QA watchdog."); }, null, 420000, Timeout.Infinite);
        DesktopMode? display = null;
        try
        {
            display = new DesktopMode();
            var current = Installation.ReadCurrent(install);
            Require(Path.GetFullPath(current.DataRoot) == data, "installed pointer binds the isolated synthetic data root");
            var versionRoot = Path.Combine(install, "versions", current.Version);
            var manifest = PayloadManifest.Read(Path.Combine(versionRoot, PayloadManifest.FileName)); manifest.Verify(versionRoot); sourceCommit = manifest.Commit;
            Require(manifest.ManagedDataContract && sourceCommit == Environment.GetEnvironmentVariable("GITHUB_SHA"), "verified installed manifest binds this exact clean source SHA and managed contract");
            Seed();
            var start = new ProcessStartInfo(Path.Combine(versionRoot, "Caiwu.Delivery.exe")) { UseShellExecute = false, WorkingDirectory = evidence, RedirectStandardOutput = true, RedirectStandardError = true };
            start.ArgumentList.Add("launch-managed"); start.ArgumentList.Add(install);
            launcher = Process.Start(start) ?? throw new IOException("Installed launcher did not start.");
            var stdout = launcher.StandardOutput.ReadToEndAsync(); var stderr = launcher.StandardError.ReadToEndAsync();
            Until(() => { desktop = Process.GetProcessesByName("Caiwu.Desktop").FirstOrDefault(p => string.Equals(p.MainModule?.FileName, Path.Combine(versionRoot, "Caiwu.Desktop.exe"), StringComparison.OrdinalIgnoreCase)); return desktop is not null; }, "actual installed Desktop process", 30000);
            Login("financial-maker", rejectWrongFirst: true); main = Window(t => t == "财务套件 · 开发预览");
            Require(main.FindFirst(TreeScope.Descendants, Id("OperatorInput")) is { Current.IsEnabled: false }, "normal authenticated product locks the session actor");
            foreach (var path in new[] { Path.Combine(install, ".delivery.lock"), Path.Combine(data, ".delivery-data.lock") })
            {
                var held = false; try { using var probe = File.Open(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None); } catch (IOException) { held = true; }
                Require(held, "actual installed App holds non-shareable OS lease: " + Path.GetFileName(path));
            }
            Shortcut(0x4f); FileDialog("打开账套", bookPath); Until(() => Text(main!, "BookNameText") == "合成安装金融账套", "normal product open of the explicitly seeded nonprofit source");
            desktop!.Refresh();
            var modules = desktop.Modules.Cast<ProcessModule>().Select(m => new { name = m.ModuleName, path = m.FileName }).ToArray();
            foreach (var name in new[] { "coreclr.dll", "hostfxr.dll", "e_sqlite3.dll" }) Require(modules.Any(m => string.Equals(m.name, name, StringComparison.OrdinalIgnoreCase) && SafePaths.Contains(versionRoot, m.path)), "installed native dependency resolves inside verified payload: " + name);
            var checkout = Environment.GetEnvironmentVariable("GITHUB_WORKSPACE")!;
            Require(modules.All(m => !SafePaths.Contains(checkout, m.path)), "actual product loads no image from the source checkout");
            File.WriteAllText(Path.Combine(evidence, "loaded-modules.json"), JsonSerializer.Serialize(modules, PayloadManifest.Json));
            Capture("normal-login-source");
            RunCase("costing", Costing); RunCase("nonprofit", Nonprofit); RunCase("designer", Designer);
            RunCase("fourCodecRestore", () => { Restore(); Close(main); Require(launcher.WaitForExit(30000) && launcher.ExitCode == 0, "installed product exits normally"); VerifyRestore(); });
            File.WriteAllText(Path.Combine(evidence, "launcher-stdout.log"), stdout.GetAwaiter().GetResult());
            File.WriteAllText(Path.Combine(evidence, "launcher-stderr.log"), stderr.GetAwaiter().GetResult());
            Require(PayloadManifest.Hash(bookPath) == sourceBookHash && PayloadManifest.Hash(identityPath) == identityHash, "all financial preview persistence and restore leave original ledger and global identities byte-identical");
            Save(true, null); return 0;
        }
        catch (Exception ex)
        {
            if (Cases.ContainsKey(currentCase) && Cases[currentCase] == "running") Cases[currentCase] = "failed";
            try { Capture("failure"); } catch { } try { DumpTree(); } catch { }
            Save(false, ex.ToString()); Console.Error.WriteLine(ex); return 1;
        }
        finally
        {
            try { if (desktop is { HasExited: false }) desktop.Kill(true); } catch { }
            try { if (launcher is { HasExited: false } && !launcher.WaitForExit(5000)) launcher.Kill(true); } catch { }
            display?.Dispose();
        }
    }
    private static void RunCase(string name, Action action) { currentCase = name; Cases[name] = "running"; Save(false, "In progress"); action(); Cases[name] = "passed"; Save(false, "In progress"); }
    private static void Seed()
    {
        var operators = new LocalOperatorService(new FileOperatorStore(Path.Combine(data, "Global", "Operators")));
        Require(operators.IsFirstUse, "fixture begins in a fresh synthetic identity directory");
        operators.InitializeAdministrator("financial-admin", "虚构管理员", Password); var admin = operators.Login("financial-admin", Password);
        operators.AddOperator(admin, operators.GetDirectory(admin).Revision, "financial-maker", "虚构金融制表人", Password, OperatorRoles.Administrator | OperatorRoles.Accountant | OperatorRoles.Preparer | OperatorRoles.Reviewer | OperatorRoles.Poster); operators.Logout(admin);
        identityPath = Path.Combine(data, "Global", "Operators", "operators.json"); identityHash = PayloadManifest.Hash(identityPath);
        bookPath = Path.Combine(data, "合成 安装金融账套.caiwu");
        var income = Guid.NewGuid(); var closing = Guid.NewGuid();
        var book = new BookInfo(BookId, "合成安装金融账套", AccountingRegime.Nonprofit, "np2026-synthetic", 2026, 1, 0, Clock);
        using (var store = SqliteLedgerStore.Create(bookPath, book, [new("1002", "合成银行", null, BalanceDirection.Debit, true, 100, 0), new("3101", "合成非限定", null, BalanceDirection.Credit, true, 0, 100), new("4101", "合成捐赠", null, BalanceDirection.Credit, true, 0, 0)]))
        {
            var initial = store.Read();
            store.Write(initial with { Revision = 1, Vouchers = [
                new(income, new(2026, 1, 1), "合成", 1, 0, "合成制单", "合成审核", VoucherStatus.Posted, [new("1002", "合成捐赠", 10, 0), new("4101", "合成捐赠", 0, 10)]),
                new(closing, new(2026, 1, 31), "合成", 2, 0, "合成制单", "合成审核", VoucherStatus.Posted, [new("4101", "合成结转", 10, 0), new("3101", "合成结转", 0, 10)])] }, initial.Revision);
        }
        // Fixture setup uses the ordinary store and real managed leases before App launch.
        // The saved manifest is an explicit synthetic input, never an anonymous Desktop host.
        using (var managed = Installation.OpenManagedData(install))
        {
            var registered = managed.RegisterBook(bookPath, BookId);
            moduleRoot = Path.GetDirectoryName(managed.ModulePath(registered, "Nonprofit", "seed.json"))!; Directory.CreateDirectory(moduleRoot);
            using var store = SqliteLedgerStore.Open(bookPath); var snapshot = store.Read();
            var period = new ReportingPeriod(new(2026, 1, 1), new(2026, 1, 31), ReportingPeriodKind.Monthly);
            var editor = new ClassificationEditorSession(snapshot, period, Clock);
            foreach (var a in editor.Accounts) { a.Semantic = a.Code switch { "1002" => LedgerAccountSemantic.OtherBalance, "3101" => LedgerAccountSemantic.UnrestrictedNetAssets, _ => LedgerAccountSemantic.IncomeExpense }; a.ActivityFact = a.Code == "4101" ? ActivityFact.DonationIncome : null; a.EvidenceReference = "合成账套人工逐项分类依据"; }
            foreach (var line in editor.Lines) { line.EvidenceReference = "合成分录逐项复核"; if (line.VoucherId == income && line.AccountCode == "1002") line.SetBalanceOnly(); else { line.Role = line.VoucherId == closing ? SourceLineRole.IncomeExpenseClosing : SourceLineRole.RecognizedActivity; line.Class = RestrictionClass.Unrestricted; } }
            foreach (var b in editor.Balances) b.ConfirmZero("合成账套逐项核实为零");
            var bank = editor.Balances.Single(b => b.Fact == BalanceFact.BankDeposits); bank.Mode = BalanceMappingMode.AccountBalances; bank.AccountCodes = "1002";
            var net = editor.Balances.Single(b => b.Fact == BalanceFact.UnrestrictedNetAssets); net.Mode = BalanceMappingMode.AccountBalances; net.AccountCodes = "3101";
            var review = editor.Review; review.CnyAmountsConfirmed = review.CompleteYearToDateConfirmed = review.AccountMappingReviewed = review.LineClassificationReviewed = review.BusinessBreakdownComplete = true;
            review.FundraisingDisclosure = FundraisingDisclosure.NotApplicableConfirmed; review.YearOpeningBasis = YearOpeningBasis.Reviewed2026TransitionLedger; review.EvidenceReference = "仅合成数据，逐项核对完整期间";
            var manifest = editor.BuildManifest();
            var oracle = new LedgerSnapshotStatementDataSource(store.Read, manifest).CreateBoundPreview(Clock).Statements;
            Require(oracle.HasCompleteReconciledCalculations && !oracle.CanIssueAsFormal && oracle.BalanceSheet.Lines.Single(l => l.Key == "assets.total").Values[1].Amount == 110m && oracle.ActivityStatement.Lines.Single(l => l.Key == "donation").Values[0].Amount == 10m, "synthetic fixture independent oracle: assets110 donation10, calculation preview only");
            new ClassificationJsonStore(moduleRoot).SaveNew("synthetic-input.json", manifest);
        }
        sourceBookHash = PayloadManifest.Hash(bookPath);
        File.WriteAllText(Path.Combine(evidence, "fixture-provenance.json"), JsonSerializer.Serialize(new { source = "Explicit synthetic normal-store fixture, no original/reference application data", bookId = BookId, bookPath, sourceBookHash, period = "2026-01", expectedAssets = 110, expectedDonation = 10, setupBeforeProductLaunch = true, classificationInputSha256 = PayloadManifest.Hash(Path.Combine(moduleRoot, "synthetic-input.json")) }, PayloadManifest.Json));
    }
    private static void Save(bool success, string? failure)
    {
        if (evidence.Length == 0) return;
        var files = Directory.GetFiles(evidence).Where(p => Path.GetFileName(p) != "financial-results.json").Select(p => new { name = Path.GetFileName(p), bytes = new FileInfo(p).Length, sha256 = PayloadManifest.Hash(p) }).ToArray();
        File.WriteAllText(Path.Combine(evidence, "financial-results.json"), JsonSerializer.Serialize(new { success, failure, currentCase, windowsExecuted = true, normalProductLogin = normalLoginCompleted, sourceCommit, productionBaseline = "dece298946d03ad88c5031eb02dab8f87c330046", runUrl = "https://github.com/" + Environment.GetEnvironmentVariable("GITHUB_REPOSITORY") + "/actions/runs/" + Environment.GetEnvironmentVariable("GITHUB_RUN_ID"), installedProduct = Path.Combine(install, "versions", "0.1.0.1", "Caiwu.Desktop.exe"), sourceProjectsExecutedAsProduct = false, formalStatementComplianceClaimed = false, cases = Cases, checks = Checks, artifacts = files }, PayloadManifest.Json));
    }
    private static void Pass(string name) { Checks.Add(name); Save(false, "In progress"); }
    private static void Require(bool value, string name) { if (!value) throw new InvalidDataException(name); Pass(name); }
}

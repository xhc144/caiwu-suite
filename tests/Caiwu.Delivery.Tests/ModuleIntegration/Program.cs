using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Delivery;
using Caiwu.Delivery.Modules;
using Caiwu.Persistence.Sqlite;
using Caiwu.Summaries;
using Caiwu.Nonprofit.Reporting;
using Caiwu.Costing;
using Caiwu.Operators;
using Caiwu.ReportDesigner;
using Caiwu.Reporting;

var root = Path.Combine(Path.GetTempPath(), "caiwu-real-module-loop-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
var checks = new List<string>();
try
{
    var install = Path.Combine(root, "program");
    var userData = Path.Combine(root, "user-data");
    var payload = Path.Combine(root, "payload");
    Directory.CreateDirectory(payload);
    File.WriteAllText(Path.Combine(payload, "Caiwu.Desktop.exe"), "synthetic payload only");
    PayloadManifest.Create(payload, "0.1.0.1", new string ('a', 40), true).Write(Path.Combine(payload, PayloadManifest.FileName));
    Installation.Install(payload, install, userData);
    using var data = Installation.OpenManagedData(install);
    // Exercise the exact FeatureWiring threading pattern: worker acquire, caller-thread release.
    var token = Task.Run(data.AcquireOperationLease).GetAwaiter().GetResult();
    token.Dispose();
    checks.Add("real lease token acquired on worker and disposed on caller thread");
    var path = data.NewBookPath(Guid.NewGuid());
    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    var info = new BookInfo(Guid.NewGuid(), "合成附件闭环账套", AccountingRegime.Nonprofit, "synthetic-2026", 2026, 1, 0, DateTimeOffset.UtcNow);
    LedgerSnapshot snapshot;
    using (var store = SqliteLedgerStore.Create(path, info, [new("1002", "银行存款", null, BalanceDirection.Debit, true, 100, 0), new("3101", "净资产", null, BalanceDirection.Credit, true, 0, 100)]))
        snapshot = store.Read();
    var book = data.RegisterBook(path, info.Id);
    Directory.CreateDirectory(data.OperatorsDirectory);
    var operators = new LocalOperatorService(new FileOperatorStore(data.OperatorsDirectory));
    operators.InitializeAdministrator("synthetic-admin", "虚构管理员", "Synthetic-password-123!");
    var identityFile = Path.Combine(data.OperatorsDirectory, "operators.json");
    var firstIdentityHash = PayloadManifest.Hash(identityFile);
    var summaries = new SummaryAttachmentCodec(userData);
    var classification = new ClassificationAttachmentCodec();
    var costing = new CostWorksheetAttachmentCodec();
    var templates = new ReportTemplateAttachmentCodec();
    var moduleHost = new ManagedModuleHost(data);
    Reject(() => moduleHost.OpenSummary(path, book.BookId), "Missing summary is not implicitly initialized");
    var registeredSummary = moduleHost.InitializeSummary(path, book.BookId);
    var summaryPath = registeredSummary.Catalog.Location.CatalogPath;
    var catalog = registeredSummary.Catalog;
    var cat = catalog.AddCategory("合成分类", catalog.Read().Version);
    var category = cat.Categories.Single().Id;
    catalog.AddSummary(category, "备份时摘要", cat.Version);
    data.RegisterAttachment(book, "summaries", summaries.Id, summaryPath, summaries);
    Reject(() => summaries.ReadVersion(summaryPath, snapshot with { Book = snapshot.Book with { Id = Guid.NewGuid() } }), "Original summary API refuses another BookId");
    var classificationPath = data.ModulePath(book, "Nonprofit", "classification.json");
    Directory.CreateDirectory(Path.GetDirectoryName(classificationPath)!);
    var period = new ReportingPeriod(new(2026, 1, 1), new(2026, 1, 31), ReportingPeriodKind.Monthly);
    new ClassificationJsonStore(Path.GetDirectoryName(classificationPath)!).SaveNew(Path.GetFileName(classificationPath), LedgerClassificationDraft.Create(snapshot, period, DateTimeOffset.UtcNow));
    data.RegisterAttachment(book, "classification", classification.Id, classificationPath, classification);
    var costPath = data.ModulePath(book, "Costing", "worksheet.json");
    Directory.CreateDirectory(Path.GetDirectoryName(costPath)!);
    var worksheet = new CostWorksheet(Guid.NewGuid(), book.BookId, new(2026, 1, 10), "synthetic-preparer", "synthetic-cost-source", CostWorksheetService.PolicyVersion, [new("s1", "合成工序", AllocationBasis.OutputQuantity, AllocationBasis.OutputQuantity, 10, 20, [new("p1", "合成品", 2, 100, 1, 1)], [])]);
    CostWorksheetExport.SaveNewJson(costPath, worksheet);
    data.RegisterAttachment(book, "cost", costing.Id, costPath, costing);
    var templatePath = data.ModulePath(book, "Reports", "template.json");
    Directory.CreateDirectory(Path.GetDirectoryName(templatePath)!);
    var template = new ReportTemplate
    {
        SourceKind = ReportKind.VoucherList,
        Title = "合成模板",
        Columns = [new("debit", "借方", "[debit]")]
    };
    TemplateStore.Save(templatePath, template);
    data.RegisterAttachment(book, "template", templates.Id, templatePath, templates);
    var service = moduleHost.BookBackups;
    var backup = service.Backup(book);
    Assert(backup.Manifest.Attachments.Length == 4 && !backup.Manifest.IncludesGlobalIdentities, "Complete four attachments with explicit identity boundary");
    var originalHashes = backup.Manifest.Attachments.ToDictionary(a => a.Key, a => a.Sha256);
    // A restore deliberately preserves both BookId and Revision. Physical instance/path must
    // still select independent writable module files, including another copy of CatalogId.
    var sameRevisionCopy = service.Restore(backup.Directory, backup.ManifestSha256);
    using (var a = SqliteLedgerStore.Open(path))
    using (var b = SqliteLedgerStore.Open(sameRevisionCopy.DatabasePath))
    {
        Assert(a.Read().Book.Id == b.Read().Book.Id && a.Read().Revision == b.Read().Revision, "Restore preserves same BookId and same Revision in a different physical path");
    }

    Assert(PayloadManifest.Hash(identityFile) == firstIdentityHash, "Same-ID/revision book restore preserves the already active global identity directory");
    var copyCatalog = moduleHost.OpenSummary(sameRevisionCopy.DatabasePath, book.BookId).Catalog;
    Assert(copyCatalog.Location.CatalogPath != catalog.Location.CatalogPath, "Equal BookId/revision resolves two distinct managed summary paths");
    var copyBefore = copyCatalog.Read();
    copyCatalog.UpdateSummary(copyBefore.Entries.Single().Id, category, "只修改恢复副本摘要", copyBefore.Version);
    Assert(moduleHost.OpenSummary(path, book.BookId).Catalog.Read().Entries.Single().Text == "备份时摘要", "Writing same-ID/revision restored summary does not change the active source summary");
    foreach (var sourceAttachment in data.ReadInventory().Attachments.Where(a => a.InstanceId == book.InstanceId))
        Assert(PayloadManifest.Hash(Path.Combine(userData, sourceAttachment.RelativePath)) == originalHashes[sourceAttachment.Key], "Restoring equal identity/revision leaves source " + sourceAttachment.Key + " untouched");
    catalog.UpdateSummary(catalog.Read().Entries.Single().Id, category, "源继续修改", catalog.Read().Version);
    TemplateStore.Save(templatePath, template with { Version = 2, Title = "源模板已改" }, TemplateStore.Load(templatePath).Sha256);
    using (var source = SqliteLedgerStore.Open(path))
    {
        var s = source.Read();
        source.Write(s with { Revision = s.Revision + 1, Book = s.Book with { Name = "源已修改" } }, s.Revision);
    }

    var attributes = SafePaths.Files(backup.Directory).ToDictionary(p => p, p => File.GetAttributes(p));
    foreach (var file in attributes)
        File.SetAttributes(file.Key, file.Value | FileAttributes.ReadOnly);
    ManagedBookRestoreResult result;
    try
    {
        result = service.Restore(backup.Directory, backup.ManifestSha256);
    }
    finally
    {
        foreach (var file in attributes)
            File.SetAttributes(file.Key, file.Value);
    }

    checks.Add("Read-only valid book and module backup restored without modifying the input");
    using (var restored = SqliteLedgerStore.Open(result.DatabasePath))
    {
        var s = restored.Read();
        Assert(s.Book.Id == info.Id && s.Book.Name == info.Name && s.Revision == snapshot.Revision, "Restored committed book before later source mutation");
    }

    var entries = data.ReadInventory().Attachments.Where(a => a.InstanceId == result.Book.InstanceId).ToArray();
    Assert(entries.Length == 4 && result.Book.InstanceId != book.InstanceId, "Restored independent physical instance ownership");
    foreach (var entry in entries)
        Assert(PayloadManifest.Hash(Path.Combine(userData, entry.RelativePath)) == originalHashes[entry.Key], "Restored exact validated " + entry.Key + " checksum");
    Assert(moduleHost.OpenSummary(result.DatabasePath, book.BookId).Catalog.Read().Entries.Single().Text == "备份时摘要", "Concrete FeatureWiring summary lookup follows restored physical instance");
    var restoredSummary = entries.Single(a => a.Key == "summaries");
    Assert(summaries.Open(Path.Combine(userData, restoredSummary.RelativePath), book.BookId).Read().Entries.Single().Text == "备份时摘要", "Summary module backup/restore API retains old summary version");
    Assert(TemplateStore.Load(Path.Combine(userData, entries.Single(a => a.Key == "template").RelativePath)).Template.Version == 1, "Template module CAS version retained");
    Assert(CostWorksheetExport.OpenJson(Path.Combine(userData, entries.Single(a => a.Key == "cost").RelativePath), book.BookId).FinishedCost == 130, "Real worksheet import recalculates restored amounts");
    // Source classification is stale after a ledger write. Do not silently capture it against a new revision.
    Reject(() => service.Backup(book), "Stale classification blocks complete backup");
    var admin = operators.Login("synthetic-admin", "Synthetic-password-123!");
    var rev = operators.GetDirectory(admin).Revision;
    operators.AddOperator(admin, rev, "synthetic-reader", "虚构只读人", "Synthetic-reader-123!", OperatorRoles.Reader);
    var reader = operators.Login("synthetic-reader", "Synthetic-reader-123!");
    var identities = new ManagedIdentityBackup(data, operators);
    Reject(() => identities.Backup(reader), "Non-admin cannot export password hashes");
    var identityBackup = identities.Backup(admin);
    Assert(identityBackup.ContainsPasswordHashes, "Separate authorized identity backup explicitly declares password hashes");
    var identityBefore = PayloadManifest.Hash(identityFile);
    service.Restore(backup.Directory, backup.ManifestSha256);
    Assert(PayloadManifest.Hash(identityFile) == identityBefore, "Book restore leaves global accounts/passwords/enabled state unchanged");
    var recoveredDirectory = identities.RestoreToNewDirectory(admin, identityBackup);
    var recoveredOperators = new LocalOperatorService(new FileOperatorStore(recoveredDirectory));
    Assert(recoveredOperators.Login("synthetic-reader", "Synthetic-reader-123!").Identity.ActorKey == reader.Identity.ActorKey, "Authorized separate identity recovery preserves synthetic actor and password");
    operators.Logout(admin);
    Reject(() => identities.RestoreToNewDirectory(admin, identityBackup), "Revoked administrator cannot restore identities");
    data.Dispose();
    var retained = SafePaths.Files(userData).Where(p => !p.EndsWith(".lock", StringComparison.Ordinal)).ToDictionary(p => p, PayloadManifest.Hash);
    Installation.Uninstall(install);
    foreach (var p in retained)
        Assert(File.Exists(p.Key) && PayloadManifest.Hash(p.Key) == p.Value, "Uninstall preserves " + Path.GetFileName(p.Key));
    var report = new
    {
        success = true,
        sourceCommit = Environment.GetEnvironmentVariable("GITHUB_SHA"),
        checks,
        sourceModules = new
        {
            summaries = "dcda051a0c9ee364ccff4c2b4c7085f446fac39d",
            classification = "cb71350b2b19067e7a8704b74985d8cf0f15e1aa",
            costing = "af0d0e34ab9963fc91cabb8a58aed558b34390f0",
            operators = "1957435365390756fd8267937fd0ec408b1e498f",
            reportDesigner = "03ee6dac47a7cc1c61f303f3c5e214245f87017d"
        },
        windowsExecuted = OperatingSystem.IsWindows(),
        realDataUsed = false
    };
    if (args.Length > 0)
        File.WriteAllText(args[0], JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
    Console.WriteLine(JsonSerializer.Serialize(report));
    return 0;
}
catch (Exception ex)
{
    Console.Error.WriteLine(ex);
    return 1;
}
finally
{
    if (Directory.Exists(root))
        Directory.Delete(root, true);
}

void Assert(bool condition, string message)
{
    if (!condition)
        throw new InvalidOperationException(message);
    checks.Add(message);
}

void Reject(Action action, string message)
{
    try
    {
        action();
    }
    catch
    {
        checks.Add(message);
        return;
    }

    throw new InvalidOperationException(message);
}

using Caiwu.Contracts;
using Caiwu.Summaries;
using Caiwu.Nonprofit.Reporting;
using Caiwu.Costing;

namespace Caiwu.Delivery.Modules;
public sealed class SummaryAttachmentCodec(string userDataRoot) : IManagedAttachmentCodec
{
    public string Id => "summary-v1";

    public JsonSummaryCatalog Open(string path, Guid bookId) => JsonSummaryCatalog.Open(new(userDataRoot, path, bookId));
    public string ReadVersion(string path, LedgerSnapshot snapshot)
    {
        var value = Open(path, snapshot.Book.Id).Read().Version;
        return $"{value.CatalogId:D}/{value.Revision}/{value.Sha256}";
    }

    public void Export(string source, string newDestination, LedgerSnapshot snapshot)
    {
        Open(source, snapshot.Book.Id).ExportBackup(newDestination);
        File.Delete(newDestination + ".lock");
    }

    public void Restore(string backup, string newDestination, LedgerSnapshot snapshot) => JsonSummaryCatalog.RestoreBackup(backup, PayloadManifest.Hash(backup), new(userDataRoot, newDestination, snapshot.Book.Id));
}

/// <summary>The source and capture are validated against the exact SQLite backup snapshot.</summary>
public sealed class ClassificationAttachmentCodec : IManagedAttachmentCodec
{
    public string Id => "nonprofit-classification-v1";

    public string ReadVersion(string path, LedgerSnapshot snapshot)
    {
        _ = Load(path, snapshot);
        return PayloadManifest.Hash(path);
    }

    public void Export(string source, string newDestination, LedgerSnapshot snapshot) => Save(newDestination, Load(source, snapshot));
    public void Restore(string backup, string newDestination, LedgerSnapshot snapshot) => Save(newDestination, Load(backup, snapshot));
    private static LedgerClassificationManifest Load(string path, LedgerSnapshot snapshot) => new ClassificationJsonStore(Path.GetDirectoryName(path)!).Load(Path.GetFileName(path), snapshot);
    private static void Save(string path, LedgerClassificationManifest value) => new ClassificationJsonStore(Path.GetDirectoryName(path)!).SaveNew(Path.GetFileName(path), value);
}

/// <summary>Worksheets are validated by the original recalculation/import API and are saved to new files.</summary>
public sealed class CostWorksheetAttachmentCodec : IManagedAttachmentCodec
{
    public string Id => "cost-worksheet-v1";

    public string ReadVersion(string path, LedgerSnapshot snapshot)
    {
        _ = CostWorksheetExport.OpenJson(path, snapshot.Book.Id);
        return PayloadManifest.Hash(path);
    }

    public void Export(string source, string newDestination, LedgerSnapshot snapshot) => CostWorksheetExport.SaveNewJson(newDestination, CostWorksheetExport.OpenJson(source, snapshot.Book.Id).Input);
    public void Restore(string backup, string newDestination, LedgerSnapshot snapshot) => Export(backup, newDestination, snapshot);
}

/// <summary>Template JSON has no intrinsic BookId. The host registry explicitly assigns it to this physical book.</summary>
public sealed class ReportTemplateAttachmentCodec : IManagedAttachmentCodec
{
    public string Id => "report-template-v1";

    public string ReadVersion(string path, LedgerSnapshot snapshot)
    {
        var value = Caiwu.ReportDesigner.TemplateStore.Load(path);
        return $"{value.Template.Id:D}/{value.Template.Version}/{value.Sha256}";
    }

    public void Export(string source, string newDestination, LedgerSnapshot snapshot)
    {
        Caiwu.ReportDesigner.TemplateStore.Save(newDestination, Caiwu.ReportDesigner.TemplateStore.Load(source).Template);
        File.Delete(newDestination + ".lock");
    }

    public void Restore(string backup, string newDestination, LedgerSnapshot snapshot) => Export(backup, newDestination, snapshot);
}

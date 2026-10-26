using System.Text.Json;
using System.Text.Json.Serialization;
using Caiwu.Contracts;
using Caiwu.ReportDesigner.Cells;

namespace Caiwu.ReportDesigner.Integration;

public sealed record ReportLedgerCompleteness(bool CompleteBaseCurrency, bool NoAuxiliaryValues,
    bool NoForeignCurrencyValues, bool NoQuantityValues, bool NoUnknownSourceColumns,
    DateOnly CoveredFrom, DateOnly CoveredThrough, bool IsSynthetic, string Evidence);
public sealed record ReportModuleEnvelope
{
    [JsonRequired] public int SchemaVersion { get; init; } = 1;
    [JsonRequired] public CellReport Report { get; init; } = new();
    /// <summary>Opaque original columns/metadata, verbatim string. No lossy DTO mapping or original-format claim.</summary>
    [JsonRequired] public string OriginalPayloadJson { get; init; } = "{}";
    [JsonExtensionData] public Dictionary<string, JsonElement>? UnknownProperties { get; init; }
}
public sealed class ReportDocumentSession
{
    public LedgerMutationContext Context { get; }
    public string DocumentId { get; }
    public ReportModuleEnvelope Envelope { get; }
    internal ReportDocumentSession(LedgerMutationContext context, string documentId, ReportModuleEnvelope envelope)
    { Context = context; DocumentId = documentId; Envelope = envelope; }
}
/// <summary>Targets frozen PR52 Contracts API. No shared source edits; no refresh/retry of a user's captured decision.</summary>
public static class ParityReportAdapter
{
    public const string ModuleId = "reports";
    private static readonly JsonSerializerOptions Options = new() {
        MaxDepth = 32, AllowDuplicateProperties = false, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        RespectRequiredConstructorParameters = true, Converters = { new JsonStringEnumConverter(allowIntegerValues: false) }
    };
    public static ParityModuleRegistration Registration { get; } = new(ModuleId, 1,
        Array.AsReadOnly(new[] { "qingsong/main", "minfeiqi/main", "chengben/main" }.SelectMany(product => new[] {
            new OriginalWindowReference(product, "w_bb_def", "event:w_bb_main.cb_7.clicked"),
            new OriginalWindowReference(product, "w_bb_def", "event:w_bb_main.cb_17.clicked"),
            new OriginalWindowReference(product, "w_bb_def_rowh", "event:w_bb_def.u_rowh"),
            new OriginalWindowReference(product, "w_bb_def_colw", "event:w_bb_def.u_colw"),
            new OriginalWindowReference(product, "w_bb_def_format", "event:w_bb_def.u_format") }).ToArray()));
    public static ReportDocumentSession Open(ModuleLedgerSnapshot snapshot, string documentId)
    {
        var context = CaptureContext(snapshot);
        var collection = snapshot.Modules.SingleOrDefault(m => m.ModuleId == ModuleId) ?? throw new InvalidDataException("本账套没有报表模块文档。");
        var document = collection.Documents.SingleOrDefault(d => d.DocumentId == documentId) ?? throw new InvalidDataException("报表文档不存在。");
        if (document.SchemaVersion != 1 || document.PayloadJson.Length > 8 * 1024 * 1024) throw new InvalidDataException("报表模块文档版本不支持或超过预算。");
        ReportModuleEnvelope envelope;
        try { envelope = JsonSerializer.Deserialize<ReportModuleEnvelope>(document.PayloadJson, Options) ?? throw new JsonException("空文档。"); }
        catch (JsonException ex) { throw new InvalidDataException("报表模块文档无效；未丢弃未知内容。", ex); }
        if (envelope.SchemaVersion != 1) throw new InvalidDataException("报表 envelope 版本不支持。");
        ValidateOriginal(envelope.OriginalPayloadJson);
        envelope = envelope with { Report = CellReportRules.Freeze(envelope.Report), UnknownProperties = envelope.UnknownProperties?.ToDictionary(k => k.Key, k => k.Value.Clone(), StringComparer.Ordinal) };
        if (documentId != Id(envelope.Report.Id)) throw new InvalidDataException("报表标识不匹配。");
        return new(context, documentId, envelope);
    }
    public static ReportDocumentSession New(ModuleLedgerSnapshot snapshot, CellReport report, string originalPayloadJson)
    {
        ValidateOriginal(originalPayloadJson); report = CellReportRules.Freeze(report);
        var documentId = Id(report.Id);
        if (snapshot.Modules.Where(m => m.ModuleId == ModuleId).SelectMany(m => m.Documents).Any(d => d.DocumentId == documentId)) throw new InvalidDataException("报表标识已存在。");
        return new(CaptureContext(snapshot), documentId, new() { Report = report, OriginalPayloadJson = originalPayloadJson });
    }
    public static void Save(IParityLedgerService service, ReportDocumentSession session, CellReport edited, string operatorName)
    {
        ArgumentNullException.ThrowIfNull(service); edited = CellReportRules.Freeze(edited);
        if (edited.Id != session.Envelope.Report.Id || edited.Version != session.Envelope.Report.Version) throw new InvalidDataException("提交编辑须保留捕获的报表Id和版本，适配器在保存时递增。");
        var envelope = session.Envelope with { Report = edited with { Version = checked(edited.Version + 1) } };
        var json = JsonSerializer.Serialize(envelope, Options);
        var document = new LedgerModuleDocument(session.DocumentId, 1, json);
        // All authority remains in one ledger CAS. External JSON is not an additional authoritative commit.
        service.SaveModuleDocuments(new(ModuleId, session.Context, [new(session.DocumentId, document)]), operatorName);
    }
    public static LedgerReportSource CreateBaseCurrencySource(ModuleLedgerSnapshot snapshot, ReportLedgerCompleteness proof)
    {
        var ledger = snapshot.Ledger; var expectedFrom = new DateOnly(ledger.Book.FiscalYear, ledger.Book.StartMonth, 1);
        if (!proof.CompleteBaseCurrency || !proof.NoAuxiliaryValues || !proof.NoForeignCurrencyValues || !proof.NoQuantityValues || !proof.NoUnknownSourceColumns ||
            string.IsNullOrWhiteSpace(proof.Evidence) || proof.CoveredFrom != expectedFrom || proof.CoveredThrough < proof.CoveredFrom)
            throw new ReportDataException("简化 Ledger DTO 不能证明完整取数；必须提供本位币完整性及无辅助/外币/数量/未知列的明确证据，否则改用无损自有取数源。");
        return new(ledger.Book.Id, ledger.Revision, proof.CoveredFrom, proof.CoveredThrough,
            ledger.Accounts.Select(a => new ReportAccount(a.Code, a.ParentCode, a.OpeningDebit, a.OpeningCredit)),
            ledger.Vouchers.Select(v => new ReportVoucher(v.Id.ToString("D"), v.Date, v.Status == VoucherStatus.Posted,
                v.Lines.Select(l => new ReportEntry(l.AccountCode, l.Debit, l.Credit)).ToArray())), proof.IsSynthetic);
    }
    private static string Id(Guid id) => "report:" + id.ToString("D");
    private static LedgerMutationContext CaptureContext(ModuleLedgerSnapshot snapshot)
    {
        if (snapshot.Ledger.Book.Id == Guid.Empty || snapshot.Ledger.Revision < 0) throw new InvalidDataException("快照身份无效。");
        return new(snapshot.Ledger.Book.Id, snapshot.Ledger.Revision);
    }
    private static void ValidateOriginal(string text)
    {
        if (text is null || text.Length > 4 * 1024 * 1024) throw new InvalidDataException("原始字段JSON为空或过大。");
        try { using var json = JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = 32, AllowDuplicateProperties = false }); if (json.RootElement.ValueKind != JsonValueKind.Object) throw new JsonException("原字段须为对象。"); }
        catch (JsonException ex) { throw new InvalidDataException("原字段JSON无效；未丢弃原字段。", ex); }
    }
}

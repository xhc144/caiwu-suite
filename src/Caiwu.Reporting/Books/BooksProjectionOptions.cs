namespace Caiwu.Reporting.Books;

/// <summary>Annotations must originate from the same user-visible module snapshot. Match guards reject stale line metadata.</summary>
public sealed record BooksLineAnnotation(Guid VoucherId, int Sequence, string AccountCode, string Summary,
    decimal Debit, decimal Credit, string SettlementType, string CheckNumber, string BillNumber, string SourceKey);

public sealed record BooksProjectionOptions(Guid ExpectedBookId, long ExpectedRevision,
    IReadOnlyDictionary<string, JournalAccountKind> JournalKinds,
    IReadOnlyDictionary<string, (decimal Debit, decimal Credit)> PreOpeningActivity,
    IReadOnlyList<BooksLineAnnotation> LineAnnotations, string BaseCurrencyName);

/// <summary>Original JSON stays verbatim; this module neither rewrites it nor interprets unsupported dimensions.</summary>
public sealed record BooksRetainedModuleDocument(string ModuleId, string DocumentId, int SchemaVersion, string PayloadJson);
public sealed record BooksModuleProjection(BooksLedgerInput Input, IReadOnlyList<BooksRetainedModuleDocument> RetainedDocuments);

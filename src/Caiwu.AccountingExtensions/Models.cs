using Caiwu.Contracts;

namespace Caiwu.AccountingExtensions;

public sealed record ReversePostingRequest(int FiscalYear, int FromMonth, int ThroughMonth,
    bool AllMonths, LedgerMutationContext Context);

public sealed record ReopenPeriodRequest(int FiscalYear, bool AllMonths, LedgerMutationContext Context);

public sealed record AccountingMutationResult(long AcceptedRevision, int AffectedCount);

public sealed record MonthlyTransferDefinition(string Code, string Version, string Summary,
    string VoucherKind, IReadOnlyList<string> SourceAccountCodes, string DestinationAccountCode);

public sealed record MonthlyTransferRequest(int FiscalYear, int Month,
    MonthlyTransferDefinition Definition, LedgerMutationContext Context);

/// <summary>A preview, never an authorization credential. Commit recomputes from the original request/token.</summary>
public sealed class MonthlyTransferPlan
{
    internal MonthlyTransferPlan(LedgerMutationContext context, DateOnly date,
        MonthlyTransferDefinition definition, IReadOnlyList<VoucherLine> lines)
        => (Context, Date, Definition, Lines) = (context, date, definition, lines);

    public LedgerMutationContext Context { get; }
    public DateOnly Date { get; }
    public MonthlyTransferDefinition Definition { get; }
    public IReadOnlyList<VoucherLine> Lines { get; }
    public decimal DebitTotal => Lines.Sum(x => x.Debit);
    public decimal CreditTotal => Lines.Sum(x => x.Credit);

    internal VoucherDraft ToDraft() => new(null, Date, Definition.VoucherKind, null, 0,
        Lines, Context.ExpectedRevision, Context.ExpectedBookId);
}

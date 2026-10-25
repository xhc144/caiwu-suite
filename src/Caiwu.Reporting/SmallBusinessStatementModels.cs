using Caiwu.Contracts;

namespace Caiwu.Reporting;

public enum StatementCoverage { Calculated, MissingData }

public sealed record StatementValue(decimal? Amount, StatementCoverage Coverage, string Explanation);
public sealed record StatementLine(int RowNumber, string Label, StatementValue First, StatementValue Second,
    string Formula, string SourceLocator);
public sealed record StatementIssue(string Code, string Detail);
public sealed record StatementAccountMapping(string RootAccountCode, string OfficialAccountCode);
public sealed record IncomeDetailMapping(int OfficialRowNumber, string AccountCode);
public sealed record SettlementTermMapping(string AccountCode, bool OpeningOverOneYear, bool ClosingOverOneYear);

/// <summary>Explicit classifications; no account-name/summary heuristics. Closing IDs are excluded only from income activity.</summary>
public sealed class SmallBusinessStatementOptions
{
    public IReadOnlyList<Guid> ProfitClosingVoucherIds { get; }
    public IReadOnlyList<StatementAccountMapping> AccountMappings { get; }
    public IReadOnlyList<IncomeDetailMapping> IncomeDetails { get; }
    public IReadOnlyList<ReportSource> AdditionalSources { get; }
    public bool SettlementLeavesAreCounterpartySeparated { get; }
    public IReadOnlyList<SettlementTermMapping> SettlementTerms { get; }

    public SmallBusinessStatementOptions(IEnumerable<Guid>? profitClosingVoucherIds = null,
        IEnumerable<StatementAccountMapping>? accountMappings = null,
        IEnumerable<IncomeDetailMapping>? incomeDetails = null, IEnumerable<ReportSource>? additionalSources = null,
        bool settlementLeavesAreCounterpartySeparated = false, IEnumerable<SettlementTermMapping>? settlementTerms = null)
    {
        ProfitClosingVoucherIds = Array.AsReadOnly((profitClosingVoucherIds ?? []).ToArray());
        AccountMappings = Array.AsReadOnly((accountMappings ?? []).ToArray());
        IncomeDetails = Array.AsReadOnly((incomeDetails ?? []).ToArray());
        AdditionalSources = Array.AsReadOnly((additionalSources ?? []).ToArray());
        SettlementLeavesAreCounterpartySeparated = settlementLeavesAreCounterpartySeparated;
        SettlementTerms = Array.AsReadOnly((settlementTerms ?? []).ToArray());
        if (ProfitClosingVoucherIds.Distinct().Count() != ProfitClosingVoucherIds.Count)
            throw new ArgumentException("损益结转凭证 ID 不能重复。", nameof(profitClosingVoucherIds));
        if (AccountMappings.Any(x => x is null) || IncomeDetails.Any(x => x is null) ||
            AdditionalSources.Any(x => x is null) || SettlementTerms.Any(x => x is null))
            throw new ArgumentException("映射和来源不能含空项。");
    }
}

/// <summary>Finite calculation preview, always unverified for production even when every amount is numeric.</summary>
public sealed class SmallBusinessStatement
{
    public const string RulePackageId = "small-business-2011-base-2026-snapshot";
    public const string RulePackageVersion = "2026.10.25.1";
    public const string RuleCommit = "e00a404bc447bb7e0d56972ef320e1b2efc9d846";
    public const string FormulaVersion = "sb-2011-17-statements-preview.1";
    public const string OfficialAppendixUrl = "https://kjs.mof.gov.cn/zhengcefabu/201111/P020111118325852734144.pdf";
    public bool IsVerifiedForProduction => false;
    public bool IsCompleteFormulaSet => false;
    public string OfficialForm { get; }
    public ReportDocument Document { get; }
    public IReadOnlyList<StatementLine> Lines { get; }
    public IReadOnlyList<StatementIssue> Issues { get; }
    public bool HasAllNumericValues => Lines.All(l => l.First.Amount.HasValue && l.Second.Amount.HasValue);

    internal SmallBusinessStatement(string form, ReportDocument document, IEnumerable<StatementLine> lines,
        IEnumerable<StatementIssue> issues)
    {
        OfficialForm = form;
        Document = document;
        Lines = Array.AsReadOnly(lines.ToArray());
        Issues = Array.AsReadOnly(issues.ToArray());
    }
}

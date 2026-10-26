using Caiwu.Contracts;

namespace Caiwu.AccountingExtensions;

/// <summary>Explicit null is distinct from numeric zero. Original text/type retains values decimal cannot represent.</summary>
public sealed record OriginalFieldValue(string DatabaseType, bool IsNull, string? InvariantText);

public sealed record AuxiliaryDimensions(string? ProjectCode, string? CounterpartyCode,
    string? DepartmentCode, string? PersonCode, string? CashFlowCode, string? ContractNumber);

public sealed record ForeignCurrencyData(string? CurrencyCode, decimal? OriginalAmount, decimal? ExchangeRate);

public sealed record QuantityData(string? Unit, decimal? Quantity, decimal? UnitPrice);

public sealed record AccountingLineData(Guid? LineId, int OriginalOrdinal, VoucherLine BaseAmounts,
    AuxiliaryDimensions? Auxiliary, ForeignCurrencyData? ForeignCurrency, QuantityData? Quantity,
    string? SettlementType, string? BankDocumentNumber, string? TransferMark,
    IReadOnlyDictionary<string, OriginalFieldValue> OriginalFields);

public sealed record AccountFeatureData(string AccountCode, bool? IsBank, bool? UsesForeignCurrency,
    bool? UsesQuantity, bool? UsesProject, bool? UsesCounterparty, bool? UsesDepartment,
    bool? UsesPerson, bool? UsesCashFlow, bool? UsesReceivablePayable,
    IReadOnlyDictionary<string, OriginalFieldValue> OriginalFields);

public sealed record AccountingOpeningData(int FiscalYear, string AccountCode,
    AuxiliaryDimensions? Auxiliary, string? CurrencyCode, string? Unit,
    decimal? OpeningDebit, decimal? OpeningCredit, decimal? BeforeStartDebit, decimal? BeforeStartCredit,
    decimal? OriginalOpeningDebit, decimal? OriginalOpeningCredit,
    decimal? OriginalBeforeStartDebit, decimal? OriginalBeforeStartCredit,
    decimal? OpeningQuantity, string? GeneratedBatchId, int? GeneratedFromYear,
    long? GeneratedFromRevision, IReadOnlyDictionary<string, OriginalFieldValue> OriginalFields);

/// <summary>Only explicitly plain legacy lines may cross the current four-field contract.</summary>
public static class LegacyLineAdapter
{
    public static IReadOnlyList<VoucherLine> ToLegacyLines(IReadOnlyList<AccountingLineData> lines)
    {
        ArgumentNullException.ThrowIfNull(lines);
        var result = new List<VoucherLine>();
        foreach (var line in lines)
        {
            ArgumentNullException.ThrowIfNull(line);
            if (line.LineId is not null || line.Auxiliary is not null || line.ForeignCurrency is not null ||
                line.Quantity is not null || line.SettlementType is not null || line.BankDocumentNumber is not null ||
                line.TransferMark is not null || line.OriginalFields is null || line.OriginalFields.Count != 0 ||
                line.OriginalOrdinal != result.Count + 1)
                throw new NotSupportedException("当前账务接口不能无损保存该分录的标识、维度、原币、数量、结算或原字段；请接入扩展事务存储，不能丢字段保存。");
            ArgumentNullException.ThrowIfNull(line.BaseAmounts);
            result.Add(line.BaseAmounts with { });
        }
        return result.AsReadOnly();
    }
}

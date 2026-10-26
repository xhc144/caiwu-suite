using System.Text.Json;
using Caiwu.Contracts;

namespace Caiwu.AccountingExtensions.Tests;

public sealed class DataContractTests
{
    private static AccountingLineData Plain() => new(null, 1, new("1001", "合成", 100, 0),
        null, null, null, null, null, null, new Dictionary<string, OriginalFieldValue>());

    [Fact]
    public void ContractRoundTripPreservesAllDimensionsZeroNullAndUnknownLexicalValues()
    {
        var line = Plain() with
        {
            LineId = Guid.NewGuid(), OriginalOrdinal = 7,
            Auxiliary = new("项目001", "客供002", "部门003", "人员004", "现金05", "合同006"),
            ForeignCurrency = new("USD", 0, null), Quantity = new("千克", 0.123456789m, 123456.7890123m),
            SettlementType = "01", BankDocumentNumber = "BANK-007", TransferMark = "1",
            OriginalFields = new Dictionary<string, OriginalFieldValue>
            {
                ["future_column"] = new("double", false, "1.7976931348623157E+308"),
                ["sql_null"] = new("numeric(18,6)", true, null), ["empty_string"] = new("char(6)", false, "")
            }
        };
        var restored = JsonSerializer.Deserialize<AccountingLineData>(JsonSerializer.Serialize(line))!;
        Assert.Equal(line.LineId, restored.LineId); Assert.Equal(7, restored.OriginalOrdinal);
        Assert.Equal(line.BaseAmounts, restored.BaseAmounts); Assert.Equal(line.Auxiliary, restored.Auxiliary);
        Assert.Equal(line.ForeignCurrency, restored.ForeignCurrency); Assert.Equal(line.Quantity, restored.Quantity);
        Assert.Equal(0, restored.ForeignCurrency!.OriginalAmount); Assert.Null(restored.ForeignCurrency.ExchangeRate);
        Assert.Equal(line.OriginalFields.OrderBy(x => x.Key), restored.OriginalFields.OrderBy(x => x.Key));
        Assert.Equal(line.SettlementType, restored.SettlementType);
        Assert.Equal(line.BankDocumentNumber, restored.BankDocumentNumber); Assert.Equal(line.TransferMark, restored.TransferMark);
    }

    [Fact]
    public void EveryUnsupportedFieldRejectsLegacyProjectionIncludingExplicitEmptyDimension()
    {
        var plain = Plain();
        AccountingLineData[] values =
        [plain with { LineId = Guid.NewGuid() }, plain with { OriginalOrdinal = 2 },
         plain with { Auxiliary = new(null, null, null, null, null, null) },
         plain with { ForeignCurrency = new(null, null, null) }, plain with { Quantity = new(null, 0, null) },
         plain with { SettlementType = "" }, plain with { BankDocumentNumber = "x" }, plain with { TransferMark = "0" },
         plain with { OriginalFields = new Dictionary<string, OriginalFieldValue> { ["unknown"] = new("double", false, "0") } }];
        foreach (var value in values)
            Assert.Throws<NotSupportedException>(() => LegacyLineAdapter.ToLegacyLines([value]));
        Assert.Equal(plain.BaseAmounts, Assert.Single(LegacyLineAdapter.ToLegacyLines([plain])));
    }

    [Fact]
    public void OpeningContractRetainsBeforeStartForeignAmountsAndGenerationProvenance()
    {
        var value = new AccountingOpeningData(2026, "1001", new("项目", null, null, null, null, null), "USD", null,
            100, 0, 20, 0, 15.123456m, 0, 3.25m, null, null, "batch-1", 2025, 123,
            new Dictionary<string, OriginalFieldValue> { ["ys"] = new("double", true, null) });
        var copy = JsonSerializer.Deserialize<AccountingOpeningData>(JsonSerializer.Serialize(value))!;
        Assert.Equal(3.25m, copy.OriginalBeforeStartDebit); Assert.Null(copy.OriginalBeforeStartCredit);
        Assert.Equal(2025, copy.GeneratedFromYear); Assert.Equal(123, copy.GeneratedFromRevision);
        Assert.Equal("batch-1", copy.GeneratedBatchId); Assert.Equal(value.OriginalFields["ys"], copy.OriginalFields["ys"]);
    }
}

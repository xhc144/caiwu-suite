using System.Text.Json;

namespace Caiwu.Payroll;

public sealed class PayrollValidationException(string message) : Exception(message);
public sealed class PayrollConflictException() : Exception("工资数据已被其他窗口更改，请刷新后重试。");

public enum PayrollValueKind { Text, Number }
public enum PayrollVoucherKind { Payment, Distribution }

// Field IDs are stable. Original code flags, NULLs, unknown fields and variant metadata
// belong in OriginalFields until the original-data adapter can interpret them losslessly.
public sealed record Department
{
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public Dictionary<string, string?> OriginalFields { get; set; } = [];
}

public sealed record Employee
{
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string DepartmentCode { get; set; } = "";
    public bool IsActive { get; set; } = true;
    // g_j4..g_j8, g_f1/g_f2 and extension fields; never truncated on save.
    public Dictionary<string, string?> Attributes { get; set; } = [];
    public Dictionary<string, string?> OriginalFields { get; set; } = [];
}

public sealed record PayrollPrintLayout
{
    public bool Enabled { get; set; }
    public int IntegerDigits { get; set; } = 10;
    public int DecimalDigits { get; set; } = 2;
}

public sealed record PayrollColumn
{
    public string FieldName { get; set; } = "";
    public string Caption { get; set; } = "";
    public string Description { get; set; } = "";
    public int Order { get; set; }
    public PayrollValueKind Kind { get; set; } = PayrollValueKind.Number;
    public bool Enabled { get; set; }
    public bool CarryForward { get; set; }
    public int Width { get; set; } = 12;
    public int DecimalDigits { get; set; } = 2;
    public PayrollPrintLayout WageTable { get; set; } = new();
    public PayrollPrintLayout Summary { get; set; } = new();
    public PayrollPrintLayout Payslip { get; set; } = new();
    public Dictionary<string, string?> OriginalFields { get; set; } = [];
}

public sealed record PayrollFormula
{
    public int Order { get; set; }
    public string Name { get; set; } = "";
    public string TargetField { get; set; } = "";
    public string Expression { get; set; } = "";
    public string Condition { get; set; } = "";
    public bool Enabled { get; set; } = true;
    // A tax formula evaluates its expression as the tax base using the explicit profile.
    public bool IsTaxFormula { get; set; }
    public Dictionary<string, string?> OriginalFields { get; set; } = [];
}

public sealed record TaxBand
{
    public decimal? UpperLimit { get; set; }
    public decimal Rate { get; set; }
}

// No installed rate table or implicit current-law assumption. This profile describes
// single-period progressive arithmetic only; annual/cumulative withholding is separate.
public sealed record PayrollTaxProfile
{
    public string Name { get; set; } = "";
    public string SourceTitle { get; set; } = "";
    public string SourceUri { get; set; } = "";
    public string SourceLocator { get; set; } = "";
    public DateOnly EffectiveFrom { get; set; }
    public DateOnly EffectiveTo { get; set; }
    public decimal Allowance { get; set; }
    public List<TaxBand> Bands { get; set; } = [];

    public void Validate()
    {
        Guard.Require(!string.IsNullOrWhiteSpace(Name) && !string.IsNullOrWhiteSpace(SourceTitle)
            && !string.IsNullOrWhiteSpace(SourceLocator), "税参数必须填写名称、出处和条款/数据定位。");
        Guard.Require(Uri.TryCreate(SourceUri, UriKind.Absolute, out var uri)
            && uri.Scheme == Uri.UriSchemeHttps, "税参数出处须为明确的 HTTPS 文档地址。");
        Guard.Require(EffectiveFrom <= EffectiveTo && Allowance >= 0, "税参数有效期或起征额不合法。");
        Guard.Require(Bands.Count is > 0 and <= 100 && Bands[^1].UpperLimit is null,
            "税率表必须以无上限档结束。");
        decimal lower = 0;
        for (var i = 0; i < Bands.Count; i++)
        {
            var b = Bands[i];
            Guard.Require(b.Rate is >= 0 and <= 1, "税率应介于 0 与 1。");
            Guard.Require(b.UpperLimit is null ? i == Bands.Count - 1 : b.UpperLimit > lower,
                "税率档上限必须严格递增，且仅末档可为空。");
            if (b.UpperLimit is { } upper) lower = upper;
        }
    }

    public decimal Calculate(decimal baseAmount, DateOnly period)
    {
        Validate();
        Guard.Require(period >= EffectiveFrom && period <= EffectiveTo, "当前工资月份不在税参数有效期内。");
        var taxable = Math.Max(0, baseAmount - Allowance);
        decimal tax = 0, lower = 0;
        foreach (var b in Bands)
        {
            tax = checked(tax + Math.Max(0, Math.Min(taxable, b.UpperLimit ?? taxable) - lower) * b.Rate);
            if (b.UpperLimit is not { } upper || taxable <= upper) break;
            lower = upper;
        }
        return decimal.Round(tax, 2, MidpointRounding.AwayFromZero);
    }
}

public sealed record PayrollRow
{
    public Employee Employee { get; set; } = new();
    public Dictionary<string, decimal?> Inputs { get; set; } = [];
    public Dictionary<string, decimal?> Results { get; set; } = [];
    public Dictionary<string, string?> OriginalFields { get; set; } = [];
}

public sealed record PayrollPeriod
{
    public DateOnly Month { get; set; }
    public List<PayrollRow> Rows { get; set; } = [];
    public long DataVersion { get; set; } = 1;
    public long CalculatedDataVersion { get; set; }
    public long CalculatedConfigurationVersion { get; set; }
}

public sealed record PayrollAccount(string Code, bool Enabled = true, bool IsLeaf = true,
    bool RequiresDepartment = false, bool RequiresEmployee = false, string? UnsupportedAuxiliaryDimensions = null);

public sealed record PayrollCreditMapping
{
    public string FieldName { get; set; } = "";
    public string AccountCode { get; set; } = "";
}

public sealed record PayrollVoucherSettings
{
    public string PayableAccount { get; set; } = "";
    public string PayableField { get; set; } = "";
    public string DistributionAccountField { get; set; } = "g_j4";
    public List<PayrollCreditMapping> Credits { get; set; } = [];
    public Dictionary<string, string?> OriginalFields { get; set; } = [];
}

public sealed record PayrollVoucherRequest(PayrollVoucherKind Kind, DateOnly Date,
    string VoucherType, int Number, string Summary);
public sealed record PayrollVoucherLine(string AccountCode, string Summary, decimal Debit,
    decimal Credit, string DepartmentCode, string EmployeeCode);

public sealed record PayrollVoucherPlan
{
    public Guid Id { get; set; }
    public string SourceKey { get; set; } = "";
    public Guid BookId { get; set; }
    public DateOnly Month { get; set; }
    public long DataVersion { get; set; }
    public long ConfigurationVersion { get; set; }
    public PayrollVoucherRequest Request { get; set; } = new(PayrollVoucherKind.Payment, default, "", 0, "");
    public List<PayrollVoucherLine> Lines { get; set; } = [];
    // A persisted plan is never a posted voucher. No fake TransferToLedger method.
    public string Status { get; set; } = "planned";
}

public sealed record WageTable(DateOnly Month, bool IsCalculated, IReadOnlyList<PayrollColumn> Columns,
    IReadOnlyList<PayrollRow> Rows, IReadOnlyDictionary<string, decimal> Totals);

public sealed record PayrollDocument
{
    public int FormatVersion { get; set; } = 1;
    public Guid BookId { get; set; }
    public string BookName { get; set; } = "";
    public DateOnly OpeningMonth { get; set; }
    public long Revision { get; set; }
    public long ConfigurationVersion { get; set; } = 1;
    public List<Department> Departments { get; set; } = [];
    public List<Employee> Employees { get; set; } = [];
    public List<PayrollColumn> Columns { get; set; } = CreateColumnSlots();
    public List<PayrollFormula> Formulas { get; set; } = [];
    public PayrollTaxProfile? TaxProfile { get; set; }
    public PayrollVoucherSettings? VoucherSettings { get; set; }
    public List<PayrollPeriod> Periods { get; set; } = [];
    public List<PayrollVoucherPlan> VoucherPlans { get; set; } = [];
    public Dictionary<string, string?> OriginalFields { get; set; } = [];

    public static List<PayrollColumn> CreateColumnSlots()
    {
        var columns = new List<PayrollColumn>();
        for (var i = 1; i <= 8; i++) columns.Add(new()
        {
            FieldName = $"g_j{i}", Caption = i switch { 1 => "编号", 2 => "姓名", 3 => "部门", _ => $"g_j{i}" },
            Kind = PayrollValueKind.Text, Enabled = i <= 3, Order = i, CarryForward = true
        });
        columns.Add(new() { FieldName = "g_f1", Caption = "g_f1", Kind = PayrollValueKind.Number, Order = 9 });
        columns.Add(new() { FieldName = "g_f2", Caption = "g_f2", Kind = PayrollValueKind.Text, Order = 10 });
        for (var i = 1; i <= 80; i++) columns.Add(new()
            { FieldName = $"g_l{i:00}", Caption = $"g_l{i:00}", Order = 10 + i });
        return columns;
    }
}

internal static class Guard
{
    public static void Require(bool condition, string message)
    {
        if (!condition) throw new PayrollValidationException(message);
    }
}

internal static class PayrollJson
{
    internal static readonly JsonSerializerOptions Options = new() { WriteIndented = true, MaxDepth = 64 };
    internal static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);
    internal static T Clone<T>(T value) => JsonSerializer.Deserialize<T>(Serialize(value), Options)!;
}

using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using Caiwu.Contracts;

namespace Caiwu.Desktop.Presentation;

public abstract class EditableRow : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;
    protected bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return false;
        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
        return true;
    }
}

public static class AmountInput
{
    public static decimal Parse(string? text, string label)
    {
        if (string.IsNullOrWhiteSpace(text)) return 0m;
        var format = CultureInfo.CurrentCulture.NumberFormat;
        var parts = text.Trim().Split(format.NumberDecimalSeparator, StringSplitOptions.None);
        if (parts.Length > 2 || parts[0].Length == 0 ||
            parts.Length == 2 && (parts[1].Length is < 1 or > 2 || !Digits(parts[1])))
            throw Invalid();
        var groups = parts[0].Split(format.NumberGroupSeparator, StringSplitOptions.None);
        if (groups.Any(group => group.Length == 0 || !Digits(group))) throw Invalid();
        if (groups.Length > 1)
        {
            var sizes = format.NumberGroupSizes;
            for (var position = groups.Length - 1; position >= 0; position--)
            {
                var size = sizes[Math.Min(groups.Length - 1 - position, sizes.Length - 1)];
                if (size == 0 ? position != 0 : position == 0 ? groups[position].Length > size : groups[position].Length != size)
                    throw Invalid();
            }
        }
        var integer = string.Concat(groups);
        var fraction = parts.Length == 2 ? parts[1].PadRight(2, '0') : "00";
        // Parse exact cents first: decimal.TryParse alone can round a very large input.
        if (!long.TryParse(integer + fraction, NumberStyles.None, CultureInfo.InvariantCulture, out var cents))
            throw new LedgerValidationException($"{label}金额超出本版支持范围。");
        var value = cents / 100m;
        return value;

        LedgerValidationException Invalid() => new($"{label}请输入非负金额，最多两位小数；千分位须按当前区域格式完整分组。");
        static bool Digits(string value) => value.All(c => c is >= '0' and <= '9');
    }

    public static string Edit(decimal value) => value == 0m ? "" : value.ToString("0.00", CultureInfo.CurrentCulture);
    public static string Display(decimal value) => value.ToString("N2", CultureInfo.CurrentCulture);
}

public sealed class VoucherLineEdit : EditableRow
{
    private string _accountCode = "", _accountName = "", _summary = "", _debitText = "", _creditText = "";
    public string AccountCode { get => _accountCode; set => Set(ref _accountCode, value); }
    public string AccountName { get => _accountName; set => Set(ref _accountName, value); }
    public string Summary { get => _summary; set => Set(ref _summary, value); }
    public string DebitText { get => _debitText; set => Set(ref _debitText, value); }
    public string CreditText { get => _creditText; set => Set(ref _creditText, value); }
    public bool IsEmpty => string.IsNullOrWhiteSpace(AccountCode) && string.IsNullOrWhiteSpace(Summary)
        && string.IsNullOrWhiteSpace(DebitText) && string.IsNullOrWhiteSpace(CreditText);

    public VoucherLine ToLine(int index) => new(AccountCode.Trim(), Summary.Trim(),
        AmountInput.Parse(DebitText, $"第{index}行借方"), AmountInput.Parse(CreditText, $"第{index}行贷方"));

    public static VoucherLineEdit From(VoucherLine line) => new()
    {
        AccountCode = line.AccountCode, Summary = line.Summary,
        DebitText = AmountInput.Edit(line.Debit), CreditText = AmountInput.Edit(line.Credit)
    };
}

public sealed class OpeningBalanceEdit : EditableRow
{
    private string _debitText = "", _creditText = "";
    public string Code { get; }
    public string Name { get; }
    public string DebitText { get => _debitText; set => Set(ref _debitText, value); }
    public string CreditText { get => _creditText; set => Set(ref _creditText, value); }
    public OpeningBalanceEdit(Account account)
    {
        Code = account.Code; Name = account.Name;
        _debitText = AmountInput.Edit(account.OpeningDebit);
        _creditText = AmountInput.Edit(account.OpeningCredit);
    }
    public OpeningBalance ToBalance() => new(Code,
        AmountInput.Parse(DebitText, $"{Code}借方期初"), AmountInput.Parse(CreditText, $"{Code}贷方期初"));
}

public sealed record VoucherListRow(Voucher Value)
{
    public Guid Id => Value.Id;
    public string Date => Value.Date.ToString("yyyy-MM-dd");
    public string Number => $"{Value.Kind}-{Value.Number:0000}";
    public string Summary => string.Join("；", Value.Lines.Select(line => line.Summary).Where(summary => summary.Length > 0).Distinct());
    public decimal Amount => Value.Lines.Sum(line => line.Debit);
    public string Status => Value.Status switch { VoucherStatus.Draft => "草稿", VoucherStatus.Reviewed => "已审核", _ => "已记账" };
    public string PreparedBy => Value.PreparedBy;
    public string ReviewedBy => Value.ReviewedBy ?? "";
}

public sealed record AccountDisplay(Account Value, bool IsLeaf)
{
    public string Code => Value.Code;
    public string Name => Value.Name;
    public string Caption => Code + "  " + Name;
    public string Parent => Value.ParentCode ?? "";
    public string Side => Value.Direction == BalanceDirection.Debit ? "借" : "贷";
    public string State => Value.IsActive ? "启用" : "停用";
    public decimal OpeningDebit => Value.OpeningDebit;
    public decimal OpeningCredit => Value.OpeningCredit;
    public string Level => IsLeaf ? "明细" : "汇总";
}

public sealed record LedgerDisplay(LedgerEntryRow Value)
{
    public string Date => Value.Date?.ToString("yyyy-MM-dd") ?? "期初";
    public string Number => Value.VoucherNumber is { } n ? $"{Value.VoucherKind}-{n:0000}" : "";
    public string Summary => Value.Summary;
    public decimal Debit => Value.Debit;
    public decimal Credit => Value.Credit;
    public string Side => Value.RunningBalance == 0m ? "平" : Value.RunningBalance > 0m ? "借" : "贷";
    public decimal Balance => Math.Abs(Value.RunningBalance);
}

using System.Globalization;

namespace Caiwu.Reporting.Books;

/// <summary>Exports accounting rows once: never sums monthly/YTD subtotals again.</summary>
public static class BooksDocumentBuilder
{
    public static ReportDocument Create(BooksResult result, string accountCode, DateTimeOffset generatedAt)
    {
        ArgumentNullException.ThrowIfNull(result);
        var account = result.Accounts.SingleOrDefault(a => a.Account.Code == accountCode)
            ?? throw new ArgumentException("科目不在本次结果内。", nameof(accountCode));
        var metadata = new ReportMetadata(result.Book, new(result.Book.FiscalYear, result.Query.FromMonth, 1),
            new(result.Book.FiscalYear, result.Query.ToMonth, DateTime.DaysInMonth(result.Book.FiscalYear, result.Query.ToMonth)), generatedAt);
        var rows = account.Rows.Select(r => new ReportRow([
            T(r.Date?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)), T(r.VoucherLabel), T(r.Summary),
            T(r.AccountCode), T(r.CounterAccounts), T(r.SettlementType), T(r.CheckNumber), T(r.BillNumber),
            M(r.Debit), M(r.Credit), T(r.Direction), M(r.BalanceAmount),
            T(r.Status switch { Contracts.VoucherStatus.Draft => "未过账（草稿）", Contracts.VoucherStatus.Reviewed => "未过账（已审核）", Contracts.VoucherStatus.Posted => "已过账", _ => "" }),
            T(r.VoucherId?.ToString("D")), T(r.LineSequence?.ToString(CultureInfo.InvariantCulture)), T(r.SourceKey)
        ], r.VoucherId, accountCode));
        return new(ReportKind.Ledger, $"{result.Title}：{accountCode} {account.Account.Name}", metadata,
        [
            C("date", "日期"), C("voucher", "凭证字号"), C("summary", "摘要"), C("account", "科目编码"),
            C("counter", "对方科目"), C("settlement", "结算类别"), C("check", "支票号"), C("bill", "银行票据"),
            C("debit", "借方发生额", true), C("credit", "贷方发生额", true), C("direction", "方向"), C("balance", "余额", true),
            C("status", "凭证状态"), C("voucherId", "凭证ID"), C("sequence", "分录行序"), C("sourceKey", "来源键")
        ], rows, new ReportRow([]),
            $"币种：{result.BaseCurrencyName}；版本：{result.Revision}；{(result.Query.IncludeUnposted ? "包含未过账凭证" : "仅已过账凭证")}。月计/累计为展示行，不重复合计。来源：{result.SourceDescription}", includeTotal: false);
    }

    private static ReportCell T(string? x) => ReportCell.Text(x);
    private static ReportCell M(decimal x) => ReportCell.Money(x);
    private static ReportColumn C(string key, string title, bool amount = false) => new(key, title, amount ? ReportValueKind.Amount : ReportValueKind.Text);
}

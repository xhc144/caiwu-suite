using System.Globalization;
using Caiwu.Contracts;

namespace Caiwu.Reporting;

/// <summary>Consumes frozen Contracts DTOs. It never posts vouchers or recalculates ledger running balances.</summary>
public static class ReportBuilder
{
    public static ReportDocument VoucherList(ReportMetadata metadata, IEnumerable<Voucher> vouchers,
        IEnumerable<Account>? accounts = null, VoucherStatus? status = null)
    {
        ArgumentNullException.ThrowIfNull(metadata);
        ArgumentNullException.ThrowIfNull(vouchers);
        if (status.HasValue && !Enum.IsDefined(status.Value))
            throw new ArgumentOutOfRangeException(nameof(status));
        var catalog = Catalog(accounts);
        var selected = vouchers.Where(v => v.Date >= metadata.From && v.Date <= metadata.To &&
                (!status.HasValue || v.Status == status.Value))
            .OrderBy(v => v.Date).ThenBy(v => v.Kind, StringComparer.Ordinal)
            .ThenBy(v => v.Number).ThenBy(v => v.Id).ToArray();
        if (selected.Select(v => v.Id).Distinct().Count() != selected.Length)
            throw new ArgumentException("凭证清单不能含重复凭证 ID。", nameof(vouchers));
        var rows = new List<ReportRow>(selected.Length);
        decimal totalDebit = 0, totalCredit = 0;
        foreach (var v in selected)
        {
            decimal debit = 0, credit = 0;
            foreach (var line in v.Lines)
            {
                _ = M(line.Debit); _ = M(line.Credit);
                debit += line.Debit; credit += line.Credit;
            }
            totalDebit += debit; totalCredit += credit;
            rows.Add(new ReportRow([
                T(v.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)), T(v.Kind), T(N(v.Number)),
                T(StatusName(v.Status)), T(string.Join("\n", v.Lines.Select(l => l.AccountCode))),
                T(string.Join("\n", v.Lines.Select(l => AccountName(l.AccountCode, catalog)))),
                T(string.Join("\n", v.Lines.Select(l => l.Summary))), M(debit), M(credit),
                T(N(v.AttachmentCount)), T(v.PreparedBy), T(v.ReviewedBy), T(v.Id.ToString("D"))
            ], voucherId: v.Id));
        }
        return new ReportDocument(ReportKind.VoucherList, "凭证清单", metadata, [
            C("date", "日期"), C("kind", "凭证字"), C("number", "凭证号"), C("status", "状态"),
            C("accountCodes", "科目编码（按分录顺序）"), C("accountNames", "科目名称（按分录顺序）"),
            C("summaries", "摘要（按分录顺序）"), C("debit", "借方合计", true), C("credit", "贷方合计", true),
            C("attachmentCount", "附件数"), C("preparedBy", "制单人"), C("reviewedBy", "审核人"), C("voucherId", "凭证 ID")
        ], rows, new ReportRow([T("合计"), T(""), T(""), T(""), T(""), T(""), T(""),
            M(totalDebit), M(totalCredit), T(""), T(""), T(""), T("")]),
            status.HasValue ? $"状态筛选：{StatusName(status.Value)}；金额为所列凭证合计。" :
                "包含期间内全部状态的凭证；金额为所列凭证合计。请根据状态区分草稿、已审核及已记账。");
    }

    public static ReportDocument TrialBalance(ReportMetadata metadata, IEnumerable<TrialBalanceRow> balances,
        IEnumerable<Account>? accounts = null)
    {
        ArgumentNullException.ThrowIfNull(metadata);
        ArgumentNullException.ThrowIfNull(balances);
        var catalog = Catalog(accounts);
        var source = balances.OrderBy(r => r.AccountCode, StringComparer.Ordinal).ToArray();
        if (source.Select(r => r.AccountCode).Distinct(StringComparer.Ordinal).Count() != source.Length)
            throw new ArgumentException("余额表不能含重复科目编码。", nameof(balances));
        var totals = new decimal[6];
        var rows = new List<ReportRow>(source.Length);
        foreach (var row in source)
        {
            decimal[] amounts = [row.OpeningDebit, row.OpeningCredit, row.PeriodDebit,
                row.PeriodCredit, row.ClosingDebit, row.ClosingCredit];
            var depth = Depth(row.AccountCode, catalog);
            var cells = new List<ReportCell> { T(row.AccountCode), T(row.AccountName), T(N(depth + 1)),
                T(row.IsLeaf ? "是" : "否") };
            for (var i = 0; i < amounts.Length; i++)
            {
                cells.Add(M(amounts[i]));
                if (row.IsLeaf) totals[i] += amounts[i];
            }
            rows.Add(new ReportRow(cells, accountCode: row.AccountCode, accountDepth: depth, isLeaf: row.IsLeaf));
        }
        return new ReportDocument(ReportKind.TrialBalance, "科目余额表", metadata, [
            C("accountCode", "科目编码"), C("accountName", "科目名称"), C("level", "层级"), C("isLeaf", "末级"),
            C("openingDebit", "期初借方", true), C("openingCredit", "期初贷方", true),
            C("periodDebit", "本期借方", true), C("periodCredit", "本期贷方", true),
            C("closingDebit", "期末借方", true), C("closingCredit", "期末贷方", true)
        ], rows, new ReportRow(new[] { T("末级合计"), T(""), T(""), T("") }.Concat(totals.Select(M))),
            "总计仅累加 IsLeaf=true 的行，保留零余额及父科目汇总行。数据与期间由领域服务提供；本表为账簿数据，未经法定财报项目映射。");
    }

    public static ReportDocument Ledger(ReportMetadata metadata, string accountCode,
        IEnumerable<LedgerEntryRow> entries, IEnumerable<Account>? accounts = null)
    {
        ArgumentNullException.ThrowIfNull(metadata);
        ArgumentException.ThrowIfNullOrWhiteSpace(accountCode);
        ArgumentNullException.ThrowIfNull(entries);
        var catalog = Catalog(accounts);
        var depth = Depth(accountCode, catalog);
        var rows = new List<ReportRow>();
        decimal totalDebit = 0, totalCredit = 0;
        foreach (var row in entries)
        {
            if (row.Date.HasValue && (row.Date.Value < metadata.From || row.Date.Value > metadata.To))
                throw new ArgumentException("明细账分录日期超出报表期间。", nameof(entries));
            if (row.Date.HasValue)
            {
                totalDebit += row.Debit; totalCredit += row.Credit;
            }
            rows.Add(new ReportRow([
                T(accountCode), T(AccountName(accountCode, catalog)),
                T(row.Date?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)), T(row.VoucherKind),
                T(row.VoucherNumber.HasValue ? N(row.VoucherNumber.Value) : ""), T(row.Summary),
                M(row.Debit), M(row.Credit), T(row.RunningBalance > 0 ? "借" : row.RunningBalance < 0 ? "贷" : "平"),
                M(row.RunningBalance), T(row.VoucherId?.ToString("D"))
            ], voucherId: row.VoucherId, accountCode: accountCode, accountDepth: depth));
        }
        return new ReportDocument(ReportKind.Ledger, $"科目明细账：{accountCode} {AccountName(accountCode, catalog)}", metadata, [
            C("accountCode", "科目编码"), C("accountName", "科目名称"), C("date", "日期"), C("kind", "凭证字"),
            C("number", "凭证号"), C("summary", "摘要"), C("debit", "借方发生额", true), C("credit", "贷方发生额", true),
            C("balanceDirection", "余额方向"), C("runningBalance", "余额（借正贷负）", true), C("voucherId", "凭证 ID")
        ], rows, new ReportRow([T("本期发生额合计"), T(""), T(""), T(""), T(""), T(""),
            M(totalDebit), M(totalCredit), T(""), T(""), T("")]),
            "保留领域服务提供的行顺序、期初及逐笔余额。余额为借方正、贷方负；本期发生额合计不含日期为空的期初行。");
    }

    private static Dictionary<string, Account> Catalog(IEnumerable<Account>? accounts) =>
        (accounts ?? []).ToDictionary(a => a.Code, StringComparer.Ordinal);

    private static string AccountName(string code, IReadOnlyDictionary<string, Account> catalog) =>
        catalog.TryGetValue(code, out var account) ? account.Name : "未知科目";

    private static int Depth(string code, IReadOnlyDictionary<string, Account> catalog)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal) { code };
        var depth = 0;
        while (catalog.TryGetValue(code, out var account) && account.ParentCode is { } parent)
        {
            if (!seen.Add(parent)) throw new ArgumentException("科目目录存在循环父子关系。", nameof(catalog));
            depth++;
            code = parent;
        }
        return depth;
    }

    private static string StatusName(VoucherStatus status) => status switch
    {
        VoucherStatus.Draft => "草稿",
        VoucherStatus.Reviewed => "已审核",
        VoucherStatus.Posted => "已记账",
        _ => throw new ArgumentOutOfRangeException(nameof(status), "未知凭证状态。")
    };
    private static string N(int value) => value.ToString(CultureInfo.InvariantCulture);
    private static ReportCell T(string? value) => ReportCell.Text(value);
    private static ReportCell M(decimal value) => ReportCell.Money(value);
    private static ReportColumn C(string key, string title, bool amount = false) =>
        new(key, title, amount ? ReportValueKind.Amount : ReportValueKind.Text);
}

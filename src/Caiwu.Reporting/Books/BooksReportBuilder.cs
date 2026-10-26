using Caiwu.Contracts;

namespace Caiwu.Reporting.Books;

/// <summary>Read-only calculations from a complete ledger. No account prefixes, summary-text closing guesses or stored slz totals.</summary>
public static class BooksReportBuilder
{
    public static BooksResult Build(BooksLedgerInput input, BooksQuery query)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(query);
        var book = input.Book;
        ArgumentNullException.ThrowIfNull(book);
        if (book.Id == Guid.Empty || !Enum.IsDefined(book.Regime) || book.FiscalYear is < 1 or > 9999 || book.StartMonth is < 1 or > 12 ||
            book.ClosedThroughMonth < book.StartMonth - 1 || book.ClosedThroughMonth > 12 || input.Revision < 0)
            throw new ArgumentException("账套身份、年度、启用月或版本无效。");
        ArgumentException.ThrowIfNullOrWhiteSpace(book.Name);
        ArgumentException.ThrowIfNullOrWhiteSpace(input.BaseCurrencyName);
        ArgumentException.ThrowIfNullOrWhiteSpace(input.SourceDescription);
        if (!Enum.IsDefined(query.Kind) || query.FromMonth < book.StartMonth || query.ToMonth > 12 || query.FromMonth > query.ToMonth)
            throw new ArgumentException("查询月份须在账套启用月起的同一年度内。");
        if (query.Kind == BooksKind.GeneralLedger && query.IncludeUnposted)
            throw new ArgumentException("凭证只有过账后，才会在总账里体现。");
        ArgumentException.ThrowIfNullOrWhiteSpace(query.AccountFrom);
        ArgumentException.ThrowIfNullOrWhiteSpace(query.AccountTo);
        if (string.CompareOrdinal(query.AccountFrom, query.AccountTo) > 0)
            throw new ArgumentException("科目范围起点不能大于终点。");

        ArgumentNullException.ThrowIfNull(input.Accounts);
        ArgumentNullException.ThrowIfNull(input.Vouchers);
        var sourceAccounts = input.Accounts.ToArray();
        if (sourceAccounts.Length == 0 || sourceAccounts.Any(a => a is null || string.IsNullOrWhiteSpace(a.Code) || string.IsNullOrWhiteSpace(a.Name)) ||
            sourceAccounts.Select(a => a.Code).Distinct(StringComparer.Ordinal).Count() != sourceAccounts.Length)
            throw new ArgumentException("科目为空、代码重复或名称缺失。");
        var catalog = sourceAccounts.ToDictionary(a => a.Code, StringComparer.Ordinal);
        var ancestors = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        var kinds = new Dictionary<string, JournalAccountKind>(StringComparer.Ordinal);
        foreach (var account in sourceAccounts)
        {
            var path = new HashSet<string>(StringComparer.Ordinal);
            var current = account;
            var classification = JournalAccountKind.None;
            while (true)
            {
                if (!path.Add(current.Code)) throw new ArgumentException("科目父子关系循环。");
                if (!Enum.IsDefined(current.JournalKind)) throw new ArgumentException("现金/银行分类无效。");
                if (current.JournalKind != JournalAccountKind.None)
                {
                    if (classification != JournalAccountKind.None && classification != current.JournalKind)
                        throw new ArgumentException("上/下级现金银行分类冲突。");
                    classification = current.JournalKind;
                }
                if (current.ParentCode is not { } parent) break;
                if (!catalog.TryGetValue(parent, out current!)) throw new ArgumentException("科目缺少上级。");
            }
            ancestors.Add(account.Code, path);
            kinds.Add(account.Code, classification);
        }
        var parentCodes = sourceAccounts.Where(a => a.ParentCode is not null).Select(a => a.ParentCode!).ToHashSet(StringComparer.Ordinal);
        var leaves = sourceAccounts.Where(a => !parentCodes.Contains(a.Code)).ToArray();
        foreach (var account in sourceAccounts)
        {
            ValidatePair(account.OpeningDebit, account.OpeningCredit, opening: true);
            ValidateAmount(account.PreOpeningDebit ?? 0); ValidateAmount(account.PreOpeningCredit ?? 0);
            if ((account.PreOpeningDebit.HasValue != account.PreOpeningCredit.HasValue) ||
                (book.StartMonth == 1 && (account.PreOpeningDebit.GetValueOrDefault() != 0 || account.PreOpeningCredit.GetValueOrDefault() != 0)))
                throw new ArgumentException("启用前累计必须成对提供，1月启用不能带启用前累计。");
            if (parentCodes.Contains(account.Code) && (account.OpeningDebit != 0 || account.OpeningCredit != 0 ||
                account.PreOpeningDebit.GetValueOrDefault() != 0 || account.PreOpeningCredit.GetValueOrDefault() != 0))
                throw new ArgumentException("父科目不能重复携带末级期初或累计。");
        }
        if (book.StartMonth > 1 && leaves.Any(a => !a.PreOpeningDebit.HasValue || !a.PreOpeningCredit.HasValue))
            throw new ArgumentException("年中启用缺启用前本年累计，不能生成完整本年累计。");
        if (Sum(leaves.Select(a => Add(a.OpeningDebit, -a.OpeningCredit))) != 0 ||
            Sum(leaves.Select(a => Add(a.PreOpeningDebit ?? 0, -(a.PreOpeningCredit ?? 0)))) != 0)
            throw new ArgumentException("账套期初或启用前累计借贷不平衡。");

        if (input.Vouchers.Any(v => v is null || v.Lines is null || v.Lines.Any(l => l is null)))
            throw new ArgumentException("凭证或分录不能含空项。");
        var vouchers = input.Vouchers.Select(v => v with { Lines = Array.AsReadOnly(v.Lines.ToArray()) }).ToArray();
        if (vouchers.Any(v => v.Id == Guid.Empty || !Enum.IsDefined(v.Status) || v.Number <= 0 || string.IsNullOrWhiteSpace(v.Kind)) ||
            vouchers.Select(v => v.Id).Distinct().Count() != vouchers.Length ||
            vouchers.Select(v => (v.Date.Month, v.Kind, v.Number)).Distinct().Count() != vouchers.Length)
            throw new ArgumentException("凭证身份、状态、字号或月内编号重复/无效。");
        var openingDate = new DateOnly(book.FiscalYear, book.StartMonth, 1);
        foreach (var voucher in vouchers)
        {
            if (voucher.Date.Year != book.FiscalYear || voucher.Date < openingDate)
                throw new ArgumentException("凭证日期超出账套覆盖期间。");
            if (voucher.Status != VoucherStatus.Posted && !query.IncludeUnposted) continue;
            if (voucher.Lines.Count < 2 || voucher.Lines.Select(l => l.Sequence).Distinct().Count() != voucher.Lines.Count)
                throw new ArgumentException("凭证分录不足或行序重复。");
            foreach (var line in voucher.Lines)
            {
                if (line.Sequence <= 0 || !catalog.ContainsKey(line.AccountCode) || parentCodes.Contains(line.AccountCode))
                    throw new ArgumentException("分录行序无效或引用未知/非末级科目。");
                ValidatePair(line.Debit, line.Credit, opening: false);
            }
            if (Sum(voucher.Lines.Select(l => Add(l.Debit, -l.Credit))) != 0)
                throw new ArgumentException("纳入账簿的凭证借贷不平衡。");
        }
        var eligible = sourceAccounts.Where(a => query.Kind == BooksKind.GeneralLedger ||
            kinds[a.Code] == (query.Kind == BooksKind.CashJournal ? JournalAccountKind.Cash : JournalAccountKind.Bank)).ToArray();
        if (!eligible.Any(a => a.Code == query.AccountFrom) || !eligible.Any(a => a.Code == query.AccountTo))
            throw new ArgumentException("科目不存在或不属于所选现金/银行账册。");
        var selected = eligible.Where(a => string.CompareOrdinal(a.Code, query.AccountFrom) >= 0 &&
            string.CompareOrdinal(a.Code, query.AccountTo) <= 0).OrderBy(a => a.Code, StringComparer.Ordinal).ToArray();
        var included = vouchers.Where(v => v.Status == VoucherStatus.Posted || query.IncludeUnposted)
            .OrderBy(v => v.Date).ThenBy(v => v.Kind, StringComparer.Ordinal).ThenBy(v => v.Number).ThenBy(v => v.Id).ToArray();
        var from = new DateOnly(book.FiscalYear, query.FromMonth, 1);
        var reports = new List<BooksAccountReport>();
        foreach (var account in selected)
        {
            var subtree = leaves.Where(a => ancestors[a.Code].Contains(account.Code)).Select(a => a.Code).ToHashSet(StringComparer.Ordinal);
            var postings = included.SelectMany(v => v.Lines.OrderBy(l => l.Sequence)
                .Where(l => subtree.Contains(l.AccountCode)).Select(l => (Voucher: v, Line: l))).ToArray();
            var ownLeaves = leaves.Where(a => subtree.Contains(a.Code)).ToArray();
            var starting = Sum(ownLeaves.Select(a => Add(a.OpeningDebit, -a.OpeningCredit)));
            var before = postings.Where(p => p.Voucher.Date < from).ToArray();
            var opening = Add(starting, Sum(before.Select(p => Add(p.Line.Debit, -p.Line.Credit))));
            var yearDebit = Add(Sum(ownLeaves.Select(a => a.PreOpeningDebit ?? 0)), Sum(before.Select(p => p.Line.Debit)));
            var yearCredit = Add(Sum(ownLeaves.Select(a => a.PreOpeningCredit ?? 0)), Sum(before.Select(p => p.Line.Credit)));
            var running = opening;
            decimal periodDebit = 0, periodCredit = 0;
            var rows = new List<BooksRow> { Summary(BooksRowKind.Opening, from, "期初余额", 0, 0, opening, account.Code) };
            for (var month = query.FromMonth; month <= query.ToMonth; month++)
            {
                var monthRows = postings.Where(p => p.Voucher.Date.Month == month).ToArray();
                var monthDebit = Sum(monthRows.Select(p => p.Line.Debit));
                var monthCredit = Sum(monthRows.Select(p => p.Line.Credit));
                foreach (var (voucher, line) in monthRows)
                {
                    running = Add(running, Add(line.Debit, -line.Credit));
                    if (query.Kind == BooksKind.GeneralLedger) continue;
                    var counter = voucher.Lines.Where(l => line.Debit != 0 ? l.Credit != 0 : l.Debit != 0)
                        .Select(l => $"{l.AccountCode} {catalog[l.AccountCode].Name}").Distinct(StringComparer.Ordinal);
                    rows.Add(new(BooksRowKind.Entry, voucher.Date, voucher.Id, voucher.Kind, voucher.Number, line.Sequence,
                        line.Summary, line.AccountCode, string.Join("；", counter), line.SettlementType, line.CheckNumber,
                        line.BillNumber, line.SourceKey, voucher.Status, line.Debit, line.Credit, running));
                }
                periodDebit = Add(periodDebit, monthDebit); periodCredit = Add(periodCredit, monthCredit);
                yearDebit = Add(yearDebit, monthDebit); yearCredit = Add(yearCredit, monthCredit);
                var end = new DateOnly(book.FiscalYear, month, DateTime.DaysInMonth(book.FiscalYear, month));
                rows.Add(Summary(BooksRowKind.MonthTotal, end, "本月合计", monthDebit, monthCredit, running, account.Code));
                rows.Add(Summary(BooksRowKind.YearToDate, end, "本年累计", yearDebit, yearCredit, running, account.Code));
            }
            if (running != Add(opening, Add(periodDebit, -periodCredit))) throw new InvalidOperationException("账簿余额不守恒。");
            reports.Add(new(account, rows.AsReadOnly(), opening, periodDebit, periodCredit, running, yearDebit, yearCredit));
        }
        return new(book, input.Revision, query, input.BaseCurrencyName, input.SourceDescription, reports.AsReadOnly());
    }

    private static BooksRow Summary(BooksRowKind kind, DateOnly date, string summary, decimal debit,
        decimal credit, decimal balance, string code) => new(kind, date, null, "", null, null, summary,
        code, "", "", "", "", "", null, debit, credit, balance);
    private static decimal Add(decimal x, decimal y) => MoneyMath.Add(x, y);
    private static decimal Sum(IEnumerable<decimal> values) => values.Aggregate(0m, Add);
    private static void ValidateAmount(decimal value) => _ = ReportCell.Money(value);
    private static void ValidatePair(decimal debit, decimal credit, bool opening)
    {
        ValidateAmount(debit); ValidateAmount(credit);
        if ((debit != 0 && credit != 0) || (opening && (debit < 0 || credit < 0)))
            throw new ArgumentException("金额须分借贷单方；期初须非负，红字发生额保留原侧负数。");
    }
}

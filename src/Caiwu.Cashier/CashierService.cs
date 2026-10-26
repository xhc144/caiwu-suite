namespace Caiwu.Cashier;

public sealed class CashierService(ICashierStore store, TimeProvider? timeProvider = null)
{
    private readonly TimeProvider clock = timeProvider ?? TimeProvider.System;
    public CashierSnapshot Read() => store.Read();

    public AccountKey[] GetAccounts() => Read().Book.Accounts
        .Where(x => x.IsDetail && x.HasCashFlow)
        .SelectMany(x => x.Currencies.Select(c => new AccountKey(x.Code, c))).ToArray();

    public CashierSnapshot SaveOpening(long revision, AccountKey account, int year, decimal balance, string actor) =>
        Change(revision, "opening.save", actor, account.Code, s =>
        {
            RequireAccount(s.Book, account);
            Require(year == s.Book.OpeningDate.Year, "opening.year", "当前切片只编辑开账年度期初；其他年度须由结账建立。");
            return s with { Openings = s.Openings.Where(x => x.Account != account || x.Year != year)
                .Append(new OpeningBalance(account, year, balance)).ToArray() };
        });

    public CashierSnapshot SaveOpenings(long revision, OpeningBalance[] openings, string actor) =>
        Change(revision, "opening.save.all", actor, "openings", s =>
        {
            Require(openings.Length > 0 && openings.Select(x => (x.Account, x.Year)).Distinct().Count() == openings.Length,
                "opening.duplicate", "期初账户重复或没有需要保存的数据。");
            foreach (var opening in openings)
            {
                RequireAccount(s.Book, opening.Account);
                Require(opening.Year == s.Book.OpeningDate.Year, "opening.year", "当前切片只编辑开账年度期初；其他年度须由结账建立。");
            }
            var keys = openings.Select(x => (x.Account, x.Year)).ToHashSet();
            return s with { Openings = s.Openings.Where(x => !keys.Contains((x.Account, x.Year))).Concat(openings).ToArray() };
        });

    public CashierDocument AddDocument(long revision, DocumentInput input)
    {
        Guid id = Guid.NewGuid();
        var result = Change(revision, "document.add", input.EnteredBy, id.ToString(), s =>
        {
            ValidateInput(s.Book, input);
            var d = FromInput(id, s.NextDocumentNumber, input);
            return s with { Documents = [.. s.Documents, d], NextDocumentNumber = checked(s.NextDocumentNumber + 1) };
        });
        return result.Documents.Single(x => x.Id == id);
    }

    public CashierSnapshot UpdateDocument(long revision, Guid id, DocumentInput input, string actor) =>
        Change(revision, "document.update", actor, id.ToString(), s =>
        {
            var old = Find(s, id);
            RequireEditable(s.Book, old, "修改");
            ValidateInput(s.Book, input);
            Require(old.Account == input.Account, "document.account", "请在原账册修改单据，不能移动到账户之外。");
            var updated = FromInput(old.Id, old.Number, input) with
            {
                EnteredBy = old.EnteredBy, OriginalFields = old.OriginalFields
            };
            return s with { Documents = s.Documents.Select(x => x.Id == id ? updated : x).ToArray() };
        });

    public CashierSnapshot DeleteDocument(long revision, Guid id, string actor) =>
        Change(revision, "document.delete", actor, id.ToString(), s =>
        {
            RequireEditable(s.Book, Find(s, id), "删除");
            return s with { Documents = s.Documents.Where(x => x.Id != id).ToArray() };
        });

    /// <summary>
    /// Stage an explicitly supplied, versioned synthetic/integration snapshot. Existing matched entries
    /// cannot disappear or change. This does not post a voucher or write to the authoritative GL.
    /// </summary>
    public CashierSnapshot StageLedgerSnapshot(long revision, LedgerEntry[] entries, string actor) =>
        Change(revision, "ledger.snapshot", actor, "ledger", s =>
        {
            Require(!store.HasAuthoritativeLedgerSnapshot, "ledger.authoritative",
                "当前存储直接读取公共总账，不能由模块覆盖账务快照。");
            Require(entries.Select(x => x.Id).Distinct(StringComparer.Ordinal).Count() == entries.Length,
                "ledger.duplicate", "账务分录识别号重复。");
            foreach (var e in entries)
            {
                RequireAccount(s.Book, e.Account);
                Require(!string.IsNullOrWhiteSpace(e.Id) && !string.IsNullOrWhiteSpace(e.Revision)
                    && !string.IsNullOrWhiteSpace(e.VoucherId), "ledger.identity", "账务分录缺少稳定识别号或修订号。");
                Require(e.ReconciliationCode is null, "ledger.match.import", "账务快照不能自行提供模块勾账码。");
                Require(e.Debit == 0 || e.Credit == 0, "ledger.amount", "账务分录不能同时存在借方和贷方金额。");
            }
            var merged = entries.ToDictionary(x => x.Id, StringComparer.Ordinal);
            foreach (var old in s.LedgerEntries.Where(x => x.ReconciliationCode.HasValue))
            {
                Require(merged.TryGetValue(old.Id, out var incoming) && SameLedgerValue(old, incoming!),
                    "ledger.matched.changed", "已勾账分录发生变化；须先取消整组勾销。");
                merged[old.Id] = old;
            }
            return s with { LedgerEntries = merged.Values.OrderBy(x => x.Date).ThenBy(x => x.Id, StringComparer.Ordinal).ToArray() };
        });

    public Journal GetJournal(AccountKey account, DateOnly from, DateOnly through, bool dailySubtotals = true)
    {
        var s = Read();
        RequireAccount(s.Book, account);
        Require(from >= s.Book.OpeningDate && through >= from && through.Year == s.Book.OpeningDate.Year,
            "journal.range", "请选择开账年度内有效的日期范围。");
        var opening = s.Openings.SingleOrDefault(x => x.Account == account && x.Year == from.Year)?.Balance ?? 0;
        opening += s.Documents.Where(x => x.Account == account && x.Date < from).Sum(x => x.Net);
        decimal balance = opening, debit = 0, credit = 0;
        var rows = new List<JournalRow> { new(JournalRowKind.Opening, from, null, null, "期初余额", 0, 0, balance) };
        foreach (var day in s.Documents.Where(x => x.Account == account && x.Date >= from && x.Date <= through)
                     .OrderBy(x => x.Date).ThenBy(x => x.Number).GroupBy(x => x.Date))
        {
            foreach (var d in day)
            {
                balance += d.Net; debit += d.Debit; credit += d.Credit;
                rows.Add(new(JournalRowKind.Document, d.Date, d.Number, d.Id, d.Summary, d.Debit, d.Credit, balance, d));
            }
            if (dailySubtotals) rows.Add(new(JournalRowKind.DailySubtotal, day.Key, null, null,
                "本日小计", day.Sum(x => x.Debit), day.Sum(x => x.Credit), balance));
        }
        return new(s.Revision, account, from, through, opening, debit, credit, balance, rows.ToArray());
    }

    public ReconciliationView ReadReconciliation(ReconciliationQuery query)
    {
        var s = Read(); RequireAccount(s.Book, query.Account);
        var month = new DateOnly(query.Year, query.Month, 1);
        var end = month.AddMonths(1);
        bool InRange(DateOnly date, long? code) => date >= s.Book.OpeningDate &&
            ((date >= month && date < end && (query.IncludeMatched || code is null)) ||
             (query.IncludeEarlierUnmatched && date < month && code is null));
        return new(s.Revision, s.Documents.Where(x => x.Account == query.Account && InRange(x.Date, x.ReconciliationCode))
            .OrderBy(x => x.Date).ThenBy(x => x.Number).ToArray(),
            s.LedgerEntries.Where(x => x.Account == query.Account && x.IsPosted && InRange(x.Date, x.ReconciliationCode))
            .OrderBy(x => x.Date).ThenBy(x => x.Id, StringComparer.Ordinal).ToArray());
    }

    public ReconciliationGroup Reconcile(long revision, AccountKey account, Guid[] documentIds,
        string[] ledgerIds, string actor)
    {
        long code = 0;
        var committed = Change(revision, "reconcile", actor, account.Code, s =>
        {
            RequireAccount(s.Book, account);
            var documents = SelectUnique(s.Documents, documentIds, x => x.Id);
            var ledger = SelectUnique(s.LedgerEntries, ledgerIds, x => x.Id);
            ValidateMatch(s.Book, account, documents, ledger);
            code = s.NextReconciliationCode;
            return ApplyMatch(s, account, documents, ledger, actor, clock.GetUtcNow());
        });
        return committed.Reconciliations.Single(x => x.Code == code);
    }

    public CashierSnapshot CancelReconciliation(long revision, long code, string actor) =>
        Change(revision, "reconcile.cancel", actor, code.ToString(), s =>
        {
            var group = s.Reconciliations.SingleOrDefault(x => x.Code == code);
            Require(group is not null, "reconcile.missing", "您选择的凭证还没有勾账！");
            var documents = s.Documents.Where(x => x.ReconciliationCode == code).ToArray();
            var ledger = s.LedgerEntries.Where(x => x.ReconciliationCode == code).ToArray();
            Require(documents.Length == group!.DocumentIds.Length && ledger.Length == group.LedgerEntryIds.Length,
                "reconcile.corrupt", "勾账码错误！");
            return s with
            {
                Documents = s.Documents.Select(x => x.ReconciliationCode == code ? x with { ReconciliationCode = null } : x).ToArray(),
                LedgerEntries = s.LedgerEntries.Select(x => x.ReconciliationCode == code ? x with { ReconciliationCode = null } : x).ToArray(),
                Reconciliations = s.Reconciliations.Where(x => x.Code != code).ToArray()
            };
        });

    /// <summary>Date ordered exact debit/credit matches. Ambiguous combinations are left for manual grouping.</summary>
    public CashierSnapshot AutoReconcile(long revision, ReconciliationQuery query, string actor) =>
        Change(revision, "reconcile.auto", actor, query.Account.Code, s =>
        {
            RequireAccount(s.Book, query.Account);
            var first = new DateOnly(query.Year, query.Month, 1);
            var end = first.AddMonths(1);
            bool Eligible(DateOnly d) => d >= s.Book.OpeningDate && d < end && (d >= first || query.IncludeEarlierUnmatched);
            var docs = s.Documents.Where(x => x.Account == query.Account && x.ReconciliationCode is null && Eligible(x.Date))
                .OrderBy(x => x.Date).ThenBy(x => x.Number).ToArray();
            foreach (var doc in docs)
            {
                var ledger = s.LedgerEntries.Where(x => x.Account == query.Account && x.IsPosted &&
                        x.ReconciliationCode is null && Eligible(x.Date) && x.Debit == doc.Debit && x.Credit == doc.Credit)
                    .OrderBy(x => x.Date).ThenBy(x => x.Id, StringComparer.Ordinal).FirstOrDefault();
                if (ledger is not null) s = ApplyMatch(s, query.Account, [doc], [ledger], actor, clock.GetUtcNow());
            }
            return s;
        });

    /// <summary>Pure, revision-bound plan; never marks source documents as transferred.</summary>
    public VoucherPlan CreateVoucherPlan(int year, int month, VoucherGrouping grouping,
        IReadOnlyDictionary<string, decimal>? rates = null)
    {
        Require(Enum.IsDefined(grouping), "voucher.grouping", "请选择有效的凭证生成方式。");
        var s = Read();
        var first = new DateOnly(year, month, 1); var end = first.AddMonths(1);
        Require(first >= s.Book.ActiveMonth && year == s.Book.OpeningDate.Year, "period.closed", "已经结账，不能生成凭证！");
        var docs = s.Documents.Where(x => x.Date >= first && x.Date < end && x.GeneratedVoucherId is null
                && x.Origin == DocumentOrigin.Cashier).OrderBy(x => x.Date).ThenBy(x => x.Number).ToArray();
        Require(docs.Length > 0, "voucher.empty", "本月不存在需要生成凭证的出纳数据！");
        var groups = grouping == VoucherGrouping.PerDocument ? docs.Select(x => new[] { x }).ToArray() : [docs];
        var vouchers = groups.Select(group =>
        {
            var lines = new List<VoucherPlanLine>();
            foreach (var d in group)
            {
                RequireDetail(s.Book, d.CounterAccount);
                decimal rate = 1;
                if (d.Account.Currency != s.Book.BaseCurrency)
                    Require(rates is not null && rates.TryGetValue(d.Account.Currency, out rate) && rate > 0,
                        "voucher.exchange", "外币凭证缺少明确的汇率，不能生成。");
                decimal debit = checked(d.Debit * rate), credit = checked(d.Credit * rate);
                lines.Add(new(d.Account.Code, debit, credit, d.Account.Currency, d.Debit, d.Credit, rate, d.Summary, d.Id));
                lines.Add(new(d.CounterAccount!, credit, debit, d.Account.Currency, d.Credit, d.Debit, rate, d.Summary, d.Id));
            }
            return new VoucherPlanItem($"cashier:{s.Book.Id}:{s.Revision}:{group[0].Id:N}", group.Max(x => x.Date),
                group.Select(x => x.Id).ToArray(), lines.ToArray());
        }).ToArray();
        return new(s.Revision, s.Book.Id, grouping, vouchers);
    }

    private CashierSnapshot Change(long revision, string action, string actor, string target,
        Func<CashierSnapshot, CashierSnapshot> change)
    {
        Require(!string.IsNullOrWhiteSpace(actor), "operator.empty", "请选择操作员。");
        return store.Transact(revision, s =>
        {
            var changed = change(s);
            return changed with { Audit = [.. changed.Audit, new AuditEntry(checked(s.Audit.LongLength + 1),
                action, actor, clock.GetUtcNow(), target)] };
        });
    }

    private static CashierDocument FromInput(Guid id, long number, DocumentInput i) =>
        new(id, number, i.Account, i.Date, i.Summary,
            i.Direction == DocumentDirection.Receipt ? i.Amount : 0,
            i.Direction == DocumentDirection.Payment ? i.Amount : 0,
            i.CounterAccount, i.EnteredBy, i.Notes, i.CounterpartyName, i.CounterpartyBank,
            i.CounterpartyBankAccount, DocumentOrigin.Cashier, null, null);

    private static void ValidateInput(BookDefinition book, DocumentInput i)
    {
        RequireAccount(book, i.Account);
        Require(i.Date >= book.ActiveMonth && i.Date >= book.OpeningDate, "period.closed", "日期小于结账月份！");
        Require(i.Date <= book.LatestDocumentDate && i.Date.Year == book.OpeningDate.Year,
            "date.future", "日期过大，请仔细检查一下！");
        Require(Enum.IsDefined(i.Direction), "document.direction", "请选择收款或付款。");
        Require(i.Amount <= -0.005m || i.Amount >= 0.005m, "document.amount", "请输入金额！");
        Require(!string.IsNullOrWhiteSpace(i.EnteredBy), "operator.empty", "请选择操作员。");
        Require(i.Summary is not null && i.Summary.Length <= 100 && (i.Notes?.Length ?? 0) <= 255,
            "document.text", "摘要或说明超出当前字段范围；请保留原值并核实模板变体。");
        if (!string.IsNullOrWhiteSpace(i.CounterAccount)) RequireDetail(book, i.CounterAccount);
    }

    private static void RequireAccount(BookDefinition book, AccountKey account) => Require(
        book.Accounts.Any(x => x.Code == account.Code && x.IsDetail && x.HasCashFlow && x.Currencies.Contains(account.Currency)),
        "account.invalid", "请先选择账册；出纳账户须为财务系统含现金流量选项的明细科目及币种。");

    private static void RequireDetail(BookDefinition book, string? code) => Require(
        !string.IsNullOrWhiteSpace(code) && book.Accounts.Any(x => x.Code == code && x.IsDetail),
        "counteraccount.invalid", "对方科目需要填写为明细科目！");

    private static CashierDocument Find(CashierSnapshot s, Guid id) =>
        s.Documents.SingleOrDefault(x => x.Id == id) ?? throw new CashierRuleException("document.missing", "单据不存在，请刷新。");

    private static void RequireEditable(BookDefinition book, CashierDocument d, string verb)
    {
        Require(d.ReconciliationCode is null, "document.matched", $"已经勾账，不能{verb}！");
        Require(d.Date >= book.ActiveMonth, "period.closed", $"已经结账，不能{verb}！");
        Require(d.GeneratedVoucherId is null, "document.voucher", $"已经生成凭证，不能直接{verb}！请先删除生成凭证。");
        Require(d.Origin == DocumentOrigin.Cashier, "document.origin", $"此记录是其他系统转入，不能{verb}！");
    }

    private static T[] SelectUnique<T, TKey>(T[] source, TKey[] ids, Func<T, TKey> key) where TKey : notnull
    {
        Require(ids.Length > 0 && ids.Distinct().Count() == ids.Length, "reconcile.selection", "请选择不重复的出纳单据与账务分录。");
        var selected = source.Where(x => ids.Contains(key(x))).ToArray();
        Require(selected.Length == ids.Length, "reconcile.stale", "部分记录已变化，请重新读入对账数据。");
        return selected;
    }

    private static void ValidateMatch(BookDefinition book, AccountKey account, CashierDocument[] docs, LedgerEntry[] ledger)
    {
        Require(docs.All(x => x.Account == account) && ledger.All(x => x.Account == account),
            "reconcile.account", "不能跨账户或币种勾账。");
        Require(docs.All(x => x.ReconciliationCode is null) && ledger.All(x => x.ReconciliationCode is null),
            "reconcile.matched", "记录已经勾账，请刷新。");
        Require(ledger.All(x => x.IsPosted), "reconcile.unposted", "只有过账的凭证，才可以和出纳进行勾账。");
        // Compare both directions. Net zero alone must never allow two unrelated opposite flows to match.
        Require(AmountsMatch(docs.Sum(x => x.Debit), ledger.Sum(x => x.Debit))
            && AmountsMatch(docs.Sum(x => x.Credit), ledger.Sum(x => x.Credit)),
            "reconcile.amount", "出纳和账务的勾账金额不一致，无法勾账！");
    }

    private static CashierSnapshot ApplyMatch(CashierSnapshot s, AccountKey account, CashierDocument[] docs,
        LedgerEntry[] ledger, string actor, DateTimeOffset now)
    {
        long code = s.NextReconciliationCode;
        var dids = docs.Select(x => x.Id).ToArray(); var lids = ledger.Select(x => x.Id).ToArray();
        return s with
        {
            NextReconciliationCode = checked(code + 1),
            Documents = s.Documents.Select(x => dids.Contains(x.Id) ? x with { ReconciliationCode = code } : x).ToArray(),
            LedgerEntries = s.LedgerEntries.Select(x => lids.Contains(x.Id) ? x with { ReconciliationCode = code } : x).ToArray(),
            Reconciliations = [.. s.Reconciliations, new ReconciliationGroup(code, account, dids, lids, now, actor)]
        };
    }

    private static bool SameLedgerValue(LedgerEntry a, LedgerEntry b) => a.Id == b.Id && a.Revision == b.Revision
        && a.Account == b.Account && a.Date == b.Date && a.VoucherId == b.VoucherId && a.Debit == b.Debit
        && a.Credit == b.Credit && a.IsPosted == b.IsPosted && a.Summary == b.Summary;

    internal static void Require(bool condition, string code, string message)
    {
        if (!condition) throw new CashierRuleException(code, message);
    }

    // Original w_cn_dz rule rejects differences greater than 0.005. Preserve values, do not round them.
    internal static bool AmountsMatch(decimal a, decimal b) => Math.Abs(a - b) <= 0.005m;
}

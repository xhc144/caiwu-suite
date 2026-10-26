using Caiwu.Contracts;

namespace Caiwu.Reporting.Books;

/// <summary>Adapts the existing simplified ledger only. Never use this as an original SQL Anywhere importer.</summary>
public static class BooksSnapshotAdapter
{
    public static BooksLedgerInput FromSnapshot(LedgerSnapshot snapshot,
        IReadOnlyDictionary<string, JournalAccountKind>? journalKinds = null,
        IReadOnlyDictionary<string, (decimal Debit, decimal Credit)>? preOpeningActivity = null,
        string baseCurrencyName = "本位币")
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        journalKinds ??= new Dictionary<string, JournalAccountKind>();
        preOpeningActivity ??= new Dictionary<string, (decimal, decimal)>();
        var codes = snapshot.Accounts.Select(a => a.Code).ToHashSet(StringComparer.Ordinal);
        if (journalKinds.Keys.Concat(preOpeningActivity.Keys).Any(k => !codes.Contains(k)))
            throw new ArgumentException("分类或启用前累计引用了不存在的科目。");
        return new(snapshot.Book, snapshot.Revision, snapshot.Accounts.Select(a =>
        {
            var prior = preOpeningActivity.TryGetValue(a.Code, out var value) ? value : ((decimal, decimal)?)null;
            return new BooksAccount(a.Code, a.Name, a.ParentCode, a.OpeningDebit, a.OpeningCredit,
                journalKinds.GetValueOrDefault(a.Code), prior?.Item1, prior?.Item2);
        }).ToArray(), snapshot.Vouchers.Select(v => new BooksVoucher(v.Id, v.Date, v.Kind, v.Number, v.Status,
            v.Lines.Select((l, i) => new BooksLine(i + 1, l.AccountCode, l.Summary, l.Debit, l.Credit)).ToArray())).ToArray(),
            baseCurrencyName, "现有 LedgerSnapshot 本币投影；原接口未提供结算/票据字段，不能据此宣称原账套兼容。");
    }
}

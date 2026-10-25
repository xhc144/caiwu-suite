using System.Security.Cryptography;
using Caiwu.Contracts;
using Caiwu.Persistence.Sqlite;
using Microsoft.Data.Sqlite;

namespace Caiwu.BookTools.Tests;

internal sealed class SyntheticBook : IDisposable
{
    internal string Root { get; } = Path.Combine(Path.GetTempPath(), "caiwu-booktools-tests-" + Guid.NewGuid().ToString("N"));
    internal string Source => Path.Combine(Root, "source.caiwu");
    internal string Destination => Path.Combine(Root, "new.caiwu");

    internal SyntheticBook()
    {
        Directory.CreateDirectory(Root);
        var at = new DateTimeOffset(2026, 1, 2, 3, 4, 5, TimeSpan.FromHours(8)).AddTicks(7);
        var book = new BookInfo(Guid.NewGuid(), "合成源账套", AccountingRegime.SmallBusiness,
            "synthetic-v1", 2026, 1, 1, at);
        Account[] accounts =
        [
            new("1002", "银行存款", null, BalanceDirection.Debit, true, 100000, 0),
            new("1403", "原材料", null, BalanceDirection.Debit, true, 0, 0),
            new("140301", "合成材料", "1403", BalanceDirection.Debit, true, 0, 0),
            new("4001", "实收资本", null, BalanceDirection.Credit, true, 0, 99990),
            new("6001", "主营业务收入", null, BalanceDirection.Credit, true, 0, 0),
            new("6602", "管理费用", null, BalanceDirection.Debit, true, 0, 0),
            new("9999", "停用历史科目", null, BalanceDirection.Credit, false, 0, 10)
        ];
        Voucher[] vouchers =
        [
            Voucher(new(2026, 1, 3), 1, VoucherStatus.Posted, "140301", "1002", 10000),
            Voucher(new(2026, 1, 4), 2, VoucherStatus.Posted, "6602", "1002", 1200),
            Voucher(new(2026, 1, 5), 3, VoucherStatus.Posted, "1002", "6001", 20000),
            Voucher(new(2026, 2, 6), 1, VoucherStatus.Reviewed, "6602", "1002", 12.34m),
            Voucher(new(2026, 2, 7), 2, VoucherStatus.Draft, "6602", "1002", 0.10m)
        ];
        using var store = SqliteLedgerStore.Create(Source, book, accounts);
        store.Write(new(1, book, accounts, vouchers,
        [
            new(Guid.NewGuid(), at, "合成制单", "Saved", vouchers[0].Id, "合成审计\n含中文"),
            new(Guid.NewGuid(), at.AddHours(1), "合成操作", "DeletedDraft", Guid.NewGuid(), "保留已删除凭证引用")
        ]), 0);
    }

    internal LedgerSnapshot Read(string? path = null)
    {
        using var store = SqliteLedgerStore.Open(path ?? Source);
        return store.Read();
    }

    internal BookCopyPlan Preview(BookCopyScope scope = BookCopyScope.FullLedger, BookCopyService? service = null) =>
        (service ?? new BookCopyService()).Preview(Read(), new(Source, Destination, "合成新账套", scope, "合成复制人"));

    internal SqliteConnection Raw(string? path = null)
    {
        var db = new SqliteConnection(new SqliteConnectionStringBuilder
        { DataSource = path ?? Source, Pooling = false }.ToString());
        db.Open(); return db;
    }

    internal static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)));

    internal static Voucher Voucher(DateOnly date, int number, VoucherStatus status, string debit, string credit, decimal amount) =>
        new(Guid.NewGuid(), date, "记", number, 3, "合成制单", status == VoucherStatus.Draft ? null : "合成审核", status,
        [new(debit, "相同摘要", amount, 0), new(credit, "相同摘要", 0, amount)]);

    public void Dispose() => Directory.Delete(Root, recursive: true);
}

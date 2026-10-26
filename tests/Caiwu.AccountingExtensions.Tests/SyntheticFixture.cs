using Caiwu.Contracts;
using Caiwu.Operators;

namespace Caiwu.AccountingExtensions.Tests;

internal sealed class SyntheticFixture : IDisposable
{
    internal const string Password = "Synthetic-Only-2026!";
    internal string DirectoryPath { get; } = Path.Combine(Path.GetTempPath(), "caiwu-accounting-synthetic-" + Guid.NewGuid().ToString("N"));
    internal LocalOperatorService Operators { get; }
    internal OperatorSession Administrator { get; }
    internal OperatorSession Worker { get; }
    internal OperatorSession Reviewer { get; }

    internal SyntheticFixture(TimeProvider? clock = null)
    {
        Directory.CreateDirectory(DirectoryPath);
        Operators = new LocalOperatorService(new FileOperatorStore(Path.Combine(DirectoryPath, "identities")), clock);
        Operators.InitializeAdministrator("root", "合成管理员", Password);
        Administrator = Operators.Login("root", Password);
        Operators.AddOperator(Administrator, Operators.GetDirectory(Administrator).Revision, "worker", "合成账务员", Password,
            OperatorRoles.Administrator | OperatorRoles.Poster | OperatorRoles.PeriodCloser | OperatorRoles.Preparer);
        Operators.AddOperator(Administrator, Operators.GetDirectory(Administrator).Revision, "reviewer", "合成审核员", Password,
            OperatorRoles.Reviewer | OperatorRoles.Poster);
        Worker = Operators.Login("worker", Password);
        Reviewer = Operators.Login("reviewer", Password);
    }

    internal AccountingExtensionService Service(ILedgerStore store, OperatorSession? session = null)
        => new(store, Operators, session ?? Worker);

    internal static LedgerSnapshot State(int closed = 0, int start = 1) => new(0,
        new(Guid.NewGuid(), "纯合成账套", AccountingRegime.SmallBusiness, "synthetic-only", 2026, start, closed, DateTimeOffset.UtcNow),
        [new("1001", "合成现金", null, BalanceDirection.Debit, true, 0, 0),
         new("6001", "合成收入", null, BalanceDirection.Credit, true, 0, 0),
         new("6602", "合成费用", null, BalanceDirection.Debit, true, 0, 0),
         new("4103", "合成本年利润", null, BalanceDirection.Credit, true, 0, 0)], [], []);

    internal static Voucher Receipt(int month = 1, decimal amount = 1000, int number = 1,
        VoucherStatus status = VoucherStatus.Posted) => new(Guid.NewGuid(), new(2026, month, 10), "记", number, 2,
        "synthetic-preparer", status == VoucherStatus.Draft ? null : "synthetic-reviewer", status,
        [new("1001", "合成收入", amount, 0), new("6001", "合成收入", 0, amount)]);

    internal static Voucher Expense(int month = 1, decimal amount = 250) => new(Guid.NewGuid(), new(2026, month, 11), "记", 2, 1,
        "synthetic-preparer", "synthetic-reviewer", VoucherStatus.Posted,
        [new("6602", "合成费用", amount, 0), new("1001", "合成费用", 0, amount)]);

    internal static LedgerMutationContext Context(LedgerSnapshot state) => new(state.Book.Id, state.Revision);
    internal static MonthlyTransferRequest Transfer(LedgerSnapshot state, int month = 1) => new(2026, month,
        new("SY", "synthetic-v1", "合成月度损益结转", "转", ["6001", "6602"], "4103"), Context(state));

    public void Dispose() => Directory.Delete(DirectoryPath, true);
}

/// <summary>Returns actual state references, so accidental mutation cannot be hidden by the test double.</summary>
internal sealed class SyntheticMemoryStore(LedgerSnapshot initial) : ILedgerStore
{
    internal LedgerSnapshot State { get; set; } = initial;
    internal int Reads { get; private set; }
    internal int Attempts { get; private set; }
    internal int Writes { get; private set; }
    internal Action? AfterRead { get; set; }
    internal Exception? Failure { get; set; }
    public string DatabasePath => "synthetic-memory://ledger";
    public LedgerSnapshot Read()
    {
        Reads++;
        var before = State;
        var action = AfterRead;
        AfterRead = null;
        action?.Invoke();
        return before;
    }
    public void Write(LedgerSnapshot next, long expectedRevision)
    {
        Attempts++;
        if (State.Revision != expectedRevision || next.Revision != checked(expectedRevision + 1))
            throw new StoreConcurrencyException("合成竞争写入冲突。");
        if (Failure is not null) throw Failure;
        State = next;
        Writes++;
    }
    public void BackupTo(string destinationPath) => throw new NotSupportedException();
    public void CheckIntegrity() { }
    public void Dispose() { }
}

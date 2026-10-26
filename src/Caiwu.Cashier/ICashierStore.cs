namespace Caiwu.Cashier;

/// <summary>
/// Atomic compare-and-swap transaction for one book. The transform may throw; no writes then survive.
/// Implementations must check the revision under the same lock/transaction as the commit.
/// Shared-core adapters must coordinate authoritative GL mutations in that same transaction.
/// </summary>
public interface ICashierStore
{
    bool HasAuthoritativeLedgerSnapshot => false;
    CashierSnapshot Read();
    CashierSnapshot Transact(long expectedRevision, Func<CashierSnapshot, CashierSnapshot> transform);
}

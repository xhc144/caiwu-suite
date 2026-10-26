namespace Caiwu.Payroll;

/// <summary>Module-owned storage port. Implementations must bind read and commit to the
/// same book/revision, preserve the entire document, and never auto-retry conflicts.</summary>
public interface IPayrollStore
{
    Guid BookId { get; }
    PayrollDocument Read();
    PayrollDocument Commit(PayrollDocument document, long expectedRevision);
}

using Microsoft.Data.Sqlite;

namespace Caiwu.Cashier;

/// <summary>
/// The actual WPF handlers use this boundary. A handled failure only reports feedback: it never
/// retries, refreshes a token, discards input, reports success or closes a window/dialog.
/// </summary>
public static class CashierOperationBoundary
{
    public static bool Run(Action operation, Action<string> reportFailure)
    {
        try { operation(); return true; }
        catch (Exception e) when (e is CashierRuleException or CashierConcurrencyException or FormatException
            or ArgumentOutOfRangeException or OverflowException or System.IO.IOException or SqliteException)
        {
            reportFailure(e.Message);
            return false;
        }
    }
}

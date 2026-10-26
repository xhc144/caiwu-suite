namespace Caiwu.Payroll.Wpf;

/// <summary>Real entry handlers for the shell. No replacement application, authentication,
/// guessed toolbar coordinates, or automatic cross-book service reuse.</summary>
public sealed class PayrollWindowFactory(PayrollService service, IReadOnlyList<PayrollAccount> accounts,
    IReadOnlyList<string>? voucherTypes = null)
{
    public DepartmentWindow Departments() => new(service);
    public PersonnelManagementView Personnel(Action closeSheet) => new(service, closeSheet);
    public PayrollColumnsWindow Columns() => new(service);
    public PayrollFormulasWindow Formulas() => new(service);
    public PayrollVoucherSettingsWindow VoucherSettings() => new(service, accounts);
    public WageManagementView Wages(DateOnly month, Action closeSheet, Action<PayrollDocument, Guid>? transferToLedger = null)
        => new(service, month, accounts, closeSheet, transferToLedger, voucherTypes);
    public PayrollVoucherWindow VoucherPlan(DateOnly month, PayrollVoucherKind kind, Action<PayrollDocument, Guid>? transferToLedger = null)
        => new(service, month, kind, accounts, transferToLedger, voucherTypes);
}

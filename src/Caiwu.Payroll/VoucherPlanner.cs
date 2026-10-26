using System.Security.Cryptography;
using System.Text;

namespace Caiwu.Payroll;

internal static class VoucherPlanner
{
    internal static void ValidateSettings(PayrollDocument book, PayrollVoucherSettings settings)
    {
        Guard.Require(!string.IsNullOrWhiteSpace(settings.PayableAccount), "应付工资对应科目未设置。");
        Numeric(book, settings.PayableField);
        Guard.Require(book.Columns.Any(c => c.FieldName == settings.DistributionAccountField && c.Enabled
            && c.Kind == PayrollValueKind.Text && c.FieldName is not ("g_j1" or "g_j2" or "g_j3")),
            "工资分配栏目应取启用的基本项，并填写每人的分配科目。");
        Guard.Require(settings.Credits.Count > 0, "没有定义贷方栏目！");
        Guard.Require(settings.Credits.Select(c => c.FieldName).Distinct(StringComparer.Ordinal).Count() == settings.Credits.Count,
            "贷方栏目重复。");
        foreach (var mapping in settings.Credits)
        { Numeric(book, mapping.FieldName); Guard.Require(!string.IsNullOrWhiteSpace(mapping.AccountCode), "贷方科目未设置。"); }
    }

    internal static PayrollVoucherPlan Create(PayrollDocument book, PayrollPeriod period,
        PayrollVoucherSettings settings, PayrollVoucherRequest request, IReadOnlyList<PayrollAccount> accounts)
    {
        ValidateSettings(book, settings);
        Guard.Require(Enum.IsDefined(request.Kind), "不支持的工资凭证种类。");
        Guard.Require(request.Number > 0 && !string.IsNullOrWhiteSpace(request.VoucherType), "凭证类型或编号未输！");
        Guard.Require(request.Date >= period.Month, "凭证日期不能早于数据月份。");
        Guard.Require(period.Rows.Count > 0, "没有工资数据。");
        Guard.Require(accounts.Select(a => a.Code).Distinct(StringComparer.Ordinal).Count() == accounts.Count, "科目目录存在重复代码。");
        var catalog = accounts.ToDictionary(a => a.Code, StringComparer.Ordinal);
        var plan = new PayrollVoucherPlan
        {
            Id = Guid.NewGuid(), BookId = book.BookId, Month = period.Month,
            DataVersion = period.DataVersion, ConfigurationVersion = book.ConfigurationVersion,
            Request = request
        };
        foreach (var row in period.Rows)
        {
            var payable = Amount(row, settings.PayableField);
            if (request.Kind == PayrollVoucherKind.Payment)
            {
                Add(settings.PayableAccount, payable, true, row);
                foreach (var credit in settings.Credits) Add(credit.AccountCode, Amount(row, credit.FieldName), false, row);
            }
            else
            {
                Guard.Require(row.Employee.Attributes.TryGetValue(settings.DistributionAccountField, out var expense)
                    && !string.IsNullOrWhiteSpace(expense), $"员工 {row.Employee.Code} 的工资分配科目未设置。");
                Add(expense!, payable, true, row);
                Add(settings.PayableAccount, payable, false, row);
            }
        }
        Guard.Require(plan.Lines.Count > 0 && plan.Lines.Sum(l => l.Debit) == plan.Lines.Sum(l => l.Credit),
            "借贷不平或金额全零，不能生成凭证计划！");
        // Includes complete settings and the resulting lines/account dimensions. Repeating
        // the exact plan is idempotent; a changed allocation requires a distinct identity.
        var fingerprint = PayrollJson.Serialize(new
        {
            book.BookId, period.Month, period.DataVersion, book.ConfigurationVersion,
            Settings = settings, Request = request, plan.Lines
        });
        plan.SourceKey = "payroll:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(fingerprint))).ToLowerInvariant();
        return plan;

        void Add(string accountCode, decimal amount, bool debit, PayrollRow row)
        {
            Guard.Require(catalog.TryGetValue(accountCode, out var account), $"科目 {accountCode} 不存在！");
            Guard.Require(account!.Enabled && account.IsLeaf, $"科目 {accountCode} 已停用或非明细科目！");
            Guard.Require(string.IsNullOrWhiteSpace(account.UnsupportedAuxiliaryDimensions),
                $"科目 {accountCode} 还有未提供的辅助核算：{account.UnsupportedAuxiliaryDimensions}。");
            Guard.Require(!account.RequiresDepartment || !string.IsNullOrWhiteSpace(row.Employee.DepartmentCode), "科目缺少部门维度。");
            Guard.Require(!account.RequiresEmployee || !string.IsNullOrWhiteSpace(row.Employee.Code), "科目缺少人员维度。");
            if (amount == 0) return;
            if (amount < 0) { debit = !debit; amount = Math.Abs(amount); }
            plan.Lines.Add(new(accountCode, request.Summary, debit ? amount : 0, debit ? 0 : amount,
                row.Employee.DepartmentCode, row.Employee.Code));
        }
    }

    private static decimal Amount(PayrollRow row, string field)
    {
        var value = PayrollService.Value(row, field);
        Guard.Require(value is not null, $"员工 {row.Employee.Code} 的栏目 {field} 为空，不能生成凭证。");
        // Individual wage values round once to the target ledger currency scale.
        return decimal.Round(value!.Value, 2, MidpointRounding.AwayFromZero);
    }
    private static void Numeric(PayrollDocument book, string field)
        => Guard.Require(book.Columns.Any(c => c.FieldName == field && c.Enabled && c.Kind == PayrollValueKind.Number),
            $"应付工资或贷方栏目 {field} 应取启用的工资数值项！");
}

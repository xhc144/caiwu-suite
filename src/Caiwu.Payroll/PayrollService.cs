using System.Globalization;
using System.Text.RegularExpressions;

namespace Caiwu.Payroll;

/// <summary>One editable session. All commands clone, validate, then atomically commit.
/// An outdated session fails rather than overwriting another window's changes.</summary>
public sealed partial class PayrollService
{
    private readonly IPayrollStore store;
    private PayrollDocument document;
    public PayrollService(IPayrollStore store) { this.store = store; document = store.Read(); }
    public PayrollDocument Snapshot => PayrollJson.Clone(document);
    public long Revision => document.Revision;
    public void Refresh() => document = store.Read();

    public void SaveDepartments(IEnumerable<Department> departments)
    {
        var rows = PayrollJson.Clone(departments.ToList());
        Unique(rows.Select(d => d.Code), "部门编码");
        foreach (var row in rows) Required(row.Name, "部门名称");
        Mutate(book =>
        {
            var codes = rows.Select(r => r.Code).ToHashSet(StringComparer.Ordinal);
            foreach (var employee in book.Employees.Concat(book.Periods.SelectMany(p => p.Rows).Select(r => r.Employee)))
                Guard.Require(codes.Contains(employee.DepartmentCode), "该部门已使用，不能被删除！");
            book.Departments = rows;
        });
    }

    public void SaveEmployees(IEnumerable<Employee> employees)
    {
        var rows = PayrollJson.Clone(employees.ToList());
        Unique(rows.Select(e => e.Code), "人员编号");
        foreach (var employee in rows)
        {
            Required(employee.Name, "姓名");
            Guard.Require(document.Departments.Any(d => d.Code == employee.DepartmentCode), $"员工 {employee.Code} 的部门不存在。");
        }
        Mutate(book =>
        {
            var codes = rows.Select(r => r.Code).ToHashSet(StringComparer.Ordinal);
            foreach (var row in book.Periods.SelectMany(p => p.Rows))
                Guard.Require(codes.Contains(row.Employee.Code), "人员已有工资记录，不能删除或直接修改编号；可停用人员。");
            book.Employees = rows;
            // Existing monthly snapshots remain unchanged, including names and departments.
        });
    }

    public void AddEmployee(Employee employee, DateOnly? month = null, IReadOnlyDictionary<string, decimal?>? initialValues = null)
    {
        var copy = PayrollJson.Clone(employee);
        Required(copy.Code, "人员编号"); Required(copy.Name, "姓名");
        Guard.Require(!document.Employees.Any(e => e.Code == copy.Code), "编号重复！");
        Guard.Require(document.Departments.Any(d => d.Code == copy.DepartmentCode), "员工所属部门不存在。");
        var values = initialValues is null ? new Dictionary<string, decimal?>() : new(initialValues);
        ValidateInputFields(values.Keys);
        // Initial values entered in personnel management also seed future months.
        foreach (var (field, value) in values) copy.Attributes[field] = value?.ToString(CultureInfo.InvariantCulture);
        Mutate(book =>
        {
            book.Employees.Add(copy);
            if (month is { } selected)
            {
                var period = FindPeriod(book, selected);
                period.Rows.Add(new() { Employee = PayrollJson.Clone(copy), Inputs = values });
                Invalidate(period);
            }
        });
    }

    public void SaveColumns(IEnumerable<PayrollColumn> columns)
    {
        var rows = PayrollJson.Clone(columns.ToList());
        Unique(rows.Select(c => c.FieldName), "栏目字段名");
        Guard.Require(rows.Count <= 256, "本切片最多支持 256 个栏目。");
        foreach (var column in rows)
        {
            Guard.Require(FieldNamePattern().IsMatch(column.FieldName), "栏目字段名只能包含小写字母、数字与下划线，且以字母开头。");
            Required(column.Caption, "栏目名称");
            Guard.Require(column.Width is > 0 and <= 1000 && column.DecimalDigits is >= 0 and <= 28,
                "栏目宽度或小数位数不合法。");
            foreach (var layout in new[] { column.WageTable, column.Summary, column.Payslip })
                Guard.Require(layout.IntegerDigits is > 0 and <= 100 && layout.DecimalDigits is >= 0 and <= 28,
                    "打印栏目宽度不合法。");
        }
        for (var i = 1; i <= 3; i++) Guard.Require(rows.Any(c => c.FieldName == $"g_j{i}"
            && c.Kind == PayrollValueKind.Text && c.Enabled), "编号、姓名和部门基本项必须保留并启用。");
        Mutate(book =>
        {
            // Never silently discard an existing slot or its original metadata.
            Guard.Require(book.Columns.All(old => rows.Any(c => c.FieldName == old.FieldName)),
                "不能删除已有栏目，请停用并保留原字段与设置。");
            foreach (var column in rows)
            {
                var previous = book.Columns.SingleOrDefault(c => c.FieldName == column.FieldName);
                if (previous is not null && previous.Kind != column.Kind)
                    Guard.Require(!book.Periods.SelectMany(p => p.Rows).Any(r => r.Inputs.ContainsKey(column.FieldName)
                        || r.Results.ContainsKey(column.FieldName) || r.Employee.Attributes.ContainsKey(column.FieldName))
                        && !book.Employees.Any(e => e.Attributes.ContainsKey(column.FieldName)), "已有数据的栏目不能直接改变类型。");
            }
            _ = FormulaEngine.Compile(rows, book.Formulas);
            book.Columns = rows;
            book.ConfigurationVersion++;
        });
    }

    public void SaveFormulas(IEnumerable<PayrollFormula> formulas)
    {
        var rows = PayrollJson.Clone(formulas.ToList());
        Unique(rows.Select(f => f.Order.ToString(CultureInfo.InvariantCulture)), "公式顺序");
        _ = FormulaEngine.Compile(document.Columns, rows);
        Mutate(book => { book.Formulas = rows; book.ConfigurationVersion++; });
    }

    public void SaveTaxProfile(PayrollTaxProfile profile)
    {
        var copy = PayrollJson.Clone(profile);
        copy.Validate();
        Mutate(book => { book.TaxProfile = copy; book.ConfigurationVersion++; });
    }

    public void OpenPeriod(DateOnly month, DateOnly? carryFrom = null)
    {
        CheckMonth(month);
        Guard.Require(month >= document.OpeningMonth, "工资月份不能早于开始使用月份。");
        Guard.Require(!document.Periods.Any(p => p.Month == month), "该月份已经存在。");
        Guard.Require(document.Employees.Any(e => e.IsActive), "请先增加员工。");
        Guard.Require(document.Columns.Any(c => c.Enabled && c.Kind == PayrollValueKind.Number), "请先定义工资栏目。");
        var source = carryFrom is { } previous ? FindPeriod(document, previous) : null;
        Guard.Require(source is null || source.Month < month, "传递来源必须早于当前月份。");
        var targets = document.Formulas.Where(f => f.Enabled).Select(f => f.TargetField).ToHashSet(StringComparer.Ordinal);
        Mutate(book =>
        {
            var period = new PayrollPeriod { Month = month };
            foreach (var employee in book.Employees.Where(e => e.IsActive).OrderBy(e => e.Code, StringComparer.Ordinal))
            {
                var row = new PayrollRow { Employee = PayrollJson.Clone(employee) };
                var old = source?.Rows.SingleOrDefault(r => r.Employee.Code == employee.Code);
                foreach (var column in book.Columns.Where(c => c.Enabled && c.Kind == PayrollValueKind.Number && !targets.Contains(c.FieldName)))
                {
                    decimal? value = null;
                    if (column.CarryForward && old is not null)
                    {
                        if (old.Inputs.TryGetValue(column.FieldName, out var carried)) value = carried;
                        else if (old.Results.TryGetValue(column.FieldName, out carried))
                        {
                            Guard.Require(IsCalculated(book, source!), "传递来源月份的计算结果已过期，请先重新计算。");
                            value = carried;
                        }
                    }
                    else if (employee.Attributes.TryGetValue(column.FieldName, out var raw) && raw is not null)
                    {
                        Guard.Require(decimal.TryParse(raw, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint,
                            CultureInfo.InvariantCulture, out var parsed), $"员工 {employee.Code} 的 {column.FieldName} 不是数值。");
                        value = parsed;
                    }
                    row.Inputs[column.FieldName] = value;
                }
                period.Rows.Add(row);
            }
            book.Periods.Add(period);
        });
    }

    public void SetInputs(DateOnly month, string employeeCode, IReadOnlyDictionary<string, decimal?> values)
    {
        ValidateInputFields(values.Keys);
        Mutate(book =>
        {
            var period = FindPeriod(book, month);
            var row = period.Rows.SingleOrDefault(r => r.Employee.Code == employeeCode);
            Guard.Require(row is not null, "该月份不存在此员工。");
            foreach (var (field, value) in values) row!.Inputs[field] = value;
            Invalidate(period);
        });
    }

    // Save an edited wage grid once, not one independent commit per row.
    public void SaveInputs(DateOnly month, IReadOnlyDictionary<string, Dictionary<string, decimal?>> inputs)
    {
        foreach (var values in inputs.Values) ValidateInputFields(values.Keys);
        Mutate(book =>
        {
            var period = FindPeriod(book, month);
            foreach (var (employee, values) in inputs)
            {
                var row = period.Rows.SingleOrDefault(r => r.Employee.Code == employee);
                Guard.Require(row is not null, $"该月份不存在员工 {employee}。");
                foreach (var (field, value) in values) row!.Inputs[field] = value;
            }
            Invalidate(period);
        });
    }

    public void SetUniformValue(DateOnly month, string field, decimal? value,
        string? departmentCode = null, bool nullValuesOnly = false)
    {
        ValidateInputFields([field]);
        Mutate(book =>
        {
            var period = FindPeriod(book, month);
            var selected = period.Rows.Where(r => departmentCode is null || r.Employee.DepartmentCode == departmentCode).ToArray();
            Guard.Require(selected.Length > 0, "没有选中工资记录。");
            foreach (var row in selected)
                if (!nullValuesOnly || row.Inputs.GetValueOrDefault(field) is null) row.Inputs[field] = value;
            Invalidate(period);
        });
    }

    public WageTable Calculate(DateOnly month)
    {
        var compiled = FormulaEngine.Compile(document.Columns, document.Formulas);
        if (compiled.Any(f => f.Definition.IsTaxFormula))
        {
            Guard.Require(document.TaxProfile is not null, "请先设置有出处的税参数。");
            document.TaxProfile!.Validate();
            Guard.Require(month >= document.TaxProfile.EffectiveFrom && month <= document.TaxProfile.EffectiveTo,
                "当前工资月份不在税参数有效期内。");
        }
        Mutate(book =>
        {
            var period = FindPeriod(book, month);
            foreach (var row in period.Rows)
            {
                try { row.Results = FormulaEngine.Calculate(compiled, book.Columns, row.Inputs, book.TaxProfile, month); }
                catch (PayrollValidationException error) { throw new PayrollValidationException($"员工 {row.Employee.Code}：{error.Message}"); }
            }
            period.CalculatedDataVersion = period.DataVersion;
            period.CalculatedConfigurationVersion = book.ConfigurationVersion;
        });
        return GetWageTable(month);
    }

    public WageTable GetWageTable(DateOnly month, string? departmentCode = null)
    {
        var book = Snapshot;
        var period = FindPeriod(book, month);
        var rows = period.Rows.Where(r => departmentCode is null || r.Employee.DepartmentCode == departmentCode).ToArray();
        var columns = book.Columns.Where(c => c.Enabled).OrderBy(c => c.Order).ThenBy(c => c.FieldName, StringComparer.Ordinal).ToArray();
        var current = IsCalculated(book, period);
        var totals = columns.Where(c => c.Kind == PayrollValueKind.Number).ToDictionary(c => c.FieldName,
            c => rows.Sum(r => Value(r, c.FieldName) ?? 0), StringComparer.Ordinal);
        return new(month, current, columns, rows, totals);
    }

    public void SaveVoucherSettings(PayrollVoucherSettings settings)
    {
        var copy = PayrollJson.Clone(settings);
        VoucherPlanner.ValidateSettings(document, copy);
        var changed = PayrollJson.Serialize(document.VoucherSettings) != PayrollJson.Serialize(copy);
        Mutate(book =>
        {
            book.VoucherSettings = copy;
            // Account/column choices are part of the decision behind every saved plan.
            // A fresh whole-book revision must not make an old decision current again.
            if (changed) book.ConfigurationVersion = checked(book.ConfigurationVersion + 1);
        });
    }

    public PayrollVoucherPlan CreateVoucherPlan(DateOnly month, PayrollVoucherRequest request,
        IReadOnlyList<PayrollAccount> accounts)
    {
        var period = FindPeriod(document, month);
        Guard.Require(IsCalculated(document, period), "工资数据或公式已变更，请先存盘并重新计算。");
        Guard.Require(document.VoucherSettings is not null, "请先进行凭证设置。");
        var plan = VoucherPlanner.Create(document, period, document.VoucherSettings!, request, accounts);
        var existing = document.VoucherPlans.SingleOrDefault(p => p.SourceKey == plan.SourceKey);
        if (existing is not null)
        {
            if (existing.ContentHash == plan.ContentHash) return PayrollJson.Clone(existing);
            // Explicit regeneration replaces only an obsolete, untransferred decision
            // with the identical voucher request. Keep the stable business source,
            // but retire its old plan ID so old confirmation callbacks cannot submit it.
            Guard.Require(existing.Status == "planned" && existing.ConfigurationVersion != document.ConfigurationVersion
                && PayrollJson.Serialize(existing.Request) == PayrollJson.Serialize(request),
                "该月份和种类已有不同的凭证计划；仅过期且尚未转入的同一凭证请求可重新生成。");
            Guard.Require(existing.ExtensionData.Count == 0 && existing.Request.ExtensionData.Count == 0
                && existing.Lines.All(line => line.ExtensionData.Count == 0), "旧计划还有未解释字段，不能省略后重新生成。");
        }
        // Different plans cannot silently refresh or overwrite the same voucher identity.
        Guard.Require(!document.VoucherPlans.Any(p => (existing is null || p.Id != existing.Id) && p.Request.Date.Year == request.Date.Year
            && p.Request.Date.Month == request.Date.Month && p.Request.VoucherType == request.VoucherType
            && p.Request.Number == request.Number), "已有重复凭证计划，请核对编号；本切片不覆盖或刷新总账凭证。");
        Mutate(book =>
        {
            if (existing is not null) book.VoucherPlans.RemoveAll(p => p.Id == existing.Id);
            book.VoucherPlans.Add(plan);
        });
        return PayrollJson.Clone(plan);
    }

    public static decimal? Value(PayrollRow row, string field) => row.Results.TryGetValue(field, out var computed)
        ? computed : row.Inputs.GetValueOrDefault(field);

    private void ValidateInputFields(IEnumerable<string> fields)
    {
        var targets = document.Formulas.Where(f => f.Enabled).Select(f => f.TargetField).ToHashSet(StringComparer.Ordinal);
        foreach (var field in fields)
        {
            Guard.Require(document.Columns.Any(c => c.FieldName == field && c.Enabled && c.Kind == PayrollValueKind.Number),
                $"{field} 不是启用的数值栏目。");
            Guard.Require(!targets.Contains(field), $"{field} 由公式计算，不能手工置数。");
        }
    }
    private void Mutate(Action<PayrollDocument> mutation)
    {
        var next = Snapshot;
        mutation(next);
        document = store.Commit(next, document.Revision);
    }
    private static void Invalidate(PayrollPeriod period)
    {
        period.DataVersion++;
        // Results are invalidated together; no stale values masquerade as current wages.
        foreach (var row in period.Rows) row.Results.Clear();
    }
    internal static bool IsCalculated(PayrollDocument book, PayrollPeriod period)
        => period.CalculatedDataVersion == period.DataVersion && period.CalculatedConfigurationVersion == book.ConfigurationVersion;
    internal static PayrollPeriod FindPeriod(PayrollDocument book, DateOnly month)
    {
        CheckMonth(month);
        return book.Periods.SingleOrDefault(p => p.Month == month) ?? throw new PayrollValidationException("该工资月份尚未建立。");
    }
    private static void CheckMonth(DateOnly month) => Guard.Require(month.Day == 1, "工资月份必须使用当月一日。");
    private static void Required(string text, string label) => Guard.Require(!string.IsNullOrWhiteSpace(text), $"{label}未输入！");
    private static void Unique(IEnumerable<string> codes, string label)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var code in codes) { Required(code, label); Guard.Require(seen.Add(code), $"{label}重复！"); }
    }
    [GeneratedRegex("^[a-z][a-z0-9_]{0,63}$", RegexOptions.CultureInvariant)]
    private static partial Regex FieldNamePattern();
}

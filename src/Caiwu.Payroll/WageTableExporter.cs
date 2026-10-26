using System.Globalization;
using System.Text;

namespace Caiwu.Payroll;

public static class WageTableExporter
{
    public static string ToCsv(WageTable table)
    {
        Guard.Require(table.IsCalculated, "请先执行工资计算，再另存工资表。");
        var output = new StringBuilder();
        output.AppendLine(string.Join(',', table.Columns.Select(c => Cell(c.Caption))));
        foreach (var row in table.Rows)
            output.AppendLine(string.Join(',', table.Columns.Select(column => column.Kind == PayrollValueKind.Number
                ? (PayrollService.Value(row, column.FieldName)?.ToString(CultureInfo.InvariantCulture) ?? "")
                : Cell(TextValue(row.Employee, column.FieldName)))));
        output.AppendLine(string.Join(',', table.Columns.Select(column => column.Kind == PayrollValueKind.Number
            ? table.Totals[column.FieldName].ToString(CultureInfo.InvariantCulture)
            : Cell(column.FieldName == "g_j1" ? "合计（空值未计入）" : ""))));
        return output.ToString();
    }
    private static string? TextValue(Employee employee, string field) => field switch
    {
        "g_j1" => employee.Code, "g_j2" => employee.Name, "g_j3" => employee.DepartmentCode,
        _ => employee.Attributes.GetValueOrDefault(field)
    };
    private static string Cell(string? value)
    {
        value ??= "";
        // Treat employee-controlled text as text in spreadsheet importers.
        var trimmed = value.AsSpan().TrimStart();
        if (!trimmed.IsEmpty && trimmed[0] is '=' or '+' or '-' or '@' || value.Length > 0 && value[0] is '\t' or '\r' or '\n')
            value = "'" + value;
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }
}

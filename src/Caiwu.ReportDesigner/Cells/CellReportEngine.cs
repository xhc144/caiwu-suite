using System.Globalization;
using R = Caiwu.ReportDesigner.SafeFormula.Rational;

namespace Caiwu.ReportDesigner.Cells;

public sealed class CellReportEngine(ReportFunctionCatalog? functions = null)
{
    private readonly ReportFunctionCatalog catalog = functions ?? ReportFunctionCatalog.Default;
    private sealed record Plan(CellReport Report, Dictionary<CellAddress, CellDefinition> Definitions,
        Dictionary<CellAddress, CellFormula.Node> Formulas, CellAddress[] Order);
    public void Validate(CellReport report) => _ = Prepare(report);
    private Plan Prepare(CellReport original)
    {
        var report = CellReportRules.Freeze(original);
        var definitions = report.Cells.ToDictionary(c => CellAddress.Parse(c.Address));
        var formulas = new Dictionary<CellAddress, CellFormula.Node>();
        var dependencies = new Dictionary<CellAddress, HashSet<CellAddress>>();
        var issues = new List<CellIssue>(); var edges = 0; var visits = 0;
        foreach (var (address, definition) in definitions)
        {
            if (!definition.Content.StartsWith('=')) continue;
            try
            {
                var formula = CellFormula.Parse(definition.Content[1..], catalog);
                var refs = new HashSet<CellAddress>();
                foreach (var reference in formula.References()) {
                    if (++visits > 200000) throw new CellFormulaFault("LIMIT", 0, "报表引用访问超过200000。");
                    refs.Add(reference);
                    if (edges + refs.Count > 100000) throw new CellFormulaFault("LIMIT", 0, "报表依赖超过100000。");
                }
                edges += refs.Count;
                if (refs.Any(r => r.Row > report.RowCount || r.Column > report.ColumnCount)) throw new CellFormulaFault("REFERENCE", 0, "公式引用超出报表范围。");
                formulas.Add(address, formula); dependencies.Add(address, refs);
            }
            catch (CellFormulaFault ex) { issues.Add(new(address.ToString(), ex.Code, ex.Message, ex.Position)); if (ex.Code == "LIMIT") throw new CellReportException(issues.AsReadOnly()); }
        }
        if (issues.Count > 0) throw new CellReportException(issues.AsReadOnly());
        var counts = formulas.Keys.ToDictionary(k => k, k => dependencies[k].Count(formulas.ContainsKey));
        var dependents = formulas.Keys.ToDictionary(k => k, _ => new List<CellAddress>());
        foreach (var (key, refs) in dependencies) foreach (var dep in refs.Where(formulas.ContainsKey)) dependents[dep].Add(key);
        var ready = new Queue<CellAddress>(counts.Where(p => p.Value == 0).Select(p => p.Key)); var order = new List<CellAddress>();
        while (ready.TryDequeue(out var key)) { order.Add(key); foreach (var next in dependents[key]) if (--counts[next] == 0) ready.Enqueue(next); }
        if (order.Count != formulas.Count) throw new CellReportException(counts.Where(p => p.Value > 0).Select(p => new CellIssue(p.Key.ToString(), "CYCLE", "循环引用或依赖循环单元格。")).ToArray());
        return new(report, definitions, formulas, order.ToArray());
    }
    public CellReportResult Generate(CellReport report, ReportQueryContext context, IReportDataSource source)
    {
        ArgumentNullException.ThrowIfNull(source);
        if (context.BookId == Guid.Empty || context.ExpectedRevision < 0 || context.From > context.To) throw new ReportDataException("生成上下文无效。");
        var plan = Prepare(report); var snapshot = source.Capture(context); var stamp = snapshot.Stamp;
        if (stamp.BookId != context.BookId || stamp.Revision != context.ExpectedRevision || stamp.From != context.From || stamp.To != context.To ||
            stamp.Currency != "CNY" || stamp.UnpostedVoucherCount < 0 || string.IsNullOrWhiteSpace(stamp.Description)) throw new ReportDataException("取数源身份、期间、代次或本位币不匹配。");
        var numbers = new Dictionary<CellAddress, R>(); var output = new Dictionary<string, CalculatedCell>(StringComparer.Ordinal);
        var issues = new List<CellIssue>(); var failed = new HashSet<CellAddress>();
        foreach (var (address, definition) in plan.Definitions.Where(p => !plan.Formulas.ContainsKey(p.Key)))
        {
            var content = definition.Content; var format = definition.Format!;
            try
            {
                decimal? number = null;
                if (IsNumber(content)) { var node = CellFormula.Parse(content, catalog); var value = node.Evaluate(_ => R.Zero, _ => 0); number = value.ToDecimal(); numbers.Add(address, value); }
                else if (content.Length == 0) numbers.Add(address, R.Zero);
                output.Add(address.ToString(), new(address.ToString(), number is null ? content : Display(number.Value, format), number, content, format));
            }
            catch (Exception ex) when (ex is CellFormulaFault or ArithmeticException) { failed.Add(address); issues.Add(new(address.ToString(), "NUMBER", ex.Message)); }
        }
        var queryCache = new Dictionary<ReportDataRequest, decimal>();
        decimal Read(ReportDataRequest request)
        {
            if (queryCache.TryGetValue(request, out var value)) return value;
            if (queryCache.Count >= 10000) throw new ReportDataException("不同取数请求超过10000。");
            value = snapshot.Read(request); queryCache.Add(request, value); return value;
        }
        R Resolve(CellAddress address)
        {
            if (failed.Contains(address)) throw new CellFormulaFault("DEPENDENCY", 0, $"依赖 {address} 计算失败。");
            if (numbers.TryGetValue(address, out var value)) return value;
            if (plan.Definitions.ContainsKey(address)) throw new CellFormulaFault("TYPE", 0, $"{address} 是文本，不能当作数值。");
            return R.Zero; // Explicitly empty cell, not a missing account or source field.
        }
        foreach (var address in plan.Order)
        {
            var definition = plan.Definitions[address];
            try
            {
                var value = plan.Formulas[address].Evaluate(Resolve, Read); var number = value.ToDecimal();
                numbers.Add(address, value);
                output.Add(address.ToString(), new(address.ToString(), Display(number, definition.Format!), number, definition.Content, definition.Format!));
            }
            catch (Exception ex) when (ex is CellFormulaFault or ArithmeticException or ReportDataException)
            {
                failed.Add(address);
                issues.Add(new(address.ToString(), ex switch { CellFormulaFault f => f.Code, DivideByZeroException => "DIV0", OverflowException => "OVERFLOW", ReportDataException => "DATA", _ => "PRECISION" }, ex.Message, (ex as CellFormulaFault)?.Position));
            }
        }
        if (issues.Count > 0) throw new CellReportException(issues.AsReadOnly());
        return new(plan.Report, stamp, output);
    }
    private static bool IsNumber(string text)
    {
        if (text.Length == 0) return false;
        var body = text[0] is '+' or '-' ? text[1..] : text;
        return body.Any(char.IsAsciiDigit) && body.All(c => char.IsAsciiDigit(c) || c == '.');
    }
    private static string Display(decimal number, CellFormat format) => number.ToString((format.Thousands ? "N" : "F") + format.DecimalPlaces, CultureInfo.InvariantCulture);
}

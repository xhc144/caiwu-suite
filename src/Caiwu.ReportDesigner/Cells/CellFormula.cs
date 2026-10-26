using R = Caiwu.ReportDesigner.SafeFormula.Rational;

namespace Caiwu.ReportDesigner.Cells;

/// <summary>Verified aliases may be supplied by an original-format adapter. Defaults are the new cell-sheet dialect, not claims about bbfun.</summary>
public sealed class ReportFunctionCatalog
{
    private readonly IReadOnlyDictionary<string, ReportMeasure> functions;
    public static ReportFunctionCatalog Default { get; } = new(new Dictionary<string, ReportMeasure> {
        ["OPENING"] = ReportMeasure.Opening, ["CLOSING"] = ReportMeasure.Closing, ["DEBIT"] = ReportMeasure.Debit,
        ["CREDIT"] = ReportMeasure.Credit, ["YTDDEBIT"] = ReportMeasure.YearToDateDebit, ["YTDCREDIT"] = ReportMeasure.YearToDateCredit });
    public ReportFunctionCatalog(IReadOnlyDictionary<string, ReportMeasure> verifiedAliases)
    {
        if (verifiedAliases.Count > 256) throw new ArgumentException("取数别名超过预算。");
        var copy = new Dictionary<string, ReportMeasure>(StringComparer.OrdinalIgnoreCase);
        foreach (var (name, measure) in verifiedAliases)
        {
            if (name.Length is < 1 or > 40 || !name.All(char.IsAsciiLetter) || name.ToUpperInvariant() is "SUM" or "ABS" or "ROUND" || !Enum.IsDefined(measure))
                throw new ArgumentException("取数别名无效。");
            copy.Add(name, measure);
        }
        functions = new System.Collections.ObjectModel.ReadOnlyDictionary<string, ReportMeasure>(copy);
    }
    internal bool TryGet(string name, out ReportMeasure measure) => functions.TryGetValue(name, out measure);
}
internal sealed class CellFormulaFault(string code, int position, string message) : Exception(message)
{ public string Code { get; } = code; public int Position { get; } = position + 1; }
internal static class CellFormula
{
    internal abstract record Node(int At)
    {
        public abstract R Evaluate(Func<CellAddress, R> cell, Func<ReportDataRequest, decimal> read);
        public abstract IEnumerable<CellAddress> References();
    }
    private sealed record Literal(R Value, int Start) : Node(Start)
    { public override R Evaluate(Func<CellAddress, R> cell, Func<ReportDataRequest, decimal> read) => Value; public override IEnumerable<CellAddress> References() => []; }
    private sealed record Reference(CellAddress Address, int Start) : Node(Start)
    { public override R Evaluate(Func<CellAddress, R> cell, Func<ReportDataRequest, decimal> read) => cell(Address); public override IEnumerable<CellAddress> References() => [Address]; }
    private sealed record Range(CellAddress From, CellAddress To, int Start) : Node(Start)
    {
        public override IEnumerable<CellAddress> References()
        { for (var row = From.Row; row <= To.Row; row++) for (var col = From.Column; col <= To.Column; col++) yield return new(row, col); }
        public override R Evaluate(Func<CellAddress, R> cell, Func<ReportDataRequest, decimal> read) => References().Aggregate(R.Zero, (a, b) => a + cell(b));
    }
    private sealed record Unary(bool Negative, Node Child, int Start) : Node(Start)
    {
        public override R Evaluate(Func<CellAddress, R> cell, Func<ReportDataRequest, decimal> read) { var n = Child.Evaluate(cell, read); return Negative ? -n : n; }
        public override IEnumerable<CellAddress> References() => Child.References();
    }
    private sealed record Binary(char Op, Node Left, Node Right, int Start) : Node(Start)
    {
        public override R Evaluate(Func<CellAddress, R> cell, Func<ReportDataRequest, decimal> read)
        {
            var a = Left.Evaluate(cell, read); var b = Right.Evaluate(cell, read);
            return Op switch { '+' => a + b, '-' => a - b, '*' => a * b, '/' => a / b, _ => throw new InvalidOperationException() };
        }
        public override IEnumerable<CellAddress> References() => Left.References().Concat(Right.References());
    }
    private sealed record Call(string Name, Node[] Args, int Start) : Node(Start)
    {
        public override R Evaluate(Func<CellAddress, R> cell, Func<ReportDataRequest, decimal> read)
        {
            var a = Args.Select(n => n.Evaluate(cell, read)).ToArray();
            return Name switch { "ABS" => a[0].Abs(), "ROUND" => a[0].Round(a[1].Integer(0, 6)), "SUM" => a.Aggregate(R.Zero, (x, y) => x + y), _ => throw new InvalidOperationException() };
        }
        public override IEnumerable<CellAddress> References() => Args.SelectMany(n => n.References());
    }
    private sealed record Data(ReportDataRequest Request, int Start) : Node(Start)
    { public override R Evaluate(Func<CellAddress, R> cell, Func<ReportDataRequest, decimal> read) => R.FromDecimal(read(Request)); public override IEnumerable<CellAddress> References() => []; }
    internal static Node Parse(string text, ReportFunctionCatalog catalog) => new Parser(text, catalog).Parse();
    private sealed class Parser(string text, ReportFunctionCatalog catalog)
    {
        private int at, nodes;
        private void Space() { while (at < text.Length && char.IsWhiteSpace(text[at])) at++; }
        private bool Take(char c) { Space(); if (at < text.Length && text[at] == c) { at++; return true; } return false; }
        private CellFormulaFault Error(string message) => new("FORMULA", at, message);
        private Node Count(Node n) { if (++nodes > 128) throw Error("公式超过128节点。"); return n; }
        public Node Parse()
        {
            if (text.Length is < 1 or > 512) throw Error("公式长度须为1–512字符。");
            var node = Expr(0); Space(); if (at != text.Length) throw Error("计算项之间缺运算符或包含不支持字符。"); return node;
        }
        private Node Expr(int depth)
        {
            var node = Product(depth + 1);
            while (true) { var start = at; if (Take('+')) node = Count(new Binary('+', node, Product(depth + 1), start)); else if (Take('-')) node = Count(new Binary('-', node, Product(depth + 1), start)); else return node; }
        }
        private Node Product(int depth)
        {
            var node = Atom(depth + 1);
            while (true) { var start = at; if (Take('*')) node = Count(new Binary('*', node, Atom(depth + 1), start)); else if (Take('/')) node = Count(new Binary('/', node, Atom(depth + 1), start)); else return node; }
        }
        private Node Atom(int depth)
        {
            if (depth > 32) throw Error("公式嵌套超过限制。");
            Space(); var start = at;
            if (Take('+')) return Count(new Unary(false, Atom(depth + 1), start));
            if (Take('-')) return Count(new Unary(true, Atom(depth + 1), start));
            if (Take('(')) { var n = Expr(depth + 1); if (!Take(')')) throw Error("括号不匹配。"); return n; }
            if (at < text.Length && (char.IsAsciiDigit(text[at]) || text[at] == '.'))
            {
                while (at < text.Length && (char.IsAsciiDigit(text[at]) || text[at] == '.')) at++;
                var literal = text[start..at];
                if (literal.Length > 30 || literal.Count(c => c == '.') > 1 || !literal.Any(char.IsAsciiDigit)) throw Error("十进制数无效或超长。");
                try { return Count(new Literal(R.ParseLiteral(literal), start)); }
                catch (ArithmeticException ex) { throw Error(ex.Message); }
            }
            if (at >= text.Length || !char.IsAsciiLetter(text[at])) throw Error("此处须为数值、单元格或受限函数。");
            while (at < text.Length && char.IsAsciiLetterOrDigit(text[at])) at++;
            var name = text[start..at].ToUpperInvariant();
            if (name.Any(char.IsAsciiDigit))
            {
                try { return Count(new Reference(CellAddress.Parse(name), start)); }
                catch (FormatException ex) { throw Error(ex.Message); }
            }
            if (!Take('(')) throw Error("函数缺左括号。");
            if (catalog.TryGet(name, out var measure))
            {
                var account = String(); var tree = false;
                if (Take(',')) { var mode = String(); tree = mode == "TREE"; if (!tree && mode != "EXACT") throw Error("汇总方式只能是 EXACT 或 TREE。"); }
                if (!Take(')')) throw Error("取数函数参数无效或缺右括号。");
                return Count(new Data(new(measure, account, tree), start));
            }
            if (name is not ("SUM" or "ABS" or "ROUND")) throw new CellFormulaFault("FUNCTION", start, "报表函数不存在或尚未验证语义。");
            var args = new List<Node>();
            if (!Take(')'))
            {
                do {
                    if (args.Count == 64) throw Error("函数参数超过64。");
                    var n = Expr(depth + 1);
                    if (Take(':'))
                    {
                        if (name != "SUM" || n is not Reference from) throw Error("矩形范围只允许在 SUM 中。");
                        var end = Atom(depth + 1);
                        if (end is not Reference to || from.Address.Row > to.Address.Row || from.Address.Column > to.Address.Column ||
                            (to.Address.Row - from.Address.Row + 1) * (to.Address.Column - from.Address.Column + 1) > 5000) throw Error("范围无效或超过5000格。");
                        n = Count(new Range(from.Address, to.Address, n.At));
                    }
                    args.Add(n);
                } while (Take(','));
                if (!Take(')')) throw Error("函数缺右括号。");
            }
            if ((name == "ABS" && args.Count != 1) || (name == "ROUND" && args.Count != 2) || (name == "SUM" && args.Count == 0)) throw Error("函数参数数量无效。");
            if (name == "ROUND" && (args[1] is not Literal p || !p.Value.IsInteger(0, 6))) throw Error("ROUND 精度须为0–6整数字面量。");
            return Count(new Call(name, args.ToArray(), start));
        }
        private string String()
        {
            if (!Take('"')) throw Error("取数参数须为双引号字符串。");
            var start = at; while (at < text.Length && text[at] != '"') { if (text[at] == '\\' || char.IsControl(text[at]) || at - start >= 40) throw Error("取数字符串无效。"); at++; }
            if (at == text.Length || at == start) throw Error("取数字符串为空或缺引号。");
            return text[start..at++];
        }
    }
}

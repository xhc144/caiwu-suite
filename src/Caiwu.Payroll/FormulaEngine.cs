using System.Globalization;

namespace Caiwu.Payroll;

/// <summary>Bounded arithmetic parser; never executes SQL, C#, reflection, or external code.</summary>
public static class FormulaEngine
{
    public static IReadOnlyList<string> GetCalculationOrder(IReadOnlyList<PayrollColumn> columns,
        IReadOnlyList<PayrollFormula> formulas) => Compile(columns, formulas).Select(f => f.Definition.TargetField).ToArray();

    public static Dictionary<string, decimal?> Calculate(IReadOnlyList<PayrollColumn> columns,
        IReadOnlyList<PayrollFormula> formulas, IReadOnlyDictionary<string, decimal?> inputs,
        PayrollTaxProfile? taxProfile = null, DateOnly month = default)
        => Calculate(Compile(columns, formulas), columns, inputs, taxProfile, month);

    internal static Dictionary<string, decimal?> Calculate(IReadOnlyList<CompiledFormula> compiled,
        IReadOnlyList<PayrollColumn> columns, IReadOnlyDictionary<string, decimal?> inputs,
        PayrollTaxProfile? taxProfile, DateOnly month)
    {
        var values = new Dictionary<string, decimal?>(inputs, StringComparer.Ordinal);
        var results = new Dictionary<string, decimal?>(StringComparer.Ordinal);
        decimal? Get(string field) => values.GetValueOrDefault(field);
        foreach (var formula in compiled)
        {
            var definition = formula.Definition;
            try
            {
                // Clear a target before evaluating so a false/null condition cannot reuse
                // last month's computed result or an old manually entered value.
                decimal? value = null;
                if (formula.Condition is null || formula.Condition.Evaluate(Get) is { } predicate && predicate != 0)
                {
                    value = formula.Expression.Evaluate(Get);
                    if (definition.IsTaxFormula)
                    {
                        Guard.Require(taxProfile is not null, "请先设置有明确出处和有效期的税参数。");
                        if (value is { } taxBase) value = taxProfile!.Calculate(taxBase, month);
                    }
                    if (value is { } amount)
                        value = decimal.Round(amount, columns.Single(c => c.FieldName == definition.TargetField).DecimalDigits,
                            MidpointRounding.AwayFromZero);
                }
                values[definition.TargetField] = results[definition.TargetField] = value;
            }
            catch (Exception error) when (error is DivideByZeroException or OverflowException or PayrollValidationException)
            {
                throw new PayrollValidationException($"公式“{definition.Name}”：{error.Message}");
            }
        }
        return results;
    }

    internal static List<CompiledFormula> Compile(IReadOnlyList<PayrollColumn> columns,
        IReadOnlyList<PayrollFormula> formulas)
    {
        Guard.Require(formulas.Count <= 256, "本切片最多支持 256 条公式。");
        var active = formulas.Where(f => f.Enabled).OrderBy(f => f.Order).ToArray();
        Guard.Require(active.Count(f => f.IsTaxFormula) <= 1, "计算个人所得税的公式只能有一条，请检查公式！");
        var numeric = columns.Where(c => c.Enabled && c.Kind == PayrollValueKind.Number)
            .Select(c => c.FieldName).ToHashSet(StringComparer.Ordinal);
        var byTarget = new Dictionary<string, CompiledFormula>(StringComparer.Ordinal);
        foreach (var formula in active)
        {
            Guard.Require(!string.IsNullOrWhiteSpace(formula.Name), "没有输入公式名！");
            Guard.Require(numeric.Contains(formula.TargetField), $"公式“{formula.Name}”的目标必须为启用的数值栏目。");
            Guard.Require(!byTarget.ContainsKey(formula.TargetField), $"栏目 {formula.TargetField} 有多个执行公式；本切片不支持重复目标。");
            var expression = new Parser(formula.Expression).Parse();
            var condition = string.IsNullOrWhiteSpace(formula.Condition) ? null : new Parser(formula.Condition).Parse();
            var dependencies = expression.Fields.Concat(condition?.Fields ?? []).ToHashSet(StringComparer.Ordinal);
            foreach (var field in dependencies)
                Guard.Require(numeric.Contains(field), $"公式“{formula.Name}”引用未知、停用或非数值栏目 {field}。");
            byTarget.Add(formula.TargetField, new(formula, expression, condition, dependencies));
        }
        var ordered = new List<CompiledFormula>();
        var visited = new HashSet<string>(StringComparer.Ordinal);
        var visiting = new HashSet<string>(StringComparer.Ordinal);
        void Visit(string target)
        {
            if (visited.Contains(target)) return;
            Guard.Require(visiting.Add(target), $"计算公式存在循环依赖：{target}。");
            var formula = byTarget[target];
            foreach (var dependency in formula.Dependencies.Order(StringComparer.Ordinal))
                if (byTarget.ContainsKey(dependency)) Visit(dependency);
            visiting.Remove(target);
            visited.Add(target);
            ordered.Add(formula);
        }
        foreach (var formula in active) Visit(formula.TargetField);
        return ordered;
    }

    internal sealed record CompiledFormula(PayrollFormula Definition, Node Expression, Node? Condition,
        HashSet<string> Dependencies);

    internal abstract record Node
    {
        public abstract decimal? Evaluate(Func<string, decimal?> get);
        public abstract IEnumerable<string> Fields { get; }
    }
    private sealed record Literal(decimal? Value) : Node
    {
        public override decimal? Evaluate(Func<string, decimal?> get) => Value;
        public override IEnumerable<string> Fields => [];
    }
    private sealed record Field(string Name) : Node
    {
        public override decimal? Evaluate(Func<string, decimal?> get) => get(Name);
        public override IEnumerable<string> Fields => [Name];
    }
    private sealed record Unary(string Operator, Node Child) : Node
    {
        public override IEnumerable<string> Fields => Child.Fields;
        public override decimal? Evaluate(Func<string, decimal?> get)
        {
            var value = Child.Evaluate(get);
            return Operator switch { "-" => -value, "+" => value, "NOT" => value is null ? null : value == 0 ? 1 : 0, _ => null };
        }
    }
    private sealed record Binary(string Operator, Node Left, Node Right) : Node
    {
        public override IEnumerable<string> Fields => Left.Fields.Concat(Right.Fields);
        public override decimal? Evaluate(Func<string, decimal?> get)
        {
            var left = Left.Evaluate(get);
            if (Operator == "AND" && left == 0) return 0;
            if (Operator == "OR" && left is not null && left != 0) return 1;
            var right = Right.Evaluate(get);
            if (Operator == "AND" && right == 0) return 0;
            if (Operator == "OR" && right is not null && right != 0) return 1;
            if (left is null || right is null) return null;
            return Operator switch
            {
                "+" => checked(left + right), "-" => checked(left - right), "*" => checked(left * right),
                "/" => left / right, "%" => left % right,
                "=" or "==" => left == right ? 1 : 0, "<>" or "!=" => left != right ? 1 : 0,
                "<" => left < right ? 1 : 0, ">" => left > right ? 1 : 0,
                "<=" => left <= right ? 1 : 0, ">=" => left >= right ? 1 : 0,
                "AND" => 1, "OR" => 0, _ => throw new PayrollValidationException("不支持的运算符。")
            };
        }
    }
    private sealed record Call(string Name, List<Node> Arguments) : Node
    {
        public override IEnumerable<string> Fields => Arguments.SelectMany(a => a.Fields);
        public override decimal? Evaluate(Func<string, decimal?> get)
        {
            if (Name == "IF") return Arguments[0].Evaluate(get) is { } condition && condition != 0
                ? Arguments[1].Evaluate(get) : Arguments[2].Evaluate(get);
            if (Name == "COALESCE")
            {
                foreach (var argument in Arguments) if (argument.Evaluate(get) is { } value) return value;
                return null;
            }
            var values = Arguments.Select(a => a.Evaluate(get)).ToArray();
            if (values.Any(v => v is null)) return null;
            var first = values[0]!.Value;
            if (Name == "ROUND")
            {
                var digits = values[1]!.Value;
                Guard.Require(digits is >= 0 and <= 28 && decimal.Truncate(digits) == digits, "ROUND 小数位必须是 0 至 28 的整数。");
                return decimal.Round(first, (int)digits, MidpointRounding.AwayFromZero);
            }
            return Name switch
            {
                "ABS" => Math.Abs(first), "MIN" => values.Min(), "MAX" => values.Max(),
                _ => throw new PayrollValidationException("不支持的函数。")
            };
        }
    }

    private sealed class Parser
    {
        private readonly string source;
        private int position, depth, nodes;
        private string token = "";
        public Parser(string source)
        {
            Guard.Require(!string.IsNullOrWhiteSpace(source) && source.Length <= 2048, "公式为空或超过 2048 字符。");
            this.source = source;
            Next();
        }
        public Node Parse()
        {
            var value = Or();
            Guard.Require(token == "", $"公式存在未识别内容（位置 {position}）。");
            return value;
        }
        private Node Count(Node node)
        {
            Guard.Require(++nodes <= 512, "公式节点超过 512 个。");
            return node;
        }
        private Node Or()
        {
            var left = And();
            while (token.Equals("OR", StringComparison.OrdinalIgnoreCase)) { Next(); left = Count(new Binary("OR", left, And())); }
            return left;
        }
        private Node And()
        {
            var left = Compare();
            while (token.Equals("AND", StringComparison.OrdinalIgnoreCase)) { Next(); left = Count(new Binary("AND", left, Compare())); }
            return left;
        }
        private Node Compare()
        {
            var left = Add();
            if (token is "=" or "==" or "<>" or "!=" or "<" or ">" or "<=" or ">=")
            { var op = token; Next(); left = Count(new Binary(op, left, Add())); }
            return left;
        }
        private Node Add()
        {
            var left = Multiply();
            while (token is "+" or "-") { var op = token; Next(); left = Count(new Binary(op, left, Multiply())); }
            return left;
        }
        private Node Multiply()
        {
            var left = UnaryValue();
            while (token is "*" or "/" or "%") { var op = token; Next(); left = Count(new Binary(op, left, UnaryValue())); }
            return left;
        }
        private Node UnaryValue()
        {
            Guard.Require(++depth <= 64, "公式嵌套超过 64 层。");
            try
            {
                if (token is "+" or "-" || token.Equals("NOT", StringComparison.OrdinalIgnoreCase))
                { var op = token.ToUpperInvariant(); Next(); return Count(new Unary(op, UnaryValue())); }
                return Primary();
            }
            finally { depth--; }
        }
        private Node Primary()
        {
            if (Take("(")) { var node = Or(); Expect(")"); return node; }
            var value = token;
            Guard.Require(value.Length > 0, "公式缺少数值或栏目。");
            Next();
            if (decimal.TryParse(value, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var number))
                return Count(new Literal(number));
            Guard.Require(char.IsLetter(value[0]) || value[0] == '_', "公式含无效数值或字符。");
            if (value.Equals("NULL", StringComparison.OrdinalIgnoreCase)) return Count(new Literal(null));
            if (value.Equals("TRUE", StringComparison.OrdinalIgnoreCase)) return Count(new Literal(1));
            if (value.Equals("FALSE", StringComparison.OrdinalIgnoreCase)) return Count(new Literal(0));
            if (!Take("(")) return Count(new Field(value));
            var name = value.ToUpperInvariant();
            Guard.Require(name is "ROUND" or "MIN" or "MAX" or "ABS" or "IF" or "COALESCE", $"本切片不支持函数 {value}，原公式应保留待适配。");
            var arguments = new List<Node>();
            if (!Take(")"))
            {
                do { arguments.Add(Or()); Guard.Require(arguments.Count <= 32, "函数参数过多。"); } while (Take(","));
                Expect(")");
            }
            Guard.Require(name switch
            {
                "ROUND" => arguments.Count == 2, "ABS" => arguments.Count == 1,
                "IF" => arguments.Count == 3, _ => arguments.Count >= 1
            }, $"函数 {value} 参数个数不符。");
            return Count(new Call(name, arguments));
        }
        private bool Take(string expected) { if (token != expected) return false; Next(); return true; }
        private void Expect(string expected) => Guard.Require(Take(expected), $"公式缺少 {expected}。");
        private void Next()
        {
            while (position < source.Length && char.IsWhiteSpace(source[position])) position++;
            if (position == source.Length) { token = ""; return; }
            var start = position;
            var ch = source[position++];
            if (char.IsLetter(ch) || ch == '_')
            {
                while (position < source.Length && (char.IsLetterOrDigit(source[position]) || source[position] == '_')) position++;
            }
            else if (char.IsAsciiDigit(ch) || ch == '.')
            {
                while (position < source.Length && (char.IsAsciiDigit(source[position]) || source[position] == '.')) position++;
            }
            else if (ch is '<' or '>' or '=' or '!')
            {
                if (position < source.Length && (source[position] == '=' || ch == '<' && source[position] == '>')) position++;
            }
            else Guard.Require(ch is '(' or ')' or ',' or '+' or '-' or '*' or '/' or '%', $"公式包含不支持的字符（位置 {start + 1}）。");
            token = source[start..position];
        }
    }
}

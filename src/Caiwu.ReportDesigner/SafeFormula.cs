using System.Globalization;
using System.Numerics;

namespace Caiwu.ReportDesigner;

/// <summary>Closed grammar. No runtime compilation, SQL, scripting, reflection, IO or user functions.</summary>
internal static class SafeFormula
{
    internal sealed class FormulaFault(int position, string message) : Exception(message)
    { public int Position { get; } = position + 1; }
    internal abstract record Node(int At)
    {
        public abstract Rational Eval(Func<string, Rational> field);
        public abstract IEnumerable<(string Key, int At)> References();
        public Rational Run(Func<string, Rational> field)
        {
            try { return Eval(field); }
            catch (FormulaFault) { throw; }
            catch (Exception ex) when (ex is ArithmeticException or ArgumentException)
            { throw new FormulaFault(At, ex.Message); }
        }
    }
    private sealed record Literal(Rational Value, int Start) : Node(Start)
    {
        public override Rational Eval(Func<string, Rational> field) => Value;
        public override IEnumerable<(string, int)> References() => [];
    }
    internal sealed record Reference(string Key, int Start) : Node(Start)
    {
        public override Rational Eval(Func<string, Rational> field) => field(Key);
        public override IEnumerable<(string, int)> References() => [(Key, At)];
    }
    private sealed record Unary(char Op, Node Child, int Start) : Node(Start)
    {
        public override Rational Eval(Func<string, Rational> field) => Op == '-' ? -Child.Run(field) : Child.Run(field);
        public override IEnumerable<(string, int)> References() => Child.References();
    }
    private sealed record Binary(char Op, Node Left, Node Right, int Start) : Node(Start)
    {
        public override Rational Eval(Func<string, Rational> field)
        {
            var a = Left.Run(field); var b = Right.Run(field);
            return Op switch { '+' => a + b, '-' => a - b, '*' => a * b, '/' => a / b, _ => throw new InvalidOperationException() };
        }
        public override IEnumerable<(string, int)> References() => Left.References().Concat(Right.References());
    }
    private sealed record Call(string Name, Node[] Args, int Start) : Node(Start)
    {
        public override Rational Eval(Func<string, Rational> field)
        {
            var a = Args.Select(n => n.Run(field)).ToArray();
            return Name switch {
                "SUM" => a.Aggregate(Rational.Zero, (x, y) => x + y),
                "ABS" => a[0].Abs(),
                "ROUND" => a[0].Round(a[1].Integer(0, 6)),
                _ => throw new InvalidOperationException()
            };
        }
        public override IEnumerable<(string, int)> References() => Args.SelectMany(n => n.References());
    }
    public static Node Parse(string expression) => new Parser(expression).Parse();
    private sealed class Parser(string text)
    {
        private int at, nodes;
        private void Space() { while (at < text.Length && char.IsWhiteSpace(text[at])) at++; }
        private bool Take(char c) { Space(); if (at < text.Length && text[at] == c) { at++; return true; } return false; }
        private FormulaFault Error(string message) => new(at, message);
        public Node Parse()
        {
            if (text.Length is < 1 or > 512) throw Error("公式长度须为1–512字符。");
            var n = Expr(0); Space(); if (at != text.Length) throw Error("意外字符；仅支持字段、十进制数、四则、SUM/ABS/ROUND。"); return n;
        }
        private Node Count(Node n) { if (++nodes > 128) throw Error("公式超过128节点。"); return n; }
        private Node Expr(int depth)
        {
            var n = Product(depth + 1);
            while (true) { Space(); var p = at; if (Take('+')) n = Count(new Binary('+', n, Product(depth + 1), p));
                else if (Take('-')) n = Count(new Binary('-', n, Product(depth + 1), p)); else return n; }
        }
        private Node Product(int depth)
        {
            var n = Atom(depth + 1);
            while (true) { Space(); var p = at; if (Take('*')) n = Count(new Binary('*', n, Atom(depth + 1), p));
                else if (Take('/')) n = Count(new Binary('/', n, Atom(depth + 1), p)); else return n; }
        }
        private Node Atom(int depth)
        {
            if (depth > 32) throw Error("公式嵌套超过限制。");
            Space(); var p = at;
            if (Take('+')) return Count(new Unary('+', Atom(depth + 1), p));
            if (Take('-')) return Count(new Unary('-', Atom(depth + 1), p));
            if (Take('(')) { var n = Expr(depth + 1); if (!Take(')')) throw Error("缺少右括号。"); return n; }
            if (Take('[')) {
                var start = at; while (at < text.Length && text[at] != ']') at++;
                if (at == text.Length) throw Error("字段缺少 ]。");
                var key = text[start..at++]; if (!TemplateRules.IsKey(key)) throw Error("字段键只能用ASCII字母数字及下划线。");
                return Count(new Reference(key, p));
            }
            if (at < text.Length && (char.IsAsciiDigit(text[at]) || text[at] == '.')) {
                var start = at; while (at < text.Length && (char.IsAsciiDigit(text[at]) || text[at] == '.')) at++;
                var literal = text[start..at];
                if (literal.Length > 30 || literal.Count(c => c == '.') > 1 || literal.Count(char.IsAsciiDigit) is < 1 or > 29 ||
                    (literal.Contains('.') && literal.Length - literal.IndexOf('.') - 1 > 28)) throw Error("无效或超精度十进制数。");
                try { return Count(new Literal(Rational.ParseLiteral(literal), p)); }
                catch (ArithmeticException ex) { throw new FormulaFault(p, ex.Message); }
            }
            if (at < text.Length && char.IsAsciiLetter(text[at])) {
                var start = at; while (at < text.Length && char.IsAsciiLetter(text[at])) at++;
                var name = text[start..at].ToUpperInvariant();
                if (name is not ("SUM" or "ABS" or "ROUND")) throw Error("仅允许SUM、ABS、ROUND函数。");
                if (!Take('(')) throw Error("函数缺少左括号。");
                var args = new List<Node>(); if (!Take(')')) {
                    do { if (args.Count == 16) throw Error("参数上限16。"); args.Add(Expr(depth + 1)); } while (Take(','));
                    if (!Take(')')) throw Error("函数缺少右括号。");
                }
                if ((name == "ABS" && args.Count != 1) || (name == "ROUND" && args.Count != 2) || (name == "SUM" && args.Count == 0)) throw Error("函数参数个数无效。");
                // ROUND precision must be a literal integer, never data-dependent.
                if (name == "ROUND" && (args[1] is not Literal l || !l.Value.IsInteger(0, 6))) throw Error("ROUND第二参数必须是0–6整数字面量。");
                return Count(new Call(name, args.ToArray(), p));
            }
            throw Error("此处须为数值、字段或受限函数。");
        }
    }
    /// <summary>Exact bounded intermediate arithmetic. Non-terminating/finer-than-decimal output requires explicit ROUND.</summary>
    internal readonly struct Rational
    {
        private readonly BigInteger numerator, denominator;
        public static Rational Zero => new(0, 1);
        private Rational(BigInteger n, BigInteger d)
        {
            if (d.IsZero) throw new DivideByZeroException("除数为0。");
            if (d.Sign < 0) { n = -n; d = -d; }
            var gcd = BigInteger.GreatestCommonDivisor(n, d); n /= gcd; d /= gcd;
            if (n.GetBitLength() > 512 || d.GetBitLength() > 512) throw new OverflowException("公式中间值超过512位复杂度限制。");
            numerator = n; denominator = d;
        }
        public static Rational FromDecimal(decimal d)
        {
            var bits = decimal.GetBits(d); var n = (BigInteger)(uint)bits[0] + ((BigInteger)(uint)bits[1] << 32) + ((BigInteger)(uint)bits[2] << 64);
            if (bits[3] < 0) n = -n;
            return new(n, BigInteger.Pow(10, (bits[3] >> 16) & 255));
        }
        public static Rational ParseLiteral(string text)
        {
            var dot = text.IndexOf('.');
            var scale = dot < 0 ? 0 : text.Length - dot - 1;
            var value = new Rational(BigInteger.Parse(text.Replace(".", "", StringComparison.Ordinal), CultureInfo.InvariantCulture), BigInteger.Pow(10, scale));
            _ = value.ToDecimal(); // Decimal.TryParse may silently round a 29-digit coefficient; do not use it here.
            return value;
        }
        public static Rational operator +(Rational a, Rational b) => new(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
        public static Rational operator -(Rational a) => new(-a.numerator, a.denominator);
        public static Rational operator -(Rational a, Rational b) => a + -b;
        public static Rational operator *(Rational a, Rational b) => new(a.numerator * b.numerator, a.denominator * b.denominator);
        public static Rational operator /(Rational a, Rational b) => new(a.numerator * b.denominator, a.denominator * b.numerator);
        public Rational Abs() => new(BigInteger.Abs(numerator), denominator);
        public bool IsInteger(int min, int max) => denominator.IsOne && numerator >= min && numerator <= max;
        public int Integer(int min, int max) => IsInteger(min, max) ? (int)numerator : throw new ArgumentException("整数参数超出范围。");
        public Rational Round(int digits)
        {
            var factor = BigInteger.Pow(10, digits); var scaled = numerator * factor;
            var q = BigInteger.DivRem(scaled, denominator, out var r);
            if (BigInteger.Abs(r) * 2 >= denominator) q += numerator.Sign;
            return new(q, factor);
        }
        public decimal ToDecimal()
        {
            var d = denominator; var twos = 0; var fives = 0;
            while (d % 2 == 0) { d /= 2; twos++; }
            while (d % 5 == 0) { d /= 5; fives++; }
            var scale = Math.Max(twos, fives);
            if (!d.IsOne || scale > 28) throw new ArithmeticException("结果不能精确表示为decimal；请显式使用ROUND(...,0–6)。");
            var n = BigInteger.Abs(numerator) * BigInteger.Pow(2, scale - twos) * BigInteger.Pow(5, scale - fives);
            if (n > (BigInteger.One << 96) - 1) throw new OverflowException("结果超过decimal精确范围；不静默损失小数。");
            return new decimal((int)(uint)(n & uint.MaxValue), (int)(uint)((n >> 32) & uint.MaxValue), (int)(uint)((n >> 64) & uint.MaxValue), numerator.Sign < 0, (byte)scale);
        }
    }
}

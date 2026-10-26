using System.Globalization;
using System.Numerics;
using System.Text.RegularExpressions;

namespace Caiwu.LegacyCompatibility;

/// <summary>
/// Exact arithmetic on invariant decimal literals, including a floating provider's round-trip
/// spelling. This is a preview arithmetic policy, not a claim about PB floating-point evaluation.
/// No currency rounding, decimal overflow/underflow, or tolerance is applied.
/// </summary>
public readonly partial struct ExactNumber : IEquatable<ExactNumber>
{
    private readonly BigInteger coefficient;
    private readonly int scale;
    public static ExactNumber Zero => default;

    private ExactNumber(BigInteger coefficient, int scale)
    {
        if (coefficient.IsZero) { this.coefficient = BigInteger.Zero; this.scale = 0; return; }
        while (scale > 0 && coefficient % 10 == 0) { coefficient /= 10; scale--; }
        this.coefficient = coefficient;
        this.scale = scale;
    }

    public static ExactNumber Parse(string value)
    {
        if (value.Length > 2048) throw new FormatException("numeric_literal_too_long");
        var match = Literal().Match(value);
        if (!match.Success) throw new FormatException("invalid_invariant_numeric_literal");
        var exponent = match.Groups[4].Success
            ? int.Parse(match.Groups[4].Value, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture) : 0;
        if (exponent is < -1000 or > 1000) throw new FormatException("numeric_exponent_out_of_range");
        var fraction = match.Groups[3].Value;
        var digits = match.Groups[2].Value + fraction;
        var number = BigInteger.Parse(digits, CultureInfo.InvariantCulture);
        if (match.Groups[1].Value == "-") number = -number;
        var scale = fraction.Length - exponent;
        if (scale < 0) { number *= BigInteger.Pow(10, -scale); scale = 0; }
        return new ExactNumber(number, scale);
    }

    public static ExactNumber operator +(ExactNumber a, ExactNumber b)
    {
        var scale = Math.Max(a.scale, b.scale);
        return new ExactNumber(a.coefficient * BigInteger.Pow(10, scale - a.scale)
            + b.coefficient * BigInteger.Pow(10, scale - b.scale), scale);
    }
    public static ExactNumber operator -(ExactNumber a, ExactNumber b) => a + new ExactNumber(-b.coefficient, b.scale);
    public bool Equals(ExactNumber other) => coefficient == other.coefficient && scale == other.scale;
    public override bool Equals(object? obj) => obj is ExactNumber value && Equals(value);
    public override int GetHashCode() => HashCode.Combine(coefficient, scale);
    public static bool operator ==(ExactNumber a, ExactNumber b) => a.Equals(b);
    public static bool operator !=(ExactNumber a, ExactNumber b) => !a.Equals(b);

    public override string ToString()
    {
        var sign = coefficient.Sign < 0 ? "-" : "";
        var digits = BigInteger.Abs(coefficient).ToString(CultureInfo.InvariantCulture);
        if (scale == 0) return sign + digits;
        digits = digits.PadLeft(scale + 1, '0');
        return sign + digits[..^scale] + "." + digits[^scale..];
    }

    [GeneratedRegex(@"\A([+-]?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]{1,4}))?\z", RegexOptions.CultureInvariant)]
    private static partial Regex Literal();
}

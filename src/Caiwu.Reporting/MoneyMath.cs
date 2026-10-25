using System.Numerics;

namespace Caiwu.Reporting;

internal static class MoneyMath
{
    // Decimal addition can round rather than throw when the integer part exhausts its 96-bit coefficient.
    // Check the result against exact integer cents so an accepted DTO can never silently lose a cent in totals.
    internal static decimal Add(decimal left, decimal right)
    {
        var sum = left + right;
        if (Cents(sum) != Cents(left) + Cents(right))
            throw new OverflowException("金额合计超出 decimal 可精确表示的分值范围。");
        return sum;
    }

    private static BigInteger Cents(decimal value)
    {
        if (decimal.Round(value, 2) != value)
            throw new ArgumentException("报表金额不能含分以下精度。", nameof(value));
        var bits = decimal.GetBits(value);
        var coefficient = (new BigInteger((uint)bits[2]) << 64) |
            (new BigInteger((uint)bits[1]) << 32) | new BigInteger((uint)bits[0]);
        var scale = (bits[3] >> 16) & 0xff;
        var cents = scale <= 2 ? coefficient * BigInteger.Pow(10, 2 - scale) :
            coefficient / BigInteger.Pow(10, scale - 2);
        return bits[3] < 0 ? -cents : cents;
    }
}

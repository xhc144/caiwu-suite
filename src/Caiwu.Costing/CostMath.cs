using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Numerics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Caiwu.Costing;

internal static class CostMath
{
    internal const decimal MaximumAmount = long.MaxValue / 100m;
    internal const decimal MaximumQuantity = 1_000_000_000m;

    internal static void Require([DoesNotReturnIf(false)] bool condition, string message)
    {
        if (!condition) throw new CostingValidationException(message);
    }

    internal static void Text(string value, string label) => Require(!string.IsNullOrWhiteSpace(value) &&
        value == value.Trim() && !value.Any(char.IsControl), $"{label}须为非空、无首尾空白及控制字符的文本。");

    internal static void Period(CostPeriod period)
    {
        Require(period is not null && period.Year is >= 1 and <= 9999 && period.Month is >= 1 and <= 12, "成本期间无效。");
    }

    internal static void Date(CostPeriod period, DateOnly date) => Require(date.Year == period.Year && date.Month == period.Month,
        "首版只支持一个月期间，不支持跨期业务、跨期退货或自动结转。");

    internal static void Money(decimal amount) => Require(amount >= 0 && amount <= MaximumAmount &&
        decimal.Round(amount, 2) == amount, "金额须非负、最多两位小数，且在Int64分范围内。");

    internal static void Quantity(decimal quantity, bool zeroAllowed = false) => Require(
        quantity >= 0 && (zeroAllowed || quantity > 0) && quantity <= MaximumQuantity && decimal.Round(quantity, 4) == quantity,
        "数量/工时须在0至十亿之间、最多四位小数；本项要求正数时不能为零。");

    internal static void Price(decimal price) => Require(price >= 0 && price <= MaximumQuantity && decimal.Round(price, 6) == price,
        "采购单价须非负、不超过十亿，最多六位小数。");

    internal static void Position(StockPosition p)
    {
        Require(p is not null, "库存余额不能为空。");
        Quantity(p.Quantity, true); Money(p.Cost);
        Require(p.Quantity != 0 || p.Cost == 0, "零数量库存不能保留成本余额。");
    }

    internal static long Cents(decimal value) { Money(value); return decimal.ToInt64(value * 100m); }
    internal static long Units(decimal value) { Quantity(value, true); return decimal.ToInt64(value * 10000m); }

    private static decimal RoundedCents(BigInteger numerator, BigInteger denominator)
    {
        var quotient = BigInteger.DivRem(numerator, denominator, out var remainder);
        if (remainder * 2 >= denominator) quotient++;
        Require(quotient >= 0 && quotient <= long.MaxValue, "计算金额超出Int64分范围。");
        return (decimal)quotient / 100m;
    }

    internal static decimal PurchaseAmount(decimal quantity, decimal price)
    {
        Quantity(quantity); Price(price);
        // Quantity has 4 places, price has 6: convert their product directly to cents.
        return RoundedCents((BigInteger)Units(quantity) * decimal.ToInt64(price * 1_000_000m), 100_000_000);
    }

    internal static decimal Share(decimal cost, decimal quantity, decimal totalQuantity)
    {
        Require(totalQuantity > 0 && quantity >= 0 && quantity <= totalQuantity, "成本分摊数量无效。");
        return RoundedCents((BigInteger)Cents(cost) * Units(quantity), Units(totalQuantity));
    }

    internal static IReadOnlyDictionary<string, decimal> Allocate(decimal pool, IReadOnlyList<(string Key, decimal Basis)> targets)
    {
        Money(pool);
        var weights = targets.Select(t => (t.Key, Units(t.Basis))).ToArray();
        var total = weights.Aggregate(BigInteger.Zero, (sum, t) => sum + t.Item2);
        Require(pool == 0 || total > 0, "费用池非零但分配基数合计为零，不能分配。");
        if (pool == 0) return weights.ToDictionary(t => t.Key, _ => 0m, StringComparer.Ordinal);
        var cents = Cents(pool);
        var parts = weights.Select(t =>
        {
            var whole = BigInteger.DivRem((BigInteger)cents * t.Item2, total, out var remainder);
            return (t.Key, Cents: (long)whole, Remainder: remainder);
        }).ToArray();
        var left = cents - parts.Sum(p => p.Cents);
        var bonuses = parts.OrderByDescending(p => p.Remainder).ThenBy(p => p.Key, StringComparer.Ordinal)
            .Take(checked((int)left)).Select(p => p.Key).ToHashSet(StringComparer.Ordinal);
        return parts.ToDictionary(p => p.Key, p => (p.Cents + (bonuses.Contains(p.Key) ? 1m : 0m)) / 100m, StringComparer.Ordinal);
    }

    private sealed class CanonicalDecimal : JsonConverter<decimal>
    {
        public override decimal Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options) => reader.GetDecimal();
        public override void Write(Utf8JsonWriter writer, decimal value, JsonSerializerOptions options) =>
            writer.WriteRawValue(value.ToString("G29", CultureInfo.InvariantCulture));
    }
    private static readonly JsonSerializerOptions HashOptions = new() { Converters = { new CanonicalDecimal() } };
    internal static string Fingerprint(object value, string? domain = null) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
        (domain ?? value.GetType().FullName) + ":" + JsonSerializer.Serialize(value, value.GetType(), HashOptions))));

    internal static IReadOnlyList<T> ReadOnly<T>(IEnumerable<T> values) => Array.AsReadOnly(values.ToArray());

    internal static IReadOnlyList<PendingCostVoucher> Suggest(Guid inventoryId, CostVoucherOrigin origin, Guid id, DateOnly date, string summary, params CostVoucherLine[] lines)
    {
        lines = lines.Where(l => l.Debit != 0 || l.Credit != 0).ToArray();
        foreach (var line in lines)
        {
            Money(line.Debit); Money(line.Credit);
            Require(line.Debit == 0 || line.Credit == 0, "凭证建议同一行不能借贷同填。");
        }
        Require(lines.Sum(l => l.Debit) == lines.Sum(l => l.Credit), "凭证建议借贷不平衡。");
        return lines.Length == 0 ? ReadOnly<PendingCostVoucher>([]) :
            ReadOnly([new PendingCostVoucher(inventoryId, origin, id, date, summary, CostVoucherStatus.PendingAccountingReview, ReadOnly(lines))]);
    }
}

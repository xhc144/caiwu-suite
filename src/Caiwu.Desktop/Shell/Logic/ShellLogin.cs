using System.Globalization;

namespace Caiwu.Desktop.Shell;

public sealed record ShellBookChoice(string Path, string Name, string Code = "")
{
    public string Display => string.IsNullOrEmpty(Code) ? Name : $"{Code}  {Name}";
}

public static class ShellLogin
{
    public static DateOnly ParseDate(string text)
    {
        if (!DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
            throw new ArgumentException("登录日期请输入有效的 yyyy-MM-dd 日期。");
        return date;
    }
    public static void ValidateDate(DateOnly date, int fiscalYear, int startMonth)
    {
        if (date < new DateOnly(fiscalYear, startMonth, 1))
            throw new ArgumentException("登录日期不能早于开账日期。");
        if (date.Year != fiscalYear)
            throw new ArgumentException("当前账套服务尚未接入跨年度操作，请选择该账套年度内的登录日期。");
    }
    public static IReadOnlyList<ShellBookChoice> Search(IEnumerable<ShellBookChoice> books, string text) => books
        .Where(b => string.IsNullOrWhiteSpace(text) || b.Display.Contains(text.Trim(), StringComparison.OrdinalIgnoreCase))
        .OrderBy(b => b.Code, StringComparer.Ordinal).ThenBy(b => b.Name, StringComparer.Ordinal).ToArray();
}

using System.Text;

namespace Caiwu.Operators;

internal static class OperatorRules
{
    internal const OperatorRoles AllRoles = OperatorRoles.Administrator | OperatorRoles.Preparer |
        OperatorRoles.Reviewer | OperatorRoles.Poster | OperatorRoles.PeriodCloser | OperatorRoles.Accountant | OperatorRoles.Reader;
    internal static string ActorKey(Guid id) => "operator:" + id.ToString("N");
    internal static string Login(string? value)
    {
        var result = (value ?? "").Trim().Normalize(NormalizationForm.FormKC).ToUpperInvariant();
        if (result.Length is < 3 or > 64 || !result.All(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '_' or '-'))
            throw new OperatorValidationException("登录名须为3–64位英文字母、数字、点、下划线或短横线。");
        return result;
    }
    internal static string Display(string? value)
    {
        var result = (value ?? "").Trim().Normalize(NormalizationForm.FormKC);
        if (result.Length is < 1 or > 80 || result.Any(char.IsControl))
            throw new OperatorValidationException("显示名须为1–80个字符，不能含控制字符。");
        return result;
    }
    internal static void Password(string? value)
    {
        if (value is null || value.Length is < 12 or > 128 || string.IsNullOrWhiteSpace(value))
            throw new OperatorValidationException("密码须为12–128个字符，不能全为空白。");
    }
    internal static void Roles(OperatorRoles roles)
    {
        if (roles == OperatorRoles.None || (roles & ~AllRoles) != 0)
            throw new OperatorValidationException("请选择至少一个有效角色。");
    }
    internal static bool Allows(OperatorRoles roles, OperatorPermission permission) => permission switch
    {
        OperatorPermission.ReadLedger => roles != OperatorRoles.None,
        OperatorPermission.ManageOperators => roles.HasFlag(OperatorRoles.Administrator),
        OperatorPermission.EditAccounts or OperatorPermission.EditOpeningBalances => roles.HasFlag(OperatorRoles.Accountant),
        OperatorPermission.PrepareVoucher => roles.HasFlag(OperatorRoles.Preparer),
        OperatorPermission.ReviewVoucher => roles.HasFlag(OperatorRoles.Reviewer),
        OperatorPermission.PostVoucher => roles.HasFlag(OperatorRoles.Poster),
        OperatorPermission.ClosePeriod => roles.HasFlag(OperatorRoles.PeriodCloser),
        OperatorPermission.BackupLedger => roles.HasFlag(OperatorRoles.Accountant),
        OperatorPermission.RestoreLedger => roles.HasFlag(OperatorRoles.Administrator),
        _ => false
    };
}

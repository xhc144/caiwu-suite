namespace Caiwu.Operators;

public sealed record ParityModuleWriteGrant(string ModuleId, OperatorPermission SavePermission);

/// <summary>Immutable composition-root allowlist. No implicit write permission for unknown modules.</summary>
public sealed class ParityModuleWritePolicy
{
    private readonly Dictionary<string, OperatorPermission> grants = new(StringComparer.Ordinal);
    public ParityModuleWritePolicy(IEnumerable<ParityModuleWriteGrant> configured)
    {
        ArgumentNullException.ThrowIfNull(configured);
        foreach (var grant in configured)
        {
            if (grant is null || string.IsNullOrWhiteSpace(grant.ModuleId) || grant.ModuleId.Length > 80 ||
                !grant.ModuleId.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.') ||
                grant.SavePermission is not (OperatorPermission.PrepareVoucher or OperatorPermission.EditAccounts or
                    OperatorPermission.EditOpeningBalances or OperatorPermission.RestoreLedger or OperatorPermission.ClosePeriod))
                throw new ArgumentException("模块必须指定稳定标识及明确业务写权限；读取/备份权限不能用于写入。", nameof(configured));
            if (!grants.TryAdd(grant.ModuleId, grant.SavePermission)) throw new ArgumentException("模块写权限重复配置。", nameof(configured));
        }
    }
    public OperatorPermission RequiredPermission(string moduleId) => moduleId is not null && grants.TryGetValue(moduleId, out var permission)
        ? permission : throw new OperatorAuthorizationException("该模块尚未配置明确的写入权限，不能保存或生成凭证。");
}

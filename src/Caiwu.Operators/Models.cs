namespace Caiwu.Operators;

[Flags]
public enum OperatorRoles
{
    None = 0, Administrator = 1, Preparer = 2, Reviewer = 4,
    Poster = 8, PeriodCloser = 16, Accountant = 32, Reader = 64
}

public enum OperatorPermission
{
    ReadLedger, ManageOperators, EditAccounts, EditOpeningBalances,
    PrepareVoucher, ReviewVoucher, PostVoucher, ClosePeriod, BackupLedger, RestoreLedger
}

public sealed record OperatorIdentity(Guid Id, string ActorKey, string LoginName,
    string DisplayName, OperatorRoles Roles, bool IsEnabled);
public sealed record OperatorDirectory(long Revision, Guid StoreId, IReadOnlyList<OperatorIdentity> Operators);

// Only this service can issue sessions; the public identity is never an authorization credential.
public sealed class OperatorSession
{
    internal OperatorSession(Guid token, OperatorIdentity identity, DateTimeOffset expiresAt)
        => (Token, Identity, ExpiresAt) = (token, identity, expiresAt);
    internal Guid Token { get; }
    public OperatorIdentity Identity { get; }
    public DateTimeOffset ExpiresAt { get; }
}

public class OperatorException(string message) : Exception(message);
public sealed class OperatorValidationException(string message) : OperatorException(message);
public sealed class OperatorAuthorizationException(string message) : OperatorException(message);
public sealed class OperatorConcurrencyException() : OperatorException("操作员资料已更新，请刷新后重新提交。");
public sealed class OperatorStorageException(string message) : OperatorException(message);

internal sealed record StoredOperator(Guid Id, string ActorKey, string LoginName, string DisplayName,
    OperatorRoles Roles, bool IsEnabled, string PasswordHash, Guid SecurityStamp, string[] ReservedDisplayNames)
{
    [System.Text.Json.Serialization.JsonIgnore]
    public OperatorIdentity Identity => new(Id, ActorKey, LoginName, DisplayName, Roles, IsEnabled);
}
internal sealed record StoreDocument(int SchemaVersion, Guid StoreId, long Revision, StoredOperator[] Operators);

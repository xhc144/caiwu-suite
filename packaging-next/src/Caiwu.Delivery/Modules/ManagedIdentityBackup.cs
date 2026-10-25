using Caiwu.Operators;

namespace Caiwu.Delivery.Modules;
public sealed record IdentityBackupReceipt(int FormatVersion, string BackupPath, string Sha256, bool ContainsPasswordHashes, string RecoveryBoundary = "Recovery creates a separate new identity directory. Book restore never replaces global users, passwords or enabled states.");
/// <summary>Explicitly separate from book backup. Original Operators methods enforce live administrator authorization.</summary>
public sealed class ManagedIdentityBackup(ManagedDataSession data, LocalOperatorService operators)
{
    public IdentityBackupReceipt Backup(OperatorSession administrator)
    {
        // Never take the data monitor while waiting for the identity lock. Other host operations
        // legitimately hold Operators.Execute through a synchronous managed-data action.
        operators.RequirePermission(administrator, OperatorPermission.ManageOperators);
        using var lease = data.AcquireOperationLease();
        var path = data.Execute(() =>
        {
            var root = SafePaths.Child(data.DataRoot, ".delivery-backups/identities");
            Directory.CreateDirectory(root);
            return SafePaths.Child(root, Guid.NewGuid().ToString("N") + ".json");
        });
        operators.BackupOperators(administrator, path); // Rechecks authorization while holding the original module lock.
        // Do not parse or log the envelope (it contains password hashes).
        return new IdentityBackupReceipt(1, path, PayloadManifest.Hash(path), true);
    }

    public string RestoreToNewDirectory(OperatorSession administrator, IdentityBackupReceipt receipt)
    {
        operators.RequirePermission(administrator, OperatorPermission.ManageOperators);
        using var lease = data.AcquireOperationLease();
        var paths = data.Execute(() =>
        {
            var root = SafePaths.Child(data.DataRoot, ".delivery-backups/identities");
            var source = SafePaths.Full(receipt.BackupPath);
            if (receipt.FormatVersion != 1 || !receipt.ContainsPasswordHashes || !SafePaths.Contains(root, source) || PayloadManifest.Hash(source) != receipt.Sha256)
                throw new InvalidDataException("Identity backup receipt/checksum mismatch.");
            var recoveryRoot = SafePaths.Child(data.DataRoot, "Global/IdentityRecovery");
            Directory.CreateDirectory(recoveryRoot);
            return (Source: source, Destination: SafePaths.Child(recoveryRoot, Guid.NewGuid().ToString("N")));
        });
        try
        {
            operators.RestoreOperatorsToNewDirectory(administrator, paths.Source, paths.Destination);
        }
        catch (Exception ex) when (ex is not OperatorAuthorizationException)
        {
            throw new IOException("Identity recovery did not complete at " + paths.Destination + "; preserve any partial recovery. The active identity directory was not replaced.", ex);
        }

        return paths.Destination;
    }
}

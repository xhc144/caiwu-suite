using System.Text.Json;
using System.Text.Json.Serialization;

namespace Caiwu.Operators;

/// <summary>Local identity store, separate from every accounting book. Host supplies a protected user-data directory.</summary>
public sealed class FileOperatorStore
{
    private readonly string _directory, _path, _marker, _lockPath;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };
    public FileOperatorStore(string userDataDirectory)
    {
        if (!Path.IsPathFullyQualified(userDataDirectory))
            throw new ArgumentException("必须指定绝对用户数据目录。", nameof(userDataDirectory));
        _directory = Path.GetFullPath(userDataDirectory);
        var install = Path.TrimEndingDirectorySeparator(Path.GetFullPath(AppContext.BaseDirectory));
        if (string.Equals(Path.TrimEndingDirectorySeparator(_directory), install, StringComparison.OrdinalIgnoreCase) ||
            _directory.StartsWith(install + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("操作员文件不能放在安装目录。", nameof(userDataDirectory));
        _path = Path.Combine(_directory, "operators.json");
        _marker = Path.Combine(_directory, "operators.initialized");
        _lockPath = Path.Combine(_directory, "operators.lock");
    }
    public string DataFilePath => _path;

    internal T Access<T>(Func<StoreDocument?, T> action)
    {
        try
        {
            Directory.CreateDirectory(_directory);
            using var fileLock = OpenPrivate(_lockPath, FileMode.OpenOrCreate);
            return action(ReadLocked());
        }
        catch (OperatorException) { throw; }
        catch (JsonException) { throw Corrupt(); }
        catch (IOException) { throw new OperatorStorageException("操作员存储不可用或正被其他进程使用；请检查目录并重试。"); }
        catch (UnauthorizedAccessException) { throw new OperatorStorageException("无权访问操作员数据目录。"); }
    }

    private StoreDocument? ReadLocked()
    {
        if (Directory.Exists(_path) || Directory.Exists(_marker)) throw Corrupt();
        var hasData = File.Exists(_path); var hasMarker = File.Exists(_marker);
        if (!hasData && !hasMarker) return null;
        if (!hasData || !hasMarker) throw Corrupt();
        if (new FileInfo(_path).Length > 4 * 1024 * 1024 || new FileInfo(_marker).Length > 128) throw Corrupt();
        var bytes = File.ReadAllBytes(_path);
        if (bytes.Length > 4 * 1024 * 1024) throw Corrupt();
        var doc = JsonSerializer.Deserialize<StoreDocument>(bytes, JsonOptions) ?? throw Corrupt();
        if (!Guid.TryParse(File.ReadAllText(_marker), out var markerId) || markerId != doc.StoreId) throw Corrupt();
        Validate(doc);
        return doc;
    }

    internal void WriteLocked(StoreDocument? before, StoreDocument next, long expectedRevision)
    {
        if ((before?.Revision ?? 0) != expectedRevision) throw new OperatorConcurrencyException();
        if (next.Revision != checked(expectedRevision + 1) || (before is not null && before.StoreId != next.StoreId))
            throw new OperatorValidationException("存储版本不连续。");
        Validate(next);
        var encoded = Encode(next);
        var temporary = Path.Combine(_directory, ".operators-" + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            WritePrivate(temporary, encoded);
            if (before is null)
            {
                // Mark first: interruption fails closed, never offers a replacement administrator.
                WritePrivate(_marker, System.Text.Encoding.UTF8.GetBytes(next.StoreId.ToString("D")));
                File.Move(temporary, _path, false);
            }
            else File.Replace(temporary, _path, null);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    internal void BackupLocked(StoreDocument doc, string destination)
    {
        if (!Path.IsPathFullyQualified(destination)) throw new OperatorValidationException("备份必须指定绝对路径。");
        var target = Path.GetFullPath(destination);
        if (string.Equals(target, _path, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(target, _marker, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(target, _lockPath, StringComparison.OrdinalIgnoreCase))
            throw new OperatorValidationException("备份不能覆盖操作员存储。");
        // One consistent envelope preserves both identities and the initialization marker value.
        var temp = Path.Combine(Path.GetDirectoryName(target)!, ".operators-backup-" + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            WritePrivate(temp, Encode(doc));
            File.Move(temp, target, false);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }

    internal static void RestoreBackupToNewDirectory(string backupPath, string newUserDataDirectory)
    {
        if (!Path.IsPathFullyQualified(backupPath) || !Path.IsPathFullyQualified(newUserDataDirectory))
            throw new OperatorValidationException("恢复源与目标须为绝对路径。");
        if (Directory.Exists(newUserDataDirectory) || File.Exists(newUserDataDirectory))
            throw new OperatorValidationException("恢复必须使用尚不存在的新用户数据目录，不能覆盖现有身份。");
        if (!File.Exists(backupPath) || new FileInfo(backupPath).Length > 4 * 1024 * 1024)
            throw new OperatorValidationException("备份不存在或超出支持大小。");
        var doc = JsonSerializer.Deserialize<StoreDocument>(File.ReadAllBytes(backupPath), JsonOptions) ?? throw Corrupt();
        Validate(doc);
        var encoded = Encode(doc);
        var target = new FileOperatorStore(newUserDataDirectory);
        target.Access<object?>(existing =>
        {
            if (existing is not null) throw new OperatorValidationException("目标已存在操作员资料。");
            // Preserve revision, store ID, password hashes and every disabled identity. Never repair in place.
            var temp = Path.Combine(target._directory, ".operators-" + Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                WritePrivate(temp, encoded);
                WritePrivate(target._marker, System.Text.Encoding.UTF8.GetBytes(doc.StoreId.ToString("D")));
                File.Move(temp, target._path, false);
            }
            finally { if (File.Exists(temp)) File.Delete(temp); }
            return null;
        });
    }

    private static FileStream OpenPrivate(string path, FileMode mode)
    {
        var options = new FileStreamOptions { Mode = mode, Access = FileAccess.ReadWrite, Share = FileShare.None };
        if (!OperatingSystem.IsWindows()) options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
        return new(path, options);
    }
    private static void WritePrivate(string path, byte[] data)
    {
        using var stream = OpenPrivate(path, FileMode.CreateNew);
        stream.Write(data); stream.Flush(flushToDisk: true);
    }
    private static byte[] Encode(StoreDocument doc)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(doc, JsonOptions);
        if (bytes.Length > 4 * 1024 * 1024)
            throw new OperatorValidationException("操作员存储已达支持大小上限；未保存，请联系管理员。");
        return bytes;
    }
    private static OperatorStorageException Corrupt() => new("操作员文件损坏、不完整或版本不受支持；已拒绝登录和重新初始化。请保留文件并联系管理员从已核实备份恢复。");
    private static void Validate(StoreDocument doc)
    {
        if (doc.SchemaVersion != 1 || doc.StoreId == Guid.Empty || doc.Revision < 1 ||
            doc.Operators is null || doc.Operators.Length is < 1 or > 1000) throw Corrupt();
        var ids = new HashSet<Guid>(); var logins = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var displays = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var op in doc.Operators)
        {
            if (op is null || op.Id == Guid.Empty || !ids.Add(op.Id) || op.ActorKey != OperatorRules.ActorKey(op.Id) ||
                op.SecurityStamp == Guid.Empty || string.IsNullOrEmpty(op.PasswordHash) || op.PasswordHash.Length > 512) throw Corrupt();
            try
            {
                if (OperatorRules.Login(op.LoginName) != op.LoginName || OperatorRules.Display(op.DisplayName) != op.DisplayName ||
                    !logins.Add(op.LoginName) || op.ReservedDisplayNames is null || op.ReservedDisplayNames.Length is < 1 or > 1000 ||
                    !op.ReservedDisplayNames.Contains(op.DisplayName, StringComparer.OrdinalIgnoreCase)) throw Corrupt();
                foreach (var name in op.ReservedDisplayNames)
                    if (OperatorRules.Display(name) != name || !displays.Add(name)) throw Corrupt();
                OperatorRules.Roles(op.Roles);
                var hash = Convert.FromBase64String(op.PasswordHash);
                if (hash.Length != 61 || hash[0] != 1) throw Corrupt();
                // Validate the official V3 envelope, not the password algorithm. Bound corrupt work factors.
                var prf = System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(hash.AsSpan(1, 4));
                var iterations = System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(hash.AsSpan(5, 4));
                var saltLength = System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(hash.AsSpan(9, 4));
                if (prf is not (1 or 2) || iterations is < 1 or > 2_000_000 || saltLength != 16) throw Corrupt();
            }
            catch (Exception ex) when (ex is OperatorValidationException or FormatException or ArgumentException) { throw Corrupt(); }
        }
        if (!doc.Operators.Any(x => x.IsEnabled && x.Roles.HasFlag(OperatorRoles.Administrator))) throw Corrupt();
    }
}

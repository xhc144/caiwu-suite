namespace Caiwu.BookTools;

internal static class CopyPaths
{
    internal static string ExistingSource(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        var resolved = Resolve(Path.GetFullPath(path));
        if (!File.Exists(resolved)) throw new FileNotFoundException("源账套不存在。", resolved);
        return resolved;
    }

    internal static string NewDestination(string source, string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        var full = Path.GetFullPath(path);
        if (Exists(full)) throw new IOException("目标已存在，不能覆盖已有文件或链接。");
        var resolved = Resolve(full);
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        foreach (var suffix in new[] { "", "-wal", "-shm", "-journal" })
            if (string.Equals(source + suffix, resolved, comparison))
                throw new IOException("目标不能是源账套或其 SQLite 日志。");
        if (!resolved.EndsWith(".caiwu", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("新账套目标必须使用 .caiwu 扩展名。", nameof(path));
        if (!Directory.Exists(Path.GetDirectoryName(resolved))) throw new DirectoryNotFoundException("目标目录不存在。");
        foreach (var suffix in new[] { "", "-wal", "-shm", "-journal" })
            if (Exists(resolved + suffix)) throw new IOException("目标或其 SQLite 日志已存在，请选择全新路径。");
        return resolved;
    }

    private static bool Exists(string path) => Path.Exists(path) || new FileInfo(path).LinkTarget is not null;

    private static string Resolve(string full)
    {
        var root = Path.GetPathRoot(full)!;
        var current = root;
        foreach (var part in full[root.Length..].Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, part);
            FileSystemInfo entry = Directory.Exists(current) ? new DirectoryInfo(current) : new FileInfo(current);
            if (entry.LinkTarget is not null)
                current = entry.ResolveLinkTarget(true)?.FullName ?? throw new IOException("无法解析路径链接。");
        }
        return current;
    }
}

namespace Caiwu.Delivery;

public static class SafePaths
{
    public static string Full(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        var windowsPath = path.Replace('/', '\\');
        if (windowsPath.StartsWith(@"\\?\", StringComparison.Ordinal) || windowsPath.StartsWith(@"\\.\", StringComparison.Ordinal) ||
            windowsPath.StartsWith(@"\??\", StringComparison.Ordinal))
            throw new InvalidDataException("Windows device and extended namespace aliases are not accepted as managed paths.");
        var result = Path.GetFullPath(path);
        if (result == Path.GetPathRoot(result)) throw new InvalidDataException("A filesystem root is not an installation/data directory.");
        RejectLinks(result);
        return result.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    }

    // Use Windows comparisons even on Linux so an artifact cannot gain aliases after delivery.
    public static bool Contains(string root, string path) =>
        path.Equals(root, StringComparison.OrdinalIgnoreCase) ||
        path.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);

    public static void RequireSeparateRoots(string install, string data)
    {
        install = Full(install); data = Full(data);
        if (Contains(install, data) || Contains(data, install))
            throw new InvalidDataException("Program and ledger directories must be separate, non-nested directories.");
    }

    public static string Child(string root, string relative)
    {
        root = Full(root);
        var parts = relative.Replace('\\', '/').Split('/');
        if (parts.Length == 0 || parts.Any(p => p.Length == 0 || p is "." or ".." ||
            p.EndsWith(' ') || p.EndsWith('.') || p.Any(c => c < 32 || "<>:\"|?*".Contains(c)) ||
            new[] { "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9" }
                .Contains(p.Split('.')[0], StringComparer.OrdinalIgnoreCase)))
            throw new InvalidDataException("Unsafe relative Windows path.");
        var result = Full(Path.Combine([root, .. parts]));
        if (!Contains(root, result) || result.Equals(root, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Path escapes its owner directory.");
        return result;
    }

    public static void RejectLinks(string path)
    {
        for (FileSystemInfo? item = Directory.Exists(path) ? new DirectoryInfo(Path.GetFullPath(path)) : new FileInfo(Path.GetFullPath(path)); item != null; item = Directory.GetParent(item.FullName))
        {
            // File.Exists is false for dangling links. LinkTarget must be checked as well.
            if (item.LinkTarget != null || (item.Exists && (item.Attributes & FileAttributes.ReparsePoint) != 0))
                throw new InvalidDataException("Symbolic links and reparse points are not allowed in managed paths.");
        }
    }

    public static IEnumerable<string> Files(string root)
    {
        RejectLinks(root);
        foreach (var item in Directory.EnumerateFileSystemEntries(root).Order(StringComparer.Ordinal))
        {
            RejectLinks(item);
            if (Directory.Exists(item)) foreach (var file in Files(item)) yield return file;
            else yield return item;
        }
    }
}

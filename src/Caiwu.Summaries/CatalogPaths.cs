namespace Caiwu.Summaries;

/// <summary>The host must supply an absolute user-data root and an absolute per-book JSON path.</summary>
public sealed class SummaryCatalogLocation
{
    public string UserDataRoot { get; }
    public string CatalogPath { get; }
    public Guid BookId { get; }

    public SummaryCatalogLocation(string userDataRoot, string catalogPath, Guid bookId)
    {
        if (bookId == Guid.Empty) throw new ArgumentException("账套标识不能为空。", nameof(bookId));
        UserDataRoot = Absolute(userDataRoot);
        if (Path.GetPathRoot(UserDataRoot) == UserDataRoot)
            throw new ArgumentException("用户数据根不能是磁盘或文件系统根。", nameof(userDataRoot));
        BookId = bookId;
        CatalogPath = WithinRoot(catalogPath);
    }

    internal string WithinRoot(string path)
    {
        var full = Absolute(path);
        var relative = Path.GetRelativePath(UserDataRoot, full);
        if (relative == "." || relative == ".." || relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal) || Path.IsPathRooted(relative))
            throw new ArgumentException("摘要文件必须位于宿主提供的用户数据根内。", nameof(path));
        var fromApplication = Path.GetRelativePath(Path.GetFullPath(AppContext.BaseDirectory), full);
        if (fromApplication == "." || (!Path.IsPathRooted(fromApplication) && fromApplication != ".." &&
            !fromApplication.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal)))
            throw new ArgumentException("摘要数据不能写入应用程序安装目录。", nameof(path));
        RejectLinks(full);
        return full;
    }

    private static string Absolute(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || !Path.IsPathFullyQualified(path))
            throw new ArgumentException("必须明确提供绝对路径。", nameof(path));
        return Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));
    }

    internal static void RejectLinks(string path)
    {
        for (string? current = path; current is not null; current = Path.GetDirectoryName(current))
        {
            // GetAttributes also detects dangling symbolic links; Exists would hide them.
            try
            {
                if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new SummaryValidationException("摘要路径不能经过符号链接或重解析点。");
            }
            catch (FileNotFoundException) { }
            catch (DirectoryNotFoundException) { }
        }
    }
}

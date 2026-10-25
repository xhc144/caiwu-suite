namespace Caiwu.BookTools;

internal sealed class CopyWorkspace : IDisposable
{
    private readonly HashSet<string> owned = [];
    private readonly string directory;
    private bool cleaned;

    internal CopyWorkspace(string parent)
    {
        directory = Path.Combine(parent, ".caiwu-copy-" + Guid.NewGuid().ToString("N"));
        if (Path.Exists(directory)) throw new IOException("临时工作目录已存在。");
        Directory.CreateDirectory(directory);
        // Reserve only these names in our new directory. Create can publish its file
        // then fail to reopen it; that file is still our unfinished candidate to clean.
        owned.UnionWith([Capture, Candidate, Ready]);
    }

    internal string Capture => Path.Combine(directory, "captured.caiwu");
    internal string Candidate => Path.Combine(directory, "candidate.caiwu");
    internal string Ready => Path.Combine(directory, "ready.caiwu");

    internal IReadOnlyList<string> Cleanup()
    {
        if (cleaned) return [];
        cleaned = true;
        var warnings = new List<string>();
        // On Unix publication adds a hard link; unlinking our ready name leaves
        // the winner's destination intact. On Windows the moved name is absent.
        foreach (var path in owned)
            foreach (var suffix in new[] { "", "-wal", "-shm", "-journal" })
                Try(() => File.Delete(path + suffix), path + suffix, warnings);
        // Never recurse: an unknown file is not ours to remove.
        Try(() => Directory.Delete(directory, recursive: false), directory, warnings);
        return warnings.AsReadOnly();
    }

    private static void Try(Action action, string path, List<string> warnings)
    {
        try { action(); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        { warnings.Add($"临时文件清理未完成：{path}（{e.Message}）"); }
    }

    public void Dispose() => Cleanup();
}

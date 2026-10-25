namespace Caiwu.Summaries;

internal sealed class AtomicCatalogFile
{
    // A narrow stream-writing seam permits real partial-write failure tests without changing production APIs.
    private readonly Action<Stream, byte[]> write;
    internal AtomicCatalogFile(Action<Stream, byte[]>? write = null) => this.write = write ?? ((s, b) => s.Write(b));

    internal static byte[] Read(string path)
    {
        SummaryCatalogLocation.RejectLinks(path);
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        if (stream.Length > CatalogCodec.MaxBytes) throw new SummaryCorruptException("摘要文件超过大小限制。");
        using var buffer = new MemoryStream();
        var chunk = new byte[8192];
        int count;
        while ((count = stream.Read(chunk)) != 0)
        {
            if (buffer.Length + count > CatalogCodec.MaxBytes) throw new SummaryCorruptException("摘要文件超过大小限制。");
            buffer.Write(chunk, 0, count);
        }
        return buffer.ToArray();
    }

    internal static FileStream Lock(string path)
    {
        SummaryCatalogLocation.RejectLinks(path + ".lock");
        try { return new FileStream(path + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
        catch (IOException ex) { throw new SummaryBusyException("摘要库正由其他窗口或进程写入，或锁文件不可用；请稍后重试。", ex); }
    }

    internal void Publish(string path, byte[] bytes, bool overwrite)
    {
        SummaryCatalogLocation.RejectLinks(path);
        var temporary = Path.Combine(Path.GetDirectoryName(path)!, ".summary-" + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                write(stream, bytes);
                stream.Flush(flushToDisk: true);
            }
            SummaryCatalogLocation.RejectLinks(path);
            // Same directory / filesystem: publish one fully flushed document with a single rename.
            File.Move(temporary, path, overwrite);
        }
        finally
        {
            try { File.Delete(temporary); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }
}

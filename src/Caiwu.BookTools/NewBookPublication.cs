using System.ComponentModel;
using System.Runtime.InteropServices;

namespace Caiwu.BookTools;

/// <summary>Publishes a complete same-filesystem stage with atomic rejection of an existing name.</summary>
internal static class NewBookPublication
{
    internal static void Publish(string stage, string destination)
    {
        if (OperatingSystem.IsWindows())
        {
            // .NET uses MoveFileEx without MOVEFILE_REPLACE_EXISTING for this operation.
            File.Move(stage, destination, overwrite: false);
        }
        else if (LinkNew(stage, destination) != 0)
        {
            // Same rule as Storage repair 4e8664d: never use check-then-rename or
            // a partial-copy fallback. The caller still owns the staging name.
            var error = new Win32Exception(Marshal.GetLastPInvokeError());
            throw new IOException("无法安全发布新账套：目标已存在或文件系统不支持原子硬链接发布。", error);
        }
    }

    [DllImport("libc", EntryPoint = "link", SetLastError = true)]
    private static extern int LinkNew(
        [MarshalAs(UnmanagedType.LPUTF8Str)] string existingPath,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string newPath);
}

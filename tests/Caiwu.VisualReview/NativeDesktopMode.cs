using System.Runtime.InteropServices;

// Match Acceptance/HighResolution's native mode setup. Window sizing alone is
// clamped to the runner's smaller desktop; image resizing is never a substitute.
internal sealed class NativeDesktopMode : IDisposable
{
    private const int ModeBytes = 220;
    private readonly IntPtr mode = Marshal.AllocHGlobal(ModeBytes);
    private byte[]? original;
    private bool disposed;
    private NativeDesktopMode() { }
    public static NativeDesktopMode EnsureFullHd()
    {
        var scope = new NativeDesktopMode();
        try
        {
            SetProcessDpiAwarenessContext(new IntPtr(-4));
            Marshal.Copy(new byte[ModeBytes], 0, scope.mode, ModeBytes);
            Marshal.WriteInt16(scope.mode, 68, ModeBytes);
            if (!EnumDisplaySettings(null, -1, scope.mode)) throw new InvalidOperationException("BLOCKED: cannot read actual native desktop mode.");
            scope.original = new byte[ModeBytes]; Marshal.Copy(scope.mode, scope.original, 0, ModeBytes);
            if (GetSystemMetrics(0) < 1920 || GetSystemMetrics(1) < 1080)
            {
                Marshal.WriteInt32(scope.mode, 72, Marshal.ReadInt32(scope.mode, 72) | 0x180000);
                Marshal.WriteInt32(scope.mode, 172, 1920); Marshal.WriteInt32(scope.mode, 176, 1080);
                if (ChangeDisplaySettings(scope.mode, 2) != 0 || ChangeDisplaySettings(scope.mode, 0) != 0)
                    throw new InvalidOperationException("BLOCKED: native desktop cannot support 1920x1080; no resized image produced.");
            }
            if (GetSystemMetrics(0) < 1920 || GetSystemMetrics(1) < 1080)
                throw new InvalidOperationException("BLOCKED: native desktop mode change did not take effect.");
            return scope;
        }
        catch { scope.Dispose(); throw; }
    }
    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        if (original is not null)
        {
            Marshal.Copy(original, 0, mode, ModeBytes); ChangeDisplaySettings(mode, 0); original = null;
        }
        Marshal.FreeHGlobal(mode);
    }
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool EnumDisplaySettings(string? device, int mode, IntPtr settings);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int ChangeDisplaySettings(IntPtr settings, uint flags);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
}

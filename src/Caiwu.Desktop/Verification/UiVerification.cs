using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Caiwu.Desktop.Presentation;

namespace Caiwu.Desktop.Verification;

internal static class UiVerification
{
    public static void Run(App app, DesktopBackend backend, string destination)
    {
        var directory = Path.GetFullPath(destination); Directory.CreateDirectory(directory);
        app.ShutdownMode = ShutdownMode.OnExplicitShutdown;
        try
        {
            var database = Path.Combine(directory, "ui-verification-" + Guid.NewGuid().ToString("N") + ".caiwu");
            var id = SampleLedger.Create(backend, database);
            System.Windows.Media.RenderOptions.ProcessRenderMode = System.Windows.Interop.RenderMode.SoftwareOnly;
            var window = new MainWindow(backend); app.MainWindow = window; window.Show();
            window.OpenVerificationBook(database);
            app.Dispatcher.InvokeAsync(() =>
            {
                try
                {
                    window.ShowVerificationPage(1); Capture(window, Path.Combine(directory, "voucher-list.png"));
                    window.ShowVerificationPage(4); Capture(window, Path.Combine(directory, "trial-balance.png"));
                    window.ShowVerificationPage(3); Capture(window, Path.Combine(directory, "opening-balances.png"));
                    var voucher = window.OpenVerificationVoucher(id);
                    voucher.Dispatcher.InvokeAsync(() =>
                    {
                        try
                        {
                            Capture(voucher, Path.Combine(directory, "posted-voucher.png"));
                            File.WriteAllText(Path.Combine(directory, "ui-verification.json"), JsonSerializer.Serialize(new
                            {
                                success = true, generatedAtUtc = DateTimeOffset.UtcNow,
                                evidence = "Actual self-authored WPF windows rendered with a real synthetic SQLite book. No original software was executed.",
                                manualInteractionTested = false,
                                screenshots = new[] { "voucher-list.png", "trial-balance.png", "opening-balances.png", "posted-voucher.png" }
                            }, new JsonSerializerOptions { WriteIndented = true }));
                            voucher.Close(); window.Close(); app.Shutdown(0);
                        }
                        catch (Exception ex) { Fail(app, directory, ex); }
                    }, DispatcherPriority.ApplicationIdle);
                }
                catch (Exception ex) { Fail(app, directory, ex); }
            }, DispatcherPriority.ApplicationIdle);
        }
        catch (Exception ex) { Fail(app, directory, ex); }
    }

    private static void Capture(Window window, string path)
    {
        window.UpdateLayout();
        var visual = window.Content as FrameworkElement ?? throw new InvalidOperationException("窗口内容不可渲染。");
        var width = (int)Math.Ceiling(visual.ActualWidth); var height = (int)Math.Ceiling(visual.ActualHeight);
        if (width <= 0 || height <= 0) throw new InvalidOperationException("窗口布局为空。");
        var bitmap = new RenderTargetBitmap(width, height, 96, 96, PixelFormats.Pbgra32); bitmap.Render(visual);
        var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var output = File.Create(path); encoder.Save(output);
    }

    private static void Fail(App app, string directory, Exception ex)
    {
        File.WriteAllText(Path.Combine(directory, "ui-verification-failure.txt"), ex.ToString()); app.Shutdown(1);
    }
}

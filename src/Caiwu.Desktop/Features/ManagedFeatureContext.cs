using System.IO;
using System.Security.Cryptography;
using System.Text;
using Caiwu.Contracts;
using Caiwu.Delivery;
using Caiwu.Delivery.Modules;
using Caiwu.Desktop.Presentation;
using Caiwu.Operators;

namespace Caiwu.Desktop.Features;

/// <summary>The already verified child-owned Delivery session; never reacquires the launcher's OS lock.</summary>
public sealed class ManagedFeatureContext(ManagedDataSession data)
{
    public ManagedDataSession Data { get; } = data;
    public ManagedModuleHost Modules { get; } = new(data);

    public DesktopFeatureOptions Options(FeatureAuthentication authentication) => new()
    {
        Authentication = authentication, Managed = this,
        OpenSummaryCatalog = binding => binding.Authentication.Operators.Execute(binding.Authentication.Session, OperatorPermission.ReadLedger, _ =>
        { binding.DemandCurrent(); return Summary(Modules.OpenSummary(binding.DatabasePath, binding.Shown.Book.Id)); }),
        CanInitializeSummaryCatalog = binding =>
        {
            var book = Data.FindBook(binding.DatabasePath, binding.Shown.Book.Id);
            return !Data.ReadInventory().Attachments.Any(a => a.InstanceId == book.InstanceId && a.Key == "summaries");
        },
        InitializeSummaryCatalog = binding => binding.Authentication.Operators.Execute(binding.Authentication.Session, OperatorPermission.PrepareVoucher, _ =>
        { binding.DemandCurrent(); return Summary(Modules.InitializeSummary(binding.DatabasePath, binding.Shown.Book.Id)); }),
        BookCopy = new(
            binding => { binding.DemandCurrent(); Data.FindBook(binding.DatabasePath, binding.Shown.Book.Id); return Data.AcquireOperationLease(); },
            (binding, path) => { binding.DemandCurrent(); Data.ValidateNewBookDestination(path); },
            (binding, result) => { binding.DemandCurrent(); Data.RegisterBook(result.DestinationPath, result.Book.Id); })
    };
    private static SummaryFeatureRegistration Summary(RegisteredSummaryCatalog registered) => new(registered.Catalog,
        registered.Attachment.Key, "受管完整备份包含此物理账套和全部登记附件；全局账号单独备份。");

    public DesktopBackend BindBackend(DesktopBackend authenticated) => authenticated with
    {
        Open = path =>
        {
            ValidateExisting(path);
            var store = authenticated.Open(path);
            try { Data.RegisterBook(store.DatabasePath, store.Read().Book.Id); return store; }
            catch { store.Dispose(); throw; }
        },
        Create = (path, book, accounts) =>
        {
            Data.ValidateNewBookDestination(path);
            var store = authenticated.Create(path, book, accounts);
            try { Data.RegisterBook(store.DatabasePath, book.Id); return store; }
            catch (Exception ex) { store.Dispose(); throw new IOException("账套文件已创建并保留，但登记未完成，请核对后重新打开：" + path, ex); }
        },
        Restore = (_, _) => throw new InvalidOperationException("受管模式请使用完整备份收据恢复，不能遗漏附件。")
    };

    public string ModuleDirectory(FeatureSessionBinding binding, string module)
    {
        binding.DemandCurrent();
        var book = Data.FindBook(binding.DatabasePath, binding.Shown.Book.Id);
        var directory = Path.GetDirectoryName(Data.ModulePath(book, module, "path-check.json"))!;
        Directory.CreateDirectory(directory); return directory;
    }

    public int RegisterModuleFiles(FeatureSessionBinding binding, string module, string codecId)
    {
        binding.DemandCurrent(); binding.Authentication.Demand(OperatorPermission.PrepareVoucher);
        using var operation = Data.AcquireOperationLease();
        var book = Data.FindBook(binding.DatabasePath, binding.Shown.Book.Id);
        var directory = ModuleDirectory(binding, module);
        var codec = Modules.Codecs.Single(c => c.Id == codecId);
        var count = 0;
        foreach (var path in Directory.EnumerateFiles(directory, "*.json", SearchOption.TopDirectoryOnly))
        {
            var name = Path.GetFileName(path);
            var key = module.ToLowerInvariant() + "-" + Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(name)))[..24];
            Data.RegisterAttachment(book, key, codec.Id, path, codec); count++;
        }
        return count;
    }

    public string ApproveModuleFile(FeatureSessionBinding binding, string module, string selected)
    {
        var directory = ModuleDirectory(binding, module);
        var full = SafePaths.Full(selected);
        if (!string.Equals(Path.GetDirectoryName(full), directory, StringComparison.OrdinalIgnoreCase) || !full.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("请选择当前物理账套指定模块目录中的 JSON 文件。");
        return Data.ModulePath(Data.FindBook(binding.DatabasePath, binding.Shown.Book.Id), module, Path.GetFileName(full));
    }

    private void ValidateExisting(string path)
    {
        var full = SafePaths.Full(path);
        if (!SafePaths.Contains(Data.DataRoot, full) || !full.EndsWith(".caiwu", StringComparison.OrdinalIgnoreCase) ||
            new[] { "Global", ".delivery-backups", ".delivery-scratch" }.Any(d => SafePaths.Contains(SafePaths.Child(Data.DataRoot, d), full)))
            throw new InvalidDataException("请选择已配置受管数据根内的账套；根外、Global 或备份目录不可直接打开。");
        _ = SafePaths.Child(Data.DataRoot, Path.GetRelativePath(Data.DataRoot, full));
    }
}

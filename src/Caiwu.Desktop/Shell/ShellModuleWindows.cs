using System.Windows;
using Caiwu.Desktop.Features;
using Caiwu.Operators;

namespace Caiwu.Desktop.Shell;

// Shell-owned adapter DTOs. Map Contracts.ParityModuleRegistration into these without copying or truncating module documents.
public sealed record ShellOriginalWindow(string Product, string ObjectName, string Entry);
public sealed record ShellModuleWindowContext(Window Owner, FeatureSessionBinding Session, DateOnly OperationDate, ShellOriginalWindow OriginalWindow);
public sealed record ShellModuleWindows(string ModuleId, int ContractVersion, IReadOnlyList<ShellOriginalWindow> OriginalWindows,
    OperatorPermission Permission, Action<ShellModuleWindowContext> Open);

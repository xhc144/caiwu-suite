# Operators focused Windows acceptance

This is an independent component host. It creates `Application`, loads the actual `Caiwu.Desktop/Themes/Modern.xaml`, and opens production Operators WPF windows. It does **not** execute product `App.OnStartup`, an installed product, an installer/update, or the full Desktop entry point. Candidate-installation acceptance belongs to the integration owner.

The baseline is `codex/sprint-integration-2` at `10e38ff65313aae5106a6b55c42790d47345b8fb`. Operators production tree matches `1957435365390756fd8267937fd0ec408b1e498f` (which contains first-stage `7a1e673`); the Modern theme tree matches `98a43e0`; Core/Contracts are v1.2. `prepare.ps1` refuses different frozen production trees and records the exact checkout/source tree and SHA256 of this group's sources.

Run on an actual Windows desktop runner with .NET SDK 10.0.402:

```powershell
./tests/Caiwu.ModuleWindowsQA/Operators/prepare.ps1
./.tools/operators-baseline/tests/Caiwu.Operators.Tests/Run-WindowsSmoke.ps1 -OutputDirectory "$PWD/artifacts/module-operators-qa/author-smoke"
./tests/Caiwu.ModuleWindowsQA/Operators/run.ps1
```

Preparation extracts the author's original script, original seven-case routed-handler probe, and `DesktopCompositionExample.cs` from the immutable Operators commit into ignored `.tools/operators-baseline`. A directory junction resolves its original project references to the frozen current production sources. The original script is run unchanged. The additional project compiles that same composition example and uses its normal authorization factory, backup, logout and captured-editor functions. There is no alternative authentication implementation or production default password.

The ten additional scenarios exercise native Win32 `SendInput` mouse/Unicode/Tab/Enter/Escape against the foreground production dialogs, first-use cancellation, setup validation followed by separate cancelled login, explicit login, invalid-login retry focus, password clearing, administrator management, role mutation and disable revocation, last-administrator preservation, non-admin rejection, password change/relogin, and old adapter/factory revocation after replacement login. Native Unicode injection is **not** an IME or a human keyboard test.

The accounting cases use actual SQLite and Core through the compiled authorized adapter. They test independent-actor preparation/review/cancel-review/review/post/close, caller display-name/ActorKey spoof rejection, rename-stable actor identity, audit actors, and the independent calculation opening 100 + posted 10 = 110. A real captured production editor attempts to save after switching to a restored file with the exact same BookId/revision; `SessionBoundMutation` must reject the old physical session, retain the window, and leave both files unchanged. Same-path close/reopen is also rejected. These protections require both the adapter and the host's captured `LedgerSession` generation; a bare actor string or bare `ILedgerService` does not encode physical-session identity.

All identities, ledger data and new-probe passwords are generated only inside a fresh GUID temporary directory. No actual user identity directory is read. Passwords/hashes are absent from arguments, environment variables, assertions, results and uploaded files. Images require empty masked password fields. Only explicit JSON/PNG/log allowlists are uploaded; identity files, ledgers, backups and binaries are excluded. The author's unchanged baseline has a fixed synthetic fixture password confined to its test executable; it never enters product builds. No network authentication or system privilege configuration is used.

Results remain incomplete until the corresponding real Windows run and artifacts exist. Linux cross-build and the author's earlier 100 Linux tests cannot establish Windows interaction success. IME composition, screen reader behavior, human keyboard/accessibility review, multi-monitor and a DPI matrix remain untested by this group.

Integration: cherry-pick this group's commit, retain the focused workflow, and run on the frozen source baseline. If production source trees change, review those changes and intentionally update the pin manifest before rerunning. No Desktop/MainWindow, Contracts, Core, SQLite, installation or global workflow files are changed by this group.

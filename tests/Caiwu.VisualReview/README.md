# Native WPF visual review

This is an optional independent Windows runner, outside the solution. It changes no application behavior or account data. `WinExe` is intentional: the existing packaging test discovery does not launch this screenshot app or treat it as an xUnit test. The isolated visual workflow first runs this harness with `-DesktopCapture` and immediately uploads its six native desktop images; it then runs complete-window captures and the existing narrow WPF/navigation regressions. The original Acceptance workflow is unchanged.

```powershell
./tests/Caiwu.VisualReview/run.ps1 -OutputDirectory artifacts/verification/modern
```

Add `-DesktopCapture` to capture the full native primary desktop with BitBlt, stable maximized bounds, repeated dispatcher/render pumping and DwmFlush. Both capture modes reject large black compositor-transition regions, retain original dimensions and restore the prior display mode.

The runner builds itself, creates a fresh synthetic SQLite book, opens the actual Desktop windows, and captures six complete native 1920×1080 windows using Win32 `PrintWindow`. It does not resize, crop, upscale, load original software, save real books, or create an installer. It fails if native dimensions are unavailable. JSON records commit/source-tree identity, dimensions, DPI, PNG SHA256s, and the exact checks performed. Partial screenshots do not count as a passing run. Timeout is 90 seconds; failed JSON/logs are retained. Windows desktop execution is still required; Linux compilation is not a runtime pass.

It records actual GlyphTypeface names, body weight/colour and per-row report cell/header positions and widths, and checks grouped right-aligned amounts. It checks button template application plus the native automation peer/focus traversal, DatePicker popup, existing menu opening, editable DataGrid amount entry/cancel, read-only posted vouchers, visible voucher widths, and the existing Controls account/summary dialogs under the actual global App resources. It is not a full keyboard/IME/screen-reader/high-contrast certification. The existing Acceptance and Controls interaction regressions remain required.

The six views are workspace, vouchers, voucher (editable in desktop mode; posted/read-only in window mode), trial balance, populated bank ledger, and reports. The metadata identifies each capture mode. The original Acceptance capture can race a native maximize/compositor transition; the isolated desktop mode waits and rejects such frames.

A source boundary guard runs on Linux or Windows with Node:

```sh
node tests/Caiwu.VisualReview/verify-xaml.mjs 6a155a5b2deec55bbf0fe8ac9fbc3e0903750ac5
```

It compares all names, automation IDs, bindings, event handler names, and write-operation tags to the behavior-owning baseline. It is a boundary check, not visual approval.

## Integration

Base: `codex/windows-revalidation` at `6a155a5b2deec55bbf0fe8ac9fbc3e0903750ac5`. Apply the visual commits to the current integration branch without replacing code-behind, Contracts, Core or Storage. Preserve newer bindings if an XAML conflict occurs. The `Themes/Modern.xaml` dictionary merges Microsoft's complete built-in `Fluent.Light.xaml` dictionary before the application styles. The colour-free `Fluent.xaml` alone was insufficient in actual screenshots. Native TextBox/ComboBox/DatePicker/Menu/DataGrid styles use `BasedOn` with the explicit .NET 10 `Default…Style` resource keys so their complete templates survive. A first actual screenshot exposed legacy templates despite a type-key BasedOn; the named keys correct that resolution. DataGrid CellStyle/ColumnHeaderStyle explicitly select the spacing/focus overlays because Fluent itself sets these properties. Button and navigation templates are self-authored and preserve access keys, pressed/hover/disabled and keyboard focus.

`App.xaml` merges `Themes/Modern.xaml`. The three existing XAML windows explicitly select the Window style because an implicit base-Window style alone is not sufficient for custom Window subclasses. Exact-type styles also apply the same Window typography to the existing code-created NewBookWindow, AccountWindow and AccountPickerWindow, without editing their behavior. Controls' picker-local styles take precedence as before; this change does not edit that module or replace its selection/edit semantics.

No NuGet dependency added. No pre-mounted book repository, original installer, extracted resources or derived catalogs were modified or uploaded. The delivery hold remains intact.

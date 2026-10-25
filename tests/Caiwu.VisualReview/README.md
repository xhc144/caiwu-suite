# Native WPF visual review

An independent Windows runner for the actual Desktop windows, synthetic SQLite books, and existing Controls dialogs. It lives outside the solution and adds no NuGet dependency. The `WinExe` target avoids accidental launch by old packaging test discovery.

```powershell
./tests/Caiwu.VisualReview/run.ps1 -OutputDirectory artifacts/high-resolution
```

Requires a real Windows desktop and the repository's .NET 10 SDK. The process is bounded to 90 seconds. It tests/applies a supported native desktop mode, maximizes each actual window, pumps layout/render messages, calls DwmFlush, verifies foreground/maximized/client bounds, and uses native BitBlt. The original display mode is restored in finally. It never resizes, crops or upscales a PNG. Unsupported display modes, unstable bounds, large black transition frames, missing output, wrong source identity or failed checks are failures rather than inferred passes.

It writes six 1920×1080 native desktop PNGs: `01-workspace.png`, `02-vouchers.png`, `03-voucher-editor.png`, `04-trial-balance.png`, `05-bank-ledger.png`, `06-reports.png`. `visual-review.json` records commit/src identity, original dimensions/DPI, PNG SHA256s, actual GlyphTypeface families, body weight/colour, per-row report cell/header positions/widths/text, and the checks performed. Failed runs keep partial evidence; a partial PNG set is not approval.

The runner checks actual native templates, automation peer/focus, calendar popup, menu, editable amount entry/cancel, posted read-only state, both Controls pickers under global resources, rendered Chinese/amount glyph families, neutral normal-weight body text, all 70 cells in the seven-row report fixture, full-width right-aligned amounts and grouping. The isolated visual workflow uploads these images first, then invokes the existing eight WPF and two bounded navigation regressions. It does not run the full business CI or create a distribution package.

A source boundary guard runs on Linux or Windows with Node:

```sh
node tests/Caiwu.VisualReview/verify-xaml.mjs 6a155a5b2deec55bbf0fe8ac9fbc3e0903750ac5
```

It compares existing operation labels, names, automation IDs, bindings, event handler names and WriteOperation tags to the behavior-owning base. It is a boundary check, distinct from rendering and interaction validation.

`Themes/Modern.xaml` merges the complete .NET 10 Fluent Light dictionary and uses explicit `Default…Style` keys for native inputs/calendars/menus. Custom Window styles apply explicitly or by exact type. Selected TabItem styling is scoped to its header so blue/semi-bold styling cannot leak into page content. The complete cell template stretches content to the actual column width while retaining the native DataGridCell/editor/automation behavior.

`Themes/ReportGridPresentation.cs` is a display-only attached decorator enabled on the read-only ReportGrid. It uses typed ReportCell amount metadata, preserves existing binding paths/modes, groups the read-only displayed amounts and totals, selects the amount element/header styles, and sets a readable amount minimum width. It does not change ReportCell values, exports, Core, Contracts, SQLite, or business commands. Report columns are not virtualized; rows still are. No existing code-behind handler/signature is changed.

See [HANDOFF.md](HANDOFF.md) for immutable validated commits, original artifact IDs, exact integration ranges, repaired attempts and remaining acceptance limits. No original commercial software/resources, pre-mounted book library or real book data are used.

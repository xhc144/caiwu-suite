# WPF visual module handoff — 2026-10-25

Deliverable: native WPF visual redesign, private draft [PR 14](https://github.com/xhc144/caiwu-suite/pull/14), branch `codex/modern-visuals`. Ready for integration; no merge, distribution or production-accounting approval is claimed.

Validated code commit: `7a845d4e637326c28774740580b675fcc5d240c4`.
Behavior-owning base: `6a155a5b2deec55bbf0fe8ac9fbc3e0903750ac5` from `codex/windows-revalidation`.
Validated `src` tree: `afc9f3328856ee207b5257ff73589c73bae058aa`.
The subsequent handoff-only commit changes this file, not that `src` tree; it does not require another Windows rendering run.

## Actual evidence

[Isolated Windows run 40181737928](https://github.com/xhc144/caiwu-suite/actions/runs/40181737928): **success** at the validated code commit.

- [Primary original PNG artifact 12594895184](https://github.com/xhc144/caiwu-suite/actions/runs/40181737928/artifacts/12594895184): `main-window.png`, `voucher-editor.png`, `ledger.png`, `report.png`; each 1920×1080 at 96 DPI, actual foreground native desktop BitBlt. No crop, resize, upscale, black padding or generated mockup. All four were downloaded and visually inspected; every PNG SHA256 matches `screenshots.json`.
- [Checks artifact 12594223314](https://github.com/xhc144/caiwu-suite/actions/runs/40181737928/artifacts/12594223314): nine actual visual/runtime checks pass, including template identities, focus/automation peer, calendar popup, menu, editable amount cell, posted read-only state, both Controls picker dialogs under global App resources, and right-aligned generated report amounts. Also six complete 1920×1080 native-window PrintWindow PNGs with SHA256s.
- The same checks artifact contains the existing eight actual WPF regressions and both new-book/report navigation cases: all PASS, zero failed or blocked. Read-only navigation, invalid/busy/stale saves retaining input and rapid double-save protection were exercised against actual WPF classes and synthetic SQLite books.
- Official .NET SDK 10.0.402: Desktop, independent VisualReview, and full solution Release cross-builds passed with zero warnings/errors. Linux compilation is distinct from the Windows evidence above.
- `node tests/Caiwu.VisualReview/verify-xaml.mjs`: all existing operation labels, names, automation IDs, bindings, handler names and WriteOperation guards match the behavior base. `git diff --check` passes.

Primary `main-window.png` SHA256: `20c4be47d47b3aeb12ce3d8984b4a7d29ca5dfb9ee535380106b516a0d87c08c`.
Primary `report.png` SHA256: `c5247604005d2bae184bc7c9031123ddf61fa035d48dd8335d8d168aab527951`.

## Integration

Apply only the module commits, preserving the integration branch's newer code-behind/Core/Contracts:

```sh
git fetch origin codex/modern-visuals
git cherry-pick 6a155a5b2deec55bbf0fe8ac9fbc3e0903750ac5..7a845d4e637326c28774740580b675fcc5d240c4
```

The code never changes code-behind, event signatures, Contracts, Core, SQLite, Controls implementation, solution, existing workflow, installer or delivery hold. Keep any newer binding if the integrator encounters an XAML conflict. This branch already preserved OpeningGrid's PropertyChanged update bindings from v1.2.

Owned files:

| Path | Purpose and boundary |
|---|---|
| `src/Caiwu.Desktop/Themes/Modern.xaml` | Complete built-in Fluent Light resources, explicit named native base styles, full self-authored Button/Tab templates, typography, focus/disabled/hover states, table and amount styles. Runtime verified. |
| `src/Caiwu.Desktop/App.xaml` | Merges that dictionary. |
| `src/Caiwu.Desktop/MainWindow.xaml` | Native shell/surfaces/navigation, action hierarchy, status and amount presentation; original bindings/handlers retained. |
| `src/Caiwu.Desktop/Dialogs/*.xaml` | Visual-only voucher/report surfaces and amount editors; original names/handlers retained. |
| `tests/Caiwu.VisualReview/**` | Bounded independent Windows runner, source guard and this evidence record. Excluded from the solution; WinExe intentionally avoids accidental launch by old packaging discovery. |
| `.github/workflows/visual-capture.yml` | Explicitly authorized scope exception: private branch-only capture job. Uploads the four primary images immediately, then runs only relevant visual/WPF/navigation checks. Contents read-only; pinned existing actions; no secrets, installer or publish step. |

The report cell style matches the current ReportBuilder amount headers because dynamically generated columns live in behavior-owned code. If those headers are localized/renamed, the owner can instead assign the existing `AmountCell` style when `column.Kind == ReportValueKind.Amount`; no accounting logic needs changing.

## Findings and repaired attempts

1. Local implicit Button style without a complete template/BasedOn had suppressed Fluent and produced legacy rectangles.
2. Type-key inheritance was insufficient in actual screenshots. The final theme uses official .NET10 named `Default…Style` bases and complete `Fluent.Light.xaml`; the colour-free `Fluent.xaml` alone left missing surfaces. Native TextBox/ComboBox/DatePicker template identity is checked at runtime.
3. Custom Window subclasses need an explicit/exact-type Window style. The installed family is `Segoe UI Variable Text`; YaHei UI is available as the Chinese fallback. Font size is verified at runtime.
4. Renaming the report Generate label broke a probe using the familiar label. Restored all operation labels, added a source guard, and reran both navigation cases successfully.
5. A small runner desktop clamped a requested 1920×1080 native window. The runner now tests/applies a supported native desktop mode and restores it in finally; it never upscales an image.

Sources for framework behavior/resources: [official WPF Fluent documentation](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/whats-new/net100), [official .NET10 Fluent Light resources](https://github.com/dotnet/wpf/blob/v10.0.0/src/Microsoft.DotNet.Wpf/src/Themes/PresentationFramework.Fluent/Themes/Fluent.Light.xaml).

## Remaining integration/acceptance work

- Integrator must apply this module to `codex/sprint-integration-2` and validate the combined result. No action is denied or uncertain in this module; push and draft PR succeeded.
- Earlier full runs `40180397486`/`40180961028` remain failed due to Delivery component file-sharing/backup failures and MutationWindows timeout. These are outside this module. Do not label the entire application accepted from this isolated visual pass; keep `DELIVERY_PAUSED`.
- Actual screenshots are 96 DPI. Physical Chinese IME, screen reader, Windows High Contrast and higher-DPI manual review have not been certified. Existing keyboard routes and accessibility peers were preserved and the specific scripted checks above passed.

Only synthetic books were created. The pre-mounted book library, original software/installers, original UI/SQL/object material, permissions and credentials were not modified or uploaded.
